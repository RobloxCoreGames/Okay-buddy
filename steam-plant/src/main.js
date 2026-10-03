// Application glue: main loop, input, tooltips, toasts, start & game-over screens.
import { Plant, D, SCENARIOS } from './sim.js';
import { PlantScene, WalkControls } from './scene.js';
import { PlantAudio } from './audio.js';
import { ConsoleUI } from './ui.js';

const f = (x, d = 1) => (x == null || !isFinite(x) ? '—' : x.toFixed(d));
const $ = id => document.getElementById(id);

class App {
  constructor() {
    this.sim = new Plant();
    this.sim.reset('hot');
    this.audio = new PlantAudio();
    this.view = new PlantScene($('gl'), $('labels'));
    this.view.walk = new WalkControls(this.view.camera, $('gl'));
    this.ui = new ConsoleUI(this);
    this.ts = 1; this.paused = false; this.started = false;
    this.lastLog = null;
    this.bindInput();
    this.buildStart();
    addEventListener('resize', () => this.view.resize());
    this.t = performance.now();
    requestAnimationFrame(() => this.frame());
  }

  loadScenario(name) {
    this.sim.reset(name);
    this.ui.render();
    this.lastLog = null;
    $('over').hidden = true;
    this.toast(`Scenario loaded: ${SCENARIOS[name].name}`);
  }

