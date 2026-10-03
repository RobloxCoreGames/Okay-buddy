// Procedural, spatialized plant soundscape (Web Audio API). Nothing is sampled – every sound is synthesized
// from noise and oscillators and driven by the simulation state.
const cl = (x, a, b) => Math.max(a, Math.min(b, x));

export class PlantAudio {
  constructor() { this.ctx = null; this.on = false; this.vol = 0.8; this.src = {}; this.alarmMuted = false; }

  start() {
    if (this.ctx) { this.ctx.resume(); this.on = true; return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.on = true;
    this.master = ctx.createGain(); this.master.gain.value = this.vol;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);
    // hall reverb
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(2.6, 2.2);
    this.verbSend = ctx.createGain(); this.verbSend.gain.value = 0.32;
    this.verbSend.connect(this.verb); this.verb.connect(this.master);
    this.ui = ctx.createGain(); this.ui.gain.value = 0.5; this.ui.connect(comp);
    // noise sources
    this.white = this.noiseBuf('white'); this.pink = this.noiseBuf('pink'); this.brown = this.noiseBuf('brown');
    this.build();
  }
  stop() { if (this.ctx) this.ctx.suspend(); this.on = false; }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  impulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(sec * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 2000 ? i / 2000 : 1); }
    return b;
  }
  noiseBuf(kind) {
    const ctx = this.ctx, n = ctx.sampleRate * 4, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return b;
  }
  noise(buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random() * 3; s.start(0, Math.random() * 3); return s; }
  osc(type, f) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; }
  filt(type, f, q = 0.7, gain = 0) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain; return b; }
  gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  panner(pos, ref = 4, roll = 1.1) {
    const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 400;
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; } else p.setPosition(...pos);
    return p;
  }
  // node chain into a spatial output
  spatial(pos, ref, roll, verb = 1) {
    const out = this.gain(0); const p = this.panner(pos, ref, roll);
    out.connect(p); p.connect(this.master);
    const s = this.gain(verb); p.connect(s); s.connect(this.verbSend);
    return out;
  }
  chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }

  build() {
    const S = this.src;
    // burner roar
    {
      const out = this.spatial([-24, 4.2, 6.5], 5, 1.0, 1);
      const n = this.noise(this.brown), lp = this.filt('lowpass', 380, 0.5), g = this.gain(1);
      this.chain(n, lp, g, out);
      const n2 = this.noise(this.pink), bp = this.filt('bandpass', 140, 1.2), g2 = this.gain(0.9);
      this.chain(n2, bp, g2, out);
      const n3 = this.noise(this.white), hp = this.filt('bandpass', 2600, 0.6), g3 = this.gain(0.0);
      this.chain(n3, hp, g3, out);
      // combustion "huffing" modulation
      const lfo = this.osc('sine', 3.1), lg = this.gain(0.25); lfo.connect(lg); lg.connect(g.gain);
      S.burner = { out, hiss: g3, lp, bp };
    }
    // FD fan
    {
      const out = this.spatial([-33.5, 2.3, 6], 4, 1.1);
      const n = this.noise(this.pink), bp = this.filt('bandpass', 700, 0.6); this.chain(n, bp, out);
      const o = this.osc('triangle', 230), og = this.gain(0.12), of = this.filt('lowpass', 900); this.chain(o, of, og, out);
      const o2 = this.osc('sine', 460), og2 = this.gain(0.05); this.chain(o2, og2, out);
      S.fd = { out, o, o2, bp };
    }
    // turbine: steam flow rush + blade-pass whine + rotor hum + rumble
    {
      const out = this.spatial([11, 7.6, 0], 5, 1.0, 1.2);
      const n = this.noise(this.pink), hp = this.filt('bandpass', 1800, 0.5), rush = this.gain(0); this.chain(n, hp, rush, out);
      const w1 = this.osc('sine', 1000), g1 = this.gain(0); this.chain(w1, g1, out);
      const w2 = this.osc('sine', 1500), g2 = this.gain(0); this.chain(w2, g2, out);
      const w3 = this.osc('triangle', 200), g3 = this.gain(0), f3 = this.filt('lowpass', 1200); this.chain(w3, f3, g3, out);
      const hum = this.osc('sine', 60), hg = this.gain(0); this.chain(hum, hg, out);
      const hum2 = this.osc('sine', 120), hg2 = this.gain(0); this.chain(hum2, hg2, out);
      const rb = this.noise(this.brown), rlp = this.filt('lowpass', 90), rg = this.gain(0); this.chain(rb, rlp, rg, out);
      S.turb = { out, rush, hp, w1, g1, w2, g2, w3, g3, hum, hg, hum2, hg2, rg };
    }
    // generator + transformer magnetostriction hum
    {
      const out = this.spatial([23, 7.7, 0], 5, 1.1);
      const a = this.osc('sine', 120), ag = this.gain(0.6), b = this.osc('sine', 240), bg = this.gain(0.25), c = this.osc('sine', 360), cg = this.gain(0.12);
      this.chain(a, ag, out); this.chain(b, bg, out); this.chain(c, cg, out);
      const fan = this.noise(this.pink), fb = this.filt('bandpass', 900, 0.5), fg = this.gain(0); this.chain(fan, fb, fg, out);
      S.gen = { out, fg };
      const tout = this.spatial([42, 3, 6], 4, 1.2, 0.3);
      const t1 = this.osc('sine', 120), t1g = this.gain(0.7), t2 = this.osc('sine', 240), t2g = this.gain(0.35), t3 = this.osc('sine', 360), t3g = this.gain(0.2);
      this.chain(t1, t1g, tout); this.chain(t2, t2g, tout); this.chain(t3, t3g, tout);
      S.xfmr = { out: tout };
    }
    // pumps & motors
    const motor = (pos, freq = 120, nf = 1400, ref = 3) => {
      const out = this.spatial(pos, ref, 1.3);
      const o = this.osc('sawtooth', freq), lp = this.filt('lowpass', 400), og = this.gain(0.2); this.chain(o, lp, og, out);
      const o2 = this.osc('sine', freq * 0.5), o2g = this.gain(0.12); this.chain(o2, o2g, out);
      const n = this.noise(this.pink), bp = this.filt('bandpass', nf, 0.7), ng = this.gain(0.9); this.chain(n, bp, ng, out);
      const cav = this.noise(this.white), cbp = this.filt('highpass', 2500), cg = this.gain(0); this.chain(cav, cbp, cg, out);
      return { out, cg, o, bp };
    };
    S.bfp = [motor([-7, 1.3, 5]), motor([-7, 1.3, 9])];
    S.cp = [motor([12.4, 2, 6.8], 120, 1800, 2), motor([14.4, 2, 6.8], 120, 1800, 2)];
    S.cw = [motor([34, 3, 21], 120, 900, 3), motor([37, 3, 21], 120, 900, 3)];
    S.vac = [motor([21.5, 1, 7.3], 100, 700, 2), motor([21.5, 1, 8.4], 100, 600, 2.5)];
    S.lube = [motor([8, 2.6, 9], 120, 2000, 1.5), motor([10, 2.6, 9], 100, 2200, 1.5)];
    // steam releases
    const release = (pos, f = 1800, ref = 6, q = 0.5, verb = 1) => {
      const out = this.spatial(pos, ref, 1.0, verb);
      const n = this.noise(this.white), bp = this.filt('bandpass', f, q), pk = this.filt('peaking', f * 2, 1, 6); this.chain(n, bp, pk, out);
      const r = this.noise(this.brown), lp = this.filt('lowpass', 250), rg = this.gain(0.7); this.chain(r, lp, rg, out);
      return { out };
    };
    S.sv = [release([-25.6, 35, -1], 1500, 9), release([-23.2, 35, -1], 1600, 9), release([-19.9, 34, 3.4], 1400, 9)];
    S.vent = release([-27, 33, 5.2], 600, 7, 0.6);
    S.erv = release([-22.2, 32, 4.4], 1700, 8);
    S.drain = release([2.6, 0.6, 11.2], 2500, 2, 0.9);
    S.dv = release([-21.5, 27.5, -0.6], 3000, 2, 1);
    S.bd = release([-32.8, 2.4, -1.5], 2200, 3, 0.8);
    S.leak = release([-19, 12, 1], 2600, 4, 0.8);
    S.diaph = release([15.8, 12.6, 1.4], 900, 8);
    S.daVent = release([-9.5, 22, -7], 3500, 1.5, 1);
    // cooling tower water fall & fans
    {
      const out = this.spatial([52, 5, 28], 8, 1.0, 0.2);
      const n = this.noise(this.pink), lp = this.filt('lowpass', 2400), hp = this.filt('highpass', 300); this.chain(n, lp, hp, out);
      S.ct = { out };
    }
    // outdoor wind ambience (non-spatial)
    {
      const g = this.gain(0.05); const n = this.noise(this.brown), lp = this.filt('lowpass', 300); this.chain(n, lp, g, this.master);
      const lfo = this.osc('sine', 0.07), lg = this.gain(0.03); lfo.connect(lg); lg.connect(g.gain);
      S.wind = g;
    }
    // alarm horn (UI)
    {
      const o = this.osc('square', 880), f = this.filt('lowpass', 2400), g = this.gain(0); this.chain(o, f, g, this.ui);
      S.horn = { o, g };
    }
    // turning gear clack scheduler state
    this.nextClick = 0; this.nextSpark = 0; this.nextCrackle = 0;
  }

  set(node, v, tc = 0.12) { if (node) node.gain.setTargetAtTime(v, this.ctx.currentTime, tc); }
  freq(osc, f, tc = 0.1) { osc.frequency.setTargetAtTime(Math.max(1, f), this.ctx.currentTime, tc); }

  updateListener(cam) {
    const L = this.ctx.listener, p = cam.position;
    const f = cam.getWorldDirection(this._v || (this._v = cam.position.clone()));
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.03); L.positionY.setTargetAtTime(p.y, t, 0.03); L.positionZ.setTargetAtTime(p.z, t, 0.03);
      L.forwardX.setTargetAtTime(f.x, t, 0.03); L.forwardY.setTargetAtTime(f.y, t, 0.03); L.forwardZ.setTargetAtTime(f.z, t, 0.03);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }

  update(sim, cam, dt) {
    if (!this.ctx || !this.on) return;
    this.updateListener(cam);
    const S = this.src, fu = sim.furn, tb = sim.tb, cd = sim.cond, now = this.ctx.currentTime;
    // burner
    const fire = sim.bms.mainFlame ? cl(fu.firing, 0, 1.3) : 0;
    const pilot = sim.bms.pilotFlame ? 1 : 0;
    this.set(S.burner.out, fire > 0 ? 0.35 + 1.4 * Math.pow(fire, 0.6) : pilot * 0.12);
    S.burner.lp.frequency.setTargetAtTime(260 + 500 * fire, now, 0.2);
    this.set(S.burner.hiss, (fu.lambda < 1 && fire > 0 ? 0.6 : 0.08) + (pilot && !fire ? 0.5 : 0));
    // ignitor spark ticks
    if (sim.fuel.ignitor && now > this.nextSpark) { this.click([-23, 4.2, 6.6], 0.25, 3500); this.nextSpark = now + 0.11; }
    // FD fan
    const fs = sim.fd.speed;
    this.set(S.fd.out, fs * (0.4 + 0.6 * sim.air.pct / 100));
    this.freq(S.fd.o, 236 * fs + 1); this.freq(S.fd.o2, 472 * fs + 1);
    // turbine
    const rps = tb.rpm / 60, q = tb.q;
    this.set(S.turb.out, 1.0);
    this.set(S.turb.rush, cl(Math.sqrt(q / 30) * 1.3 + (sim.tb.msvPos > 0 && q > 0.05 ? 0.1 : 0), 0, 1.6));
    S.turb.hp.frequency.setTargetAtTime(900 + 2000 * cl(q / 30, 0, 1), now, 0.3);
    this.freq(S.turb.w1, rps * 58); this.freq(S.turb.w2, rps * 84); this.freq(S.turb.w3, rps * 7);
    const sp = cl(tb.rpm / 3600, 0, 1.2);
    this.set(S.turb.g1, 0.05 * sp * sp + 0.05 * cl(q / 30, 0, 1) * sp);
    this.set(S.turb.g2, 0.025 * sp * sp);
    this.set(S.turb.g3, 0.08 * sp);
    this.freq(S.turb.hum, Math.max(rps, 1)); this.freq(S.turb.hum2, Math.max(rps * 2, 2));
    this.set(S.turb.hg, 0.35 * sp); this.set(S.turb.hg2, 0.18 * sp);
    this.set(S.turb.rg, cl((tb.vib - 30) / 120, 0, 1.5) * 1.2 + 0.25 * sp);
    if (tb.tgEngaged && tb.rpm > 0.5 && now > this.nextClick) { this.click([19, 8.5, 1.3], 0.18, 900); this.nextClick = now + 60 / (tb.rpm * 24 + 1); }
    // generator & transformer
    const g = sim.gen;
    this.set(S.gen.out, g.field ? 0.15 + (g.breaker ? 0.5 * cl(Math.abs(g.Pe) / 36, 0, 1.2) : 0.08) : 0);
    this.set(S.gen.fg, 0.4 * sp);
    this.set(S.xfmr.out, g.breaker ? 0.55 : 0);
    // pumps
    const pumpUpd = (s, run, load = 0.5, cav = 0) => { this.set(s.out, run ? 0.35 + 0.35 * load : 0, 0.4); this.set(s.cg, cav * 0.8); if (cav > 0.2 && Math.random() < cav * dt * 30) this.crackle(s.out); };
    sim.bfp.forEach((p, i) => pumpUpd(S.bfp[i], p.speed, p.flow / 30, p.cav));
    sim.cp.forEach((p, i) => pumpUpd(S.cp[i], p.speed * 0.5, p.flow / 40, p.cav));
    pumpUpd(S.cw[0], cd.cwA ? 1 : 0, 0.8); pumpUpd(S.cw[1], cd.cwB ? 1 : 0, 0.8);
    pumpUpd(S.vac[0], cd.vacPump ? 0.6 : 0, 0.5); pumpUpd(S.vac[1], cd.hogger ? 0.9 : 0, 0.9);
    pumpUpd(S.lube[0], tb.lube.aop ? 0.4 : 0, 0.3); pumpUpd(S.lube[1], tb.lube.dcop ? 0.5 : 0, 0.3);
    // steam releases
    sim.svs.forEach((sv, i) => this.set(S.sv[i].out, sv.q > 0.1 ? cl(sv.q / 12, 0.4, 2.2) : 0, 0.04));
    this.set(S.vent.out, sim.sh.qvent > 0.05 ? cl(Math.sqrt(sim.sh.qvent / 8), 0.1, 1.6) : 0, 0.15);
    this.set(S.erv.out, sim.sh.qerv > 0.1 ? 1.5 : 0, 0.05);
    this.set(S.drain.out, cl(sim.sh.qdrain / 1.5, 0, 0.6));
    this.set(S.dv.out, sim.drum.qdv > 0.02 ? cl(sim.drum.qdv, 0.1, 0.8) : 0);
    this.set(S.bd.out, cl(sim.drum.qbd / 2, 0, 0.9));
    this.set(S.leak.out, cl(sim.fault.tubeLeak / 10, 0, 1.5));
    this.set(S.diaph.out, cd.diaphragm && tb.q > 0.5 ? 1.6 : 0);
    this.set(S.daVent.out, sim.da.p > 0.12 ? 0.12 : 0);
    this.set(S.ct.out, cd.cwFlow > 50 ? 0.9 * cl(cd.cwFlow / 1800, 0, 1) : 0, 0.8);
    // annunciator horn: pulses while unacknowledged alarms exist
    const horn = sim.alarmUnack && !this.alarmMuted;
    const pri1 = sim.alarmPri1;
    if (horn) {
      const phase = (now * (pri1 ? 2.2 : 1.2)) % 1;
      this.freq(S.horn.o, pri1 ? (phase < 0.5 ? 950 : 720) : 880, 0.005);
      this.set(S.horn.g, (pri1 || phase < 0.5) ? 0.22 : 0, 0.01);
    } else this.set(S.horn.g, 0, 0.02);
  }

  // ------------------------------------------------------------ one-shots
  oneShot(pos, ref = 6) { return pos ? this.spatial(pos, ref, 1.0, 1.4) : (() => { const g = this.gain(1); g.connect(this.master); const s = this.gain(1); g.connect(s); s.connect(this.verbSend); return g; })(); }
  env(g, peak, attack, decay) { const t = this.ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay); }
  burstNoise(out, buf, f1, f2, peak, a, d, type = 'lowpass') {
    const s = this.ctx.createBufferSource(); s.buffer = buf; const f = this.filt(type, f1, 0.7); const g = this.gain(0);
    this.chain(s, f, g, out);
    const t = this.ctx.currentTime;
    f.frequency.setValueAtTime(f1, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + a + d);
    this.env(g, peak, a, d); s.start(t, Math.random() * 2); s.stop(t + a + d + 0.1);
  }
  thump(out, f0, f1, peak, d) {
    const o = this.ctx.createOscillator(); o.type = 'sine'; const g = this.gain(0); this.chain(o, g, out);
    const t = this.ctx.currentTime; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
    this.env(g, peak, 0.005, d); o.start(t); o.stop(t + d + 0.1);
  }
  click(pos, peak, f) { if (!this.ctx) return; const out = this.oneShot(pos, 2); out.gain.value = 1; this.burstNoise(out, this.white, f, f * 0.6, peak, 0.001, 0.03, 'bandpass'); }
  crackle(out) { this.burstNoise(out, this.white, 3000, 1500, 0.5 + Math.random() * 0.5, 0.001, 0.02, 'highpass'); }
  metal(out, sev) {
    for (const [f, q, d] of [[183, 30, 1.6], [412, 40, 1.2], [767, 50, 0.9], [1331, 60, 0.7], [2100, 70, 0.4]]) {
      const s = this.ctx.createBufferSource(); s.buffer = this.white; const bp = this.filt('bandpass', f * (0.95 + Math.random() * 0.1), q); const g = this.gain(0);
      this.chain(s, bp, g, out); this.env(g, 4 * sev, 0.002, d * (0.6 + sev)); const t = this.ctx.currentTime; s.start(t); s.stop(t + d * 2);
    }
  }
  play(e) {
    if (!this.ctx || !this.on) return;
    const pos = {
      hammer: [-6, 8, 12.5], breaker: [47, 2, 1], badSync: [23, 7.6, 0], lightoff: [-24, 4.2, 6], puff: [-24, 5, 6], pilotLight: [-23, 4.2, 6.6],
      latch: [6.5, 7, 0], svLift: [-23, 33, 0], svSeat: [-23, 33, 0], grind: [18, 7.6, 0], flameout: [-24, 4.2, 6.5],
    }[e.type];
    const out = this.oneShot(pos, 8);
    switch (e.type) {
      case 'hammer': this.metal(out, 0.5 + e.sev); this.thump(out, 90, 40, 1.5 * e.sev, 0.5); this.burstNoise(out, this.brown, 800, 80, 1.2, 0.002, 0.4); break;
      case 'breaker': this.thump(out, 70, 35, 1.2, 0.25); this.burstNoise(out, this.white, 4000, 800, 0.8, 0.001, 0.08, 'bandpass'); this.uiBeep(660, 0.08); break;
      case 'badSync': this.thump(out, 55, 25, 3, 1.4); this.metal(out, 1.2); this.burstNoise(out, this.brown, 600, 40, 2.5, 0.01, 2.5); break;
      case 'lightoff': this.burstNoise(out, this.brown, 500, 60, 2.2, 0.03, 1.1); this.thump(out, 80, 40, 1.0, 0.4); break;
      case 'pilotLight': this.burstNoise(out, this.pink, 1200, 300, 0.6, 0.02, 0.4); break;
      case 'flameout': this.burstNoise(out, this.brown, 300, 60, 0.8, 0.02, 0.8); break;
      case 'puff': this.burstNoise(out, this.brown, 900, 40, 3.5 * e.sev + 0.5, 0.005, 1.6); this.thump(out, 60, 25, 3 * e.sev, 0.8); this.metal(out, e.sev); break;
      case 'explosion': {
        const o2 = this.oneShot(null);
        this.burstNoise(o2, this.brown, 2500, 30, 6, 0.004, 5); this.thump(o2, 50, 18, 6, 2.5); this.metal(o2, 2); this.burstNoise(o2, this.white, 6000, 500, 2.5, 0.002, 1.2);
        break;
      }
      case 'svLift': this.burstNoise(out, this.white, 2500, 1200, 2.0, 0.005, 0.5, 'bandpass'); this.thump(out, 120, 60, 0.8, 0.2); break;
      case 'svSeat': this.thump(out, 200, 90, 0.5, 0.12); break;
      case 'latch': this.thump(out, 160, 90, 0.6, 0.12); this.click(pos, 0.5, 2200); break;
      case 'grind': this.metal(out, 1.5); this.burstNoise(out, this.white, 5000, 1500, 1.5, 0.01, 2.5, 'highpass'); break;
      case 'trip': this.tripSiren(); break;
      case 'chime': this.uiBeep(880, 0.15); setTimeout(() => this.uiBeep(1320, 0.2), 160); break;
      default: break;
    }
  }
  uiBeep(f, d = 0.06, peak = 0.3) {
    if (!this.ctx || !this.on) return;
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = this.gain(0); this.chain(o, g, this.ui);
    this.env(g, peak, 0.004, d); const t = this.ctx.currentTime; o.start(t); o.stop(t + d + 0.05);
  }
  tripSiren() {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; const f = this.filt('lowpass', 1800); const g = this.gain(0);
    this.chain(o, f, g, this.ui);
    const t = this.ctx.currentTime;
    for (let k = 0; k < 3; k++) { o.frequency.setValueAtTime(500, t + k * 0.7); o.frequency.linearRampToValueAtTime(1100, t + k * 0.7 + 0.6); }
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.05); g.gain.setValueAtTime(0.35, t + 2.0); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.start(t); o.stop(t + 2.3);
  }
}
