// Steam plant process model.
// A ~35 MW gas-fired drum boiler (Astrom-Bell drum dynamics), superheater with attemperator,
// condensing turbine, synchronous generator on an infinite bus, condenser, deaerator and feed train.
// Units: MPa, degC, kg/s, kJ/kg, kW internally (MW where noted), seconds.
import * as S from './steam.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- design data
export const D = {
  fuelMax: 2.4,          // kg/s natural gas at 100% fuel valve
  LHV: 50000,            // kJ/kg
  AFR: 17.2,             // stoichiometric air/fuel (mass)
  airMax: 55,            // kg/s FD fan at 100%
  cpGas: 1.15,           // kJ/kgK
  pilotFuel: 0.025,      // kg/s
  // drum: 1.6 m dia x 10 m, plus risers/downcomers/headers
  drumR: 0.8, drumL: 10, Vtubes: 24,
  metalMass: 120000, cpMetal: 0.5,
  // superheater + main steam line volume
  Vsh: 10, shMetal: 40000,
  ratedSteam: 30,        // kg/s
  ratedP: 8.7,           // MPa at turbine throttle
  ratedT: 510,           // degC
  ratedMW: 36,
  // turbine / generator
  J: 1600,               // kg m2 combined rotor
  Kt: 2.5,              // turbine flow coefficient
  Sbase: 45,             // MVA
  Xs: 0.55,              // pu transfer reactance
  // condenser
  cwPerPump: 900,        // kg/s
  condC: 15000,          // kJ/K
  condV: 150,            // m3 free shell volume
  // tanks
  daVol: 60, hwVol: 25,
  // pumps
  bfpShutoff: 13.5, bfpQmax: 48,
  Tamb: 22,
};

class Valve {
  constructor(pos = 0, rate = 0.1) { this.cmd = pos; this.pos = pos; this.rate = rate; this.stuck = false; }
  step(dt) {
    if (this.stuck) return;
    const d = this.cmd - this.pos, m = this.rate * dt;
    this.pos += d > m ? m : d < -m ? -m : d;
  }
  set(v) { this.cmd = clamp(v, 0, 1); }
}

// PI(D) controller with bumpless auto/manual transfer and anti-windup
export class PID {
  constructor(o) {
    Object.assign(this, { kp: 1, ti: 10, lo: 0, hi: 1, sp: 0, out: 0, auto: true, dir: 1, name: '', unit: '', pv: 0 }, o);
    this.i = this.out;
  }
  run(pv, dt, ff = 0) {
    this.pv = pv;
    const e = this.dir * (this.sp - pv);
    if (!this.auto) { this.i = this.out - this.kp * e - ff; return this.out; }
    this.i += this.kp * e * dt / this.ti;
    let o = this.kp * e + this.i + ff;
    if (o > this.hi) { o = this.hi; this.i = Math.min(this.i, o - this.kp * e - ff); }
    if (o < this.lo) { o = this.lo; this.i = Math.max(this.i, o - this.kp * e - ff); }
    this.out = o;
    return o;
  }
  track(out, pv, ff = 0) { this.out = out; this.pv = pv; this.i = out - this.kp * this.dir * (this.sp - pv) - ff; }
}

function segArea(R, h) { // circular segment area with depth h
  h = clamp(h, 0, 2 * R);
  return R * R * Math.acos((R - h) / R) - (R - h) * Math.sqrt(Math.max(0, 2 * R * h - h * h));
}

// ---------------------------------------------------------------- plant
export class Plant {
  constructor() { this.reset('hot'); }

  reset(scenario = 'hot') {
    this.t = 0;
    this.events = [];
    this.log = [];
    this.scenario = scenario;
    this.over = null;     // catastrophic end state
    this.rng = 1234567;

    this.env = { Tamb: D.Tamb, Tcw: 20, gridF: 60, gridV: 1.0, gridOK: true, gasP: 0.35, price: 65, fuelPrice: 4.2 };

    this.fault = {
      bfpATrip: false, tubeLeak: 0, gridLoss: false, fdTrip: false, gasLow: false, cwTrip: false,
      airLeak: false, ltDrift: 0, fcvStuck: false, svSeized: false, otsFail: false, scannerFail: false,
    };
    this.bypass = { bms: false, syncCheck: false };
    this.interlocks = { turbTripRunback: true, mftTripsTurbine: true };

    // ---- fuel & air
    this.fd = { run: false, speed: 0, amps: 0 };
    this.damper = new Valve(0, 0.12);
    this.fcv = new Valve(0, 0.08);          // gas flow control valve
    this.fuel = { ssov: false, pilot: false, ignitor: false, flow: 0, pilotFlow: 0 };
    this.air = { flow: 0, pct: 0 };
    this.bms = { state: 'TRIPPED', purgeT: 0, purgeDone: false, purgeExpire: 0, pilotFlame: false, mainFlame: false,
      scanner: false, tripCause: 'Initial state – reset BMS', trialT: 0, pilotOnT: 0, mainOnT: 0, flameLossT: 0 };
    this.furn = { T: 60, Qrel: 0, lambda: 9, o2: 20.9, co: 0, nox: 0, smoke: 0, Tstack: 25, eff: 0, unburned: 0,
      Qev: 0, Qsh: 0, Qec: 0, Qbb: 0, Qaph: 0, pres: 0, flameT: 0, firing: 0, ignition: 0 };

    // ---- drum / evaporator
    const Vdrum = Math.PI * D.drumR ** 2 * D.drumL;
    this.drum = { p: 0.1013, Vwt: D.Vtubes + Vdrum * 0.5, Vbub: 0, level: 0, Ts: 100, dTdt: 0, tds: 40,
      Vdrum, carry: 0, tubeT: 100, prevP: 0.1013, levelA: 0, levelB: 0, ventPos: 0 };
    this.drumVent = new Valve(0, 0.2);
    this.cbd = new Valve(0.1, 0.2);         // continuous blowdown
    this.ibd = new Valve(0, 0.5);           // intermittent bottom blowdown

    // ---- superheater / main steam
    this.sh = { p: 0.1013, h: 2676, T: 100, Tm: 60, Tout: 100, qin: 0, hOut: 2676, qspray: 0, Tline: 30, condensate: 0, wet: 0 };
    this.spray = new Valve(0, 0.1);
    this.vent = new Valve(0, 0.15);          // SH start-up vent (to silencer)
    this.drain = new Valve(0, 0.3);          // main steam line drains
    this.erv = { auto: true, open: false, man: false, set: 9.5 };
    this.svs = [
      { id: 'SV-1', loc: 'drum', set: 10.3, open: false, q: 0, k: 1.1 },
      { id: 'SV-2', loc: 'drum', set: 10.5, open: false, q: 0, k: 1.1 },
      { id: 'SV-3', loc: 'sh', set: 9.8, open: false, q: 0, k: 1.0 },
    ];

    // ---- feedwater
    this.bfp = [mkPump('BFP-A'), mkPump('BFP-B')];
    this.fwcv = new Valve(0, 0.08);
    this.fwbp = new Valve(0, 0.05);           // start-up bypass
    this.fw = { q: 0, pDis: 0.3, Tecon: 60, qrec: 0, recircAuto: true, recirc: new Valve(1, 0.3) };

    // ---- turbine / generator
    this.tb = { omega: 0, rpm: 0, latched: false, msv: false, msvPos: 0, gv: new Valve(0, 0.25), q: 0, Pm: 0,
      hIn: 2676, hEx: 2500, xEx: 1, Tin: 100, Tr: 40, T1: 40, stress: 0, vib: 20, vibX: 20, bow: 0, tg: true,
      tgEngaged: true, stillT: 0, tripCause: 'Not latched', mode: 'speed', target: 0, ref: 0, accel: 150,
      mwSP: 0, mwRate: 3, mwRef: 0, gvLimit: 1, droop: 0.05, opc: false, exhT: 30, hoodSpray: false, eta: 0,
      qext: 0, induction: 0, lube: { aop: false, dcop: false, p: 0, Tbrg: 35, Tmax: 35 }, eccentric: 30, autoSync: false, valvePosMode: false, gvMan: 0 };
    this.gen = { breaker: false, field: false, E: 0, Efd: 0, Vt: 0, f: 0, phase: 0, delta: 0, Pe: 0, Q: 0, I: 0,
      avrSP: 1.0, varMode: false, Pnet: 0, aux: 0, revT: 0, lockout: false, Ifd: 0 };

    // ---- condenser / condensate / deaerator
    this.cond = { Tcs: 20, mAir: 175, p: 0.101, pVap: 0.0023, pAir: 0.099, cwA: false, cwB: false, cwFlow: 0,
      vacPump: false, hogger: false, vacBreaker: new Valve(1, 0.2), Q: 0, hw: 0.5 * D.hwVol * 995, hwLevel: 50,
      makeup: new Valve(0, 0.1), diaphragm: false, Tcw_out: 20, qin: 0 };
    this.cp = [mkPump('CP-A'), mkPump('CP-B')];
    this.cpLcv = new Valve(0, 0.1);
    this.da = { M: 0.6 * D.daVol * 940, h: 420, p: 0.11, T: 100, level: 60, peg: 0, qext: 0, qin: 0, do2: 40, qHeat: 0 };

    // ---- controllers
    this.ctl = {
      master: new PID({ name: 'Boiler master (pressure)', kp: 0.22, ti: 80, sp: D.ratedP, lo: 0.08, hi: 1, auto: false, unit: 'MPa' }),
      air: new PID({ name: 'Combustion air', kp: 0.6, ti: 5, lo: 0, hi: 1, auto: true, unit: '%' }),
      o2: new PID({ name: 'O₂ trim', kp: 0.015, ti: 90, sp: 3.0, lo: 0.85, hi: 1.35, out: 1.05, auto: true, unit: '%' }),
      lvl: new PID({ name: 'Drum level', kp: 0.0012, ti: 45, sp: 0, lo: 0, hi: 1, auto: true, unit: 'mm' }),
      lvl3: new PID({ name: 'Drum level (3-elem outer)', kp: 0.04, ti: 90, sp: 0, lo: -12, hi: 12, auto: true, out: 0 }),
      fwf: new PID({ name: 'Feed flow (3-elem inner)', kp: 0.008, ti: 4, lo: 0, hi: 1, auto: true }),
      sht: new PID({ name: 'Main steam temp', kp: 0.008, ti: 40, sp: D.ratedT, lo: 0, hi: 1, dir: -1, auto: true, unit: '°C' }),
      daP: new PID({ name: 'Deaerator pressure', kp: 6, ti: 30, sp: 0.30, lo: 0, hi: 1, auto: true, unit: 'MPa' }),
      daL: new PID({ name: 'Deaerator level', kp: 0.04, ti: 90, sp: 60, lo: 0, hi: 1, auto: true, unit: '%' }),
      hwL: new PID({ name: 'Hotwell level (makeup)', kp: 0.06, ti: 120, sp: 50, lo: 0, hi: 1, auto: true, unit: '%' }),
    };
    this.firingMan = 0.08;     // manual firing demand when master in manual
    this.threeElement = false;

    this.alarms = new Map();
    this.damage = { boiler: 0, sh: 0, turbine: 0, gen: 0, bfp: 0, furnace: 0 };
    this.stats = { revenue: 0, fuelCost: 0, mwh: 0, dispatch: 0, trackErr: 0 };
    this.trend = [];
    this.trendT = 0;
    this._lastQt = 0;

    applyScenario(this, scenario);
  }