  setSpeed(ts) {
    this.ts = ts; this.paused = ts === 0;
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === ts));
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.t) / 1000); this.t = now;
    const sim = this.sim;
    if (this.started && !this.paused && !sim.over) sim.advance(dt * this.ts);
    // alarms summary for horn & beacon
    let unack = false, pri1 = false;
    for (const a of sim.alarms.values()) if (a.active && !a.ack) { unack = true; if (a.pri === 1) pri1 = true; }
    sim.alarmUnack = unack; sim.alarmPri1 = pri1;
    // events
    for (const e of sim.events) { this.audio.play(e); this.view.event(e); }
    sim.events.length = 0;
    // toasts from the log
    if (sim.log.length && sim.log[0] !== this.lastLog) {
      const idx = this.lastLog ? sim.log.indexOf(this.lastLog) : Math.min(sim.log.length, 1);
      const fresh = sim.log.slice(0, idx < 0 ? 3 : idx).reverse();
      for (const l of fresh) if (l.level !== 'info' || /established|proven|CLOSED|latched|complete/i.test(l.msg)) this.toast(l.msg, l.level);
      this.lastLog = sim.log[0];
    }
    if (sim.over && $('over').hidden) this.showOver();
    this.view.update(sim, dt, this.paused ? 0 : this.ts);
    this.audio.update(sim, this.view.camera, dt);
    this.ui.refresh();
    if (this._tipId) this.updateTip();
    requestAnimationFrame(() => this.frame());
  }

  toast(msg, level = 'info') {
    const t = document.createElement('div'); t.className = 'toast ' + level; t.textContent = msg;
    const box = $('toasts'); box.prepend(t);
    while (box.children.length > 5) box.lastChild.remove();
    setTimeout(() => t.classList.add('out'), 5200); setTimeout(() => t.remove(), 5800);
  }

  showOver() {
    const o = this.sim.over;
    $('overTitle').textContent = o.title; $('overText').textContent = o.text;
    $('overTime').textContent = `Shift time ${Math.floor((o.t - (this.sim.t0 || 0)) / 60)} min · energy sent ${f(this.sim.stats.mwh, 2)} MWh`;
    $('over').hidden = false;
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const gl = $('gl');
    let down = null;
    gl.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    gl.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || this.view.walk.enabled) return;
      const hit = this.pickAt(e.clientX, e.clientY);
      if (hit) this.openFor(hit.id);
    });
    gl.addEventListener('dblclick', e => { const hit = this.pickAt(e.clientX, e.clientY); if (hit) this.view.focus(hit.id); });
    let lastMove = 0;
    gl.addEventListener('pointermove', e => {
      if (this.view.walk.enabled) return;
      const n = performance.now(); if (n - lastMove < 60) return; lastMove = n;
      const hit = this.pickAt(e.clientX, e.clientY);
      const tip = $('tip');
      if (!hit) { tip.hidden = true; this._tipId = null; gl.style.cursor = ''; return; }
      gl.style.cursor = 'pointer';
      this._tipId = hit.id; this._tipName = hit.name;
      tip.hidden = false;
      const w = innerWidth; tip.style.left = Math.min(e.clientX + 16, w - 260) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
      this.updateTip();
    });
    gl.addEventListener('pointerleave', () => { $('tip').hidden = true; this._tipId = null; });
    addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input')) return;
      const k = e.key.toLowerCase();
      if (e.key === 'Tab') { e.preventDefault(); this.togglePanel(); }
      else if (k === 'f') this.toggleWalk();
      else if (k === 'x') this.toggle('xray');
      else if (k === 'n') this.toggle('night');
      else if (k === 'l') this.toggle('labels');
      else if (k === 'r') this.toggle('roof');
      else if (k === 'm') this.toggle('sound');
      else if (k === 'p') this.setSpeed(this.paused ? 1 : 0);
      else if (k === 'escape' && this.view.walk.enabled) this.toggleWalk();
      else if (['1', '2', '3', '4', '5'].includes(k) && !this.view.walk.enabled) this.setSpeed([1, 2, 5, 10, 20][+k - 1]);
    });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && this.view.walk.enabled) this.toggleWalk(); });
    $('topbar').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.speed) this.setSpeed(+b.dataset.speed);
      if (b.dataset.tog) this.toggle(b.dataset.tog);
      if (b.dataset.cmd === 'panel') this.togglePanel();
      if (b.dataset.cmd === 'walk') this.toggleWalk();
      if (b.dataset.cmd === 'help') $('help').hidden = !$('help').hidden;
    });
    $('help').addEventListener('click', e => { if (e.target.closest('[data-close]')) $('help').hidden = true; });
    $('overRestart').addEventListener('click', () => this.loadScenario(this.sim.scenario));
    $('overMenu').addEventListener('click', () => { $('over').hidden = true; $('start').hidden = false; this.started = false; });
  }
  pickAt(x, y) { const r = $('gl').getBoundingClientRect(); return this.view.raycast((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); }
  togglePanel() { document.body.classList.toggle('nopanel'); setTimeout(() => this.view.resize(), 50); }
  toggleWalk() {
    const on = !this.view.walk.enabled;
    this.view.walk.enable(on);
    this.view.controls.enabled = !on;
    document.body.classList.toggle('walking', on);
    if (!on) { const d = this.view.camera.getWorldDirection(this.view.controls.target.clone()); this.view.controls.target.copy(this.view.camera.position).addScaledVector(d, 10); }
    document.querySelector('[data-cmd="walk"]').classList.toggle('on', on);
    if (on) this.toast('Walk mode: WASD to move, mouse to look, Q/E down/up, Shift to run, Esc to exit');
  }
  toggle(what) {
    const v = this.view;
    const btn = document.querySelector(`[data-tog="${what}"]`);
    let on;
    if (what === 'xray') { on = !v.xray; v.setXray(on); }
    else if (what === 'night') { on = !v.night; v.setNight(on); }
    else if (what === 'labels') { on = !(this._labels ?? true); this._labels = on; v.setLabels(on); }
    else if (what === 'roof') { on = !(this._roof ?? true); this._roof = on; v.setRoof(on); }
    else if (what === 'sound') { on = !this.audio.on; if (on) this.audio.start(); else this.audio.stop(); }
    if (btn) btn.classList.toggle('on', on);
  }
  openFor(id) {
    const map = { drum: 'boiler', gaugeglass: 'boiler', furnace: 'boiler', burner: 'boiler', fd: 'boiler', damper: 'boiler', ssov: 'boiler', fcv: 'boiler', stack: 'boiler', vent: 'boiler', erv: 'boiler', drumvent: 'boiler', cbd: 'boiler', ibd: 'boiler', sv0: 'boiler', sv1: 'boiler', sv2: 'boiler', spray: 'boiler', drain: 'boiler',
      bfp0: 'feed', bfp1: 'feed', fwcv: 'feed', fwbp: 'feed', da: 'feed', condenser: 'feed', cp0: 'feed', cp1: 'feed', cw0: 'feed', cw1: 'feed', vac: 'feed', vacbreaker: 'feed', makeup: 'feed', lcv: 'feed',
      turbine: 'turbine', generator: 'turbine', msv: 'turbine', lube: 'turbine', breaker: 'turbine', transformer: 'turbine', controlroom: 'overview' };
    if (map[id]) { this.ui.show(map[id]); document.body.classList.remove('nopanel'); }
  }
  info(id) {
    const s = this.sim, tb = s.tb;
    const pump = p => [['State', p.tripped ? 'TRIPPED' : p.speed > 0.05 ? 'RUNNING' : 'stopped'], ['Flow', f(p.flow, 1) + ' kg/s'], ['Motor', f(p.amps, 0) + ' A']];
    const vlv = v => [['Position', f(v.pos * 100, 0) + ' %'], ['Demand', f(v.cmd * 100, 0) + ' %']];
    switch (id) {
      case 'drum': return [['Pressure', f(s.drum.p, 2) + ' MPa'], ['Saturation', f(s.drum.Ts, 0) + ' °C'], ['Level (LT-A)', f(s.drum.levelA, 0) + ' mm'], ['Steam out', f(s.drum.qsteam, 1) + ' kg/s']];
      case 'gaugeglass': return [['True level', f(s.drum.level, 0) + ' mm'], ['LT-A reads', f(s.drum.levelA, 0) + ' mm'], ['LT-B reads', f(s.drum.levelB, 0) + ' mm']];
      case 'furnace': case 'burner': return [['BMS', s.bms.state], ['Heat release', f(s.furn.Qrel / 1000, 1) + ' MW'], ['Exit gas', f(s.furn.T, 0) + ' °C'], ['O₂ / CO', f(s.furn.o2, 1) + ' % / ' + f(s.furn.co, 0) + ' ppm']];
      case 'fd': return [['State', s.fd.run ? 'RUNNING' : 'stopped'], ['Air flow', f(s.air.pct, 0) + ' %'], ['Motor', f(s.fd.amps, 0) + ' A']];
      case 'damper': return vlv(s.damper);
      case 'ssov': return [['SSOVs', s.fuel.ssov ? 'OPEN' : 'closed'], ['Pilot', s.fuel.pilot ? 'OPEN' : 'closed']];
      case 'fcv': return [...vlv(s.fcv), ['Gas flow', f(s.fuel.flow, 2) + ' kg/s']];
      case 'stack': return [['Stack temp', f(s.furn.Tstack, 0) + ' °C'], ['Opacity', f(s.furn.smoke * 100, 0) + ' %'], ['NOx', f(s.furn.nox, 0) + ' ppm']];
      case 'vent': return [...vlv(s.vent), ['Flow', f(s.sh.qvent, 1) + ' kg/s']];
      case 'erv': return [['ERV', s.erv.open ? 'OPEN' : 'closed'], ['Mode', s.erv.auto ? 'auto (' + s.erv.set + ' MPa)' : 'manual']];
      case 'drumvent': return vlv(s.drumVent);
      case 'cbd': return vlv(s.cbd);
      case 'ibd': return vlv(s.ibd);
      case 'sv0': case 'sv1': case 'sv2': { const v = s.svs[+id[2]]; return [['Set pressure', v.set + ' MPa'], ['State', v.open ? 'LIFTED' : 'seated'], ['Relieving', f(v.q, 1) + ' kg/s']]; }
      case 'spray': return [...vlv(s.spray), ['Spray flow', f(s.sh.qspray, 2) + ' kg/s'], ['MS temp', f(s.sh.Tout, 0) + ' °C']];
      case 'drain': return [...vlv(s.drain), ['Condensate in line', f(s.sh.condensate, 0) + ' kg']];
      case 'bfp0': return [...pump(s.bfp[0]), ['Discharge', f(s.fw.pDis, 2) + ' MPa']];
      case 'bfp1': return [...pump(s.bfp[1]), ['Discharge', f(s.fw.pDis, 2) + ' MPa']];
      case 'fwcv': return [...vlv(s.fwcv), ['Feed flow', f(s.fw.q, 1) + ' kg/s']];
      case 'fwbp': return vlv(s.fwbp);
      case 'da': return [['Pressure', f(s.da.p, 3) + ' MPa'], ['Temp', f(s.da.T, 0) + ' °C'], ['Level', f(s.da.level, 0) + ' %']];
      case 'condenser': return [['Pressure', f(s.cond.p * 1000, 1) + ' kPa abs'], ['Hotwell', f(s.cond.hwLevel, 0) + ' %'], ['Heat load', f(s.cond.Q / 1000, 1) + ' MW']];
      case 'cp0': return pump(s.cp[0]); case 'cp1': return pump(s.cp[1]);
      case 'cw0': return [['State', s.cond.cwA ? 'RUNNING' : 'stopped']]; case 'cw1': return [['State', s.cond.cwB ? 'RUNNING' : 'stopped']];
      case 'vac': return [['Hogger', s.cond.hogger ? 'RUNNING' : 'stopped'], ['Holding pump', s.cond.vacPump ? 'RUNNING' : 'stopped'], ['Air in shell', f(s.cond.mAir, 1) + ' kg']];
      case 'vacbreaker': return vlv(s.cond.vacBreaker);
      case 'makeup': return [...vlv(s.cond.makeup), ['Flow', f(s.cond.qmk, 2) + ' kg/s']];
      case 'lcv': return vlv(s.cpLcv);
      case 'turbine': return [['Speed', f(tb.rpm, 0) + ' rpm'], ['Steam flow', f(tb.q, 1) + ' kg/s'], ['Vibration', f(tb.vib, 0) + ' µm'], ['Exhaust', f(tb.exhT, 0) + ' °C']];
      case 'generator': return [['Output', f(s.gen.breaker ? s.gen.Pe : 0, 1) + ' MW'], ['Reactive', f(s.gen.Q, 1) + ' MVAr'], ['Voltage', f(s.gen.Vt * 13.8, 2) + ' kV'], ['Frequency', f(s.gen.f, 2) + ' Hz']];
      case 'msv': return [['MSV', f(tb.msvPos * 100, 0) + ' % open'], ['Turbine', tb.latched ? 'latched' : 'TRIPPED']];
      case 'lube': return [['Oil pressure', f(tb.lube.p, 3) + ' MPa'], ['Bearing', f(tb.lube.Tbrg, 0) + ' °C'], ['AC pump', tb.lube.aop ? 'RUNNING' : 'stopped']];
      case 'breaker': return [['52G', s.gen.breaker ? 'CLOSED' : 'open'], ['Grid', f(s.env.gridF, 3) + ' Hz']];
      case 'transformer': return [['Loading', f(Math.hypot(s.gen.Pe, s.gen.Q) / 45 * 100, 0) + ' %'], ['Energized', s.gen.breaker ? 'yes' : 'no']];
      case 'controlroom': return [['Unit', 'Unit 1 · 36 MW gas'], ['Click', 'opens the overview']];
      default: return [];
    }
  }
  updateTip() {
    const rows = this.info(this._tipId);
    $('tip').innerHTML = `<b>${this._tipName}</b>${rows.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('')}<em>Click: open controls · Double-click: zoom</em>`;
  }

  buildStart() {
    const box = $('scen');
    box.innerHTML = Object.entries(SCENARIOS).map(([k, v]) => `<button class="scard" data-scen="${k}"><b>${v.name}</b><span>${v.desc}</span></button>`).join('');
    box.addEventListener('click', e => {
      const c = e.target.closest('[data-scen]'); if (!c) return;
      this.audio.start(); document.querySelector('[data-tog="sound"]').classList.add('on');
      this.loadScenario(c.dataset.scen);
      $('start').hidden = true; this.started = true; this.setSpeed(1);
      if (c.dataset.scen !== 'online' && c.dataset.scen !== 'full') this.ui.show('proc');
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try { window.app = new App(); }
  catch (err) {
    console.error(err);
    const el = document.getElementById('fatal');
    if (el) { el.hidden = false; el.textContent = 'The 3D view could not start: ' + err.message + '. WebGL 2 is required.'; }
  }
});
