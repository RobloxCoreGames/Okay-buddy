// Steam property functions built on the IAPWS-IF97 tables in steamtables.js.
// Pressure in MPa, temperature in degC, enthalpy kJ/kg, entropy kJ/kg/K, density kg/m3.
import { SAT, SH_P, SH_T, SH_H, SH_S, SH_RHO } from './steamtables.js';

const SAT_LNP = SAT.map(r => Math.log(r[0]));
const SH_LNP = SH_P.map(p => Math.log(p));
const LNP0 = SAT_LNP[0], LNP1 = SAT_LNP[SAT_LNP.length - 1];
const SAT_DLNP = (LNP1 - LNP0) / (SAT.length - 1);

function satRow(p) {
  const lp = Math.log(Math.min(Math.max(p, SAT[0][0]), SAT[SAT.length - 1][0]));
  let f = (lp - LNP0) / SAT_DLNP;
  let i = Math.min(Math.max(Math.floor(f), 0), SAT.length - 2);
  const t = f - i, a = SAT[i], b = SAT[i + 1];
  return [a, b, t];
}
function satCol(p, c) { const [a, b, t] = satRow(p); return a[c] + (b[c] - a[c]) * t; }

export const tsat = p => satCol(p, 1);
export const rhof = p => satCol(p, 2);
export const rhog = p => satCol(p, 3);
export const hf = p => satCol(p, 4);
export const hg = p => satCol(p, 5);
export const sf = p => satCol(p, 6);
export const sg = p => satCol(p, 7);

// All saturation properties at once (faster than calling one by one)
export function sat(p) {
  const [a, b, t] = satRow(p);
  const L = c => a[c] + (b[c] - a[c]) * t;
  return { p, T: L(1), rf: L(2), rg: L(3), hf: L(4), hg: L(5), sf: L(6), sg: L(7) };
}

// Saturation pressure from temperature (MPa), by bisection on the table.
export function psat(T) {
  if (T <= SAT[0][1]) return SAT[0][0];
  if (T >= SAT[SAT.length - 1][1]) return SAT[SAT.length - 1][0];
  let lo = 0, hi = SAT.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (SAT[m][1] > T) hi = m; else lo = m; }
  const a = SAT[lo], b = SAT[hi];
  const t = (T - a[1]) / (b[1] - a[1]);
  return Math.exp(Math.log(a[0]) + (Math.log(b[0]) - Math.log(a[0])) * t);
}

// Superheated-region bilinear lookup (log p, T). Values below Tsat clamp to saturated vapour.
function shLookup(tab, p, T) {
  const lp = Math.log(Math.min(Math.max(p, SH_P[0]), SH_P[SH_P.length - 1]));
  let i = 0; while (i < SH_LNP.length - 2 && SH_LNP[i + 1] < lp) i++;
  const tp = (lp - SH_LNP[i]) / (SH_LNP[i + 1] - SH_LNP[i]);
  const Tc = Math.min(Math.max(T, SH_T[0]), SH_T[SH_T.length - 1]);
  let j = Math.min(Math.floor((Tc - SH_T[0]) / 10), SH_T.length - 2);
  const tt = (Tc - SH_T[j]) / 10;
  const r0 = tab[i], r1 = tab[i + 1];
  const v0 = r0[j] + (r0[j + 1] - r0[j]) * tt;
  const v1 = r1[j] + (r1[j + 1] - r1[j]) * tt;
  return v0 + (v1 - v0) * tp;
}

// Enthalpy of steam at p,T. Below saturation returns h_g (callers handle wet steam separately).
export function hPT(p, T) {
  const ts = tsat(p);
  if (T <= ts) return hg(p);
  const h = shLookup(SH_H, p, T);
  // table interpolation across the saturation kink can dip below hg; never return less
  return Math.max(h, hg(p));
}
export function sPT(p, T) {
  const ts = tsat(p);
  if (T <= ts) return sg(p);
  return Math.max(shLookup(SH_S, p, T), sg(p));
}

// Density of steam at p,T (saturated vapour density when T <= Tsat)
export function rhoPT(p, T) {
  const ts = tsat(p);
  if (T <= ts) return rhog(p);
  return Math.min(shLookup(SH_RHO, p, T), rhog(p));
}

// Temperature of steam from p,h (superheated; returns Tsat if wet/saturated)
export function TPH(p, h) {
  const s = sat(p);
  if (h <= s.hg) return s.T;
  let lo = s.T, hi = 700;
  for (let k = 0; k < 30; k++) { const m = 0.5 * (lo + hi); if (hPT(p, m) > h) hi = m; else lo = m; }
  return 0.5 * (lo + hi);
}

// Entropy from p,h for either wet or superheated steam
export function sPH(p, h) {
  const s = sat(p);
  if (h <= s.hg) {
    const x = Math.max(0, (h - s.hf) / (s.hg - s.hf));
    return s.sf + x * (s.sg - s.sf);
  }
  return sPT(p, TPH(p, h));
}

// Isentropic expansion endpoint: enthalpy at pressure p with entropy s.
export function hPS(p, s) {
  const st = sat(p);
  if (s <= st.sg) {
    const x = Math.max(0, (s - st.sf) / (st.sg - st.sf));
    return { h: st.hf + x * (st.hg - st.hf), x, T: st.T };
  }
  let lo = st.T, hi = 700;
  for (let k = 0; k < 30; k++) { const m = 0.5 * (lo + hi); if (sPT(p, m) > s) hi = m; else lo = m; }
  const T = 0.5 * (lo + hi);
  return { h: hPT(p, T), x: 1, T };
}

// Compressed liquid water enthalpy ~ saturated liquid at the same temperature (good to ~1% below 20 MPa)
export function hWater(T) { return hf(psat(T)); }
export function TWater(h) {
  let lo = 1, hi = 370;
  for (let k = 0; k < 30; k++) { const m = 0.5 * (lo + hi); if (hWater(m) > h) hi = m; else lo = m; }
  return 0.5 * (lo + hi);
}
export function rhoWater(T) { return rhof(psat(T)); }

// Numerical derivatives wrt pressure (per MPa)
export function satDerivs(p) {
  const dp = Math.max(p * 0.01, 0.002);
  const a = sat(Math.max(p - dp, SAT[0][0])), b = sat(p + dp);
  const d = b.p - a.p;
  return {
    drf: (b.rf - a.rf) / d, drg: (b.rg - a.rg) / d,
    dhf: (b.hf - a.hf) / d, dhg: (b.hg - a.hg) / d,
    dT: (b.T - a.T) / d,
  };
}