  rand() { this.rng = (this.rng * 1103515245 + 12345) % 2147483648; return this.rng / 2147483648; }
  emit(type, data = {}) { this.events.push({ type, t: this.t, ...data }); }
  note(msg, level = 'info') {
    this.log.unshift({ t: this.t, msg, level });
    if (this.log.length > 200) this.log.length = 200;
  }

  // ------------------------------------------------------------ commands
  fdStart() { if (this.fault.fdTrip) { this.note('FD fan will not start – motor protection tripped', 'warn'); return; } if (!this.fd.run) { this.fd.run = true; this.emit('motorStart', { who: 'fd' }); this.note('FD fan started'); } }
  fdStop() { if (this.fd.run) { this.fd.run = false; this.note('FD fan stopped'); } }
  pumpStart(p) {
    if (p.tripped) { this.note(`${p.name} locked out – reset first`, 'warn'); return; }
    if (p.name === 'BFP-A' && this.fault.bfpATrip) { this.note('BFP-A breaker will not close (fault)', 'warn'); return; }
    if (!p.run) { p.run = true; this.emit('motorStart', { who: p.name }); this.note(`${p.name} started`); }
  }
  pumpStop(p) { if (p.run) { p.run = false; this.note(`${p.name} stopped`); } }
  pumpReset(p) { if (p.damage < 1) { p.tripped = false; p.temp = Math.min(p.temp, 90); this.note(`${p.name} reset`); } }

  bmsReset() {
    const b = this.bms;
    if (b.state !== 'TRIPPED') return;
    const cause = this.mftCauses(true);
    if (cause) { this.note(`BMS reset blocked: ${cause}`, 'warn'); return; }
    b.state = 'SHUTDOWN'; b.tripCause = ''; this.note('BMS reset – ready for purge');
  }
  bmsPurge() {
    const b = this.bms;
    if (b.state !== 'SHUTDOWN') { this.note('Purge only available from SHUTDOWN', 'warn'); return; }
    const perm = this.purgePermissive();
    if (perm) { this.note(`Purge permissive missing: ${perm}`, 'warn'); return; }
    b.state = 'PURGING'; b.purgeT = 0; this.note('Furnace purge started (5 volume changes)');
  }
  bmsIgnitor(on) {
    const b = this.bms;
    if (on && !(b.state === 'PURGE COMPLETE' || b.state === 'FIRING' || b.state === 'LIGHT-OFF')) { this.note('Ignitor blocked – purge not complete', 'warn'); return; }
    this.fuel.ignitor = on;
    if (on) this.note('Ignitor energized');
  }
  bmsPilot(on) {
    const b = this.bms;
    if (on) {
      if (!(b.state === 'PURGE COMPLETE' || b.state === 'FIRING') && !this.bypass.bms) { this.note('Pilot blocked – purge not complete', 'warn'); return; }
      if (this.air.pct < 20 || this.air.pct > 50) { this.note('Pilot blocked – air flow not in light-off window (20–50 %)', 'warn'); if (!this.bypass.bms) return; }
      this.fuel.pilot = true; b.trialT = 0;
      if (b.state === 'PURGE COMPLETE') b.state = 'LIGHT-OFF';
      this.note('Pilot gas valve open – trial for ignition');
    } else { this.fuel.pilot = false; this.note('Pilot valve closed'); }
  }
  bmsMain(on) {
    const b = this.bms;
    if (on) {
      if (!b.pilotFlame && !this.bypass.bms) { this.note('Main fuel blocked – pilot flame not proven', 'warn'); return; }
      if (this.fcv.pos > 0.15) { this.note('Main fuel blocked – gas valve not at light-off position (<15 %)', 'warn'); if (!this.bypass.bms) return; }
      if (this.env.gasP < 0.2) { this.note('Main fuel blocked – low gas pressure', 'warn'); if (!this.bypass.bms) return; }
      this.fuel.ssov = true; b.mainOnT = 0; b.state = 'FIRING';
      this.note('Main gas safety shutoff valves open');
    } else { this.fuel.ssov = false; this.note('Main gas SSOVs closed'); }
  }
  mft(cause) {
    const b = this.bms;
    if (b.state === 'TRIPPED') return;
    const wasFiring = this.fuel.ssov || b.mainFlame;
    b.state = 'TRIPPED'; b.tripCause = cause; b.purgeDone = false;
    this.fuel.ssov = false; this.fuel.pilot = false; this.fuel.ignitor = false;
    this.ctl.master.auto = false; this.firingMan = 0.08;
    this.fcv.set(0.08);
    this.note(`MASTER FUEL TRIP: ${cause}`, 'trip');
    this.emit('trip', { what: 'MFT', cause });
    if (wasFiring && this.interlocks.mftTripsTurbine && this.tb.latched && this.gen.breaker) this.turbineTrip('Boiler MFT (unit trip)');
  }

  turbineLatch() {
    const t = this.tb;
    if (t.latched) return;
    if (this.damage.turbine >= 1) { this.note('Turbine damaged – cannot latch', 'warn'); return; }
    if (t.lube.p < 0.1) { this.note('Latch blocked: low lube oil pressure', 'warn'); return; }
    if (this.cond.p > 0.03) { this.note('Latch blocked: condenser vacuum too low (need < 30 kPa abs)', 'warn'); return; }
    t.latched = true; t.tripCause = ''; t.mode = 'speed'; t.target = 0; t.ref = t.rpm; t.gv.set(0); t.gv.pos = 0;
    this.note('Turbine latched (trip oil pressurized)'); this.emit('latch');
  }
  turbineMSV(open) {
    const t = this.tb;
    if (open && !t.latched) { this.note('MSV: turbine not latched', 'warn'); return; }
    t.msv = open; this.note(open ? 'Main stop valve opening' : 'Main stop valve closing');
  }
  turbineTrip(cause) {
    const t = this.tb;
    if (!t.latched && !t.msv) return;
    t.latched = false; t.msv = false; t.gv.cmd = 0; t.tripCause = cause; t.autoSync = false;
    this.note(`TURBINE TRIP: ${cause}`, 'trip');
    this.emit('trip', { what: 'TURBINE', cause });
    if (this.interlocks.turbTripRunback && this.bms.state === 'FIRING') {
      this.ctl.master.auto = false; this.firingMan = Math.min(this.firingMan, 0.25);
      this.note('Boiler runback to 25 % firing on turbine trip');
    }
  }
  breakerClose() {
    const g = this.gen, t = this.tb;
    if (g.breaker) return;
    if (g.lockout) { this.note('Generator lockout relay (86G) tripped – reset required', 'warn'); return; }
    if (!this.env.gridOK) { this.note('Breaker blocked: grid dead', 'warn'); return; }
    if (!g.field) { this.note('Breaker blocked: field breaker open', 'warn'); return; }
    const df = g.f - this.env.gridF, dv = g.Vt - this.env.gridV;
    let ph = ((g.phase % 360) + 540) % 360 - 180;
    if (!this.bypass.syncCheck) {
      if (Math.abs(df) > 0.2) { this.note(`Sync-check: slip ${df.toFixed(2)} Hz too high`, 'warn'); return; }
      if (Math.abs(ph) > 20) { this.note(`Sync-check: phase ${ph.toFixed(0)}° out of window`, 'warn'); return; }
      if (Math.abs(dv) > 0.06) { this.note(`Sync-check: voltage mismatch ${(dv * 100).toFixed(1)} %`, 'warn'); return; }
    }
    g.breaker = true; g.delta = ph * Math.PI / 180;
    const sev = Math.abs(Math.sin(g.delta / 2)) + Math.abs(df) * 0.3;
    t.mode = 'load'; t.mwSP = Math.max(t.mwSP, 2); t.mwRef = Math.max(0, g.Pe); t.autoSync = false;
    if (Math.abs(ph) > 12 || Math.abs(df) > 0.3) {
      this.emit('badSync', { sev });
      this.damage.gen += clamp(sev * 0.5, 0, 1);
      this.note(`OUT-OF-PHASE SYNCHRONIZATION (${ph.toFixed(0)}°) – shaft torque transient`, 'trip');
      t.vib += 120 * sev;
      if (Math.abs(ph) > 45) { this.genTrip('Out-of-phase closing – differential relay'); return; }
    } else this.emit('breaker', { closed: true });
    this.note(`Generator breaker CLOSED (phase ${ph.toFixed(1)}°, slip ${df.toFixed(3)} Hz)`);
  }
  breakerOpen(cause = 'Operator') {
    const g = this.gen;
    if (!g.breaker) return;
    g.breaker = false; this.tb.mode = 'speed'; this.tb.target = 3600; this.tb.ref = this.tb.rpm;
    this.emit('breaker', { closed: false });
    this.note(`Generator breaker OPEN (${cause})`, cause === 'Operator' ? 'info' : 'trip');
  }
  genTrip(cause) {
    this.gen.lockout = true; this.gen.field = false;
    this.breakerOpen(cause);
    this.note(`GENERATOR TRIP (86G): ${cause}`, 'trip');
    this.emit('trip', { what: 'GEN', cause });
    this.turbineTrip('Generator protection');
  }

  purgePermissive() {
    if (!this.fd.run || this.fd.speed < 0.9) return 'FD fan not running';
    if (this.air.pct < 25) return 'Air flow < 25 % (purge rate)';
    if (this.fuel.ssov || this.fuel.pilot) return 'Fuel valves not closed';
    if (this.drum.levelA < -200) return 'Drum level low';
    if (this.env.gasP < 0.2) return 'Low gas supply pressure';
    return '';
  }
  // returns active MFT condition (or '' if none)
  mftCauses(forReset = false) {
    if (!this.fd.run || this.fd.speed < 0.5) return forReset ? '' : 'FD fan stopped';
    if (this.drum.levelA < -250) return 'Drum level low-low';
    if (this.drum.levelA > 250) return 'Drum level high-high';
    if (this.drum.p > 10.9) return 'Drum pressure high-high';
    if (this.env.gasP < 0.2) return 'Gas supply pressure low';
    if (this.furn.pres > 25) return 'Furnace pressure high';
    return '';
  }

