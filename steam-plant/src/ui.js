// DCS operator console: tabs, faceplates, annunciator, trends, procedures, instructor station.
import { D, SCENARIOS } from './sim.js';

const f = (x, d = 1) => (x == null || !isFinite(x) ? '—' : x.toFixed(d));
const cl = (x, a, b) => Math.max(a, Math.min(b, x));
const hms = s => { s = Math.max(0, Math.floor(s)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

export class ConsoleUI {
  constructor(app) {
    this.app = app; this.vf = []; this.af = []; this.tab = 'overview';
    this.root = document.getElementById('dcs');
    this.render();
    this.root.addEventListener('click', e => this.onClick(e));
    document.getElementById('topbar').addEventListener('click', e => this.onClick(e));
    document.getElementById('annunc').addEventListener('click', e => this.onClick(e));
    this.root.addEventListener('change', e => this.onChange(e));
    this.root.addEventListener('input', e => this.onChange(e));
  }
  get s() { return this.app.sim; }

  // ---------------------------------------------------------------- binding helpers
  V(fn, cls = '', tag = 'span') { this.vf.push({ fn, kind: 'text' }); return `<${tag} class="${cls}" data-v="${this.vf.length - 1}"></${tag}>`; }
  BAR(fn, cls = '') { this.vf.push({ fn, kind: 'bar' }); return `<span class="bar ${cls}"><i data-v="${this.vf.length - 1}"></i></span>`; }
  BAR2(fnPos, fnCmd) { this.vf.push({ fn: fnPos, kind: 'bar' }); const a = this.vf.length - 1; this.vf.push({ fn: fnCmd, kind: 'mark' }); return `<span class="bar"><i data-v="${a}"></i><b data-v="${this.vf.length - 1}"></b></span>`; }
  LED(fn, label = '') { this.vf.push({ fn, kind: 'led' }); return `<span class="led" data-v="${this.vf.length - 1}"></span>${label ? `<span class="ledl">${label}</span>` : ''}`; }
  CLS(fn) { this.vf.push({ fn, kind: 'cls' }); return `data-v="${this.vf.length - 1}"`; }
  BTN(label, act, opts = {}) {
    this.af.push(act); const i = this.af.length - 1;
    let on = '';
    if (opts.on) { this.vf.push({ fn: opts.on, kind: 'on' }); on = ` data-v="${this.vf.length - 1}"`; }
    return `<button class="btn ${opts.cls || ''}" data-a="${i}"${on} title="${opts.title || ''}">${label}</button>`;
  }
  onClick(e) {
    const b = e.target.closest('[data-a]');
    if (b) { const fn = this.af[+b.dataset.a]; if (fn) { fn(b); this.app.audio.uiBeep(1200, 0.025, 0.12); this.refresh(true); } return; }
    const t = e.target.closest('[data-tab]');
    if (t) this.show(t.dataset.tab);
    const g = e.target.closest('[data-goto]');
    if (g) { this.show(g.dataset.goto); }
  }
  onChange(e) {
    const el = e.target;
    if (el.dataset.in) { const fn = this.inputs[el.dataset.in]; if (fn) fn(el); }
  }

  // ---------------------------------------------------------------- reusable widgets
  valveCtl(label, get, extra = '') {
    const st = v => () => get().set(cl(get().cmd + v, 0, 1));
    return `<div class="vctl"><div class="vname">${label}${extra}</div>
      <div class="vrow">${this.BAR2(() => get().pos, () => get().cmd)}${this.V(() => f(get().pos * 100, 0) + ' %', 'num w4')}</div>
      <div class="vbtns">${this.BTN('Close', () => get().set(0))}${this.BTN('−10', st(-0.1))}${this.BTN('−1', st(-0.01))}${this.BTN('+1', st(0.01))}${this.BTN('+10', st(0.1))}${this.BTN('Open', () => get().set(1))}</div></div>`;
  }
  // faceplate for a PID controller; manual output target via setOut(v) and getOut()
  faceplate(key, o) {
    const c = () => this.s.ctl[key];
    const spStep = o.spStep || 1;
    const outGet = o.getOut || (() => c().out);
    const outSet = o.setOut || (v => { c().out = v; });
    return `<div class="fp"><div class="fph"><span>${o.title || c().name}</span>
        ${this.BTN('AUTO', () => { c().auto = true; }, { on: () => c().auto, cls: 'sm' })}${this.BTN('MAN', () => { c().auto = false; }, { on: () => !c().auto, cls: 'sm' })}</div>
      <div class="fpg"><span class="lbl">PV</span>${this.V(() => o.pv ? o.pv() : f(c().pv, o.d ?? 1), 'num big')}<span class="u">${o.unit || ''}</span></div>
      <div class="fpg"><span class="lbl">SP</span>${this.V(() => f(c().sp, o.spd ?? o.d ?? 1), 'num')}<span class="u">${o.unit || ''}</span>
        ${this.BTN('−', () => { c().sp -= spStep; }, { cls: 'sm' })}${this.BTN('+', () => { c().sp += spStep; }, { cls: 'sm' })}</div>
      <div class="fpg"><span class="lbl">${o.outLabel || 'OUT'}</span>${this.BAR(() => (outGet() - (o.outMin || 0)) / ((o.outMax || 1) - (o.outMin || 0)))}${this.V(() => o.outFmt ? o.outFmt(outGet()) : f(outGet() * 100, 0) + ' %', 'num w4')}</div>
      <div class="fpb">${this.BTN('◀◀', () => { c().auto = false; outSet(cl(outGet() - 0.05, 0, 1)); }, { cls: 'sm', title: 'Manual output −5 %' })}${this.BTN('◀', () => { c().auto = false; outSet(cl(outGet() - 0.01, 0, 1)); }, { cls: 'sm', title: 'Manual output −1 %' })}${this.BTN('▶', () => { c().auto = false; outSet(cl(outGet() + 0.01, 0, 1)); }, { cls: 'sm', title: 'Manual output +1 %' })}${this.BTN('▶▶', () => { c().auto = false; outSet(cl(outGet() + 0.05, 0, 1)); }, { cls: 'sm', title: 'Manual output +5 %' })}</div>
    </div>`;
  }
  pump(p, name, extra = '') {
    return `<div class="pump"><div class="ph">${this.LED(() => p().tripped ? 'alarm' : p().speed > 0.05 ? 'run' : 'off')}<b>${name}</b>
      ${this.BTN('Start', () => this.s.pumpStart(p()), { cls: 'sm' })}${this.BTN('Stop', () => this.s.pumpStop(p()), { cls: 'sm' })}${this.BTN('Reset', () => this.s.pumpReset(p()), { cls: 'sm' })}</div>
      <div class="kv4"><span>Flow</span>${this.V(() => f(p().flow, 1) + ' kg/s')}<span>Motor</span>${this.V(() => f(p().amps, 0) + ' A')}${extra}</div></div>`;
  }
  kv(rows) { return `<div class="kv">${rows.map(([k, v]) => `<span>${k}</span>${v}`).join('')}</div>`; }
  sec(title, body, cls = '') { return `<section class="${cls}"><h3>${title}</h3>${body}</section>`; }

  // ---------------------------------------------------------------- render
  render() {
    const s = () => this.s;
    const tabs = [['overview', 'Overview'], ['boiler', 'Boiler'], ['feed', 'Feed & Cond'], ['turbine', 'Turbine / Gen'], ['trends', 'Trends'], ['alarms', 'Alarms'], ['proc', 'Procedures'], ['instr', 'Instructor']];
    this.inputs = {};
    const html = `
      <div class="tabs" role="tablist">${tabs.map(([k, n]) => `<button class="tab" data-tab="${k}" role="tab">${n}${k === 'alarms' ? this.V(() => { const n = [...this.s.alarms.values()].filter(a => a.active).length; return n ? ` ${n}` : ''; }, 'acount') : ''}</button>`).join('')}</div>
      <div class="pages">
        <div class="page" data-page="overview">${this.pageOverview()}</div>
        <div class="page" data-page="boiler">${this.pageBoiler()}</div>
        <div class="page" data-page="feed">${this.pageFeed()}</div>
        <div class="page" data-page="turbine">${this.pageTurbine()}</div>
        <div class="page" data-page="trends">${this.pageTrends()}</div>
        <div class="page" data-page="alarms">${this.pageAlarms()}</div>
        <div class="page" data-page="proc">${this.pageProc()}</div>
        <div class="page" data-page="instr">${this.pageInstr()}</div>
      </div>`;
    this.root.innerHTML = html;
    // top bar vitals & annunciator (always visible)
    document.getElementById('vitals').innerHTML = this.vitals();
    document.getElementById('annunc').innerHTML = this.annunc();
    this.els = [...document.querySelectorAll('[data-v]')].map(el => ({ el, i: +el.dataset.v, page: el.closest('.page')?.dataset.page || '*', last: undefined }));
    this.show(this.tab);
  }
  show(tab) {
    this.tab = tab;
    this.root.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    this.root.querySelectorAll('.page').forEach(p => p.hidden = p.dataset.page !== tab);
    this.refresh(true);
  }

  vitals() {
    const s = () => this.s;
    const item = (k, fn, u, cls) => `<div class="vit" ${cls ? this.CLS(cls) : ''}><span class="k">${k}</span><span class="vv">${this.V(fn)}<small>${u}</small></span></div>`;
    return [
      item('Gen', () => f(s().gen.breaker ? s().gen.Pe : 0, 1), 'MW', () => s().gen.breaker ? 'ok' : ''),
      item('Net', () => f(s().gen.Pnet, 1), 'MW'),
      item('Speed', () => f(s().tb.rpm, 0), 'rpm', () => s().tb.rpm > 3708 ? 'bad' : ''),
      item('Grid', () => f(s().env.gridF, 3), 'Hz'),
      item('Drum', () => f(s().drum.p, 2), 'MPa', () => s().drum.p > 10 ? 'bad' : ''),
      item('Level', () => f(s().drum.levelA, 0), 'mm', () => Math.abs(s().drum.levelA) > 120 ? 'bad' : Math.abs(s().drum.levelA) > 80 ? 'warn' : ''),
      item('MS temp', () => f(s().sh.Tout, 0), '°C', () => s().sh.Tout > 530 ? 'bad' : ''),
      item('Vacuum', () => f(s().cond.p * 1000, 1), 'kPa a', () => s().cond.p > 0.015 && s().tb.rpm > 100 ? 'bad' : ''),
      item('Dispatch', () => f(s().stats.dispatch, 0), 'MW'),
      item('Profit', () => '$' + f(s().stats.revenue - s().stats.fuelCost, 0), ''),
    ].join('');
  }
  annunc() {
    // fixed annunciator windows (ringing on alarm)
    const W = [['MFT', 'BOILER\nMFT'], ['LVL_HI', 'DRUM LVL\nHIGH'], ['LVL_LO', 'DRUM LVL\nLOW'], ['DRUM_P_HI', 'DRUM PRESS\nHIGH'], ['SV_OPEN', 'SAFETY\nVALVE OPEN'], ['SH_T_HI', 'MS TEMP\nHIGH'],
      ['SH_WET', 'WATER\nINDUCTION'], ['O2_LO', 'O₂\nLOW'], ['CO_HI', 'CO\nHIGH'], ['FURN_P', 'FURNACE\nPRESS HIGH'], ['BFP_TRIP', 'FEED PUMP\nTRIP'], ['BFP_CAV', 'BFP\nCAVITATION'],
      ['DA_LVL_LO', 'DEAERATOR\nLVL LOW'], ['HW_LO', 'HOTWELL\nLVL LOW'], ['VAC_LO', 'VACUUM\nLOW'], ['TB_VIB', 'TURBINE\nVIBRATION'], ['TB_TRIP', 'TURBINE\nTRIP'], ['LUBE_LO', 'LUBE OIL\nPRESS LOW'],
      ['TB_STRESS', 'ROTOR\nSTRESS'], ['TB_EXH', 'EXHAUST\nHOOD TEMP'], ['GEN_REV', 'REVERSE\nPOWER'], ['GEN_86', 'GEN\nLOCKOUT'], ['GRID', 'GRID\nLOSS'], ['LVL_DEV', 'LVL XMTR\nDEVIATION']];
    return `<div class="anngrid">${W.map(([id, t]) => `<div class="win" ${this.CLS(() => { const a = this.s.alarms.get(id); return a ? (a.active ? (a.ack ? 'act' : 'ring') : 'clr') : ''; })}>${t.replace('\n', '<br>')}</div>`).join('')}</div>
      <div class="annb">${this.BTN('Silence', () => { this.app.audio.alarmMuted = true; })}${this.BTN('Acknowledge', () => { for (const a of this.s.alarms.values()) a.ack = true; this.app.audio.alarmMuted = false; })}${this.BTN('Reset', () => { for (const [k, a] of this.s.alarms) if (!a.active) this.s.alarms.delete(k); })}</div>`;
  }

  pageOverview() {
    const s = () => this.s;
    const T = (x, y, fn, cls = 'mv') => `<text x="${x}" y="${y}" class="${cls}" ${''}>${this.V(fn, '', 'tspan')}</text>`;
    const st = (fn) => this.CLS(fn);
    const pumpC = p => () => p().tripped ? 'eq alarm' : p().speed > 0.05 ? 'eq run' : 'eq';
    const flowC = fn => () => (fn() > 0.3 ? 'fl on' : 'fl');
    return `
    <svg class="mimic" viewBox="0 0 520 430" role="img" aria-label="Plant overview mimic">
      <!-- boiler -->
      <g data-goto="boiler" class="hot"><rect x="20" y="70" width="110" height="200" rx="4" ${st(() => s().bms.mainFlame ? 'eq run' : 'eq')}/>
      <text x="75" y="88" class="ml">BOILER</text>
      <path d="M45 250 Q75 ${200} 105 250 Z" ${st(() => s().bms.mainFlame ? 'flame on' : s().bms.pilotFlame ? 'flame pilot' : 'flame')}/>
      ${T(75, 110, () => s().bms.state, 'mv c sm')}
      ${T(75, 132, () => 'Fuel ' + f(s().fuel.flow / D.fuelMax * 100, 0) + '%', 'mv c')}
      ${T(75, 150, () => 'Air ' + f(s().air.pct, 0) + '%', 'mv c')}
      ${T(75, 168, () => 'O₂ ' + f(s().furn.o2, 1) + '%', 'mv c')}
      ${T(75, 186, () => 'η ' + f(s().furn.eff * 100, 1) + '%', 'mv c')}</g>
      <!-- drum -->
      <g data-goto="boiler" class="hot"><rect x="30" y="18" width="90" height="38" rx="19" class="eq"/>
      <rect x="32" y="37" width="86" height="17" rx="8" ${st(() => Math.abs(s().drum.levelA) > 120 ? 'wat alarm' : 'wat')}/>
      ${T(75, 33, () => f(s().drum.p, 2) + ' MPa', 'mv c')}
      ${T(75, 68, () => 'Lvl ' + f(s().drum.levelA, 0) + ' mm', 'mv c sm')}</g>
      <!-- SH & main steam -->
      <path d="M120 30 H 300 V 70" ${st(flowC(() => s().tb.q + s().sh.qvent))}/>
      ${T(200, 22, () => f(s().sh.p, 2) + ' MPa  ' + f(s().sh.Tout, 0) + ' °C', 'mv c')}
      ${T(200, 46, () => f(s().drum.qsteam, 1) + ' kg/s', 'mv c sm')}
      <!-- turbine/gen -->
      <g data-goto="turbine" class="hot"><path d="M280 70 L320 70 L350 110 L350 140 L280 140 Z" ${st(() => s().tb.latched ? (s().tb.rpm > 100 ? 'eq run' : 'eq') : 'eq trip')}/>
      <text x="315" y="100" class="ml">TURB</text>
      ${T(315, 128, () => f(s().tb.rpm, 0) + ' rpm', 'mv c sm')}
      <line x1="350" y1="105" x2="380" y2="105" class="shaft"/>
      <circle cx="420" cy="105" r="34" ${st(() => s().gen.breaker ? 'eq run' : 'eq')}/>
      <text x="420" y="98" class="ml">GEN</text>
      ${T(420, 116, () => f(s().gen.Pe, 1) + ' MW', 'mv c')}
      <path d="M454 105 H 495 V 60" ${st(() => s().gen.breaker ? 'el on' : 'el')}/>
      <rect x="485" y="66" width="20" height="14" ${st(() => s().gen.breaker ? 'brk on' : 'brk')}/>
      ${T(495, 50, () => f(s().env.gridF, 2) + ' Hz', 'mv c sm')}</g>
      <!-- condenser -->
      <g data-goto="feed" class="hot"><path d="M315 140 V 175" ${st(flowC(() => s().tb.q))}/>
      <rect x="270" y="175" width="90" height="60" rx="4" class="eq"/>
      <text x="315" y="192" class="ml">CONDENSER</text>
      ${T(315, 210, () => f(s().cond.p * 1000, 1) + ' kPa a', 'mv c')}
      ${T(315, 226, () => 'HW ' + f(s().cond.hwLevel, 0) + '%', 'mv c sm')}
      <path d="M360 195 H 420" ${st(flowC(() => s().cond.cwFlow / 100))} />
      <path d="M360 220 H 420" ${st(flowC(() => s().cond.cwFlow / 100))} />
      <rect x="420" y="180" width="70" height="55" rx="3" class="eq"/>
      <text x="455" y="200" class="ml">CW / TOWER</text>
      ${T(455, 218, () => f(s().cond.cwFlow, 0) + ' kg/s', 'mv c sm')}</g>
      <!-- condensate -> DA -->
      <path d="M315 235 V 300 H 250" ${st(flowC(() => s().cond.qcp))}/>
      <circle cx="235" cy="300" r="13" ${st(pumpC(() => s().cp[0].speed > s().cp[1].speed ? s().cp[0] : s().cp[1]))}/>
      <text x="235" y="304" class="ml sm">CP</text>
      <path d="M222 300 H 200 V 170" ${st(flowC(() => s().cond.qcp))}/>
      <g data-goto="feed" class="hot"><rect x="160" y="130" width="90" height="40" rx="18" class="eq"/>
      <rect x="162" y="150" width="86" height="18" rx="8" ${st(() => s().da.level < 30 ? 'wat alarm' : 'wat')}/>
      <text x="205" y="125" class="ml">DEAERATOR</text>
      ${T(205, 146, () => f(s().da.p, 2) + ' MPa  ' + f(s().da.level, 0) + '%', 'mv c sm')}</g>
      <!-- feed -->
      <path d="M205 170 V 350 H 180" ${st(flowC(() => s().fw.q))}/>
      <circle cx="165" cy="350" r="13" ${st(pumpC(() => s().bfp[0]))}/><text x="165" y="354" class="ml sm">A</text>
      <circle cx="165" cy="385" r="13" ${st(pumpC(() => s().bfp[1]))}/><text x="165" y="389" class="ml sm">B</text>
      <path d="M152 350 H 75 V 270" ${st(flowC(() => s().fw.q))}/>
      ${T(112, 340, () => f(s().fw.q, 1) + ' kg/s', 'mv c sm')}
      ${T(112, 410, () => 'FWCV ' + f(s().fwcv.pos * 100, 0) + '%  ' + (s().threeElement ? '3-elem' : '1-elem'), 'mv c sm')}
      <!-- stack -->
      <path d="M130 90 H 150 V 40" class="flue"/>
      ${T(170, 64, () => f(s().furn.Tstack, 0) + ' °C', 'mv sm')}
    </svg>
    <div class="ovgrid">
      ${this.sec('Unit', this.kv([
        ['Gross / net', this.V(() => f(this.s.gen.breaker ? this.s.gen.Pe : 0, 1) + ' / ' + f(this.s.gen.Pnet, 1) + ' MW')],
        ['Auxiliary load', this.V(() => f(this.s.gen.aux, 2) + ' MW')],
        ['Heat input', this.V(() => f(this.s.furn.Qrel / 1000, 1) + ' MW')],
        ['Net heat rate', this.V(() => this.s.gen.Pnet > 1 ? f(this.s.furn.Qrel / this.s.gen.Pnet / 1000 * 3600, 0) + ' kJ/kWh' : '—')],
        ['Cycle efficiency', this.V(() => this.s.gen.Pnet > 1 && this.s.furn.Qrel > 0 ? f(this.s.gen.Pnet * 1000 / this.s.furn.Qrel * 100, 1) + ' %' : '—')],
      ]))}
      ${this.sec('Market', this.kv([
        ['Dispatch target', this.V(() => f(this.s.stats.dispatch, 0) + ' MW')],
        ['Power price', this.V(() => '$' + f(this.s.env.price, 0) + '/MWh')],
        ['Revenue', this.V(() => '$' + f(this.s.stats.revenue, 0))],
        ['Fuel cost', this.V(() => '$' + f(this.s.stats.fuelCost, 0))],
        ['Energy sent', this.V(() => f(this.s.stats.mwh, 2) + ' MWh')],
      ]))}
      ${this.sec('Equipment health', `<div class="health">${[['boiler', 'Boiler'], ['sh', 'Superheater'], ['furnace', 'Furnace'], ['turbine', 'Turbine'], ['gen', 'Generator'], ['bfp', 'Feed pumps']].map(([k, n]) => `<span>${n}</span>${this.BAR(() => 1 - this.s.damage[k], 'health')}`).join('')}</div>`)}
    </div>
    <div class="log">${this.V(() => this.s.log.slice(0, 7).map(l => `${hms(l.t - (this.s.t0 || 0))}  ${l.msg}`).join('\n'), 'pre')}</div>`;
  }

  pageBoiler() {
    const s = () => this.s;
    const b = () => this.s.bms;
    const perm = (label, fn) => `<li>${this.LED(() => fn() ? 'ok' : 'off')}${label}</li>`;
    return `
    ${this.sec('Burner management (BMS)', `
      <div class="bmsstate"><span class="lbl">State</span>${this.V(() => b().state, 'pill', 'b')}${this.V(() => b().tripCause ? '⚠ ' + b().tripCause : '', 'trip')}</div>
      <div class="row">${this.LED(() => this.s.fd.run ? 'run' : 'off', 'FD fan')} ${this.BTN('Start FD', () => this.s.fdStart())}${this.BTN('Stop FD', () => this.s.fdStop())}
        ${this.LED(() => b().scanner ? 'flame' : 'off', 'Flame scanner')}</div>
      <ul class="perm">
        ${perm('FD fan running', () => this.s.fd.run && this.s.fd.speed > 0.9)}
        ${perm('Air flow ≥ 25 % (purge rate)', () => this.s.air.pct >= 25)}
        ${perm('All fuel valves closed', () => !this.s.fuel.ssov && !this.s.fuel.pilot)}
        ${perm('Drum level > −200 mm', () => this.s.drum.levelA > -200)}
        ${perm('Gas supply pressure OK', () => this.s.env.gasP > 0.2)}
      </ul>
      <div class="row"><span class="lbl">Purge</span>${this.BAR(() => b().state === 'PURGING' ? b().purgeT / 90 : ['PURGE COMPLETE', 'LIGHT-OFF', 'FIRING'].includes(b().state) ? 1 : 0)}${this.V(() => b().state === 'PURGING' ? f(90 - b().purgeT, 0) + ' s' : b().state === 'PURGE COMPLETE' ? 'expires ' + f(b().purgeExpire, 0) + ' s' : '', 'num')}</div>
      <div class="seq">
        ${this.BTN('1 · Reset', () => this.s.bmsReset(), { on: () => b().state !== 'TRIPPED' })}
        ${this.BTN('2 · Purge', () => this.s.bmsPurge(), { on: () => b().state === 'PURGING' })}
        ${this.BTN('3 · Ignitor', () => this.s.bmsIgnitor(!this.s.fuel.ignitor), { on: () => this.s.fuel.ignitor })}
        ${this.BTN('4 · Pilot', () => this.s.bmsPilot(!this.s.fuel.pilot), { on: () => this.s.fuel.pilot })}
        ${this.BTN('5 · Main fuel', () => this.s.bmsMain(!this.s.fuel.ssov), { on: () => this.s.fuel.ssov })}
        ${this.BTN('MFT', () => this.s.mft('Manual (operator)'), { cls: 'danger' })}
      </div>`)}
    ${this.sec('Combustion', `
      ${this.faceplate('master', { title: 'Boiler master · steam pressure', unit: 'MPa', d: 2, spStep: 0.1, outLabel: 'FIRING', getOut: () => this.s.ctl.master.auto ? this.s.ctl.master.out : this.s.firingMan, setOut: v => { this.s.firingMan = cl(v, 0.06, 1); } })}
      ${this.kv([
        ['Gas flow', this.V(() => f(this.s.fuel.flow, 2) + ' kg/s  (' + f(this.s.fuel.flow / D.fuelMax * 100, 0) + ' %)')],
        ['Gas valve', this.V(() => f(this.s.fcv.pos * 100, 0) + ' %')],
        ['Air flow', this.V(() => f(this.s.air.flow, 1) + ' kg/s  (' + f(this.s.air.pct, 0) + ' %)')],
        ['Excess air (λ)', this.V(() => this.s.furn.lambda > 9 ? '—' : f(this.s.furn.lambda, 2))],
        ['Flue O₂ / CO / NOx', this.V(() => f(this.s.furn.o2, 1) + ' % / ' + f(this.s.furn.co, 0) + ' / ' + f(this.s.furn.nox, 0) + ' ppm')],
        ['Furnace exit gas', this.V(() => f(this.s.furn.T, 0) + ' °C')],
        ['Stack', this.V(() => f(this.s.furn.Tstack, 0) + ' °C · opacity ' + f(this.s.furn.smoke * 100, 0) + ' %')],
        ['Boiler efficiency', this.V(() => f(this.s.furn.eff * 100, 1) + ' % (LHV)')],
        ['Furnace pressure', this.V(() => f(this.s.furn.pres, 1) + ' mbar')],
      ])}
      ${this.faceplate('o2', { title: 'O₂ trim (air/fuel ratio)', unit: '% O₂', d: 1, spStep: 0.2, outLabel: 'RATIO', outMin: 0.85, outMax: 1.35, outFmt: v => '×' + f(v, 2), setOut: v => { this.s.ctl.o2.out = cl(v, 0.85, 1.35); }, getOut: () => this.s.ctl.o2.out })}
      ${this.faceplate('air', { title: 'Combustion air · FD damper', unit: '%', d: 0, spStep: 2, getOut: () => this.s.damper.cmd, setOut: v => this.s.damper.set(v) })}
    `)}
    ${this.sec('Steam drum', `
      ${this.kv([
        ['Pressure', this.V(() => f(this.s.drum.p, 2) + ' MPa · ' + f(this.s.drum.Ts, 0) + ' °C sat')],
        ['Heating rate', this.V(() => f(this.s.drum.dTdt, 0) + ' °C/h', '', 'span')],
        ['Level  LT-A / LT-B', this.V(() => f(this.s.drum.levelA, 0) + ' / ' + f(this.s.drum.levelB, 0) + ' mm')],
        ['Steam / feed flow', this.V(() => f(this.s.drum.qsteam, 1) + ' / ' + f(this.s.fw.q, 1) + ' kg/s')],
        ['Boiler water TDS', this.V(() => f(this.s.drum.tds, 0) + ' ppm')],
        ['Safety valves', this.V(() => this.s.svs.map(v => `${v.id} ${v.open ? 'OPEN' : 'shut'} (${v.set})`).join(' · '))],
      ])}
      <p class="hint">The 3D gauge glass on the drum end always shows the true level. If LT-A and LT-B disagree, go and look at it.</p>
      ${this.valveCtl('Drum air vent', () => this.s.drumVent)}
      ${this.valveCtl('Continuous blowdown', () => this.s.cbd)}
      ${this.valveCtl('Bottom blowdown (drops level fast)', () => this.s.ibd)}
    `)}
    ${this.sec('Superheater & main steam', `
      ${this.kv([
        ['Outlet', this.V(() => f(this.s.sh.p, 2) + ' MPa · ' + f(this.s.sh.Tout, 0) + ' °C')],
        ['Superheat', this.V(() => f(this.s.sh.Tout - this.s.drum.Ts, 0) + ' K' + (this.s.sh.wet > 0.001 ? ' · WET ' + f(this.s.sh.wet * 100, 1) + ' %' : ''))],
        ['Tube metal', this.V(() => f(this.s.sh.Tm, 0) + ' °C (limit 600)')],
        ['Steam line metal', this.V(() => f(this.s.sh.Tline, 0) + ' °C · condensate ' + f(this.s.sh.condensate, 0) + ' kg')],
        ['Spray flow', this.V(() => f(this.s.sh.qspray, 2) + ' kg/s')],
      ])}
      ${this.faceplate('sht', { title: 'Main steam temperature · spray', unit: '°C', d: 0, spStep: 2, getOut: () => this.s.spray.cmd, setOut: v => this.s.spray.set(v) })}
      ${this.valveCtl('SH start-up vent (to silencer)', () => this.s.vent)}
      ${this.valveCtl('Main steam line drains', () => this.s.drain)}
      <div class="row"><b>ERV</b>${this.BTN('Auto', () => { this.s.erv.auto = true; }, { on: () => this.s.erv.auto, cls: 'sm' })}${this.BTN('Open', () => { this.s.erv.auto = false; this.s.erv.man = true; }, { on: () => !this.s.erv.auto && this.s.erv.man, cls: 'sm' })}${this.BTN('Close', () => { this.s.erv.auto = false; this.s.erv.man = false; }, { on: () => !this.s.erv.auto && !this.s.erv.man, cls: 'sm' })}${this.LED(() => this.s.erv.open ? 'alarm' : 'off', 'open')}</div>
    `)}`;
  }

  pageFeed() {
    const s = this.s;
    return `
    ${this.sec('Boiler feed pumps', `
      ${this.pump(() => this.s.bfp[0], 'BFP-A', `<span>Disch.</span>${this.V(() => f(this.s.fw.pDis, 2) + ' MPa')}<span>Temp</span>${this.V(() => f(this.s.bfp[0].temp, 0) + ' °C')}`)}
      ${this.pump(() => this.s.bfp[1], 'BFP-B', `<span>Cavitation</span>${this.V(() => f(Math.max(this.s.bfp[0].cav, this.s.bfp[1].cav) * 100, 0) + ' %')}<span>Temp</span>${this.V(() => f(this.s.bfp[1].temp, 0) + ' °C')}`)}
      <div class="row"><b>Min-flow recirc</b>${this.BTN('Auto', () => { this.s.fw.recircAuto = true; }, { on: () => this.s.fw.recircAuto, cls: 'sm' })}${this.BTN('Open', () => { this.s.fw.recircAuto = false; this.s.fw.recirc.set(1); }, { cls: 'sm' })}${this.BTN('Close', () => { this.s.fw.recircAuto = false; this.s.fw.recirc.set(0); }, { cls: 'sm' })}${this.V(() => f(this.s.fw.qrec, 1) + ' kg/s', 'num')}</div>
      <p class="hint">One pump carries about 60 % load. Start the second pump before going above about 22 MW.</p>`)}
    ${this.sec('Drum level control', `
      <div class="row"><span class="lbl">Mode</span>${this.V(() => this.s.threeElement ? 'THREE-ELEMENT (level + steam flow + feed flow)' : 'SINGLE-ELEMENT (level only)', 'pill')}</div>
      ${this.faceplate('lvl', { title: 'Drum level → feed control valve', unit: 'mm', d: 0, spStep: 10, pv: () => f(this.s.drum.levelA, 0), getOut: () => this.s.fwcv.cmd, setOut: v => this.s.fwcv.set(v) })}
      ${this.valveCtl('Feed start-up bypass (manual)', () => this.s.fwbp)}
      ${this.kv([['Economizer outlet', this.V(() => f(this.s.fw.Tecon, 0) + ' °C')], ['Feed header', this.V(() => f(this.s.fw.pDis, 2) + ' MPa')]])}`)}
    ${this.sec('Deaerator', `
      ${this.kv([
        ['Pressure / temp', this.V(() => f(this.s.da.p, 3) + ' MPa · ' + f(this.s.da.T, 0) + ' °C')],
        ['Storage level', this.V(() => f(this.s.da.level, 0) + ' %')],
        ['Heating steam', this.V(() => 'extraction ' + f(this.s.da.qext, 2) + ' · pegging ' + f(this.s.da.peg, 2) + ' kg/s')],
        ['Dissolved O₂', this.V(() => f(this.s.da.do2, 0) + ' ppb')],
      ])}
      ${this.faceplate('daP', { title: 'Deaerator pressure (pegging steam)', unit: 'MPa', d: 3, spStep: 0.01 })}
      ${this.faceplate('daL', { title: 'Deaerator level → condensate LCV', unit: '%', d: 0, spStep: 2, getOut: () => this.s.cpLcv.cmd, setOut: v => this.s.cpLcv.set(v) })}`)}
    ${this.sec('Condenser & condensate', `
      ${this.kv([
        ['Shell pressure', this.V(() => f(this.s.cond.p * 1000, 2) + ' kPa abs (' + f((this.s.cond.p - 0.1013) * 1000, 1) + ' kPa g)')],
        ['Saturation temp', this.V(() => f(this.s.cond.Tcs, 1) + ' °C')],
        ['Air in shell', this.V(() => f(this.s.cond.mAir, 1) + ' kg · ' + f(this.s.cond.pAir * 1000, 2) + ' kPa partial')],
        ['Heat rejected', this.V(() => f(this.s.cond.Q / 1000, 1) + ' MW')],
        ['CW in / out', this.V(() => f(this.s.env.Tcw, 1) + ' / ' + f(this.s.cond.Tcw_out, 1) + ' °C')],
        ['Hotwell level', this.V(() => f(this.s.cond.hwLevel, 0) + ' %')],
        ['Exhaust hood', this.V(() => f(this.s.tb.exhT, 0) + ' °C' + (this.s.tb.hoodSpray ? ' · hood spray ON' : ''))],
      ])}
      <div class="row">${this.LED(() => this.s.cond.cwA ? 'run' : 'off', 'CW-A')}${this.BTN('Start', () => { this.s.cond.cwA = true; this.s.emit('motorStart'); }, { cls: 'sm' })}${this.BTN('Stop', () => { this.s.cond.cwA = false; }, { cls: 'sm' })}
        ${this.LED(() => this.s.cond.cwB ? 'run' : 'off', 'CW-B')}${this.BTN('Start', () => { this.s.cond.cwB = true; }, { cls: 'sm' })}${this.BTN('Stop', () => { this.s.cond.cwB = false; }, { cls: 'sm' })}</div>
      <div class="row">${this.LED(() => this.s.cond.hogger ? 'run' : 'off', 'Hogger')}${this.BTN('Start', () => { this.s.cond.hogger = true; }, { cls: 'sm' })}${this.BTN('Stop', () => { this.s.cond.hogger = false; }, { cls: 'sm' })}
        ${this.LED(() => this.s.cond.vacPump ? 'run' : 'off', 'Holding pump')}${this.BTN('Start', () => { this.s.cond.vacPump = true; }, { cls: 'sm' })}${this.BTN('Stop', () => { this.s.cond.vacPump = false; }, { cls: 'sm' })}</div>
      ${this.valveCtl('Vacuum breaker', () => this.s.cond.vacBreaker)}
      ${this.pump(() => this.s.cp[0], 'Condensate pump A')}
      ${this.pump(() => this.s.cp[1], 'Condensate pump B')}
      ${this.faceplate('hwL', { title: 'Hotwell level → makeup valve', unit: '%', d: 0, spStep: 2, getOut: () => this.s.cond.makeup.cmd, setOut: v => this.s.cond.makeup.set(v) })}`)}`;
  }

  pageTurbine() {
    const t = () => this.s.tb, g = () => this.s.gen;
    return `
    ${this.sec('Lube oil & turning gear', `
      <div class="row">${this.LED(() => t().lube.aop ? 'run' : 'off', 'AC oil pump')}${this.BTN('Start', () => { t().lube.aop = true; this.s.emit('motorStart'); }, { cls: 'sm' })}${this.BTN('Stop', () => { t().lube.aop = false; }, { cls: 'sm' })}
        ${this.LED(() => t().lube.dcop ? 'alarm' : 'off', 'DC emergency pump')}${this.BTN('Stop', () => { t().lube.dcop = false; }, { cls: 'sm' })}</div>
      <div class="row">${this.LED(() => t().tgEngaged ? 'run' : 'off', 'Turning gear')}${this.BTN('In service', () => { t().tg = true; }, { on: () => t().tg, cls: 'sm' })}${this.BTN('Off', () => { t().tg = false; }, { on: () => !t().tg, cls: 'sm' })}</div>
      ${this.kv([
        ['Oil pressure', this.V(() => f(t().lube.p, 3) + ' MPa')],
        ['Bearing metal', this.V(() => f(t().lube.Tbrg, 0) + ' °C')],
        ['Rotor eccentricity', this.V(() => f(t().eccentric, 0) + ' µm' + (t().bow > 0.05 ? ' · rotor bowed' : ''))],
      ])}`)}
    ${this.sec('Turbine control (DEH)', `
      <div class="bmsstate"><span class="lbl">Status</span>${this.V(() => t().latched ? (t().msvPos > 0.95 ? 'LATCHED · MSV OPEN' : 'LATCHED') : 'TRIPPED', 'pill', 'b')}${this.V(() => t().tripCause ? '⚠ ' + t().tripCause : '', 'trip')}</div>
      <div class="row">${this.BTN('Latch / reset', () => this.s.turbineLatch())}${this.BTN('Open MSV', () => this.s.turbineMSV(true))}${this.BTN('Close MSV', () => this.s.turbineMSV(false))}${this.BTN('TRIP', () => this.s.turbineTrip('Manual (operator)'), { cls: 'danger' })}</div>
      <div class="big3">
        <div><span class="lbl">Speed</span>${this.V(() => f(t().rpm, 0), 'num huge')}<small>rpm</small></div>
        <div><span class="lbl">Reference</span>${this.V(() => f(t().ref, 0), 'num huge')}<small>rpm</small></div>
        <div><span class="lbl">Valves</span>${this.V(() => f(t().gv.pos * 100, 1), 'num huge')}<small>%</small></div>
      </div>
      <div class="row"><span class="lbl">Speed target</span>${[0, 500, 2000, 3000, 3600].map(r => this.BTN(String(r), () => { t().target = r; t().mode === 'load' || (t().mode = 'speed'); }, { on: () => t().target === r, cls: 'sm' })).join('')}${this.BTN('Hold', () => { t().target = Math.round(t().ref); }, { cls: 'sm' })}</div>
      <div class="row"><span class="lbl">Acceleration</span>${[100, 200, 300, 500].map(r => this.BTN(r + '/min', () => { t().accel = r; }, { on: () => t().accel === r, cls: 'sm' })).join('')}</div>
      <p class="hint">Critical speeds are about 1850 and 2350 rpm. The DEH forces at least 450 rpm/min through 1650–2650 rpm, and holding there builds vibration.</p>
      ${this.kv([
        ['Steam flow', this.V(() => f(t().q, 2) + ' kg/s')],
        ['Throttle', this.V(() => f(this.s.sh.p, 2) + ' MPa · ' + f(t().Tin, 0) + ' °C')],
        ['Exhaust', this.V(() => f(this.s.cond.p * 1000, 1) + ' kPa · wetness ' + f((1 - Math.min(1, t().xEx)) * 100, 1) + ' %')],
        ['Shaft vibration', this.V(() => f(t().vib, 0) + ' µm pk-pk (trip 250)')],
        ['Rotor stress', this.V(() => f(t().stress, 0) + ' % · rotor ' + f(t().Tr, 0) + ' °C vs steam ' + f(t().T1, 0) + ' °C')],
        ['Internal efficiency', this.V(() => f(t().eta * 100, 1) + ' %')],
      ])}`)}
    ${this.sec('Generator & synchronizing', `
      <div class="syncwrap"><canvas id="syncscope" width="220" height="220" aria-label="Synchroscope"></canvas>
      <div class="synckv">${this.kv([
        ['Gen / grid', this.V(() => f(g().f, 3) + ' / ' + f(this.s.env.gridF, 3) + ' Hz')],
        ['Slip', this.V(() => f(g().f - this.s.env.gridF, 3) + ' Hz')],
        ['Phase', this.V(() => g().breaker ? 'locked' : f(((g().phase % 360) + 540) % 360 - 180, 0) + '°')],
        ['Voltage', this.V(() => f(g().Vt * 13.8, 2) + ' kV (' + f(g().Vt * 100, 1) + ' %)')],
        ['Field current', this.V(() => f(g().Ifd, 0) + ' A')],
      ])}
      <div class="row">${this.LED(() => g().field ? 'run' : 'off', 'Field')}${this.BTN('Field ON', () => { if (t().rpm < 2700) this.s.note('Field breaker blocked below 2700 rpm (V/Hz)', 'warn'); else g().field = true; }, { cls: 'sm' })}${this.BTN('OFF', () => { g().field = false; }, { cls: 'sm' })}</div>
      <div class="row"><span class="lbl">AVR</span>${this.BTN('Lower', () => { g().avrSP = cl(g().avrSP - 0.01, 0.9, 1.1); }, { cls: 'sm' })}${this.BTN('Raise', () => { g().avrSP = cl(g().avrSP + 0.01, 0.9, 1.1); }, { cls: 'sm' })}${this.V(() => f(g().avrSP * 100, 0) + ' %', 'num')}</div>
      </div></div>
      <div class="row">${this.LED(() => g().breaker ? 'run' : 'off', '52G breaker')}${this.BTN('CLOSE', () => this.s.breakerClose(), { cls: 'go' })}${this.BTN('OPEN', () => this.s.breakerOpen())}${this.BTN('Auto-sync', () => { t().autoSync = !t().autoSync; }, { on: () => t().autoSync })}${this.BTN('Reset 86G', () => { if (this.s.damage.gen < 1) { g().lockout = false; this.s.note('86G lockout reset'); } })}</div>
      <p class="hint">Close the breaker manually when the pointer turns slowly clockwise (generator slightly fast) and is just before 12 o'clock.</p>`)}
    ${this.sec('Load control', `
      <div class="big3">
        <div><span class="lbl">Generator</span>${this.V(() => f(g().breaker ? g().Pe : 0, 1), 'num huge')}<small>MW</small></div>
        <div><span class="lbl">Reactive</span>${this.V(() => f(g().Q, 1), 'num huge')}<small>MVAr</small></div>
        <div><span class="lbl">Dispatch</span>${this.V(() => f(this.s.stats.dispatch, 0), 'num huge')}<small>MW net</small></div>
      </div>
      <div class="row"><span class="lbl">MW setpoint</span>${this.BTN('−5', () => { t().mwSP = cl(t().mwSP - 5, 0, 40); }, { cls: 'sm' })}${this.BTN('−1', () => { t().mwSP = cl(t().mwSP - 1, 0, 40); }, { cls: 'sm' })}${this.V(() => f(t().mwSP, 0) + ' MW', 'num')}${this.BTN('+1', () => { t().mwSP = cl(t().mwSP + 1, 0, 40); }, { cls: 'sm' })}${this.BTN('+5', () => { t().mwSP = cl(t().mwSP + 5, 0, 40); }, { cls: 'sm' })}${this.BTN('= Dispatch', () => { t().mwSP = cl(this.s.stats.dispatch + this.s.gen.aux, 0, 40); }, { cls: 'sm' })}</div>
      <div class="row"><span class="lbl">Ramp rate</span>${[1, 3, 6, 10].map(r => this.BTN(r + ' MW/min', () => { t().mwRate = r; }, { on: () => t().mwRate === r, cls: 'sm' })).join('')}</div>
      <div class="row"><span class="lbl">Mode</span>${this.BTN('MW control', () => { t().valvePosMode = false; }, { on: () => !t().valvePosMode, cls: 'sm' })}${this.BTN('Valve position', () => { t().valvePosMode = true; t().gvMan = t().gv.pos; }, { on: () => t().valvePosMode, cls: 'sm' })}${this.BTN('GV −', () => { t().gvMan = cl(t().gvMan - 0.02, 0, 1); }, { cls: 'sm' })}${this.BTN('GV +', () => { t().gvMan = cl(t().gvMan + 0.02, 0, 1); }, { cls: 'sm' })}</div>
      ${this.kv([
        ['MW reference', this.V(() => f(t().mwRef, 1) + ' MW')],
        ['Stator current', this.V(() => f(g().I, 0) + ' A')],
        ['Load angle', this.V(() => g().breaker ? f(g().delta * 180 / Math.PI, 1) + '°' : '—')],
        ['Auxiliaries', this.V(() => f(g().aux, 2) + ' MW')],
        ['Governor droop', this.V(() => f(t().droop * 100, 0) + ' %')],
      ])}`)}`;
  }

  pageTrends() {
    this.trendSets = {
      boiler: [{ k: 'psh', n: 'MS pressure', min: 0, max: 11, u: 'MPa', c: '#4fb3ff' }, { k: 'lvl', n: 'Drum level', min: -300, max: 300, u: 'mm', c: '#ffd34d' }, { k: 'qs', n: 'Steam flow', min: 0, max: 40, u: 'kg/s', c: '#ff7a59' }, { k: 'qf', n: 'Feed flow', min: 0, max: 40, u: 'kg/s', c: '#7bd88f' }],
      turbine: [{ k: 'rpm', n: 'Speed', min: 0, max: 4000, u: 'rpm', c: '#4fb3ff' }, { k: 'mw', n: 'Generator', min: -5, max: 40, u: 'MW', c: '#ff7a59' }, { k: 'vib', n: 'Vibration', min: 0, max: 250, u: 'µm', c: '#ffd34d' }, { k: 'T', n: 'MS temp', min: 100, max: 560, u: '°C', c: '#c792ea' }],
      combustion: [{ k: 'fuel', n: 'Fuel', min: 0, max: 100, u: '%', c: '#ff7a59' }, { k: 'air', n: 'Air', min: 0, max: 100, u: '%', c: '#4fb3ff' }, { k: 'o2', n: 'O₂', min: 0, max: 21, u: '%', c: '#7bd88f' }, { k: 'p', n: 'Drum pressure', min: 0, max: 11, u: 'MPa', c: '#ffd34d' }],
      cycle: [{ k: 'vac', n: 'Condenser', min: 0, max: 40, u: 'kPa', c: '#4fb3ff' }, { k: 'hw', n: 'Hotwell', min: 0, max: 100, u: '%', c: '#7bd88f' }, { k: 'da', n: 'DA level', min: 0, max: 100, u: '%', c: '#ffd34d' }, { k: 'f', n: 'Grid', min: 59.8, max: 60.2, u: 'Hz', c: '#c792ea' }],
    };
    this.trendSel = 'boiler'; this.trendSpan = 600;
    return `<div class="row">${Object.keys(this.trendSets).map(k => this.BTN(k[0].toUpperCase() + k.slice(1), () => { this.trendSel = k; }, { on: () => this.trendSel === k, cls: 'sm' })).join('')}
      <span class="sp"></span>${[[300, '5 min'], [600, '10 min'], [1800, '30 min']].map(([v, n]) => this.BTN(n, () => { this.trendSpan = v; }, { on: () => this.trendSpan === v, cls: 'sm' })).join('')}</div>
      <canvas id="trend" width="500" height="300" aria-label="Trend chart"></canvas><div id="trendleg" class="legend"></div>`;
  }

  pageAlarms() {
    return `<div class="row">${this.BTN('Acknowledge all', () => { for (const a of this.s.alarms.values()) a.ack = true; this.app.audio.alarmMuted = false; })}${this.BTN('Clear returned', () => { for (const [k, a] of this.s.alarms) if (!a.active) this.s.alarms.delete(k); })}</div>
      <div class="alist">${this.V(() => { const L = [...this.s.alarms.values()].sort((a, b) => a.pri - b.pri || b.t - a.t); return L.length ? L.map(a => `<div class="al p${a.pri} ${a.active ? '' : 'rtn'} ${a.ack ? 'ack' : 'unack'}"><span>${hms(a.t - (this.s.t0 || 0))}</span><span>P${a.pri}</span><span>${a.text}</span><span>${a.active ? (a.ack ? 'ACK' : 'NEW') : 'RTN'}</span></div>`).join('') : '<p class="hint">No alarms.</p>'; }, '', 'div')}</div>
      <h3>Event log</h3><div class="elog">${this.V(() => this.s.log.slice(0, 60).map(l => `<div class="ev ${l.level}"><span>${hms(l.t - (this.s.t0 || 0))}</span>${l.msg}</div>`).join(''), '', 'div')}</div>`;
  }

  pageProc() {
    const s = () => this.s;
    const P = {
      cold: ['Cold start (from cold iron)', [
        ['Start both circulating water pumps', () => s().cond.cwA && s().cond.cwB],
        ['Start a condensate pump. Makeup holds the hotwell; get the DA level to 50 % or more', () => s().cp.some(p => p.speed > 0.5) && s().da.level >= 50],
        ['Start the AC lube oil pump and put the turning gear in service', () => s().tb.lube.aop && (s().tb.tgEngaged || s().tb.rpm > 2)],
        ['Close the vacuum breaker and start the hogger and holding vacuum pump. Pull vacuum below 20 kPa abs', () => s().cond.p < 0.02],
        ['Start BFP-A. Fill the drum to about −100 mm with the bypass or FWCV in manual', () => s().bfp.some(p => p.speed > 0.5) && s().drum.levelA > -150],
        ['Keep the drum vent, SH vent and steam line drains open', () => s().drumVent.pos > 0.5 && s().vent.pos > 0.2],
        ['Start the FD fan, reset the BMS and purge the furnace', () => ['PURGE COMPLETE', 'LIGHT-OFF', 'FIRING'].includes(s().bms.state)],
        ['Light off: ignitor, then pilot, then main fuel at minimum fire', () => s().bms.mainFlame],
        ['Close the drum vent once steam blows freely (above 0.2 MPa)', () => s().drum.p > 0.2 && s().drumVent.pos < 0.05],
        ['Raise pressure. Keep the drum heating rate under about 110 °C/h', () => s().drum.p > 3],
        ['Continue with the hot start procedure', () => s().drum.p > 6],
      ]],
      hot: ['Hot start (from banked boiler)', [
        ['Check the feed pump is running and the drum level is near normal (±80 mm)', () => s().bfp.some(p => p.speed > 0.5) && Math.abs(s().drum.levelA) < 80],
        ['Start the FD fan and establish purge air flow (25 % or more)', () => s().fd.run && s().air.pct >= 25],
        ['Purge the furnace (5 volume changes)', () => ['PURGE COMPLETE', 'LIGHT-OFF', 'FIRING'].includes(s().bms.state)],
        ['Ignitor and pilot. Prove the pilot flame', () => s().bms.pilotFlame || s().bms.mainFlame],
        ['Open main fuel at the light-off position', () => s().bms.mainFlame],
        ['Open the SH vent or drains so steam flows through the superheater', () => s().vent.pos > 0.1 || s().drain.pos > 0.3],
        ['Raise firing gently toward 8.7 MPa throttle pressure', () => s().sh.p > 8.2],
        ['Put the boiler master in AUTO', () => s().ctl.master.auto],
        ['Lube oil pressure normal, turning gear engaged and vacuum below 10 kPa abs', () => s().tb.lube.p > 0.1 && s().cond.p < 0.01],
        ['Latch the turbine and open the main stop valve', () => s().tb.latched && s().tb.msvPos > 0.9],
        ['Roll to 3600 rpm (watch vibration through the critical speeds)', () => s().tb.rpm > 3550],
        ['Close the SH vent and pinch the drains', () => s().vent.pos < 0.05],
        ['Close the field breaker and set terminal voltage to about 100 %', () => s().gen.field && Math.abs(s().gen.Vt - 1) < 0.05],
        ['Synchronize, manually or with auto-sync', () => s().gen.breaker],
        ['Take a 5 MW block load and close the drains once the line is hot', () => s().gen.Pe > 4 && s().drain.pos < 0.2],
        ['Start BFP-B and the second condensate pump before 22 MW', () => s().bfp.every(p => p.speed > 0.5)],
        ['Follow dispatch. Keep steam at 510 °C, O₂ at 2–4 % and level near 0 mm', () => s().gen.Pnet > 0 && Math.abs(s().gen.Pnet - s().stats.dispatch) < 2],
      ]],
      shut: ['Normal shutdown', [
        ['Ramp load down to about 3 MW', () => s().gen.breaker && s().gen.Pe < 4],
        ['Open the generator breaker', () => !s().gen.breaker],
        ['Trip the turbine. Confirm the MSV is closed', () => !s().tb.latched && s().tb.msvPos < 0.05],
        ['Open the field breaker', () => !s().gen.field],
        ['Open the drains and reduce firing to minimum (boiler master MAN)', () => !s().ctl.master.auto],
        ['Close main fuel. The burner shuts down', () => !s().bms.mainFlame],
        ['Keep lube oil running. Turning gear engages near standstill', () => s().tb.tgEngaged],
      ]],
    };
    this.procs = P;
    this.procSel = this.s.scenario === 'cold' ? 'cold' : 'hot';
    return `<div class="row">${Object.entries(P).map(([k, [n]]) => this.BTN(n, () => { this.procSel = k; this.renderProc(); }, { on: () => this.procSel === k, cls: 'sm' })).join('')}</div><ol id="proclist" class="proc"></ol>`;
  }
  renderProc() {
    const el = document.getElementById('proclist'); if (!el) return;
    const [, steps] = this.procs[this.procSel];
    el.innerHTML = steps.map(([t, c], i) => `<li data-i="${i}">${t}</li>`).join('');
  }
  updateProc() {
    const el = document.getElementById('proclist'); if (!el) return;
    if (!el.children.length) this.renderProc();
    const [, steps] = this.procs[this.procSel];
    let next = -1;
    [...el.children].forEach((li, i) => { let ok = false; try { ok = steps[i][1](); } catch (e) { ok = false; } li.classList.toggle('done', ok); if (!ok && next < 0) next = i; li.classList.remove('next'); });
    if (next >= 0) el.children[next].classList.add('next');
  }

  pageInstr() {
    const s = () => this.s;
    const F = (k, label, on) => `<div class="row">${this.BTN(label, () => { const fl = this.s.fault; fl[k] = on ? (typeof on === 'function' ? on(fl[k]) : (fl[k] ? (typeof fl[k] === 'number' ? 0 : false) : on)) : !fl[k]; this.s.note(`Instructor: ${label} ${fl[k] ? 'ACTIVE' : 'cleared'}`, 'warn'); }, { on: () => !!this.s.fault[k], cls: 'sm wide' })}</div>`;
    this.inputs.tcw = el => { this.s.env.Tcw = +el.value; this.s.env.Tamb = +el.value + 2; };
    this.inputs.fdev = el => { this.s.env.fDev = +el.value; };
    return `
    ${this.sec('Scenario', `<div class="row">${Object.entries(SCENARIOS).map(([k, v]) => this.BTN(v.name, () => this.app.loadScenario(k), { on: () => this.s.scenario === k, cls: 'sm' })).join('')}</div>
      ${this.V(() => SCENARIOS[this.s.scenario]?.desc || '', 'hint', 'p')}`)}
    ${this.sec('Malfunctions', `<div class="faults">
      ${F('bfpATrip', 'Trip BFP-A')}${F('fdTrip', 'FD fan motor trip')}${F('cwTrip', 'CW pumps trip')}
      ${F('tubeLeak', 'Water-wall tube leak', v => (v ? 0 : 4))}${F('gasLow', 'Low gas supply pressure')}${F('gridLoss', 'Grid loss (load rejection)')}
      ${F('airLeak', 'Condenser air in-leakage')}${F('ltDrift', 'Drum level transmitter LT-A drifts high', v => (v ? 0 : 90))}${F('fcvStuck', 'Feed valve sticks')}
      ${F('scannerFail', 'Flame scanner fails')}${F('svSeized', 'Drum safety valves seized')}${F('otsFail', 'Overspeed trip fails')}
      </div><p class="hint">Some of these are deliberately dangerous. Combined, they can destroy the plant.</p>`)}
    ${this.sec('Grid & environment', `
      <label class="sl">Cooling water temperature <input type="range" min="4" max="34" step="1" value="20" data-in="tcw" aria-label="Cooling water temperature">${this.V(() => f(this.s.env.Tcw, 0) + ' °C', 'num')}</label>
      <label class="sl">Grid frequency offset <input type="range" min="-0.3" max="0.3" step="0.01" value="0" data-in="fdev" aria-label="Grid frequency offset">${this.V(() => f(this.s.env.fDev || 0, 2) + ' Hz', 'num')}</label>`)}
    ${this.sec('Bypasses & interlocks', `
      <div class="row">${this.BTN('BMS jumpers (bypass flame proving)', () => { this.s.bypass.bms = !this.s.bypass.bms; this.s.note(`BMS bypass ${this.s.bypass.bms ? 'INSTALLED' : 'removed'}`, 'warn'); }, { on: () => this.s.bypass.bms, cls: 'sm wide danger' })}</div>
      <div class="row">${this.BTN('Sync-check relay bypass', () => { this.s.bypass.syncCheck = !this.s.bypass.syncCheck; }, { on: () => this.s.bypass.syncCheck, cls: 'sm wide danger' })}</div>
      <div class="row">${this.BTN('Boiler MFT trips the turbine', () => { this.s.interlocks.mftTripsTurbine = !this.s.interlocks.mftTripsTurbine; }, { on: () => this.s.interlocks.mftTripsTurbine, cls: 'sm wide' })}</div>
      <div class="row">${this.BTN('Turbine trip runs the boiler back', () => { this.s.interlocks.turbTripRunback = !this.s.interlocks.turbTripRunback; }, { on: () => this.s.interlocks.turbTripRunback, cls: 'sm wide' })}</div>`)}`;
  }

  // ---------------------------------------------------------------- update
  refresh(force = false) {
    const now = performance.now();
    if (!force && now - (this._lastRefresh || 0) < 120) return;
    this._lastRefresh = now;
    for (const e of this.els) {
      if (e.page !== '*' && e.page !== this.tab) continue;
      const b = this.vf[e.i];
      let v; try { v = b.fn(); } catch (err) { v = '—'; }
      if (v === e.last) continue;
      e.last = v;
      switch (b.kind) {
        case 'text': if (e.el.dataset.html !== undefined || /<\w/.test(String(v))) e.el.innerHTML = v; else e.el.textContent = v; break;
        case 'bar': e.el.style.width = cl(v * 100, 0, 100) + '%'; break;
        case 'mark': e.el.style.left = cl(v * 100, 0, 100) + '%'; break;
        case 'led': e.el.className = 'led ' + v; break;
        case 'cls': e.el.setAttribute('class', (e.el.dataset.base || (e.el.dataset.base = e.el.getAttribute('class') || '')) + ' ' + v); break;
        case 'on': e.el.classList.toggle('on', !!v); break;
      }
    }
    if (this.tab === 'turbine') this.drawSync();
    if (this.tab === 'trends') this.drawTrend();
    if (this.tab === 'proc') this.updateProc();
    // clock & speed
    document.getElementById('clock').textContent = hms(this.s.t - (this.s.t0 || 0));
  }

  drawSync() {
    const c = document.getElementById('syncscope'); if (!c) return;
    const g = c.getContext('2d'), w = c.width, r = w / 2;
    const css = getComputedStyle(document.documentElement);
    g.clearRect(0, 0, w, w);
    g.fillStyle = css.getPropertyValue('--panel-2'); g.beginPath(); g.arc(r, r, r - 2, 0, 7); g.fill();
    g.strokeStyle = css.getPropertyValue('--line'); g.lineWidth = 2; g.stroke();
    // sync window
    g.fillStyle = 'rgba(80,200,120,0.25)'; g.beginPath(); g.moveTo(r, r); g.arc(r, r, r - 8, -Math.PI / 2 - 0.35, -Math.PI / 2 + 0.35); g.fill();
    g.fillStyle = css.getPropertyValue('--fg-dim'); g.font = '11px ' + css.getPropertyValue('--mono'); g.textAlign = 'center';
    g.fillText('SLOW', r - 52, r + 54); g.fillText('FAST', r + 52, r + 54);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.strokeStyle = css.getPropertyValue('--fg-dim'); g.beginPath(); g.moveTo(r + Math.sin(a) * (r - 8), r - Math.cos(a) * (r - 8)); g.lineTo(r + Math.sin(a) * (r - 18), r - Math.cos(a) * (r - 18)); g.stroke(); }
    const gen = this.s.gen;
    const on = gen.field && this.s.tb.rpm > 2000;
    let ph = gen.breaker ? gen.delta : (((gen.phase % 360) + 540) % 360 - 180) * Math.PI / 180;
    if (on || gen.breaker) {
      g.strokeStyle = css.getPropertyValue('--accent'); g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(r - Math.sin(ph) * 20, r + Math.cos(ph) * 20); g.lineTo(r + Math.sin(ph) * (r - 22), r - Math.cos(ph) * (r - 22)); g.stroke();
    }
    g.fillStyle = css.getPropertyValue('--fg'); g.beginPath(); g.arc(r, r, 7, 0, 7); g.fill();
    // sync lamps (dark at in-phase)
    const lampB = on && !gen.breaker ? (1 - Math.cos(ph)) / 2 : 0;
    for (const x of [26, w - 26]) { g.fillStyle = `rgba(255,210,120,${0.1 + lampB * 0.9})`; g.beginPath(); g.arc(x, 24, 9, 0, 7); g.fill(); }
  }

  drawTrend() {
    const c = document.getElementById('trend'); if (!c) return;
    const box = c.getBoundingClientRect();
    if (box.width > 0 && Math.abs(c.width - box.width * devicePixelRatio) > 4) { c.width = box.width * devicePixelRatio; c.height = box.width * 0.6 * devicePixelRatio; }
    const g = c.getContext('2d'), W = c.width, H = c.height, dpr = devicePixelRatio;
    const css = getComputedStyle(document.documentElement);
    g.clearRect(0, 0, W, H);
    const pad = { l: 8 * dpr, r: 8 * dpr, t: 8 * dpr, b: 18 * dpr };
    const data = this.s.trend, span = this.trendSpan, tEnd = this.s.t, t0 = tEnd - span;
    g.strokeStyle = css.getPropertyValue('--line'); g.lineWidth = 1;
    g.fillStyle = css.getPropertyValue('--fg-dim'); g.font = `${10 * dpr}px ` + css.getPropertyValue('--mono');
    for (let i = 0; i <= 5; i++) { const y = pad.t + (H - pad.t - pad.b) * i / 5; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); }
    for (let i = 0; i <= 5; i++) { const x = pad.l + (W - pad.l - pad.r) * i / 5; g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, H - pad.b); g.stroke(); g.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center'; g.fillText(i === 5 ? 'now' : '−' + Math.round(span * (5 - i) / 5 / 60) + ' min', x, H - 4 * dpr); }
    const set = this.trendSets[this.trendSel];
    const leg = [];
    for (const sr of set) {
      g.strokeStyle = sr.c; g.lineWidth = 2 * dpr; g.beginPath();
      let first = true, last = null;
      for (const p of data) {
        if (p.t < t0) continue;
        const x = pad.l + (p.t - t0) / span * (W - pad.l - pad.r);
        const y = pad.t + (1 - cl((p[sr.k] - sr.min) / (sr.max - sr.min), 0, 1)) * (H - pad.t - pad.b);
        if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
        last = [x, y, p[sr.k]];
      }
      g.stroke();
      if (last) { g.fillStyle = sr.c; g.beginPath(); g.arc(last[0], last[1], 3.5 * dpr, 0, 7); g.fill(); }
      leg.push(`<span><i style="background:${sr.c}"></i>${sr.n} <b>${last ? f(last[2], Math.abs(sr.max - sr.min) < 5 ? 2 : sr.max > 1000 ? 0 : 1) : '—'}</b> ${sr.u} <em>${sr.min}…${sr.max}</em></span>`);
    }
    const L = document.getElementById('trendleg'); const h = leg.join(''); if (L.innerHTML !== h) L.innerHTML = h;
  }
}