  // ------------------------------------------------------------ main step
  step(dt) {
    if (this.over) return;
    this.t += dt;
    const env = this.env;
    const g = this.gen, tb = this.tb, dr = this.drum, sh = this.sh, cd = this.cond, da = this.da, fu = this.furn;

    // ---------------- grid
    env.gridF += (60 + (env.fDev || 0) - env.gridF) * 0.02 * dt + (this.rand() - 0.5) * 0.004 * Math.sqrt(dt);
    if (this.fault.gridLoss && env.gridOK) { env.gridOK = false; if (g.breaker) this.breakerOpen('Grid loss – line breakers open'); this.note('Grid disturbance: transmission line lost', 'trip'); }
    if (!this.fault.gridLoss && !env.gridOK) { env.gridOK = true; this.note('Grid restored'); }
    env.gasP += ((this.fault.gasLow ? 0.12 : 0.35) - env.gasP) * dt / 8;

    // ---------------- actuators
    this.fcv.stuck = false; this.fwcv.stuck = this.fault.fcvStuck;
    for (const v of [this.damper, this.fcv, this.spray, this.vent, this.drain, this.fwcv, this.fwbp, this.cbd, this.ibd, this.drumVent, this.cpLcv, cd.makeup, cd.vacBreaker, this.fw.recirc]) v.step(dt);
    tb.gv.rate = tb.latched ? 0.25 : 5; tb.gv.step(dt);
    tb.msvPos = clamp(tb.msvPos + ((tb.msv && tb.latched) ? dt / 4 : -dt / 0.25), 0, 1);

    // ---------------- FD fan & air
    if (this.fault.fdTrip && this.fd.run) { this.fd.run = false; this.note('FD fan motor tripped (overcurrent)', 'trip'); this.emit('trip', { what: 'FD' }); }
    this.fd.speed = clamp(this.fd.speed + (this.fd.run ? dt / 6 : -dt / 25), 0, 1);
    const dmp = this.damper.pos;
    this.air.flow = D.airMax * this.fd.speed * (0.06 + 0.94 * dmp);
    this.air.pct = this.air.flow / D.airMax * 100;
    this.fd.amps = this.fd.run ? (this.fd.speed < 0.98 ? 600 * (1 - this.fd.speed) + 40 : 35 + 70 * Math.pow(this.air.pct / 100, 1.5)) : 0;

    // ---------------- fuel & BMS
    this.stepBMS(dt);
    const gasFactor = Math.sqrt(clamp(env.gasP / 0.35, 0, 1.2));
    this.fuel.flow = this.fuel.ssov ? D.fuelMax * this.fcv.pos * gasFactor : 0;
    this.fuel.pilotFlow = this.fuel.pilot ? D.pilotFuel * gasFactor : 0;
    const fuelIn = this.fuel.flow + this.fuel.pilotFlow;
    const airIn = this.air.flow;
    fu.lambda = fuelIn > 1e-4 ? airIn / (D.AFR * fuelIn) : 9.9;
    const flame = this.bms.mainFlame || this.bms.pilotFlame;
    let burn = 0;
    if (flame) burn = Math.min(fuelIn + fu.unburned * 0.5, airIn / D.AFR);
    // furnace combustible inventory (only accumulates without flame or when rich)
    const furnaceAir = 380; // kg of gas in furnace volume
    fu.unburned += (fuelIn - burn) * dt - fu.unburned * Math.min(1, (airIn + 0.5) / furnaceAir * dt);
    if (flame) fu.unburned -= Math.min(fu.unburned, fu.unburned * 0.5 * dt);
    fu.unburned = Math.max(0, fu.unburned);
    this.checkFurnaceExplosion(dt);

    fu.Qrel = burn * D.LHV;
    const L = fu.Qrel / (D.fuelMax / 1.2 * D.LHV); // ~1 at rated
    fu.firing = L;
    const lam = fu.lambda;
    fu.o2 = flame || fuelIn > 0 ? clamp(20.9 * (lam - 1) / (lam + 0.11), 0, 20.9) : 20.9;
    fu.co = flame ? clamp(25 + 9000 * Math.pow(Math.max(0, 1.08 - lam), 1.4) + (lam > 2.5 ? (lam - 2.5) * 80 : 0), 0, 30000) : 0;
    fu.flameT = flame ? 300 + 1650 / Math.max(1, lam) * clamp(1.2 - Math.max(0, 1 - lam), 0.3, 1) : 0;
    fu.nox = flame ? clamp(4 * Math.exp((fu.flameT - 1500) / 160) * (0.4 + L), 0, 400) : 0;
    const smokeT = flame ? clamp((1.02 - lam) * 6, 0, 1) : (fuelIn > 0 ? 0.1 : 0);
    fu.smoke += (smokeT - fu.smoke) * dt / 3;
    // tube leak steam into furnace quenches flame
    const leak = this.fault.tubeLeak;

    const mflue = airIn + fuelIn + leak * 0.8;
    const cg = Math.max(mflue, 0.5) * D.cpGas;
    // air heater preheat recovers stack heat
    // furnace exit gas temperature dynamics
    let fegtT;
    if (flame && fu.Qrel > 10) {
      fegtT = 320 + 800 * Math.pow(clamp(L, 0, 1.3), 0.4) * Math.pow(1.15 / clamp(lam, 0.8, 4), 0.35) - leak * 15;
      fegtT = Math.min(fegtT, env.Tamb + 0.75 * fu.Qrel / cg);
    } else fegtT = env.Tamb + 40;
    fu.T += (fegtT - fu.T) * dt / (flame ? 12 : 60 / (0.3 + this.air.pct / 50));

    // convective sections
    const Tg1 = fu.T;
    const shm = sh.Tm;
    const Gsh = 44 * Math.pow(clamp(mflue / 50, 0.02, 1.5), 0.65);
    fu.Qsh = Math.max(0, Gsh * (Tg1 - shm));
    const Tg2 = Tg1 - fu.Qsh / cg;
    fu.Qbb = Math.max(0, 0.6 * cg * (Tg2 - dr.Ts));
    const Tg3 = Tg2 - fu.Qbb / cg;
    // economizer
    const Tfw = da.T;
    const qfw = this.fw.q;
    const ecGas = Math.max(0, 0.6 * cg * (Tg3 - Tfw));
    const ecWaterCap = Math.max(0, qfw * 4.6 * (dr.Ts - 3 - Tfw)) + 30;
    fu.Qec = Math.min(ecGas, ecWaterCap);
    this.fw.Tecon = qfw > 0.05 ? Tfw + Math.min(fu.Qec / (qfw * 4.6), dr.Ts - Tfw) : lerp(this.fw.Tecon, Math.min(Tg3, dr.Ts), dt / 120);
    const Tg4 = Tg3 - fu.Qec / cg;
    fu.Qaph = Math.max(0, 0.45 * cg * (Tg4 - env.Tamb));
    fu.Tstack = Tg4 - fu.Qaph / cg;
    // radiant heat to water walls: energy balance on furnace
    const Qin = fu.Qrel + fu.Qaph;
    fu.Qev = Math.max(0, Qin - cg * (fu.T - env.Tamb)) * (1 - Math.min(0.6, leak * 0.02));
    if (!flame) fu.Qev = Math.max(0, cg * 0.02 * (fu.T - dr.Ts)); // residual radiation from hot refractory
    const stackLoss = cg * (fu.Tstack - env.Tamb);
    fu.eff = fu.Qrel > 100 ? clamp((fu.Qev + fu.Qsh + fu.Qbb + fu.Qec) / Math.max(1, fuelIn * D.LHV), 0, 1) : 0;
    fu.stackLoss = stackLoss;
    fu.pres = 0.3 + 6 * Math.pow(this.air.pct / 100, 2) + leak * 2.5 + (flame ? 0.4 * L : 0) + fu.ignition;
    fu.ignition *= Math.exp(-dt * 2);

    // ---------------- feedwater hydraulics
    this.stepFeed(dt);

    // ---------------- superheater outflows and pressure
    const satD = S.sat(dr.p);
    dr.Ts = satD.T;
    const rhoSH = S.rhoPT(sh.p, sh.Tout);
    const dPds = dr.p - sh.p;
    const Kds = 6.5;
    const sq = Math.sqrt(Math.abs(dPds) + 0.004);
    let qds = Kds * Math.sqrt(satD.rg) * dPds / sq;
    const dqds = Kds * Math.sqrt(satD.rg) / sq * 0.75;
    if (qds < 0) qds = 0;

    // turbine steam flow (Stodola-like, nozzle limited)
    const pc = cd.p;
    const gvEff = tb.gv.pos * tb.msvPos;
    const flowCoef = Math.sqrt(Math.max(0, sh.p * rhoSH)) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.min(1, pc / sh.p), 2)));
    let qt = D.Kt * gvEff * flowCoef;
    const qvent = 0.62 * this.vent.pos * Math.sqrt(Math.max(0, (sh.p - 0.1013) * rhoSH * 1.6));
    const qdrain = Math.min(0.15 + 2.0 * this.drain.pos, 0.08 * sh.p * 10) * (sh.p > 0.11 ? 1 : 0) * (this.drain.pos > 0.01 || sh.condensate > 0 ? 1 : 0) * clamp(sh.condensate / 20 + this.drain.pos, 0, 1);
    // safety valves (pop action with blowdown)
    for (const sv of this.svs) {
      const p = sv.loc === 'drum' ? dr.p : sh.p;
      if (this.fault.svSeized && sv.loc === 'drum') { sv.open = false; }
      else if (!sv.open && p > sv.set) { sv.open = true; this.note(`${sv.id} LIFTED at ${p.toFixed(2)} MPa`, 'warn'); this.emit('svLift', { id: sv.id }); }
      else if (sv.open && p < sv.set * 0.955) { sv.open = false; this.note(`${sv.id} reseated`); this.emit('svSeat', { id: sv.id }); }
      sv.q = sv.open || sv.test ? sv.k * Math.sqrt(p * (sv.loc === 'drum' ? satD.rg : rhoSH)) * (sv.open ? 1 : 0.3) : 0;
    }
    // power operated relief valve (ERV)
    const erv = this.erv;
    if (erv.auto) { if (sh.p > erv.set) erv.open = true; else if (sh.p < erv.set - 0.25) erv.open = false; } else erv.open = erv.man;
    const qerv = erv.open ? 0.45 * Math.sqrt(sh.p * rhoSH) : 0;
    const qsvSh = this.svs[2].q;
    // pegging steam to deaerator
    const qpeg = da.peg;
    const qOut = qt + qvent + qsvSh + qerv + qdrain + qpeg;
    const qIn = qds + sh.qspray;
    const Csh = D.Vsh * rhoSH / Math.max(sh.p, 0.05) * 1.15;
    const Aout = qOut / Math.max(sh.p, 0.05);
    const dpSH = dt * (qIn - qOut) / (Csh + dt * (dqds + Aout));
    sh.p = Math.max(0.1013, sh.p + dpSH);
    sh.qin = qds;
    // recompute qt with new pressure for consistency
    qt = D.Kt * gvEff * Math.sqrt(Math.max(0, sh.p * rhoSH)) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.min(1, pc / sh.p), 2)));
    sh.qvent = qvent; sh.qerv = qerv; sh.qdrain = qdrain;

    // ---------------- drum (Astrom-Bell)
    const sd = S.satDerivs(dr.p);
    const Vt = dr.Vdrum + D.Vtubes;
    const Vwt = dr.Vwt, Vst = Vt - Vwt;
    const qdv = 0.35 * this.drumVent.pos * Math.sqrt(Math.max(0, (dr.p - 0.1013) * satD.rg * 4));
    const qsvd = this.svs[0].q + this.svs[1].q;
    const qsteam = qds + qdv + qsvd;
    const qbd = (0.33 * this.cbd.pos + 1.8 * this.ibd.pos) * Math.sqrt(Math.max(0, dr.p - 0.1013) * 10) * 0.3;
    const qleak = leak;
    dr.qbd = qbd; dr.qdv = qdv;
    // carry-over when the level is high (water droplets leave with steam)
    const foam = clamp((dr.tds - 120) / 200, 0, 0.5);
    dr.carry = clamp((dr.level - 140 + foam * 200) / 120, 0, 1) * 0.25;
    const hSteamOut = satD.hg - dr.carry * (satD.hg - satD.hf);
    const hfe = S.hWater(this.fw.Tecon);
    const Qloss = 180 * (dr.Ts - env.Tamb) / 280;
    const Qev = fu.Qev + fu.Qbb - Qloss;
    const e11 = satD.rf - satD.rg;
    const e12 = Vst * sd.drg + Vwt * sd.drf;
    const e21 = satD.rf * satD.hf - satD.rg * satD.hg;
    const e22 = Vst * (satD.hg * sd.drg + satD.rg * sd.dhg) + Vwt * (satD.hf * sd.drf + satD.rf * sd.dhf) - 1000 * Vt + D.metalMass * D.cpMetal * sd.dT;
    // carried-over water leaves as liquid so the "steam" mass outflow includes it
    const qf = this.fw.q;
    const b1 = qf - qsteam - qbd - qleak;
    const b2 = Qev + qf * hfe - qsteam * hSteamOut - (qbd + qleak) * satD.hf;
    const det = e11 * e22 - e12 * e21;
    const dVwt = (b1 * e22 - e12 * b2) / det;
    const dp = (e11 * b2 - e21 * b1) / det;
    dr.p = Math.max(0.1013, dr.p + dp * dt);
    if (dr.p <= 0.1013 && dp < 0) {
      // atmospheric: excess energy deficit condenses nothing – keep at atmosphere, adjust water volume via mass only
    }
    dr.Vwt = clamp(dr.Vwt + dVwt * dt, 1, Vt - 0.5);
    dr.dTdt = lerp(dr.dTdt, sd.dT * dp * 3600, dt / 20); // degC per hour
    dr.Ts = S.tsat(dr.p);
    // shrink & swell: steam bubbles below the surface
    const Qr = 62000;
    const bubT = clamp(3.2 * Math.pow(Math.max(0, Qev) / Qr, 0.65) * Math.sqrt(9 / Math.max(dr.p, 0.3)), 0, 9) + clamp(-dp * 14, -1.5, 3);
    dr.Vbub += (bubT - dr.Vbub) * dt / 5;
    const Vwd = dr.Vwt + dr.Vbub - D.Vtubes;
    dr.level = this.levelFromVolume(Vwd);
    // transmitters
    dr.levelA = dr.level + this.fault.ltDrift + (this.rand() - 0.5) * 3;
    dr.levelB = dr.level + (this.rand() - 0.5) * 3;
    // TDS
    const Mw = dr.Vwt * satD.rf;
    const tdsIn = 3 + 40 * clamp(cd.makeup.pos, 0, 1) * 0.2;
    dr.tds += (qf * tdsIn - (qbd + qleak) * dr.tds - qsteam * dr.carry * dr.tds) / Math.max(Mw, 1000) * dt;
    // water-wall tube metal: overheat when circulation breaks down (low level)
    const starve = clamp((-dr.level - 420) / 200, 0, 1);
    const tubeT = dr.Ts + 25 * L + starve * (fu.T - dr.Ts) * 0.8;
    dr.tubeT += (tubeT - dr.tubeT) * dt / 20;
    dr.qsteam = qsteam;

    // ---------------- superheater thermal
    const qsh = Math.max(qds, 0);
    const Tin = dr.Ts;
    const UAs = 360 * Math.pow(Math.max(qsh, 0.02) / D.ratedSteam, 0.8);
    const cps = 2.6;
    const NTU = UAs / Math.max(qsh * cps, 1e-3);
    const ToutT = sh.Tm - (sh.Tm - Tin) * Math.exp(-NTU);
    let Qs = qsh * cps * (ToutT - Tin);
    if (qsh < 1e-3) Qs = UAs * (sh.Tm - Tin) * 0.2;
    const hShOut = qsh > 0.01 ? hSteamOut + Qs / qsh : S.hPT(sh.p, Math.max(ToutT, Tin));
    sh.Tm += (fu.Qsh - Qs - 15 * (sh.Tm - env.Tamb) / 400) / (D.shMetal * D.cpMetal) * dt;
    // attemperator spray mixing
    const hfw = S.hWater(Tfw + 3);
    const hMix = (qsh * hShOut + sh.qspray * hfw) / Math.max(qsh + sh.qspray, 1e-3);
    const hTarget = qsh + sh.qspray > 0.05 ? hMix : S.hPT(sh.p, Math.max(sh.Tm * 0.97, S.tsat(sh.p)));
    sh.h += (hTarget - sh.h) * clamp(dt / 3, 0, 1);
    const shs = S.sat(sh.p);
    sh.wet = sh.h < shs.hg ? clamp((shs.hg - sh.h) / (shs.hg - shs.hf), 0, 1) : 0;
    sh.Tout = S.TPH(sh.p, sh.h);
    sh.T = sh.Tout;

    // main steam line warm-up, condensate & water hammer
    const steamPresent = sh.p > 0.12;
    const flowF = clamp((qt + qvent + qdrain + qerv) / 5, 0.05, 6);
    if (steamPresent) {
      const hA = 1.5 + 6 * flowF;                        // kW/K steam-to-pipe
      const Q = hA * (sh.Tout - sh.Tline);
      if (sh.Tline < shs.T) sh.condensate += hA * (shs.T - sh.Tline) / Math.max(shs.hg - shs.hf, 300) * dt;
      sh.Tline += Q / 20000 * dt;
    }
    sh.Tline -= 0.6 * (sh.Tline - env.Tamb) / 32000 * dt * 10;
    sh.condensate = Math.max(0, sh.condensate - qdrain * dt - 0.04 * dt);
    const dqt = (qt - this._lastQt) / dt; this._lastQt = qt;
    if (sh.condensate > 45 && qt > 0.8 && (dqt > 0.4 || this.rand() < dt * sh.condensate / 2000)) {
      const sev = clamp(sh.condensate / 150, 0.2, 1);
      this.emit('hammer', { sev });
      this.note(`WATER HAMMER in main steam line (${sh.condensate.toFixed(0)} kg condensate)`, 'warn');
      this.damage.sh = Math.min(1, this.damage.sh + 0.01 * sev);
      tb.induction += sh.condensate * 0.3;
      sh.condensate *= 0.4;
    }

    // ---------------- turbine
    this.stepTurbine(dt, qt);

    // ---------------- condenser / hotwell / deaerator
    this.stepCondenser(dt);
    this.stepDeaerator(dt);

    // ---------------- controls
    this.stepControls(dt);

    // ---------------- protection & damage
    this.stepProtection(dt);
    this.stepAlarms();
    this.stepEconomics(dt);
    dr.prevP = dr.p;

    this.trendT += dt;
    if (this.trendT >= 1) { this.trendT = 0; this.pushTrend(); }
  }

  levelFromVolume(Vwd) {
    const R = D.drumR, Ld = D.drumL;
    if (Vwd <= 0) return -R * 1000 + Vwd / 0.9 * 1000; // below drum bottom: into the downcomers
    if (Vwd >= this.drum.Vdrum) return R * 1000 + (Vwd - this.drum.Vdrum) * 100;
    const A = Vwd / Ld;
    let lo = 0, hi = 2 * R;
    for (let k = 0; k < 26; k++) { const m = 0.5 * (lo + hi); if (segArea(R, m) > A) hi = m; else lo = m; }
    return (0.5 * (lo + hi) - R) * 1000;
  }

  stepBMS(dt) {
    const b = this.bms, f = this.fuel, fu = this.furn;
    if (b.state === 'PURGING') {
      const perm = this.purgePermissive();
      if (perm) { b.state = 'SHUTDOWN'; this.note(`Purge interrupted: ${perm}`, 'warn'); }
      else { b.purgeT += dt * clamp(this.air.pct / 30, 1, 2.2); if (b.purgeT >= 90) { b.state = 'PURGE COMPLETE'; b.purgeExpire = 900; this.note('Purge complete – light-off permitted'); this.emit('chime'); } }
    }
    if (b.state === 'PURGE COMPLETE') {
      b.purgeExpire -= dt;
      if (b.purgeExpire <= 0) { b.state = 'SHUTDOWN'; this.note('Purge expired – repurge required', 'warn'); }
      if (this.air.pct < 15 || !this.fd.run) { b.state = 'SHUTDOWN'; this.note('Purge lost – air flow', 'warn'); }
    }
    // pilot flame establishment
    const lam = fu.lambda;
    if (f.pilot) {
      b.trialT += dt;
      if (!b.pilotFlame && (f.ignitor || fu.T > 650 || b.mainFlame) && b.trialT > 1.2 && this.air.pct > 8) {
        b.pilotFlame = true; this.emit('pilotLight'); this.note('Pilot flame proven');
      }
    } else b.pilotFlame = false;
    // main flame
    if (f.ssov && f.flow > 0.005) {
      b.mainOnT += dt;
      if (!b.mainFlame && (b.pilotFlame || f.ignitor || fu.T > 650) && b.mainOnT > 0.6) {
        b.mainFlame = true; this.emit('lightoff', { size: fu.unburned }); this.note('Main flame established');
        // ignition of accumulated gas
        if (fu.unburned > 2) this.furnacePuff();
      }
    } else { if (b.mainFlame) this.emit('flameout'); b.mainFlame = false; b.mainOnT = 0; }
    // flame stability
    if (b.mainFlame) {
      const lean = lam > 6.5 && !b.pilotFlame, rich = lam < 0.62, starved = f.flow < 0.035 && !b.pilotFlame, quench = this.fault.tubeLeak > 6;
      const p = (lean ? 0.8 : 0) + (rich ? 0.6 : 0) + (starved ? 1.2 : 0) + (quench ? 0.3 : 0);
      if (p > 0 && this.rand() < p * dt) { b.mainFlame = false; this.emit('flameout'); this.note('Main flame lost', 'warn'); }
    }
    if (b.pilotFlame && this.air.pct > 65 && !b.mainFlame && this.rand() < 0.5 * dt) { b.pilotFlame = false; this.note('Pilot blown out', 'warn'); }
    if (f.ignitor && b.mainOnT > 10) f.ignitor = false;
    if (f.pilot && b.mainFlame && b.mainOnT > 15) { f.pilot = false; this.note('Pilot removed – main flame self-sustaining'); }

    // flame scanner
    b.scanner = (b.mainFlame || b.pilotFlame) && !this.fault.scannerFail;
    const fuelOn = f.ssov || f.pilot;
    if (fuelOn && !b.scanner && !this.bypass.bms) {
      b.flameLossT += dt;
      const limit = f.ssov ? 3 : 10;
      if (b.flameLossT > limit) this.mft(f.ssov ? 'Flame failure (scanner)' : 'Pilot trial for ignition failed');
    } else b.flameLossT = 0;
    // other MFT conditions
    if (b.state === 'FIRING' || b.state === 'LIGHT-OFF') {
      const c = this.mftCauses();
      if (c) this.mft(c);
      if (this.air.pct < 18 && f.ssov) this.mft('Low combustion air flow');
    }
    if (b.state === 'FIRING' && !f.ssov && !f.pilot) { b.state = 'SHUTDOWN'; this.note('Burner shut down – purge required for relight'); }
    if (b.state === 'LIGHT-OFF' && !f.pilot && !f.ssov) b.state = 'SHUTDOWN';
  }

  furnacePuff() {
    const fu = this.furn, m = fu.unburned;
    if (m > 11 && m < 60) return this.furnaceExplosion();
    this.emit('puff', { sev: clamp(m / 11, 0.2, 1) });
    this.note(`FURNACE PUFF – delayed ignition of ${m.toFixed(1)} kg gas`, 'trip');
    fu.ignition = 20 * m / 11;
    this.damage.furnace += 0.08 * m / 11;
    fu.unburned = 0;
  }
  checkFurnaceExplosion(dt) {
    const fu = this.furn;
    if (fu.unburned < 2) return;
    const ign = this.fuel.ignitor || fu.T > 620 || this.bms.mainFlame || this.bms.pilotFlame;
    if (ign) this.furnacePuff();
  }
  furnaceExplosion() {
    this.emit('explosion', { what: 'furnace' });
    this.damage.furnace = 1;
    this.end('FURNACE EXPLOSION', `${this.furn.unburned.toFixed(0)} kg of unburned gas accumulated in the furnace and ignited. ` +
      'The casing ruptured. NFPA 85 purge and flame-proving interlocks exist precisely to prevent this.');
  }
  end(title, text) {
    if (this.over) return;
    this.over = { title, text, t: this.t };
    this.note(`${title}: ${text}`, 'trip');
    this.fuel.ssov = false; this.fuel.pilot = false;
  }

  stepFeed(dt) {
    const fw = this.fw, da = this.da, dr = this.drum, sh = this.sh;
    // pump speeds
    let nRun = 0, sp2 = 0;
    for (const p of this.bfp) {
      if (p.name === 'BFP-A' && this.fault.bfpATrip && p.run) { p.run = false; p.tripped = true; this.note('BFP-A TRIPPED (motor protection)', 'trip'); this.emit('trip', { what: 'BFP-A' }); }
      p.speed = clamp(p.speed + (p.run ? dt / 3 : -dt / 8), 0, 1);
      if (p.speed > 0.05) { nRun += 1; sp2 += p.speed * p.speed; }
    }
    // cavitation from deaerator level / subcooling
    const npsh = clamp((da.level - 4) / 8, 0, 1);
    const cav = 1 - npsh;
    const pSuct = da.p + 0.15 + 0.004 * da.level; // static head from elevated deaerator
    const avgS2 = nRun ? sp2 / nRun : 0;
    const H0 = D.bfpShutoff * avgS2 * (1 - 0.7 * cav);
    const Kp = D.bfpShutoff / (D.bfpQmax * D.bfpQmax);
    const pdis = q => pSuct + Math.max(0, H0 - Kp * (q / Math.max(nRun, 1)) ** 2 * (nRun ? 1 : 0));
    // feed control valve (equal %) + bypass
    const eq = x => (x <= 0.001 ? 0 : (Math.pow(30, x - 1) - 1 / 30 * (1 - x)) );
    const Cv = 98 * eq(this.fwcv.pos) + 9 * this.fwbp.pos;
    const Kec = 0.25 / (30 * 30);
    // recirc and spray branch flows use last discharge pressure
    const dpr = Math.max(0, fw.pDis - da.p);
    fw.qrec = nRun ? 2.4 * this.fw.recirc.pos * Math.sqrt(dpr) : 0;
    sh.qspray = (nRun ? 2.2 * this.spray.pos * Math.sqrt(Math.max(0, fw.pDis - sh.p)) : 0);
    const side = fw.qrec + sh.qspray;
    let lo = 0, hi = 140;
    for (let k = 0; k < 30; k++) {
      const q = 0.5 * (lo + hi);
      const avail = pdis(q + side) - dr.p - Kec * q * q;
      const qv = Cv * Math.sqrt(Math.max(0, avail));
      if (qv > q) lo = q; else hi = q;
    }
    fw.q = 0.5 * (lo + hi);
    if (fw.q < 1e-3) fw.q = 0;
    fw.pDis = pdis(fw.q + side);
    const qPump = nRun ? (fw.q + side) / nRun : 0;
    // auto recirculation
    if (fw.recircAuto) { if (qPump < 9) this.fw.recirc.set(1); else if (qPump > 15) this.fw.recirc.set(0); }
    for (const p of this.bfp) {
      const running = p.speed > 0.05;
      p.flow = running ? qPump : 0;
      p.cav = running ? cav : 0;
      const heat = running ? (qPump < 5 ? (5 - qPump) * 0.5 + 0.1 : 0) + cav * 1.5 : 0;
      p.temp += (heat - (p.temp - da.T) * 0.01 - (running ? qPump * 0.004 * (p.temp - da.T) : 0)) * dt;
      p.temp = Math.max(p.temp, Math.min(da.T, p.temp + 1));
      p.amps = running ? (p.speed < 0.97 ? 1400 * (1 - p.speed) + 60 : 90 + 4.2 * qPump * (H0 / 13.5)) : 0;
      p.power = running ? (qPump * (fw.pDis - pSuct) * 1000 / 920 / 0.78 + 150) * p.speed / 1000 : 0; // MW
      if (running && p.temp > 160) { p.run = false; p.tripped = true; p.damage = Math.min(1, p.damage + 0.5); this.note(`${p.name} TRIPPED – pump overheated (min-flow)`, 'trip'); this.emit('trip', { what: p.name }); }
      if (running && cav > 0.5) p.damage = Math.min(1, p.damage + cav * dt * 0.004);
      if (running && cav > 0.85 && this.rand() < dt * 0.1) { p.run = false; p.tripped = true; this.note(`${p.name} TRIPPED – low suction pressure`, 'trip'); }
    }
    this.damage.bfp = Math.max(this.bfp[0].damage, this.bfp[1].damage);
  }

  stepTurbine(dt, qt) {
    const tb = this.tb, sh = this.sh, cd = this.cond, g = this.gen, env = this.env;
    tb.q = qt;
    // expansion
    const pin = sh.p, hin = sh.h;
    tb.hIn = hin; tb.Tin = sh.Tout;
    let Pm = 0, hEx = hin, eta = 0;
    if (qt > 0.01) {
      const sIn = S.sPH(pin, hin);
      const ex = S.hPS(cd.p, sIn);
      const lf = clamp(qt / D.ratedSteam, 0, 1.2);
      eta = 0.86 * (1 - 0.55 * Math.pow(1 - Math.min(lf, 1), 2.2)) - 0.5 * sh.wet;
      eta *= 1 - 0.3 * this.damage.turbine;
      hEx = hin - Math.max(0, eta) * (hin - ex.h);
      tb.xEx = clamp((hEx - S.hf(cd.p)) / (S.hg(cd.p) - S.hf(cd.p)), 0, 1.2);
      // extraction to deaerator from intermediate stage
      const qextAvail = tb.msvPos > 0.5 && qt > 6 ? 0.14 * qt : 0;
      tb.qext = Math.min(qextAvail, this.da.qHeat);
      const hExt = hin - 0.45 * (hin - hEx);
      tb.hExt = hExt;
      Pm = ((qt - tb.qext) * (hin - hEx) + tb.qext * (hin - hExt)) / 1000 * 0.985;
      // control stage temperature for thermal stress
      // control stage: isenthalpic throttling across the governor valves, then a partial nozzle drop
      const p1 = Math.max(cd.p * 2, pin * clamp(qt / D.ratedSteam, 0.01, 1) * 0.75);
      const s1 = S.hPS(p1, sIn);
      const h1 = hin - 0.35 * clamp(qt / D.ratedSteam, 0, 1) * (hin - s1.h);
      tb.T1 = S.TPH(p1, h1);
    } else { tb.qext = 0; tb.xEx = 1; tb.T1 = lerp(tb.T1, tb.Tr, dt / 30); }
    tb.eta = eta; tb.hEx = hEx; tb.Pm = Pm;
    // rotor surface/bore temperature lag -> thermal stress index
    const flowF = 0.15 + clamp(qt / D.ratedSteam, 0, 1);
    tb.Tr += (tb.T1 - tb.Tr) * dt / (900 / flowF);
    tb.Tr += (env.Tamb + 15 - tb.Tr) * dt / 40000;
    tb.stress = (tb.T1 - tb.Tr) / 140 * 100;

    // windage & friction losses (MW)
    const w = tb.omega, ws = TAU * 60;
    const dens = 1 + 18 * clamp(cd.p / 0.101, 0, 1.2);
    const Ploss = 0.22 * Math.pow(w / ws, 2.6) * dens + 0.06 * (w / ws) + (w > 0.2 ? 0.004 : 0);
    // lube oil
    const lu = tb.lube;
    const shaftPump = 0.19 * Math.pow(clamp(w / ws, 0, 1.2), 2);
    if (!lu.aop && lu.p < 0.06 && tb.rpm > 5 && !lu.dcop) { lu.dcop = true; this.note('Emergency DC lube oil pump AUTO-STARTED', 'warn'); this.emit('motorStart', { who: 'dcop' }); }
    const pOilT = Math.max(lu.aop ? 0.16 : 0, lu.dcop ? 0.11 : 0, shaftPump);
    lu.p += (pOilT - lu.p) * dt / 1.2;
    const oilOK = lu.p > 0.05;
    const bHeat = (tb.rpm / 3600) * (oilOK ? 0 : 3.2) + (tb.rpm / 3600) * 0.6;
    lu.Tbrg += (bHeat - (lu.Tbrg - 45) * (oilOK ? 0.08 : 0.004) - (lu.Tbrg - env.Tamb) * 0.002) * dt;
    if (lu.Tbrg < env.Tamb) lu.Tbrg = env.Tamb;
    lu.Tmax = Math.max(lu.Tmax, lu.Tbrg);
    if (lu.Tbrg > 125 && this.damage.turbine < 1) {
      this.damage.turbine = Math.min(1, this.damage.turbine + dt * 0.02);
      if (!lu.wiped) { lu.wiped = true; this.note('BEARING WIPED – babbitt melted (no lube oil)', 'trip'); this.emit('grind'); }
    }

    // turning gear
    if (tb.tg && w < 0.36 && lu.p > 0.05) tb.tgEngaged = true;
    if (w > 1.5) tb.tgEngaged = false;
    if (!tb.tg) tb.tgEngaged = false;
    // rotor bow when stationary & hot
    if (w < 0.1 && tb.Tr > 150) tb.stillT += dt; else tb.stillT = Math.max(0, tb.stillT - dt * 3 * (w > 0.2 ? 1 : 0));
    tb.bow = clamp(tb.stillT / 1800, 0, 1) * clamp((tb.Tr - 120) / 200, 0, 1);
    tb.eccentric = 25 + 180 * tb.bow;

    // dynamics
    const J = D.J;
    const wg = TAU * env.gridF;
    if (g.breaker) {
      // swing equation on infinite bus
      const Pmax = g.E * env.gridV / D.Xs * D.Sbase;
      g.Pe = Pmax * Math.sin(g.delta) + 2.5 * (w - wg);
      g.Q = (g.E * env.gridV * Math.cos(g.delta) - env.gridV * env.gridV) / D.Xs * D.Sbase;
      const acc = (Pm - g.Pe - Ploss) * 1e6 / (J * Math.max(w, 1));
      tb.omega += acc * dt;
      g.delta += (tb.omega - wg) * dt;
      if (Math.abs(g.delta) > 2.4) {
        this.damage.gen = Math.min(1, this.damage.gen + 0.15);
        this.genTrip('Loss of synchronism (pole slip)');
        this.emit('badSync', { sev: 1 });
      }
      g.Vt = env.gridV;
    } else {
      g.Pe = 0; g.Q = 0;
      let acc = (Pm - Ploss) * 1e6 / (J * Math.max(w, 2));
      if (tb.tgEngaged) { acc = (0.335 - w) * 0.8 + Math.max(0, acc); }
      tb.omega = Math.max(0, tb.omega + acc * dt);
      if (tb.omega < 0.02 && !tb.tgEngaged && Pm < 0.05) tb.omega = 0;
      g.phase += 360 * (tb.omega / TAU - env.gridF) * dt;
      g.phase = ((g.phase % 360) + 360) % 360;
      g.Vt = g.field ? g.E * (tb.omega / (TAU * 60)) : 0.01 * tb.omega / ws;
    }
    tb.rpm = tb.omega * 60 / TAU;
    g.f = tb.omega / TAU;

    // excitation / AVR
    if (g.field && tb.rpm < 2700 && !g.breaker) { g.field = false; this.note('Field breaker opened – V/Hz limiter (speed < 2700 rpm)', 'warn'); }
    if (g.field) {
      const vErr = g.breaker ? (g.avrSP - 1.0) : (g.avrSP - g.Vt);
      if (g.breaker) g.Efd = clamp(g.Efd + (1 + (g.avrSP - 1) * 6 - g.Efd) * dt / 1.5, 0.3, 1.9);
      else g.Efd = clamp(g.Efd + vErr * 2.5 * dt, 0, 1.6);
    } else g.Efd = 0;
    g.E += (g.Efd - g.E) * dt / 2.5;
    g.Ifd = g.E * 820;
    g.I = g.breaker ? Math.hypot(g.Pe, g.Q) / (Math.sqrt(3) * 13.8 * Math.max(g.Vt, 0.5)) * 1000 : 0;
    // reverse power
    if (g.breaker && g.Pe < -0.4) { g.revT += dt; if (g.revT > 5) { this.breakerOpen('Reverse power relay (32)'); } } else g.revT = 0;

    // governor (DEH)
    this.stepGovernor(dt);

    // vibration (µm pk-pk), with critical speeds at 1850 and 2350 rpm
    const r = tb.rpm;
    const res = 1 / (1 + Math.pow((r - 1850) / 110, 2)) * 85 + 1 / (1 + Math.pow((r - 2350) / 130, 2)) * 60;
    const unb = 1 + 3.5 * tb.bow + 2 * this.damage.turbine + tb.induction / 80 + (lu.wiped ? 2 : 0);
    const run = clamp(r / 3600, 0, 1.2);
    const vibT = (18 * run * run + 4) * unb + res * unb * (r > 300 ? 1 : 0) + (g.breaker ? 4 * Math.abs(g.Pe - Pm) : 0) + sh.wet * 400 * run;
    tb.vib += (vibT - tb.vib) * dt / 3;
    tb.vibX = tb.vib * (0.9 + 0.2 * Math.sin(this.t * 0.7));
    tb.induction = Math.max(0, tb.induction - dt * 2);
    if (sh.wet > 0.03 && qt > 1) { this.damage.turbine = Math.min(1, this.damage.turbine + sh.wet * dt * 0.01); }

    // exhaust hood temperature (windage heating at low flow)
    const hood = cd.Tcs + 95 * Math.pow(run, 3) * clamp(1 - qt / 4, 0, 1) * (1 + 3 * clamp(cd.p / 0.03, 0, 1));
    tb.hoodSpray = hood > 75;
    tb.exhT += ((tb.hoodSpray ? cd.Tcs + (hood - cd.Tcs) * 0.45 : hood) - tb.exhT) * dt / 20;
  }

  stepGovernor(dt) {
    const tb = this.tb, g = this.gen;
    if (!tb.latched) { tb.gv.cmd = 0; tb.ref = tb.rpm; tb.mwRef = 0; return; }
    if (tb.mode === 'speed') {
      // auto-synchronizer: hold a small positive slip and close near 0 deg
      if (tb.autoSync && g.field && !g.breaker) {
        tb.target = 3600 * (this.env.gridF + 0.06) / 60;
        let ph = ((g.phase % 360) + 540) % 360 - 180;
        const df = g.f - this.env.gridF;
        if (df > 0.01 && df < 0.15 && ph > -12 && ph < -3 && Math.abs(g.Vt - this.env.gridV) < 0.05 && Math.abs(tb.rpm - tb.ref) < 8) {
          this.breakerClose();
        }
      }
      let rate = tb.accel;
      if (tb.ref > 1650 && tb.ref < 2650) rate = Math.max(rate, 450); // pass critical speed band quickly
      const d = tb.target - tb.ref;
      const m = rate / 60 * dt;
      tb.ref += d > m ? m : d < -m ? -m : d;
      const err = tb.ref - tb.rpm;
      // PI on speed
      tb._i = (tb._i || 0) + err * dt * 0.00005;
      tb._i = clamp(tb._i, -0.05, 0.25);
      let gv = 0.0006 * err + tb._i + 0.012 * (tb.ref / 3600) * (tb.ref > 30 ? 1 : 0);
      if (tb.ref < 1 && tb.target < 1) { gv = 0; tb._i = 0; }
      tb.gv.set(gv);
    } else {
      // load control with frequency droop
      const fErr = this.env.gridF - 60;
      if (tb.valvePosMode) {
        tb.gv.set(tb.gvMan - fErr / 60 / tb.droop);
        tb.mwRef = g.Pe;
      } else {
        const d = tb.mwSP - tb.mwRef, m = tb.mwRate / 60 * dt;
        tb.mwRef += d > m ? m : d < -m ? -m : d;
        const target = tb.mwRef - fErr / 60 / tb.droop * D.ratedMW;
        const err = target - g.Pe;
        tb._li = clamp((tb._li ?? tb.gv.pos) + err * dt * 0.0016, 0, 1);
        tb.gv.set(clamp(tb._li + err * 0.004, 0, tb.gvLimit));
      }
    }
    if (tb.mode === 'speed') tb._li = tb.gv.pos;
    // overspeed protection controller (103 %)
    if (tb.rpm > 3708) tb.opc = true; else if (tb.rpm < 3630) tb.opc = false;
    if (tb.opc) { tb.gv.cmd = 0; tb.gv.pos = Math.min(tb.gv.pos, Math.max(0, tb.gv.pos - dt * 4)); }
  }

  stepCondenser(dt) {
    const cd = this.cond, tb = this.tb, env = this.env;
    if (this.fault.cwTrip && (cd.cwA || cd.cwB)) { cd.cwA = false; cd.cwB = false; this.note('Circulating water pumps TRIPPED', 'trip'); this.emit('trip', { what: 'CW' }); }
    const cwT = ((cd.cwA ? 1 : 0) + (cd.cwB ? 1 : 0)) * D.cwPerPump;
    cd.cwFlow += (cwT - cd.cwFlow) * dt / (cwT > cd.cwFlow ? 10 : 15);
    // steam to condenser
    const qst = Math.max(0, tb.q - tb.qext) + this.sh.qdrain * 0.5;
    cd.qin = qst;
    const hfC = S.hf(cd.p);
    cd.Q = qst * Math.max(0, tb.hEx - hfC);
    const UA = 5200 * Math.pow(clamp(cd.cwFlow / (2 * D.cwPerPump), 0.001, 1.2), 0.8);
    const C = cd.cwFlow * 4.18;
    const eps = C > 1 ? 1 - Math.exp(-UA / C) : 0;
    const Qcw = C * eps * (cd.Tcs - env.Tcw);
    cd.Tcw_out = env.Tcw + (C > 1 ? Qcw / C : 0);
    cd.Tcs += (cd.Q - Qcw - 3 * (cd.Tcs - env.Tamb)) / D.condC * dt;
    cd.Tcs = Math.max(cd.Tcs, Math.min(env.Tcw, env.Tamb) - 1);
    cd.pVap = S.psat(cd.Tcs);
    // air: in-leakage vs removal
    const vb = cd.vacBreaker.pos;
    const dpAtm = Math.max(0, 0.1013 - cd.p);
    const leak = 0.004 + (this.fault.airLeak ? 0.06 : 0) + vb * 4.5 * Math.sqrt(dpAtm / 0.1) + (cd.diaphragm ? 3 * Math.sqrt(dpAtm / 0.1) : 0) + (tb.rpm > 5 && !tb.latched && tb.q < 0.01 ? 0 : 0);
    const S_ = (cd.vacPump ? 0.35 : 0) + (cd.hogger ? 2.2 : 0);
    const removal = cd.p < 0.104 ? S_ * cd.mAir / D.condV : 0;
    cd.mAir = Math.max(0, cd.mAir + (leak - removal) * dt);
    cd.pAir = cd.mAir * 0.287 * (cd.Tcs + 273.15) / D.condV / 1000;
    cd.p = cd.pVap + cd.pAir;
    if (cd.p > 0.1013) {
      // shell above atmospheric: air is pushed out through the vacuum breaker / relief
      const over = cd.p - 0.1013;
      cd.mAir = Math.max(0, cd.mAir - over * 2000 * dt);
      if (cd.p > 0.135 && !cd.diaphragm) { cd.diaphragm = true; this.note('LP exhaust atmospheric relief diaphragm RUPTURED', 'trip'); this.emit('svLift', { id: 'diaphragm' }); }
    }
    if (cd.diaphragm && cd.pVap > 0.1013) cd.Tcs = Math.min(cd.Tcs, 100.5);
    // hotwell
    const qmk = 6 * cd.makeup.pos * Math.sqrt(Math.max(0, 0.11 - cd.p + 0.02) / 0.11);
    cd.qmk = qmk;
    // condensate pumps
    let nCp = 0;
    for (const p of this.cp) { p.speed = clamp(p.speed + (p.run ? dt / 2 : -dt / 5), 0, 1); if (p.speed > 0.05) nCp++; }
    const hwLvl = cd.hw / (D.hwVol * 990) * 100;
    cd.hwLevel = hwLvl;
    const cpCav = clamp((12 - hwLvl) / 10, 0, 1);
    const cpHead = nCp ? 1.6 * (1 - 0.8 * cpCav) : 0;
    const dpv = Math.max(0, cpHead - (this.da.p - cd.p) - 0.12);
    let qcp = nCp ? Math.min(42 * nCp, 32 * this.cpLcv.pos * Math.sqrt(dpv)) : 0;
    if (cd.hw < 50) qcp = Math.min(qcp, cd.hw / dt * 0.5);
    for (const p of this.cp) { p.flow = p.speed > 0.05 ? qcp / Math.max(nCp, 1) : 0; p.cav = p.speed > 0.05 ? cpCav : 0; p.amps = p.speed > 0.05 ? 30 + p.flow * 1.6 : 0; }
    cd.qcp = qcp;
    cd.hw = Math.max(0, cd.hw + (qst + qmk - qcp) * dt);
    if (cd.hw > D.hwVol * 990 * 1.15) cd.hw = D.hwVol * 990 * 1.15;
  }

  stepDeaerator(dt) {
    const da = this.da, cd = this.cond, fw = this.fw, sh = this.sh, tb = this.tb;
    // heating steam: extraction first, then pegging steam from main steam via PRV
    const u = this.ctl.daP.out;
    da.qHeat = u * 7;
    const ext = tb.qext;
    const pegCap = sh.p > da.p + 0.15 ? 0.9 * Math.sqrt((sh.p - da.p) * S.rhoPT(sh.p, sh.Tout)) : 0;
    da.peg = Math.min(Math.max(0, da.qHeat - ext), pegCap);
    da.qext = ext;
    const hExt = tb.hExt || 2750;
    const hPeg = sh.h;
    const hCond = S.hWater(cd.Tcs - 1);
    const hRec = da.h + 8;
    const qOut = fw.q + sh.qspray;
    const vent = 0.03 * clamp((da.p - 0.1013) * 10, 0, 1);
    const qIn = cd.qcp + ext + da.peg;
    const Mold = da.M;
    da.M = Math.max(100, da.M + (qIn - qOut - vent) * dt);
    const E = Mold * da.h + (cd.qcp * hCond + ext * hExt + da.peg * hPeg + fw.qrec * 8 - qOut * da.h - vent * 2700 - 12 * (da.T - this.env.Tamb) / 100) * dt;
    da.h = E / da.M;
    da.h = clamp(da.h, 84, 1100);
    da.T = S.TWater(da.h);
    da.p = Math.max(0.1013 * 0.98, S.psat(da.T));
    da.level = da.M / (D.daVol * S.rhoWater(da.T)) * 100;
    da.qin = qIn;
    const do2T = da.T > 125 ? 5 : 5 + (125 - da.T) * 4;
    da.do2 += (do2T - da.do2) * dt / 90;
  }

  stepControls(dt) {
    const c = this.ctl, dr = this.drum, sh = this.sh, fu = this.furn, da = this.da, cd = this.cond;
    // ---- combustion: boiler master -> fuel & air with cross limiting
    const firing = this.bms.state === 'FIRING' && this.fuel.ssov;
    let demand;
    if (firing) {
      if (c.master.auto) demand = c.master.run(sh.p, dt);
      else { demand = this.firingMan; c.master.track(demand, sh.p); }
    } else { demand = 0; c.master.track(this.firingMan, sh.p); }
    this.firingDemand = demand;
    const ratio = c.o2.auto && firing && fu.Qrel > 2000 ? c.o2.run(fu.o2, dt) : (c.o2.track(c.o2.out, fu.o2), c.o2.out);
    // fuel and air in % of max
    const fuelPct = this.fuel.flow / D.fuelMax * 100;
    const kAir = 1.055 * 1.15 / 1.15;
    if (c.air.auto) {
      const airDem = Math.max(firing ? demand * 100 * kAir * ratio / 1.05 : 0, fuelPct * kAir * ratio / 1.05, 33);
      c.air.sp = clamp(airDem, 0, 100);
      this.damper.set(c.air.run(this.air.pct, dt, c.air.sp / 100 * 0.9));
    } else c.air.track(this.damper.cmd, this.air.pct);
    // fuel valve: forced to light-off position until main flame, cross-limited by air
    if (firing && this.bms.mainOnT > 5) {
      const airLimit = this.air.pct / (kAir * ratio / 1.05) / 100;
      this.fcv.set(clamp(Math.min(demand, airLimit + 0.02), 0.06, 1));
    } else this.fcv.set(0.08); // low-fire hold at light-off position

    // ---- drum level (single / three element)
    const steamF = dr.qsteam, feedF = this.fw.q;
    if (steamF > 8) this.threeElement = true; else if (steamF < 6) this.threeElement = false;
    const lvl = dr.levelA;
    if (c.lvl.auto) {
      if (this.threeElement) {
        c.lvl3.sp = c.lvl.sp;
        const bias = c.lvl3.run(lvl, dt);
        c.fwf.sp = steamF + bias;
        const out = c.fwf.run(feedF, dt);
        this.fwcv.set(out);
        c.lvl.track(out, lvl);
      } else {
        const out = c.lvl.run(lvl, dt);
        this.fwcv.set(out);
        c.lvl3.track(0, lvl); c.fwf.track(out, feedF);
      }
    } else { c.lvl.track(this.fwcv.cmd, lvl); c.lvl3.track(0, lvl); c.fwf.track(this.fwcv.cmd, feedF); }

    // ---- superheat spray
    if (c.sht.auto) this.spray.set(sh.qin > 2 ? c.sht.run(sh.Tout, dt) : (c.sht.track(0, sh.Tout), 0));
    else c.sht.track(this.spray.cmd, sh.Tout);
    // ---- deaerator
    if (c.daP.auto) c.daP.run(da.p, dt); else c.daP.out = clamp(c.daP.out, 0, 1);
    if (c.daL.auto) this.cpLcv.set(c.daL.run(da.level, dt)); else c.daL.track(this.cpLcv.cmd, da.level);
    if (c.hwL.auto) cd.makeup.set(c.hwL.run(cd.hwLevel, dt)); else c.hwL.track(cd.makeup.cmd, cd.hwLevel);
  }

  stepProtection(dt) {
    const tb = this.tb, dr = this.drum, sh = this.sh, cd = this.cond, g = this.gen;
    // turbine trips
    if (tb.latched) {
      if (tb.rpm > 3960 && !this.fault.otsFail) this.turbineTrip('Overspeed 110 %');
      if (tb.lube.p < 0.05 && tb.rpm > 30) this.turbineTrip('Low lube oil pressure');
      if (tb.vib > 250) this.turbineTrip('High shaft vibration');
      if (cd.p > 0.03 && tb.rpm > 300) this.turbineTrip('Low condenser vacuum');
      if (tb.exhT > 120) this.turbineTrip('High exhaust hood temperature');
      if (dr.level > 300) this.turbineTrip('Drum level high – water induction risk');
    }
    // catastrophic overspeed
    if (tb.rpm > 4500) {
      this.emit('explosion', { what: 'turbine' });
      this.damage.turbine = 1;
      this.end('TURBINE DISINTEGRATION', 'The rotor exceeded 125 % speed. Centrifugal stress burst the LP discs. Overspeed protection must be tested regularly.');
    }
    // boiler overpressure
    if (dr.p > 13.8) {
      this.emit('explosion', { what: 'boiler' });
      this.damage.boiler = 1;
      this.end('BOILER EXPLOSION', 'Drum pressure exceeded its design rupture margin. With the safety valves seized, there was nowhere for the energy to go.');
    }
    // water wall tube failure (low water)
    if (dr.tubeT > dr.Ts + 180 && !this.tubeFailed) {
      this.tubeFailed = true;
      this.fault.tubeLeak = 25;
      this.damage.boiler = Math.max(this.damage.boiler, 0.7);
      this.note('WATER WALL TUBE RUPTURE – overheated from low water', 'trip');
      this.emit('explosion', { what: 'tube' });
      this.mft('Furnace pressure high (tube rupture)');
    }
    // superheater overheating
    if (sh.Tm > 640) {
      this.damage.sh = Math.min(1, this.damage.sh + (sh.Tm - 640) / 100 * dt * 0.01);
      if (this.damage.sh >= 1 && !this.shFailed) {
        this.shFailed = true; this.fault.tubeLeak = Math.max(this.fault.tubeLeak, 12);
        this.note('SUPERHEATER TUBE FAILURE – long-term overheating (no steam flow while firing)', 'trip');
        this.emit('explosion', { what: 'tube' });
        this.mft('Superheater tube failure');
      }
    }
    // turbine thermal stress damage
    if (Math.abs(tb.stress) > 150 && tb.rpm > 100) this.damage.turbine = Math.min(1, this.damage.turbine + (Math.abs(tb.stress) - 150) * dt * 2e-6);
    // drum thermal stress
    if (Math.abs(dr.dTdt) > 250) this.damage.boiler = Math.min(1, this.damage.boiler + dt * 5e-6 * (Math.abs(dr.dTdt) - 250) / 100);
    // generator: overcurrent heating
    if (g.I > 2200) this.damage.gen = Math.min(1, this.damage.gen + (g.I - 2200) * dt * 1e-6);
  }

  stepAlarms() {
    const A = this.alarms, now = this.t;
    const dr = this.drum, sh = this.sh, tb = this.tb, cd = this.cond, da = this.da, fu = this.furn, g = this.gen;
    const firing = this.bms.mainFlame;
    const set = (id, on, text, pri = 2) => {
      const a = A.get(id);
      if (on) { if (!a) { A.set(id, { id, text, pri, t: now, ack: false, active: true }); this.emit('alarm', { id, pri }); } else if (!a.active) { a.active = true; a.ack = false; a.t = now; this.emit('alarm', { id, pri }); } }
      else if (a) { a.active = false; if (a.ack) A.delete(id); }
    };
    set('LVL_HI', dr.levelA > 120, 'DRUM LEVEL HIGH', 2);
    set('LVL_LO', dr.levelA < -120, 'DRUM LEVEL LOW', 2);
    set('LVL_DEV', Math.abs(dr.levelA - dr.levelB) > 40, 'DRUM LEVEL TRANSMITTER DEVIATION', 2);
    set('DRUM_P_HI', dr.p > 10.0, 'DRUM PRESSURE HIGH', 1);
    set('SV_OPEN', this.svs.some(s => s.open), 'SAFETY VALVE OPEN', 1);
    set('SH_T_HI', sh.Tout > 530, 'MAIN STEAM TEMP HIGH', 2);
    set('SH_T_LO', tb.q > 3 && sh.Tout < 450, 'MAIN STEAM TEMP LOW', 2);
    set('SH_WET', sh.wet > 0.005 && sh.p > 0.3, 'MAIN STEAM WET – WATER INDUCTION', 1);
    set('SH_METAL', sh.Tm > 605, 'SUPERHEATER METAL OVERTEMP', 1);
    set('STEAM_LINE_COND', sh.condensate > 40, 'MAIN STEAM LINE CONDENSATE HIGH', 3);
    set('O2_LO', firing && fu.o2 < 1.0, 'FLUE GAS O₂ LOW', 2);
    set('CO_HI', firing && fu.co > 400, 'FLUE GAS CO HIGH', 2);
    set('SMOKE', fu.smoke > 0.3, 'STACK OPACITY HIGH', 2);
    set('FURN_P', fu.pres > 12, 'FURNACE PRESSURE HIGH', 1);
    set('GAS_LO', this.env.gasP < 0.25, 'GAS SUPPLY PRESSURE LOW', 2);
    set('BFP_RECIRC', this.bfp.some(p => p.speed > 0.5 && p.flow < 5 && this.fw.recirc.pos < 0.3), 'BFP BELOW MINIMUM FLOW', 1);
    set('BFP_CAV', this.bfp.some(p => p.cav > 0.3), 'BFP CAVITATION – LOW SUCTION', 1);
    set('BFP_TRIP', this.bfp.some(p => p.tripped), 'FEED PUMP TRIPPED', 1);
    set('FWCV_FULL', this.fwcv.pos > 0.95 && this.fw.q < dr.qsteam - 2, 'FEED VALVE WIDE OPEN – FEED < STEAM', 2);
    set('DA_LVL_LO', da.level < 30, 'DEAERATOR LEVEL LOW', 2);
    set('DA_LVL_HI', da.level > 90, 'DEAERATOR LEVEL HIGH', 3);
    set('DA_O2', da.do2 > 20, 'FEEDWATER DISSOLVED O₂ HIGH', 3);
    set('HW_LO', cd.hwLevel < 25, 'HOTWELL LEVEL LOW', 2);
    set('HW_HI', cd.hwLevel > 85, 'HOTWELL LEVEL HIGH', 3);
    set('VAC_LO', tb.rpm > 100 && cd.p > 0.015, 'CONDENSER VACUUM LOW', 1);
    set('TB_VIB', tb.vib > 125, 'TURBINE VIBRATION HIGH', 1);
    set('TB_ECC', tb.eccentric > 76, 'ROTOR ECCENTRICITY HIGH', 2);
    set('TB_STRESS', Math.abs(tb.stress) > 100, 'TURBINE ROTOR STRESS HIGH', 2);
    set('TB_EXH', tb.exhT > 80, 'EXHAUST HOOD TEMP HIGH', 2);
    set('TB_OS', tb.rpm > 3708, 'TURBINE OVERSPEED', 1);
    set('LUBE_LO', tb.lube.p < 0.08 && tb.rpm > 2, 'LUBE OIL PRESSURE LOW', 1);
    set('BRG_T', tb.lube.Tbrg > 95, 'BEARING METAL TEMP HIGH', 1);
    set('TB_TRIP', !tb.latched && tb.rpm > 100, 'TURBINE TRIPPED', 1);
    set('GEN_REV', g.breaker && g.Pe < -0.3, 'GENERATOR REVERSE POWER', 1);
    set('GEN_86', g.lockout, 'GENERATOR LOCKOUT (86G)', 1);
    set('GRID', !this.env.gridOK, 'GRID UNAVAILABLE', 1);
    set('MFT', this.bms.state === 'TRIPPED', 'BOILER MASTER FUEL TRIP', 1);
    set('FD_TRIP', this.fault.fdTrip, 'FD FAN TRIPPED', 1);
    set('CW_LO', tb.q > 1 && cd.cwFlow < 300, 'CIRC WATER FLOW LOW', 1);
    set('TDS', dr.tds > 150, 'BOILER WATER CONDUCTIVITY HIGH', 3);
    set('STEAM_FEED_MM', dr.qsteam > 5 && this.fw.q - dr.qsteam - dr.qbd > 4 && this.fault.tubeLeak > 0, 'STEAM/FEED FLOW MISMATCH', 2);
    set('DRUM_RATE', Math.abs(dr.dTdt) > 150, 'DRUM HEATING RATE EXCESSIVE', 3);
  }

  stepEconomics(dt) {
    const g = this.gen, st = this.stats;
    let aux = 0.08;
    for (const p of this.bfp) aux += p.power || 0;
    for (const p of this.cp) aux += p.speed * 0.12;
    aux += this.fd.speed * (0.15 + 0.55 * Math.pow(this.air.pct / 100, 2.5));
    aux += ((this.cond.cwA ? 1 : 0) + (this.cond.cwB ? 1 : 0)) * 0.42 + (this.cond.vacPump ? 0.06 : 0) + (this.cond.hogger ? 0.2 : 0);
    aux += this.tb.lube.aop ? 0.04 : 0;
    g.aux = aux;
    const Pg = g.breaker ? g.Pe * 0.985 : 0;
    g.Pnet = Pg - aux;
    // dispatch target changes every few minutes when online
    if (!st.nextDispatch || this.t > st.nextDispatch) {
      st.nextDispatch = this.t + 300 + this.rand() * 300;
      st.dispatch = Math.round(14 + this.rand() * 18);
      this.env.price = Math.round(35 + this.rand() * 80);
    }
    const hrs = dt / 3600;
    st.revenue += g.Pnet * this.env.price * hrs;
    st.fuelCost += (this.fuel.flow + this.fuel.pilotFlow) * D.LHV / 1e6 * 3600 / 1055 * this.env.fuelPrice * hrs; // $/MMBtu
    st.mwh += Math.max(0, g.Pnet) * hrs;
    if (g.breaker) st.trackErr += Math.abs(g.Pnet - st.dispatch) * hrs;
  }

  pushTrend() {
    const s = this;
    this.trend.push({
      t: s.t, p: s.drum.p, psh: s.sh.p, lvl: s.drum.levelA, T: s.sh.Tout, mw: s.gen.Pe, rpm: s.tb.rpm,
      qs: s.drum.qsteam, qf: s.fw.q, fuel: s.fuel.flow / D.fuelMax * 100, air: s.air.pct, o2: s.furn.o2,
      vac: s.cond.p * 1000, f: s.env.gridF, vib: s.tb.vib, da: s.da.level, hw: s.cond.hwLevel,
    });
    if (this.trend.length > 1800) this.trend.shift();
  }

  // advance the simulation by `real` seconds with fixed sub-steps
  advance(real, dtFix = 0.02) {
    this._acc = (this._acc || 0) + real;
    let n = 0;
    while (this._acc >= dtFix && n < 2000) { this.step(dtFix); this._acc -= dtFix; n++; }
    if (n >= 2000) this._acc = 0;
    return n;
  }
}

function mkPump(name) { return { name, run: false, speed: 0, flow: 0, amps: 0, temp: 40, tripped: false, damage: 0, cav: 0, power: 0 }; }

// ---------------------------------------------------------------- scenarios
export const SCENARIOS = {
  cold: { name: 'Cold start', desc: 'Everything is shut down. The boiler is filled and vented, the condenser is at atmospheric pressure and the turbine is stationary. Bring the unit from cold iron to the grid.' },
  hot: { name: 'Hot standby', desc: 'The boiler is banked at 6 MPa with the burner off. Vacuum is up, BFP-A is running and the turbine is on turning gear. Purge, light off, roll, synchronize and load the unit.' },
  online: { name: 'Online – 60 % load', desc: 'The unit is synchronized at about 20 MW with all controls in auto. Follow the dispatcher and handle whatever the shift brings.' },
  full: { name: 'Full load', desc: 'Base load at about 35 MW. The plant is close to its limits, so a single failure can cascade quickly.' },
};

function applyScenario(s, name) {
  const dr = s.drum, sh = s.sh, cd = s.cond, da = s.da, tb = s.tb;
  if (name === 'cold') {
    dr.p = 0.1013; dr.Vwt = D.Vtubes + dr.Vdrum * 0.42; sh.p = 0.1013; sh.Tm = 25; sh.Tline = 22; sh.h = 2676;
    s.drumVent.set(1); s.drumVent.pos = 1; s.vent.set(1); s.vent.pos = 1; s.drain.set(1); s.drain.pos = 1;
    s.ctl.lvl.auto = false; s.fw.Tecon = 30; s.furn.T = 22;
    da.h = S.hWater(40); da.T = 40; da.p = 0.1013; da.M = 0.55 * D.daVol * 990;
    cd.Tcs = 22; cd.mAir = 175; cd.hw = 0.5 * D.hwVol * 990;
    tb.Tr = 25; tb.T1 = 25; tb.lube.aop = false; tb.tg = false; tb.lube.p = 0; tb.lube.Tbrg = 25;
    s.ctl.daP.auto = true; s.cbd.set(0); s.cbd.pos = 0;
    dr.tds = 20;
    return;
  }
  // common warm conditions
  tb.lube.aop = true; tb.lube.p = 0.16; tb.tg = true; tb.tgEngaged = true; tb.omega = 0.335;
  cd.cwA = true; cd.cwB = true; cd.cwFlow = 2 * D.cwPerPump; cd.vacPump = true; cd.vacBreaker.set(0); cd.vacBreaker.pos = 0;
  cd.mAir = 2; cd.Tcs = 24; cd.p = 0.005;
  s.cp[0].run = true; s.cp[0].speed = 1;
  s.bfp[0].run = true; s.bfp[0].speed = 1;
  da.h = S.hWater(133); da.T = 133; da.p = 0.30; da.M = 0.6 * D.daVol * 932;
  s.fd.run = false; da.do2 = 6;
  if (name === 'hot') {
    dr.p = 6.0; sh.p = 6.0; dr.Ts = S.tsat(6); sh.Tm = 300; sh.Tline = 265; sh.h = S.hg(6); sh.Tout = dr.Ts;
    dr.Vwt = D.Vtubes + dr.Vdrum * 0.47; s.furn.T = 160; s.fw.Tecon = 200;
    tb.Tr = 240; tb.T1 = 240; s.ctl.master.auto = false;
    s.drain.set(0.3); s.drain.pos = 0.3;
    s.bms.state = 'SHUTDOWN'; s.bms.tripCause = '';
    tb.stillT = 0;
    // settle feed/condensate inventory controls
    for (let i = 0; i < 1500; i++) s.step(0.02);
  } else {
    const mw = name === 'full' ? 35 : 20;
    const load = mw / 36;
    dr.p = 9.0 + 0.4 * load; sh.p = 8.7; dr.Ts = S.tsat(dr.p); sh.Tm = 470 + 40 * load; sh.Tline = 500; sh.h = S.hPT(8.7, 505); sh.Tout = 505;
    dr.Vwt = D.Vtubes + dr.Vdrum * 0.5 - 3 * Math.pow(load, 0.65); dr.Vbub = 3.2 * Math.pow(load, 0.65);
    tb.Tr = 470; tb.T1 = 480; tb.latched = true; tb.msv = true; tb.msvPos = 1; tb.tg = true; tb.tgEngaged = false;
    tb.omega = TAU * 60; tb.rpm = 3600; tb.mode = 'load'; tb.mwSP = mw; tb.mwRef = mw; tb.gv.pos = 0.5 * load + 0.1; tb.gv.cmd = tb.gv.pos; tb._li = tb.gv.pos; tb.tripCause = '';
    tb.vib = 30;
    const g = s.gen; g.breaker = true; g.field = true; g.E = 1.08; g.Efd = 1.08; g.delta = 0.35 * load; g.avrSP = 1.01;
    s.fd.run = true; s.fd.speed = 1;
    s.bms.state = 'FIRING'; s.bms.mainFlame = true; s.bms.purgeDone = true; s.bms.mainOnT = 60; s.bms.tripCause = '';
    s.fuel.ssov = true; s.fcv.pos = 0.85 * load; s.fcv.cmd = s.fcv.pos; s.damper.pos = 0.9 * load; s.damper.cmd = s.damper.pos;
    s.ctl.master.auto = true; s.ctl.master.i = 0.85 * load; s.ctl.master.out = 0.85 * load; s.firingMan = 0.85 * load;
    s.furn.T = 1000; s.fw.Tecon = 200;
    if (name === 'full') { s.bfp[1].run = true; s.bfp[1].speed = 1; }
    s.cp[1].run = name === 'full'; s.cp[1].speed = name === 'full' ? 1 : 0;
    s.fwcv.pos = 0.6; s.fwcv.cmd = 0.6; s.ctl.lvl3.i = 0;
    for (let i = 0; i < 9000; i++) s.step(0.02); // settle 3 minutes
  }
  s.alarms.clear(); s.log.length = 0; s.events.length = 0; s.trend.length = 0;
  s.stats = { revenue: 0, fuelCost: 0, mwh: 0, dispatch: Math.round(s.gen.Pnet) || 0, trackErr: 0, nextDispatch: s.t + 240 };
  s.damage = { boiler: 0, sh: 0, turbine: 0, gen: 0, bfp: 0, furnace: 0 };
  s.t0 = s.t;
}
