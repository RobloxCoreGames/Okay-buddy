// Three.js plant model: geometry, materials, live animation driven by the simulation.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clampS = (x, a, b) => Math.max(a, Math.min(b, x));

// ------------------------------------------------------------------ procedural textures
function canvasTex(w, h, draw, repeat = [1, 1], srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function noiseFill(g, w, h, base, amp, n = 9000, size = 2) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = (Math.random() - 0.5) * amp;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(Math.random() * w, Math.random() * h, size * Math.random() + 0.5, size * Math.random() + 0.5);
  }
}
const TEX = {};
function makeTextures() {
  TEX.concrete = canvasTex(512, 512, (g, w, h) => {
    noiseFill(g, w, h, '#8f8d86', 0.16, 26000, 2.5);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(40,35,30,${Math.random() * 0.06})`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 60, 10 + Math.random() * 40, Math.random() * 3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(30,30,30,0.35)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
  }, [60, 60]);
  TEX.slab = canvasTex(256, 256, (g, w, h) => { noiseFill(g, w, h, '#a3a199', 0.12, 9000, 2); g.strokeStyle = 'rgba(40,40,40,.4)'; g.strokeRect(0, 0, w, h); }, [1, 1]);
  TEX.gravel = canvasTex(512, 512, (g, w, h) => noiseFill(g, w, h, '#6d6a62', 0.35, 60000, 3), [90, 90]);
  TEX.grass = canvasTex(512, 512, (g, w, h) => { noiseFill(g, w, h, '#4d5a37', 0.25, 50000, 3); }, [60, 60]);
  TEX.cladding = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c4c8cb'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 64) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, y + 2, w, 1); }
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(80,70,60,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  }, [1, 1]);
  TEX.ribbed = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#7d8890'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { const gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, 'rgba(255,255,255,.12)'); gr.addColorStop(.5, 'rgba(0,0,0,.15)'); gr.addColorStop(1, 'rgba(255,255,255,.12)'); g.fillStyle = gr; g.fillRect(x, 0, 16, h); }
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(90,60,40,${Math.random() * 0.08})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 6); }
  }, [6, 3]);
  TEX.grating = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = '#9aa0a3';
    for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 2, h);
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 2);
  }, [4, 4]);
  TEX.window = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#29343c'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) for (let y = 0; y < h; y += 42) { g.fillStyle = '#5e7684'; g.fillRect(x + 3, y + 3, 26, 36); }
  }, [1, 1]);
  TEX.windowLit = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#1e2224'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) for (let y = 0; y < h; y += 42) { g.fillStyle = Math.random() < 0.8 ? '#ffe2a8' : '#6b5e44'; g.fillRect(x + 3, y + 3, 26, 36); }
  }, [1, 1]);
  TEX.hazard = canvasTex(128, 32, (g, w, h) => { g.fillStyle = '#e1b12c'; g.fillRect(0, 0, w, h); g.fillStyle = '#1b1b1b'; for (let x = -32; x < w; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.fill(); } }, [4, 1]);
  TEX.marker = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#4a5054'; g.fillRect(0, 0, w, h); g.fillStyle = '#e8e2d0'; g.fillRect(0, 0, 32, h); g.fillStyle = '#c0392b'; g.fillRect(128, 0, 16, h); }, [1, 1]);
  TEX.sprite = canvasTex(128, 128, (g, w, h) => {
    const id = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2);
      const r = Math.sqrt(dx * dx + dy * dy);
      let a = Math.max(0, 1 - r); a = a * a * (3 - 2 * a);
      const n = 0.75 + 0.25 * Math.sin(x * 0.31 + Math.sin(y * 0.23) * 3) * Math.cos(y * 0.27 + Math.sin(x * 0.19) * 2);
      const i = (y * w + x) * 4; id.data[i] = id.data[i + 1] = id.data[i + 2] = 255; id.data[i + 3] = a * n * 255;
    }
    g.putImageData(id, 0, 0);
  }, [1, 1], false);
}

// ------------------------------------------------------------------ fire shader
const NOISE_GLSL = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;
vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
i=mod289(i);vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
float fbm(vec3 p){float f=0.0;float a=0.5;for(int i=0;i<4;i++){f+=a*snoise(p);p*=2.03;a*=0.5;}return f;}
`;
function fireMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uLambda: { value: 1.15 }, uSeed: { value: Math.random() * 10 } },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){ vUv=uv; vP=position; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: NOISE_GLSL + `
      uniform float uTime; uniform float uPower; uniform float uLambda; uniform float uSeed;
      varying vec3 vP; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){
        float h = vUv.y;
        float n = fbm(vec3(vP.x*1.3, vP.y*0.9 - uTime*3.2, vP.z*1.3 + uSeed));
        float n2 = fbm(vec3(vP.x*2.7+3.0, vP.y*2.0 - uTime*5.5, vP.z*2.7));
        float rim = pow(abs(dot(vN, vV)), 1.6);
        float body = smoothstep(1.0, 0.15, h + n*0.35) * rim;
        float a = clamp(body * (0.65 + n2*0.6), 0.0, 1.0) * uPower;
        float lean = clamp((uLambda-1.2)/1.5, 0.0, 1.0);
        float rich = clamp((1.05-uLambda)/0.35, 0.0, 1.0);
        vec3 root = mix(vec3(0.25,0.45,1.2), vec3(0.35,0.55,1.4), lean);
        vec3 mid = mix(vec3(2.6,1.25,0.35), vec3(1.4,1.0,1.1), lean*0.6);
        mid = mix(mid, vec3(1.6,0.45,0.08), rich);
        vec3 tip = mix(vec3(1.4,0.35,0.06), vec3(0.15,0.05,0.02), rich);
        vec3 col = mix(root, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, tip, smoothstep(0.45, 1.0, h + n*0.2));
        gl_FragColor = vec4(col * (1.2 + n2), a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------------ particles (steam, smoke, sparks)
class Particles {
  constructor(scene, max = 6000) {
    this.max = max; this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4); this.size = new Float32Array(max); this.age = new Float32Array(max); this.life = new Float32Array(max);
    this.grow = new Float32Array(max); this.a0 = new Float32Array(max); this.drag = new Float32Array(max); this.buoy = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: TEX.sprite }, scale: { value: 600 }, light: { value: 1 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*scale/max(0.5,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; uniform float light; varying vec4 vC; void main(){ vec4 t=texture2D(map, gl_PointCoord); if(t.a*vC.a<0.004) discard; gl_FragColor=vec4(vC.rgb*light, t.a*vC.a); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }
  emit(p, v, o) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const s = o.spread || 0;
    this.pos[i * 3] = p.x + (Math.random() - 0.5) * (o.jitter || 0); this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * (o.jitter || 0);
    this.vel[i * 3] = v.x + (Math.random() - 0.5) * s; this.vel[i * 3 + 1] = v.y + (Math.random() - 0.5) * s; this.vel[i * 3 + 2] = v.z + (Math.random() - 0.5) * s;
    const c = o.color;
    this.col[i * 4] = c[0]; this.col[i * 4 + 1] = c[1]; this.col[i * 4 + 2] = c[2]; this.col[i * 4 + 3] = 0;
    this.a0[i] = o.alpha ?? 0.5; this.size[i] = o.size ?? 1; this.grow[i] = o.grow ?? 1; this.age[i] = 0; this.life[i] = o.life ?? 3;
    this.drag[i] = o.drag ?? 0.6; this.buoy[i] = o.buoy ?? 0.5;
  }
  update(dt, wind) {
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) continue;
      // compact
      if (j !== i) {
        for (let k = 0; k < 3; k++) { this.pos[j * 3 + k] = this.pos[i * 3 + k]; this.vel[j * 3 + k] = this.vel[i * 3 + k]; }
        for (let k = 0; k < 4; k++) this.col[j * 4 + k] = this.col[i * 4 + k];
        this.size[j] = this.size[i]; this.life[j] = this.life[i]; this.grow[j] = this.grow[i]; this.a0[j] = this.a0[i]; this.drag[j] = this.drag[i]; this.buoy[j] = this.buoy[i];
      }
      this.age[j] = age;
      const d = Math.exp(-this.drag[j] * dt);
      this.vel[j * 3] = this.vel[j * 3] * d + wind.x * (1 - d);
      this.vel[j * 3 + 1] = this.vel[j * 3 + 1] * d + this.buoy[j] * dt;
      this.vel[j * 3 + 2] = this.vel[j * 3 + 2] * d + wind.z * (1 - d);
      this.pos[j * 3] += this.vel[j * 3] * dt; this.pos[j * 3 + 1] += this.vel[j * 3 + 1] * dt; this.pos[j * 3 + 2] += this.vel[j * 3 + 2] * dt;
      this.size[j] += this.grow[j] * dt;
      const t = age / this.life[j];
      this.col[j * 4 + 3] = this.a0[j] * Math.min(1, t * 8) * (1 - t) * (1 - t);
      j++;
    }
    this.n = j;
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ gauge dial
function dialTexture(label, min, max, unit, majors, redFrom) {
  return canvasTex(256, 256, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#1d1d1d'; g.beginPath(); g.arc(c, c, c, 0, 7); g.fill();
    g.fillStyle = '#f2efe6'; g.beginPath(); g.arc(c, c, c - 12, 0, 7); g.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    if (redFrom != null) {
      g.strokeStyle = '#c0392b'; g.lineWidth = 10; g.beginPath();
      g.arc(c, c, c - 30, a0 + (redFrom - min) / (max - min) * (a1 - a0), a1); g.stroke();
    }
    g.strokeStyle = '#111'; g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = majors * 5;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n, maj = i % 5 === 0;
      g.lineWidth = maj ? 3 : 1.4;
      const r1 = c - 22, r2 = r1 - (maj ? 16 : 8);
      g.beginPath(); g.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2); g.stroke();
      if (maj) {
        const v = min + (max - min) * i / n;
        g.font = 'bold 19px sans-serif';
        g.fillText(Math.abs(v) >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1), c + Math.cos(a) * (r2 - 18), c + Math.sin(a) * (r2 - 18));
      }
    }
    g.font = 'bold 18px sans-serif'; g.fillText(unit, c, c + 46);
    g.font = '15px sans-serif'; g.fillStyle = '#444'; g.fillText(label, c, c + 70);
  });
}

// ------------------------------------------------------------------ PlantScene
export class PlantScene {
  constructor(canvas, labelRoot) {
    makeTextures();
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.9;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xaab6c0, 0.0008);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);
    this.camera.position.set(38, 30, 62);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(-2, 8, 0);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495; this.controls.minDistance = 2; this.controls.maxDistance = 260;
    this.labels = new CSS2DRenderer({ element: labelRoot });
    this.pick = [];
    this.anim = {};
    this.emitters = [];
    this.gauges = [];
    this.lamps = [];
    this.night = false;
    this.xray = false;
    this.time = 0;
    this.shake = 0;
    this.wind = V3(1.8, 0, -0.6);
    this.M = this.makeMaterials();
    this.buildEnvironment();
    this.buildBoiler();
    this.buildStack();
    this.buildFeedTrain();
    this.buildDeaerator();
    this.buildTurbineHall();
    this.buildTurbine();
    this.buildCondenser();
    this.buildCoolingTower();
    this.buildSwitchyard();
    this.buildControlRoom();
    this.buildPiping();
    this.particles = new Particles(this.scene, 7000);
    this.composer = null;
    this.setupPost();
    this.resize();
    this.setNight(false);
  }

  makeMaterials() {
    const S = (c, r = 0.6, m = 0.2, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...o });
    return {
      lag: S(0xc9ccd0, 0.38, 0.75, { map: TEX.cladding }),
      lagPlain: S(0xbfc3c6, 0.42, 0.7),
      casing: S(0xa3adb4, 0.7, 0.25, { map: TEX.ribbed }),
      casingX: S(0xa3adb4, 0.7, 0.25, { map: TEX.ribbed }),
      steelBlue: S(0x2f5f8a, 0.55, 0.35),
      steelGrey: S(0x55606a, 0.6, 0.4),
      yellow: S(0xe0b028, 0.5, 0.2),
      red: S(0xb52a22, 0.45, 0.2),
      green: S(0x3d6b4a, 0.55, 0.2),
      cw: S(0x35588a, 0.5, 0.25),
      cond: S(0x5d8a59, 0.55, 0.2),
      gas: S(0xd6aa22, 0.45, 0.3),
      oil: S(0x6e4b2a, 0.55, 0.2),
      pump: S(0x2b5d94, 0.45, 0.3),
      motor: S(0x41604f, 0.55, 0.35),
      turb: S(0x7f8a83, 0.45, 0.45),
      turbDark: S(0x5a6560, 0.5, 0.45),
      gen: S(0x3b4c5e, 0.45, 0.4),
      concrete: S(0xffffff, 0.92, 0.0, { map: TEX.slab }),
      ground: S(0xffffff, 0.95, 0.0, { map: TEX.concrete }),
      gravel: S(0xffffff, 1, 0, { map: TEX.gravel }),
      grass: S(0xffffff, 1, 0, { map: TEX.grass }),
      grating: S(0x9aa0a3, 0.6, 0.6, { map: TEX.grating, alphaMap: TEX.grating, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide }),
      roof: S(0x8a9095, 0.6, 0.5, { map: TEX.cladding, side: THREE.DoubleSide }),
      wall: S(0xb7bcbf, 0.6, 0.45, { map: TEX.cladding, side: THREE.DoubleSide }),
      window: S(0xffffff, 0.2, 0.3, { map: TEX.window, emissiveMap: TEX.windowLit, emissive: 0x000000 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0xdfe8ee, roughness: 0.05, metalness: 0, transmission: 0.9, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
      water: new THREE.MeshStandardMaterial({ color: 0x3d8fd1, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.85, emissive: 0x0b3354 }),
      chrome: S(0xdddddd, 0.15, 1.0),
      black: S(0x1a1a1a, 0.6, 0.2),
      hazard: S(0xffffff, 0.6, 0.1, { map: TEX.hazard }),
      marker: S(0xffffff, 0.4, 0.6, { map: TEX.marker }),
      refractory: S(0x8a4b32, 0.9, 0.0),
      tube: S(0x494d50, 0.5, 0.6),
      shTube: S(0x5a5048, 0.5, 0.6, { emissive: 0x000000 }),
      transformer: S(0x6f7a6b, 0.55, 0.35),
      porcelain: S(0x7a5236, 0.3, 0.05),
      lampOff: S(0x3a3a3a, 0.4, 0.1, { emissive: 0x000000 }),
    };
  }

  // -------------------------------------------------------------- helpers
  mesh(geo, mat, x = 0, y = 0, z = 0, parent = this.scene, cast = true) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true;
    parent.add(m); return m;
  }
  box(w, h, d, mat, x, y, z, parent) { return this.mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent); }
  cylX(r, len, mat, x, y, z, parent, seg = 32) { const m = this.mesh(new THREE.CylinderGeometry(r, r, len, seg), mat, x, y, z, parent); m.rotation.z = Math.PI / 2; return m; }
  cylY(r, len, mat, x, y, z, parent, seg = 28) { return this.mesh(new THREE.CylinderGeometry(r, r, len, seg), mat, x, y, z, parent); }
  cylZ(r, len, mat, x, y, z, parent, seg = 28) { const m = this.mesh(new THREE.CylinderGeometry(r, r, len, seg), mat, x, y, z, parent); m.rotation.x = Math.PI / 2; return m; }
  addPick(obj, id, name) { obj.traverse(o => { o.userData.pickId = id; }); obj.userData.pickId = id; this.pick.push(obj); obj.userData.pickName = name; }
  label(text, x, y, z) {
    const el = document.createElement('div'); el.className = 'tag'; el.textContent = text;
    const o = new CSS2DObject(el); o.position.set(x, y, z); this.scene.add(o); (this.tags ||= []).push(o); return o;
  }

  // pipe through points with smooth elbows; returns merged mesh
  pipe(points, r, mat, bend = null, parent = this.scene) {
    bend = bend ?? Math.max(r * 2.5, 0.3);
    const geos = [];
    const pts = points.map(p => (p.isVector3 ? p : V3(...p)));
    let start = pts[0].clone();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dir = b.clone().sub(a).normalize();
      let end = b.clone();
      const hasNext = i < pts.length - 1;
      let nextDir;
      if (hasNext) {
        nextDir = pts[i + 1].clone().sub(b).normalize();
        const segLen = Math.min(b.distanceTo(a), pts[i + 1].distanceTo(b));
        const bb = Math.min(bend, segLen * 0.45);
        end = b.clone().addScaledVector(dir, -bb);
        const len = start.distanceTo(end);
        if (len > 0.01) geos.push(this.straight(start, end, r));
        const nStart = b.clone().addScaledVector(nextDir, bb);
        const curve = new THREE.QuadraticBezierCurve3(end, b.clone(), nStart);
        geos.push(new THREE.TubeGeometry(curve, 10, r, 20, false));
        start = nStart;
      } else {
        if (start.distanceTo(end) > 0.01) geos.push(this.straight(start, end, r));
      }
    }
    const g = mergeGeometries(geos.map(x => x.index ? x.toNonIndexed() : x).map(x => { x.deleteAttribute('uv'); return x; }), false);
    return this.mesh(g, mat, 0, 0, 0, parent);
  }
  straight(a, b, r) {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 20, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V3(1, 1, 1));
    g.applyMatrix4(m);
    return g;
  }
  flange(p, axis, r, mat = this.M.steelGrey) {
    const g = new THREE.CylinderGeometry(r * 1.6, r * 1.6, r * 0.5, 20);
    const m = this.mesh(g, mat, p[0], p[1], p[2]);
    m.quaternion.setFromUnitVectors(V3(0, 1, 0), V3(...axis).normalize());
    return m;
  }
  handwheel(r, mat = this.M.red) {
    const g = new THREE.Group();
    this.mesh(new THREE.TorusGeometry(r, r * 0.09, 8, 28), mat, 0, 0, 0, g);
    for (let k = 0; k < 3; k++) { const s = this.mesh(new THREE.CylinderGeometry(r * 0.05, r * 0.05, r * 2, 6), mat, 0, 0, 0, g); s.rotation.z = k * Math.PI / 3; }
    this.mesh(new THREE.CylinderGeometry(r * 0.15, r * 0.15, r * 0.3, 10), this.M.steelGrey, 0, 0, 0, g).rotation.x = Math.PI / 2;
    return g;
  }
  // gate/globe valve with handwheel (manual) or actuator; axis is pipe direction, stem goes +Y
  valve(x, y, z, size, opts = {}) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    if (opts.rotY) g.rotation.y = opts.rotY;
    const body = this.mesh(new THREE.SphereGeometry(size * 0.7, 20, 14), opts.bodyMat || this.M.steelGrey, 0, 0, 0, g);
    body.scale.set(1.3, 1, 1);
    this.mesh(new THREE.CylinderGeometry(size * 0.85, size * 0.85, size * 0.25, 18), this.M.steelGrey, -size * 0.85, 0, 0, g).rotation.z = Math.PI / 2;
    this.mesh(new THREE.CylinderGeometry(size * 0.85, size * 0.85, size * 0.25, 18), this.M.steelGrey, size * 0.85, 0, 0, g).rotation.z = Math.PI / 2;
    this.mesh(new THREE.CylinderGeometry(size * 0.35, size * 0.5, size * 1.0, 14), opts.bodyMat || this.M.steelGrey, 0, size * 0.9, 0, g);
    const stem = this.mesh(new THREE.CylinderGeometry(size * 0.07, size * 0.07, size * 1.6, 8), this.M.chrome, 0, size * 1.9, 0, g);
    const yoke = this.mesh(new THREE.BoxGeometry(size * 0.9, size * 0.12, size * 0.25), this.M.steelGrey, 0, size * 2.2, 0, g);
    let wheel = null, act = null;
    if (opts.actuator) {
      act = new THREE.Group(); g.add(act); act.position.y = size * 2.6;
      this.mesh(new THREE.SphereGeometry(size * 0.75, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), opts.actMat || this.M.yellow, 0, 0.0, 0, act).scale.y = 0.5;
      this.mesh(new THREE.CylinderGeometry(size * 0.75, size * 0.75, size * 0.12, 20), this.M.steelGrey, 0, 0, 0, act);
      this.mesh(new THREE.SphereGeometry(size * 0.75, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), opts.actMat || this.M.yellow, 0, 0, 0, act).scale.y = 0.5;
      // position indicator pointer
      const ind = this.mesh(new THREE.BoxGeometry(size * 0.04, size * 0.04, size * 0.3), this.M.red, size * 0.1, -size * 0.35, size * 0.2, g);
      g.userData.indicator = ind;
    } else {
      wheel = this.handwheel(size * 0.7, opts.wheelMat || this.M.red);
      wheel.rotation.x = Math.PI / 2; wheel.position.y = size * 2.75; g.add(wheel);
    }
    yoke.visible = !opts.actuator;
    (opts.parent || this.scene).add(g);
    return { g, stem, wheel, size, y0: size * 1.9, act };
  }
  pumpSet(x, y, z, rotY, scale, name, id) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; this.scene.add(g);
    const s = scale;
    this.box(4.6 * s, 0.25 * s, 1.4 * s, this.M.steelGrey, 0, 0.12 * s, 0, g);
    // pump casing
    const casing = this.mesh(new THREE.CylinderGeometry(0.62 * s, 0.62 * s, 1.5 * s, 26), this.M.pump, -1.25 * s, 0.95 * s, 0, g); casing.rotation.z = Math.PI / 2;
    for (let i = 0; i < 6; i++) { const r = this.mesh(new THREE.TorusGeometry(0.62 * s, 0.05 * s, 6, 26), this.M.pump, -1.9 * s + i * 0.26 * s, 0.95 * s, 0, g); r.rotation.y = Math.PI / 2; }
    this.box(0.3 * s, 0.7 * s, 0.6 * s, this.M.pump, -1.25 * s, 0.4 * s, 0, g);
    // coupling (rotates)
    const coup = new THREE.Group(); coup.position.set(0, 0.95 * s, 0); g.add(coup);
    const c1 = this.mesh(new THREE.CylinderGeometry(0.28 * s, 0.28 * s, 0.5 * s, 16), this.M.marker, 0, 0, 0, coup); c1.rotation.z = Math.PI / 2;
    // coupling guard (mesh cage)
    const guard = this.mesh(new THREE.CylinderGeometry(0.42 * s, 0.42 * s, 0.75 * s, 16, 1, true, 0, Math.PI), this.M.yellow, 0, 0.95 * s, 0, g); guard.rotation.z = Math.PI / 2;
    // motor
    const motor = this.mesh(new THREE.CylinderGeometry(0.7 * s, 0.7 * s, 1.9 * s, 30), this.M.motor, 1.35 * s, 1.0 * s, 0, g); motor.rotation.z = Math.PI / 2;
    for (let i = 0; i < 14; i++) { const f = this.mesh(new THREE.BoxGeometry(1.7 * s, 0.08 * s, 0.05 * s), this.M.motor, 1.35 * s, 1.0 * s, 0, g); f.rotation.x = i / 14 * Math.PI * 2; f.position.y += Math.cos(i / 14 * Math.PI * 2) * 0.72 * s; f.position.z += Math.sin(i / 14 * Math.PI * 2) * 0.72 * s; }
    this.box(0.5 * s, 0.4 * s, 0.4 * s, this.M.motor, 1.35 * s, 1.85 * s, 0, g);
    // fan cowl
    this.mesh(new THREE.CylinderGeometry(0.66 * s, 0.66 * s, 0.3 * s, 26), this.M.steelGrey, 2.45 * s, 1.0 * s, 0, g).rotation.z = Math.PI / 2;
    // status lamp
    const lamp = this.mesh(new THREE.SphereGeometry(0.09 * s, 10, 8), this.M.lampOff.clone(), 1.35 * s, 2.12 * s, 0, g);
    this.lamps.push(lamp);
    this.addPick(g, id, name);
    return { g, coup, lamp };
  }
  gauge(label, min, max, unit, x, y, z, rotY = 0, size = 0.32, majors = 5, redFrom = null) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; this.scene.add(g);
    this.mesh(new THREE.CylinderGeometry(size * 1.08, size * 1.08, size * 0.35, 28), this.M.black, 0, 0, -size * 0.1, g).rotation.x = Math.PI / 2;
    const face = this.mesh(new THREE.CircleGeometry(size, 40), new THREE.MeshStandardMaterial({ map: dialTexture(label, min, max, unit, majors, redFrom), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.0, emissiveMap: null }), 0, 0, size * 0.08, g, false);
    this.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8), this.M.steelGrey, 0, -size - 0.15, -size * 0.1, g);
    const needle = new THREE.Group(); needle.position.z = size * 0.12; g.add(needle);
    const nm = this.mesh(new THREE.BoxGeometry(size * 0.05, size * 0.82, size * 0.02), new THREE.MeshStandardMaterial({ color: 0xb01e14 }), 0, size * 0.36, 0, needle, false);
    this.mesh(new THREE.CircleGeometry(size * 0.07, 12), this.M.black, 0, 0, 0.012, needle, false);
    const glass = this.mesh(new THREE.CircleGeometry(size, 28), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.12 }), 0, 0, size * 0.15, g, false);
    const obj = { g, needle, min, max, v: min, face, set(v) { this.v += (v - this.v) * 0.2; const f = clampS((this.v - min) / (max - min), -0.03, 1.04); needle.rotation.z = -(Math.PI * 0.75 + f * Math.PI * 1.5) + Math.PI / 2 + Math.PI; } };
    obj.set(min);
    this.gauges.push(obj);
    return obj;
  }
  platform(x, y, z, w, d, rails = true) {
    const mat = this.M.grating.clone(); mat.map = TEX.grating.clone(); mat.map.repeat.set(w / 1.2, d / 1.2); mat.alphaMap = mat.map; mat.map.needsUpdate = true;
    const p = this.mesh(new THREE.PlaneGeometry(w, d), mat, x, y, z); p.rotation.x = -Math.PI / 2;
    this.box(w, 0.18, 0.1, this.M.yellow, x, y - 0.09, z + d / 2);
    this.box(w, 0.18, 0.1, this.M.yellow, x, y - 0.09, z - d / 2);
    this.box(0.1, 0.18, d, this.M.yellow, x + w / 2, y - 0.09, z);
    this.box(0.1, 0.18, d, this.M.yellow, x - w / 2, y - 0.09, z);
    if (rails) this.railing([[x - w / 2, y, z + d / 2], [x + w / 2, y, z + d / 2], [x + w / 2, y, z - d / 2], [x - w / 2, y, z - d / 2], [x - w / 2, y, z + d / 2]]);
    return p;
  }
  railing(pts) {
    for (let i = 1; i < pts.length; i++) {
      const a = V3(...pts[i - 1]), b = V3(...pts[i]);
      const top = [a.clone().setY(a.y + 1.05), b.clone().setY(b.y + 1.05)];
      const mid = [a.clone().setY(a.y + 0.55), b.clone().setY(b.y + 0.55)];
      this.scene.add(new THREE.Mesh(this.straight(top[0], top[1], 0.025), this.M.yellow));
      this.scene.add(new THREE.Mesh(this.straight(mid[0], mid[1], 0.02), this.M.yellow));
      const n = Math.max(1, Math.round(a.distanceTo(b) / 1.8));
      for (let k = 0; k <= n; k++) { const p = a.clone().lerp(b, k / n); this.scene.add(new THREE.Mesh(this.straight(p, p.clone().setY(p.y + 1.05), 0.025), this.M.yellow)); }
    }
  }
  column(x, z, h, mat = this.M.steelBlue, s = 0.35) {
    // wide-flange column approximated by an I-section
    const g = new THREE.Group(); g.position.set(x, h / 2, z); this.scene.add(g);
    this.box(s, h, 0.04, mat, 0, 0, s / 2 - 0.02, g); this.box(s, h, 0.04, mat, 0, 0, -s / 2 + 0.02, g); this.box(0.03, h, s, mat, 0, 0, 0, g);
    return g;
  }
  beam(a, b, mat = this.M.steelBlue, s = 0.3) {
    const A = V3(...a), B = V3(...b), len = A.distanceTo(B);
    const m = this.mesh(new THREE.BoxGeometry(s * 0.6, s, len), mat, 0, 0, 0);
    m.position.copy(A.clone().add(B).multiplyScalar(0.5)); m.lookAt(B);
    return m;
  }
  stairs(x, y0, z, y1, len, rotY = 0) {
    const g = new THREE.Group(); g.position.set(x, y0, z); g.rotation.y = rotY; this.scene.add(g);
    const h = y1 - y0, n = Math.round(h / 0.2);
    for (let i = 0; i < n; i++) this.box(1.1, 0.04, 0.28, this.M.grating, 0, i * h / n, -i * len / n, g);
    const ang = Math.atan2(h, len), L = Math.hypot(h, len);
    for (const sx of [-0.58, 0.58]) { const s = this.box(0.06, 0.25, L, this.M.yellow, sx, h / 2, -len / 2, g); s.rotation.x = ang; const r = this.box(0.04, 0.04, L, this.M.yellow, sx, h / 2 + 1, -len / 2, g); r.rotation.x = ang; }
  }

  // -------------------------------------------------------------- environment & lights
  buildEnvironment() {
    const sc = this.scene;
    this.sky = new Sky(); this.sky.scale.setScalar(4000); sc.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3; u.rayleigh.value = 2.2; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    this.sunDir = V3(0, 1, 0);
    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x5c564c, 1.0); sc.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dd, 3.2);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
    const c = sun.shadow.camera; c.left = -80; c.right = 80; c.top = 80; c.bottom = -80; c.near = 1; c.far = 400;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    sc.add(sun); sc.add(sun.target);
    // ground
    const ground = this.mesh(new THREE.PlaneGeometry(240, 240), this.M.ground, 0, 0, 0, sc, false); ground.rotation.x = -Math.PI / 2;
    const gravel = this.mesh(new THREE.PlaneGeometry(700, 700), this.M.gravel, 0, -0.02, 0, sc, false); gravel.rotation.x = -Math.PI / 2;
    const grass = this.mesh(new THREE.PlaneGeometry(3000, 3000), this.M.grass, 0, -0.05, 0, sc, false); grass.rotation.x = -Math.PI / 2;
    // painted walkway lines
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xd8b13a });
    for (const [x, z, w, d] of [[0, 13, 70, 0.15], [0, 16, 70, 0.15], [-36, 0, 0.15, 40], [33, 0, 0.15, 40]]) { const l = this.mesh(new THREE.PlaneGeometry(w, d), lineMat, x, 0.01, z, sc, false); l.rotation.x = -Math.PI / 2; }
    // distant hills / tree line silhouettes
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x3e4a38, roughness: 1 });
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * Math.PI * 2, R = 520 + Math.random() * 120;
      const h = this.mesh(new THREE.SphereGeometry(80 + Math.random() * 90, 16, 8), hillMat, Math.cos(a) * R, -50, Math.sin(a) * R, sc, false);
      h.scale.y = 0.45 + Math.random() * 0.3;
    }
    // site fence
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8b9196, roughness: 0.5, metalness: 0.7, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    for (const [x, z, w, r] of [[0, 70, 160, 0], [0, -70, 160, 0], [80, 0, 140, Math.PI / 2], [-80, 0, 140, Math.PI / 2]]) {
      const f = this.mesh(new THREE.PlaneGeometry(w, 2.4), fenceMat, x, 1.2, z, sc, false); f.rotation.y = r;
    }
    // yard light poles
    this.yardLights = [];
    for (const [x, z] of [[-40, 20], [0, 22], [40, 22], [-45, -25], [55, -10], [60, 30]]) {
      this.cylY(0.12, 12, this.M.steelGrey, x, 6, z);
      const head = this.box(1.2, 0.25, 0.5, this.M.steelGrey, x, 12, z);
      const lens = this.mesh(new THREE.PlaneGeometry(1.0, 0.35), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc06a, emissiveIntensity: 0 }), x, 11.86, z, sc, false);
      lens.rotation.x = Math.PI / 2;
      const L = new THREE.SpotLight(0xffc27a, 0, 45, 0.9, 0.6, 1.2); L.position.set(x, 11.8, z); L.target.position.set(x, 0, z); sc.add(L); sc.add(L.target);
      this.yardLights.push({ lens, L });
    }
  }

  // -------------------------------------------------------------- boiler
  buildBoiler() {
    const M = this.M, sc = this.scene;
    const B = this.boiler = new THREE.Group(); sc.add(B);
    const cx = -24;
    // foundation
    this.box(14, 0.6, 26, M.concrete, cx, 0.3, -6);
    // furnace casing (front section)
    const fur = this.box(10, 22, 9, M.casingX, cx, 11.6, 0, B);
    fur.material = M.casingX; this.furnaceCasing = fur;
    M.casingX.map.repeat.set(4, 6);
    // backpass
    const bp = this.box(8.5, 17, 7, M.casingX, cx, 13.6, -8.5, B); this.backpass = bp;
    // roof penthouse
    this.box(11, 2.2, 17.5, M.casing, cx, 23.7, -4.2, B);
    // buckstays (horizontal stiffeners)
    for (let y = 2.5; y < 22; y += 2.6) {
      this.box(10.5, 0.35, 0.3, M.steelGrey, cx, y, 4.65, B);
      this.box(10.5, 0.35, 0.3, M.steelGrey, cx, y, -4.65, B);
      this.box(0.3, 0.35, 9.3, M.steelGrey, cx + 5.15, y, 0, B);
      this.box(0.3, 0.35, 9.3, M.steelGrey, cx - 5.15, y, 0, B);
    }
    // hopper bottom
    const hop = this.mesh(new THREE.CylinderGeometry(4.4, 2.0, 1.6, 4), M.casing, cx, 0.9, 0, B); hop.rotation.y = Math.PI / 4; hop.scale.set(1.12, 1, 1);
    // support steel
    for (const [x, z] of [[cx - 6.5, 5.5], [cx + 6.5, 5.5], [cx - 6.5, -5.5], [cx + 6.5, -5.5], [cx - 6.5, -12.5], [cx + 6.5, -12.5]]) this.column(x, z, 26.5, M.steelBlue, 0.45);
    for (const y of [4.2, 12.4, 21.0]) {
      this.beam([cx - 6.5, y, 5.5], [cx + 6.5, y, 5.5]); this.beam([cx - 6.5, y, -12.5], [cx + 6.5, y, -12.5]);
      this.beam([cx - 6.5, y, 5.5], [cx - 6.5, y, -12.5]); this.beam([cx + 6.5, y, 5.5], [cx + 6.5, y, -12.5]);
    }
    // platforms around boiler front at burner and drum level
    this.platform(cx, 4.2, 6.6, 13, 2.2);
    this.platform(cx + 6.6, 12.4, -3.5, 2.2, 18);
    this.platform(cx, 25.0, 3.0, 12.5, 2.6);
    this.platform(cx + 5.9, 25.0, -4.2, 2.0, 12);
    this.stairs(cx + 5.5, 0, 9.6, 4.2, 2.8);
    this.stairs(cx + 8.3, 4.2, 6.0, 12.4, 6.0, 0);

    // ---- internals for X-ray view
    const inner = this.boilerInner = new THREE.Group(); B.add(inner);
    // refractory floor
    this.box(9.6, 0.2, 8.6, M.refractory, cx, 1.0, 0, inner);
    // water wall tubes (instanced) lining the furnace
    const tubeGeo = new THREE.CylinderGeometry(0.07, 0.07, 20.5, 6);
    const N = 4 * 56;
    const ww = this.waterwall = new THREE.InstancedMesh(tubeGeo, M.tube.clone(), N);
    let k = 0; const m4 = new THREE.Matrix4();
    for (let i = 0; i < 56; i++) {
      const f = -4.7 + i * 0.17;
      m4.makeTranslation(cx + f, 11.6, 4.3); ww.setMatrixAt(k++, m4);
      m4.makeTranslation(cx + f, 11.6, -4.3); ww.setMatrixAt(k++, m4);
      m4.makeTranslation(cx + 4.8, 11.6, f * 0.86); ww.setMatrixAt(k++, m4);
      m4.makeTranslation(cx - 4.8, 11.6, f * 0.86); ww.setMatrixAt(k++, m4);
    }
    inner.add(ww);
    // superheater pendants (hang from roof at furnace exit)
    const shGeo = new THREE.TorusGeometry(0.35, 0.06, 6, 12, Math.PI);
    const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 7, 6);
    const shm = this.shTubeMat = M.shTube;
    this.shPend = new THREE.Group(); inner.add(this.shPend);
    for (let i = 0; i < 14; i++) {
      const x = cx - 4.2 + i * 0.65;
      for (let j = 0; j < 3; j++) {
        const z = -3.5 + j * 0.9;
        this.mesh(legGeo, shm, x, 18.3, z - 0.35, this.shPend, false); this.mesh(legGeo, shm, x, 18.3, z + 0.35, this.shPend, false);
        const u = this.mesh(shGeo, shm, x, 14.8, z, this.shPend, false); u.rotation.y = Math.PI / 2; u.rotation.x = Math.PI;
      }
    }
    // economizer bank in backpass
    const ecGeo = new THREE.CylinderGeometry(0.05, 0.05, 7.6, 6);
    for (let r = 0; r < 12; r++) for (let c = 0; c < 10; c++) { const m = this.mesh(ecGeo, M.tube, cx, 7 + r * 0.32, -11.2 + c * 0.6, inner, false); m.rotation.z = Math.PI / 2; }
    // boiler bank tubes
    for (let r = 0; r < 18; r++) for (let c = 0; c < 6; c++) this.mesh(new THREE.CylinderGeometry(0.06, 0.06, 8, 6), M.tube, cx - 3.6 + r * 0.42, 17, -10.6 + c * 0.8, inner, false);
    inner.visible = false;

    // ---- burner front
    const wb = this.box(5, 4, 1.4, M.casing, cx, 4.2, 5.2, B);
    this.mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.0, 28), M.steelGrey, cx, 4.2, 6.2, B).rotation.x = Math.PI / 2;
    // burner gun / gas spuds
    this.cylZ(0.18, 2.4, M.chrome, cx, 4.2, 7.0, B);
    // peep sights (glow)
    this.peep = [];
    for (const [px, py] of [[cx - 1.8, 4.2], [cx + 1.8, 4.2], [cx, 6.0]]) {
      this.mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.25, 16), M.steelGrey, px, py, 6.0, B).rotation.x = Math.PI / 2;
      const glow = this.mesh(new THREE.CircleGeometry(0.11, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }), px, py, 6.14, B, false);
      this.peep.push(glow);
    }
    // more peep sights up the furnace side wall
    for (let y = 8; y < 20; y += 4) {
      const glow = this.mesh(new THREE.CircleGeometry(0.12, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }), cx + 5.02, y, 2, B, false);
      glow.rotation.y = Math.PI / 2; this.peep.push(glow);
    }
    // flame (inside furnace)
    const fm = this.fireMat = fireMaterial();
    const flame = this.flame = new THREE.Group(); flame.position.set(cx, 4.2, 4.0); B.add(flame);
    flame.rotation.x = -Math.PI / 2; // shoots toward -z (into furnace)
    for (let i = 0; i < 3; i++) {
      const L = 7 - i * 1.6;
      const cone = this.mesh(new THREE.CylinderGeometry(0.35 + i * 0.3, 0.75 + i * 0.35, L, 32, 12, true), fm, 0, L / 2, 0, flame, false);
      cone.renderOrder = 5;
    }
    this.pilotFlame = this.mesh(new THREE.ConeGeometry(0.25, 1.2, 16, 4, true), fm, cx + 0.8, 4.2, 3.6, B, false); this.pilotFlame.rotation.x = -Math.PI / 2;
    this.flameLight = new THREE.PointLight(0xff9a40, 0, 30, 2); this.flameLight.position.set(cx, 6, 0); B.add(this.flameLight);
    this.burnerGlowLight = new THREE.PointLight(0xff8a30, 0, 5, 2); this.burnerGlowLight.position.set(cx, 4.2, 7.0); B.add(this.burnerGlowLight);

    // ---- steam drum
    const drumY = 26.3, drumZ = -1.0;
    this.drumPos = V3(cx, drumY, drumZ);
    const drum = this.drumMesh = this.cylX(0.8, 10, M.lagPlain, cx, drumY, drumZ, B, 40);
    drum.material = M.lagPlain.clone(); drum.material.transparent = true;
    for (const s of [-1, 1]) { const head = this.mesh(new THREE.SphereGeometry(0.8, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), drum.material, cx + s * 5, drumY, drumZ, B); head.rotation.z = -s * Math.PI / 2; head.scale.y = 0.45; }
    for (const s of [-3, 3]) this.box(0.4, 1.0, 1.4, M.steelGrey, cx + s, drumY - 1.0, drumZ, B);
    // drum water (x-ray)
    this.drumWater = this.mesh(new THREE.BufferGeometry(), M.water, cx, drumY, drumZ, B, false);
    this.drumWater.visible = false; this.drumWater.userData.lvl = -999;
    // gauge glass on east end of drum (shows TRUE level)
    const gg = this.gaugeGlass = new THREE.Group(); gg.position.set(cx + 5.6, drumY, drumZ + 0.5); B.add(gg);
    this.box(0.18, 1.5, 0.12, M.steelGrey, 0, 0, -0.06, gg);
    this.mesh(new THREE.BoxGeometry(0.1, 1.3, 0.05), new THREE.MeshStandardMaterial({ color: 0x222831, emissive: 0x334455, emissiveIntensity: 0.6 }), 0, 0, 0.02, gg, false);
    this.ggWater = this.mesh(new THREE.BoxGeometry(0.08, 1, 0.06), new THREE.MeshStandardMaterial({ color: 0x1f6fbf, emissive: 0x2a7fd4, emissiveIntensity: 1.2 }), 0, -0.3, 0.04, gg, false);
    this.mesh(new THREE.BoxGeometry(0.14, 0.012, 0.08), new THREE.MeshBasicMaterial({ color: 0xff3020 }), 0, 0, 0.05, gg, false); // NWL mark
    this.pipe([[cx + 5, drumY + 0.6, drumZ], [cx + 5.6, drumY + 0.6, drumZ], [cx + 5.6, drumY + 0.6, drumZ + 0.5]], 0.04, M.steelGrey, 0.1, B);
    this.pipe([[cx + 5, drumY - 0.6, drumZ], [cx + 5.6, drumY - 0.6, drumZ], [cx + 5.6, drumY - 0.6, drumZ + 0.5]], 0.04, M.steelGrey, 0.1, B);
    this.addPick(gg, 'gaugeglass', 'Drum gauge glass (true level)');
    this.gDrum = this.gauge('DRUM', 0, 14, 'MPa', cx + 5.6, drumY + 1.3, drumZ + 0.9, 0, 0.34, 7, 10.3);
    this.addPick(drum, 'drum', 'Steam drum');
    // downcomers
    for (const x of [cx - 3.5, cx + 3.5]) this.pipe([[x, drumY - 0.6, drumZ], [x, drumY - 2.2, drumZ], [x, drumY - 2.2, -4.9], [x, 1.2, -4.9], [x, 1.2, -3.8]], 0.32, M.lagPlain, 0.9, B);
    // risers drum <- furnace roof
    for (let i = 0; i < 8; i++) { const x = cx - 4 + i * 1.15; this.pipe([[x, 22.8, 2.5], [x, 25, 2.5], [x, drumY + 0.3, drumZ + 0.5]], 0.11, M.lagPlain, 0.5, B); }
    // safety valves on drum + SH SV
    this.svObjs = [];
    const svPos = [[cx - 2.2, drumY + 0.8, drumZ], [cx + 0.2, drumY + 0.8, drumZ], [cx + 3.5, 25.6, 3.4]];
    svPos.forEach(([x, y, z], i) => {
      const g = new THREE.Group(); g.position.set(x, y, z); B.add(g);
      this.cylY(0.22, 0.6, M.steelGrey, 0, 0.3, 0, g);
      this.mesh(new THREE.SphereGeometry(0.32, 16, 12), M.steelGrey, 0, 0.75, 0, g);
      this.cylY(0.12, 0.9, M.red, 0, 1.3, 0, g);   // spring bonnet
      this.cylY(0.05, 0.5, M.chrome, 0, 1.95, 0, g);
      const lever = this.box(0.05, 0.05, 0.6, M.steelGrey, 0, 1.9, 0.3, g);
      // escape pipe & drip pan elbow through roof
      this.pipe([[0, 0.75, 0], [0.6, 0.75, 0], [0.6, 8.5, 0]], 0.22, M.lagPlain, 0.4, g);
      this.cylY(0.34, 0.7, M.steelGrey, 0.6, 8.3, 0, g);
      this.svObjs.push({ g, tip: V3(x + 0.6, y + 8.8, z), lever });
      this.addPick(g, 'sv' + i, ['Drum safety valve SV-1', 'Drum safety valve SV-2', 'SH safety valve SV-3'][i]);
    });
    // SH outlet header + ERV + startup vent silencer on roof
    this.cylX(0.32, 10, M.lagPlain, cx, 25.6, 3.4, B);
    this.ervObj = this.valve(cx + 1.8, 26.2, 3.4, 0.22, { actuator: true, actMat: M.red });
    this.pipe([[cx + 1.8, 25.6, 3.4], [cx + 1.8, 26.0, 3.4]], 0.12, M.steelGrey, 0.1);
    this.pipe([[cx + 1.8, 26.4, 3.4], [cx + 1.8, 26.4, 4.4], [cx + 1.8, 32, 4.4]], 0.18, M.lagPlain, 0.4);
    this.ervTip = V3(cx + 1.8, 32.2, 4.4);
    this.addPick(this.ervObj.g, 'erv', 'Electromatic relief valve (ERV)');
    // start-up vent valve + silencer
    this.ventObj = this.valve(cx - 3, 26.3, 3.4, 0.28, { actuator: true, actMat: M.steelBlue });
    this.pipe([[cx - 3, 25.6, 3.4], [cx - 3, 26.0, 3.4]], 0.14, M.steelGrey, 0.1);
    this.pipe([[cx - 3, 26.6, 3.4], [cx - 3, 26.6, 5.2], [cx - 3, 28.5, 5.2]], 0.2, M.lagPlain, 0.4);
    this.cylY(0.75, 4.5, M.steelGrey, cx - 3, 30.7, 5.2);
    this.cylY(0.8, 0.15, M.steelGrey, cx - 3, 32.95, 5.2);
    this.ventTip = V3(cx - 3, 33.1, 5.2);
    this.addPick(this.ventObj.g, 'vent', 'SH start-up vent (to silencer)');
    // drum vent (small, top of drum)
    this.drumVentObj = this.valve(cx + 2.5, drumY + 1.1, drumZ, 0.12, {});
    this.drumVentTip = V3(cx + 2.5, drumY + 1.6, drumZ + 0.4);
    this.addPick(this.drumVentObj.g, 'drumvent', 'Drum air vent');
    // continuous blowdown valve near drum
    this.cbdObj = this.valve(cx - 4.2, drumY - 1.3, drumZ + 1.0, 0.14, {});
    this.addPick(this.cbdObj.g, 'cbd', 'Continuous blowdown valve');
    // bottom blowdown at mud drum level
    this.ibdObj = this.valve(cx - 3.5, 1.1, -2.5, 0.18, { rotY: Math.PI / 2 });
    this.addPick(this.ibdObj.g, 'ibd', 'Intermittent (bottom) blowdown');
    this.pipe([[cx - 3.5, 1.1, -3.6], [cx - 3.5, 1.1, -1.5], [cx - 8, 1.1, -1.5], [cx - 8, 0.5, -1.5]], 0.1, M.steelGrey, 0.3);
    this.cylY(1.0, 2.2, M.steelGrey, cx - 8.8, 1.1, -1.5); // blowdown tank
    this.bdTankTip = V3(cx - 8.8, 2.4, -1.5);
    this.cylY(0.12, 1.6, M.steelGrey, cx - 8.8, 2.9, -1.5);

    this.addPick(fur, 'furnace', 'Furnace');
    this.addPick(wb, 'burner', 'Burner & windbox');
    this.label('BOILER', cx, 36, 0);

    // gas train
    this.pipe([[cx - 12, 0.5, 9.5], [cx - 4, 0.5, 9.5], [cx - 4, 1.4, 9.5], [cx - 4, 1.4, 8.5], [cx - 1.2, 1.4, 8.5], [cx - 1.2, 4.2, 8.5], [cx - 1.2, 4.2, 7.4]], 0.12, M.gas, 0.35);
    this.ssovObjs = [this.valve(cx - 3.4, 1.4, 8.5, 0.18, { actuator: true, actMat: M.red }), this.valve(cx - 2.6, 1.4, 8.5, 0.18, { actuator: true, actMat: M.red })];
    this.fcvObj = this.valve(cx - 1.8, 1.4, 8.5, 0.2, { actuator: true, actMat: M.yellow });
    this.ssovObjs.forEach(v => this.addPick(v.g, 'ssov', 'Main gas safety shutoff valves'));
    this.addPick(this.fcvObj.g, 'fcv', 'Gas flow control valve');
    this.gGas = this.gauge('GAS SUPPLY', 0, 0.6, 'MPa', cx - 6, 1.6, 9.8, 0, 0.22, 6, null);
    this.cylY(0.6, 1.6, M.gas, cx - 12.5, 0.8, 9.5); // gas meter / regulator skid
    this.label('GAS TRAIN', cx - 4, 3, 9.5);

    // FD fan
    const fd = new THREE.Group(); fd.position.set(cx - 9.5, 0, 4); sc.add(fd);
    this.box(4, 0.4, 4, M.concrete, 0, 0.2, 0, fd);
    const scroll = this.mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.2, 36), M.steelBlue, 0, 2.3, 0, fd); scroll.rotation.x = Math.PI / 2;
    this.box(1.4, 2.0, 1.2, M.steelBlue, 1.2, 3.3, 0, fd);
    this.mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.3, 24), M.steelGrey, 0, 2.3, 1.2, fd).rotation.x = Math.PI / 2;
    // inlet bell + silencer + visible impeller
    const inlet = this.mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.1, 24), M.black, 0, 2.3, 1.9, fd); inlet.rotation.x = Math.PI / 2;
    const imp = this.fdImpeller = new THREE.Group(); imp.position.set(0, 2.3, 1.95); fd.add(imp);
    for (let i = 0; i < 12; i++) { const b = this.box(0.08, 0.8, 0.05, M.steelGrey, 0, 0, 0, imp); b.position.set(Math.cos(i / 12 * 6.283) * 0.45, Math.sin(i / 12 * 6.283) * 0.45, 0); b.rotation.z = i / 12 * 6.283 + 0.4; }
    this.mesh(new THREE.CircleGeometry(0.2, 16), M.steelGrey, 0, 0, 0.02, imp);
    // screen grill
    for (let i = -4; i <= 4; i++) { this.box(0.02, 1.8, 0.02, M.steelGrey, i * 0.2, 2.3, 2.0, fd); this.box(1.8, 0.02, 0.02, M.steelGrey, 0, 2.3 + i * 0.2, 2.0, fd); }
    const fdMotor = this.mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.2, 28), M.motor, 0, 2.3, -2.0, fd); fdMotor.rotation.x = Math.PI / 2;
    this.fdLamp = this.mesh(new THREE.SphereGeometry(0.1, 10, 8), M.lampOff.clone(), 0, 3.25, -2.0, fd);
    this.lamps.push(this.fdLamp);
    // duct to windbox
    this.box(1.4, 1.4, 1.4, M.steelBlue, 1.2, 4.0, 0, fd);
    this.pipe([[cx - 8.3, 4.0, 4], [cx - 4, 4.0, 4], [cx - 2.5, 4.2, 4.6]], 0.75, M.steelBlue, 1.2);
    // FD damper actuator
    this.damperObj = this.valve(cx - 6, 5.0, 4, 0.25, { actuator: true, actMat: M.steelGrey });
    this.addPick(fd, 'fd', 'Forced draft fan');
    this.addPick(this.damperObj.g, 'damper', 'FD fan inlet damper');
    this.label('FD FAN', cx - 9.5, 5.5, 4);
    // furnace pressure / flue gas analyser box
    this.box(0.6, 0.8, 0.3, M.steelGrey, cx + 4.2, 5.3, 5.4);
    this.gFurnP = this.gauge('FURNACE', 0, 30, 'mbar', cx + 2.8, 5.6, 5.9, 0, 0.2, 6, 20);
  }

  buildStack() {
    const M = this.M, cx = -24;
    // breeching duct from backpass bottom to stack
    this.box(6, 3.4, 4, M.casing, cx, 3.3, -13.5);
    this.box(3, 3, 6, M.casing, cx, 3.3, -18.0);
    // air heater block
    this.box(5, 4.5, 3.5, M.steelBlue, cx + 5.5, 3.0, -13.5);
    const st = this.mesh(new THREE.CylinderGeometry(1.25, 1.9, 48, 32), new THREE.MeshStandardMaterial({ color: 0x9a978e, roughness: 0.85, metalness: 0.1 }), cx, 24, -22.5);
    // red/white aviation bands at top
    for (let i = 0; i < 4; i++) this.mesh(new THREE.CylinderGeometry(1.29, 1.31, 1.5, 32), i % 2 ? M.lagPlain : M.red, cx, 46.5 - i * 1.5, -22.5);
    this.stackTip = V3(cx, 48.3, -22.5);
    // ladder & platforms
    for (const y of [20, 38]) { const r = this.mesh(new THREE.TorusGeometry(1.9 - y * 0.0125, 0.06, 6, 36), M.yellow, cx, y + 1, -22.5); r.rotation.x = Math.PI / 2; const p = this.mesh(new THREE.RingGeometry(1.6 - y * 0.0125, 2.1 - y * 0.0125, 36), M.grating, cx, y, -22.5); p.rotation.x = -Math.PI / 2; }
    this.aviation = this.mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0x330000 }), cx + 1.3, 48.2, -22.5, this.scene, false);
    this.addPick(st, 'stack', 'Stack (flue gas)');
    this.label('STACK', cx, 50, -22.5);
    // CEMS shelter
    this.box(2.5, 2.6, 2, M.lagPlain, cx + 4, 1.3, -24);
  }

  buildDeaerator() {
    const M = this.M, x = -7, y = 15.5, z = -7;
    for (const [dx, dz] of [[-4, -1.5], [4, -1.5], [-4, 1.5], [4, 1.5]]) this.column(x + dx, z + dz, 13.8, M.steelBlue, 0.4);
    this.platform(x, 13.8, z, 10, 4.4);
    this.stairs(x + 5.6, 0, z + 9.3, 13.8, 9.0);
    const tank = this.cylX(1.6, 10, M.lagPlain, x, y, z);
    for (const s of [-1, 1]) { const h = this.mesh(new THREE.SphereGeometry(1.6, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.lagPlain, x + s * 5, y, z); h.rotation.z = -s * Math.PI / 2; h.scale.y = 0.5; }
    const head = this.cylY(0.95, 4.2, M.lagPlain, x - 2.5, y + 3.0, z);
    this.mesh(new THREE.SphereGeometry(0.95, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.lagPlain, x - 2.5, y + 5.1, z);
    this.daVentTip = V3(x - 2.5, y + 6.4, z);
    this.cylY(0.05, 0.6, M.steelGrey, x - 2.5, y + 6.0, z);
    // level glass
    const lg = new THREE.Group(); lg.position.set(x + 5.3, y, z + 0.9); this.scene.add(lg);
    this.box(0.15, 2.4, 0.1, M.steelGrey, 0, 0, 0, lg);
    this.daGlass = this.mesh(new THREE.BoxGeometry(0.08, 1, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a7fd4, emissive: 0x2a7fd4, emissiveIntensity: 0.9 }), 0, 0, 0.05, lg, false);
    this.gDA = this.gauge('DEAERATOR', 0, 0.6, 'MPa', x + 3, y + 1.9, z + 1.5, 0, 0.26, 6, 0.45);
    this.addPick(tank, 'da', 'Deaerator & storage tank');
    this.label('DEAERATOR', x, y + 7.5, z);
    // pegging steam valve
    this.pegObj = this.valve(x - 2.5, y + 5.6, z + 1.4, 0.18, { actuator: true, actMat: M.steelGrey });
  }

  buildFeedTrain() {
    const M = this.M;
    this.box(9, 0.3, 7.5, M.concrete, -7, 0.15, 7);
    this.bfpObjs = [this.pumpSet(-7, 0.3, 5.0, 0, 1.0, 'Boiler feed pump A', 'bfp0'), this.pumpSet(-7, 0.3, 9.0, 0, 1.0, 'Boiler feed pump B', 'bfp1')];
    this.gBfp = [this.gauge('BFP-A DISCH', 0, 16, 'MPa', -9.6, 2.6, 6.1, 0, 0.22, 8, 14), this.gauge('BFP-B DISCH', 0, 16, 'MPa', -9.6, 2.6, 10.1, 0, 0.22, 8, 14)];
    this.label('FEED PUMPS', -7, 4, 7);
    // recirc valves
    this.recircObj = this.valve(-11, 2.6, 7.2, 0.14, { actuator: true, actMat: M.steelGrey });
    // feedwater control station near boiler
    this.box(5, 0.3, 2.5, M.concrete, -15.5, 0.15, 9.5);
    this.fwcvObj = this.valve(-15.5, 1.3, 9.0, 0.26, { actuator: true, actMat: M.yellow });
    this.fwbpObj = this.valve(-15.5, 1.3, 10.4, 0.16, {});
    this.addPick(this.fwcvObj.g, 'fwcv', 'Feedwater control valve');
    this.addPick(this.fwbpObj.g, 'fwbp', 'Feedwater start-up bypass');
    this.gFw = this.gauge('FEEDWATER', 0, 16, 'MPa', -13.2, 2.0, 9.9, 0, 0.22, 8, 14);
    this.label('FEED REG STATION', -15.5, 3, 9.6);
  }

  buildTurbineHall() {
    const M = this.M;
    const x0 = -2, x1 = 34, z0 = -15, z1 = 15, H = 19;
    this.box(x1 - x0, 0.3, z1 - z0, M.concrete, (x0 + x1) / 2, 0.15, 0);
    // columns & girders
    for (let x = x0; x <= x1; x += 6) for (const z of [z0, z1]) this.column(x, z, H, M.steelBlue, 0.6);
    for (let x = x0; x <= x1; x += 6) { this.beam([x, H, z0], [x, H + 3, 0], M.steelBlue, 0.45); this.beam([x, H + 3, 0], [x, H, z1], M.steelBlue, 0.45); this.beam([x, H, z0], [x, H, z1], M.steelBlue, 0.3); }
    for (const z of [z0, z1]) { this.beam([x0, H, z], [x1, H, z], M.steelBlue, 0.5); this.beam([x0, 13, z], [x1, 13, z], M.yellow, 0.55); }
    // crane rail & overhead crane
    const crane = this.crane = new THREE.Group(); crane.position.set(16, 14, 0); this.scene.add(crane);
    this.box(1.0, 1.4, 30, M.yellow, -1.2, 0, 0, crane); this.box(1.0, 1.4, 30, M.yellow, 1.2, 0, 0, crane);
    this.box(3.6, 1.2, 2.4, M.yellow, 0, 0.9, 0, crane);
    this.cylY(0.03, 6, M.black, 0, -3, 0.5, crane);
    this.box(0.6, 0.6, 0.3, M.hazard, 0, -6.2, 0.5, crane);
    // roof (two slopes, cut away near camera by the user toggling 'hall roof')
    const roofA = this.mesh(new THREE.PlaneGeometry(x1 - x0 + 1, Math.hypot(15, 3) + 0.5), M.roof, (x0 + x1) / 2, H + 1.5, -7.5); roofA.rotation.x = -Math.PI / 2 + Math.atan2(3, 15); roofA.rotation.order = 'YXZ';
    const roofB = this.mesh(new THREE.PlaneGeometry(x1 - x0 + 1, Math.hypot(15, 3) + 0.5), M.roof, (x0 + x1) / 2, H + 1.5, 7.5); roofB.rotation.x = -Math.PI / 2 - Math.atan2(3, 15);
    this.hallRoof = [roofA, roofB];
    M.roof.map = TEX.cladding.clone(); M.roof.map.repeat.set(8, 4); M.roof.map.needsUpdate = true;
    // back wall (north) with window band
    const wallN = this.mesh(new THREE.PlaneGeometry(x1 - x0, H), M.wall, (x0 + x1) / 2, H / 2, z0 - 0.3);
    M.wall.map = TEX.cladding.clone(); M.wall.map.repeat.set(6, 3); M.wall.map.needsUpdate = true;
    const winN = this.mesh(new THREE.PlaneGeometry(x1 - x0 - 2, 2.4), M.window, (x0 + x1) / 2, 15.5, z0 - 0.25);
    M.window.map.repeat.set(5, 1); M.window.emissiveMap.repeat.set(5, 1);
    // east gable wall
    const wallE = this.mesh(new THREE.PlaneGeometry(z1 - z0, H), M.wall, x1 + 0.3, H / 2, 0); wallE.rotation.y = -Math.PI / 2;
    const gable = new THREE.Shape(); gable.moveTo(z0, 0); gable.lineTo(z1, 0); gable.lineTo(0, 3); gable.lineTo(z0, 0);
    const gm = this.mesh(new THREE.ShapeGeometry(gable), M.wall, x1 + 0.3, H, 0); gm.rotation.y = -Math.PI / 2;
    // roller door in east wall
    this.box(0.2, 7, 6, M.steelGrey, x1 + 0.25, 3.5, 7);
    // hall high-bay lights
    this.hallLights = [];
    for (let x = x0 + 3; x < x1; x += 6) for (const z of [-6, 6]) {
      const lamp = this.mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xfff2d8, emissiveIntensity: 0 }), x, H - 1, z, this.scene, false);
      this.hallLights.push(lamp);
    }
    this.hallPL = [];
    for (const x of [6, 22]) { const L = new THREE.PointLight(0xfff0d0, 0, 40, 1.6); L.position.set(x, H - 2, 0); this.scene.add(L); this.hallPL.push(L); }
    this.label('TURBINE HALL', 16, H + 5, 0);
    // alarm beacon
    this.beacon = this.mesh(new THREE.SphereGeometry(0.25, 12, 10), new THREE.MeshStandardMaterial({ color: 0x552200, emissive: 0xff6a00, emissiveIntensity: 0 }), 3, 10, z1 - 0.4, this.scene, false);
    this.beaconLight = new THREE.SpotLight(0xff7a00, 0, 30, 0.5, 0.5, 1); this.beaconLight.position.set(3, 10, z1 - 0.6); this.scene.add(this.beaconLight); this.scene.add(this.beaconLight.target);
  }

  buildTurbine() {
    const M = this.M;
    // turbine pedestal (table-top) and deck
    const deckY = 6;
    for (const x of [6, 12, 19, 26]) for (const z of [-3.2, 3.2]) this.box(1.2, deckY, 1.2, M.concrete, x, deckY / 2, z);
    this.box(22, 1.0, 7.6, M.concrete, 16, deckY - 0.5, 0);
    // operating floor around the table
    this.platform(16, deckY, 6.2, 22, 4.6);
    this.platform(16, deckY, -6.2, 22, 4.6);
    this.stairs(3.2, 0, 11.6, deckY, 5.2);
    const cy = deckY + 1.6;
    const T = this.turbineGroup = new THREE.Group(); this.scene.add(T);
    // front standard
    this.box(2.2, 2.2, 2.2, M.turbDark, 6.5, deckY + 1.1, 0, T);
    this.gTach = this.gauge('TURBINE SPEED', 0, 4000, 'rpm', 5.35, deckY + 1.6, 0.4, -Math.PI / 2, 0.32, 8, 3600);
    // HP casing via lathe profile
    const prof = [[0.2, 0], [1.1, 0], [1.25, 0.6], [1.3, 2.0], [1.55, 3.6], [1.75, 5.0], [1.8, 5.8], [0.2, 5.8]].map(([r, y]) => new THREE.Vector2(r, y));
    const hp = this.mesh(new THREE.LatheGeometry(prof, 48), M.turb, 7.6, cy, 0, T); hp.rotation.z = -Math.PI / 2;
    // horizontal joint flange
    this.box(5.8, 0.18, 3.9, M.turbDark, 10.5, cy, 0, T);
    // bolts
    for (let i = 0; i < 18; i++) for (const s of [-1, 1]) this.cylY(0.07, 0.3, M.steelGrey, 7.9 + i * 0.32, cy + 0.15, s * 1.85, T);
    // LP exhaust hood
    const lp = this.box(4.6, 3.2, 5.8, M.turb, 15.8, cy + 0.2, 0, T);
    const lpTop = this.mesh(new THREE.CylinderGeometry(2.9, 2.9, 4.6, 40, 1, false, 0, Math.PI), M.turb, 15.8, cy + 1.8, 0, T); lpTop.rotation.z = Math.PI / 2; lpTop.rotation.y = Math.PI / 2;
    // atmospheric relief diaphragms on LP hood
    this.diaph = [];
    for (const z of [-1.4, 1.4]) { const d = this.cylY(0.5, 0.25, M.steelGrey, 15.8, cy + 4.75, z, T); this.diaph.push(d); }
    this.diaphTip = V3(15.8, cy + 5.0, 1.4);
    // bearing housings and shaft
    for (const x of [13.5, 18.4, 19.9, 26.8]) this.box(0.9, 1.6, 1.8, M.turbDark, x, cy - 0.3, 0, T);
    const shaft = this.mesh(new THREE.CylinderGeometry(0.28, 0.28, 22, 24), M.chrome, 17, cy, 0, T); shaft.rotation.z = Math.PI / 2;
    // couplings (rotating, marked)
    this.couplings = [];
    for (const x of [6.0, 19.15, 27.6]) {
      const cg = new THREE.Group(); cg.position.set(x, cy, 0); T.add(cg);
      const c = this.mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 24), M.marker, 0, 0, 0, cg); c.rotation.z = Math.PI / 2;
      for (let i = 0; i < 8; i++) { const b = this.cylX(0.05, 0.75, M.steelGrey, 0, Math.cos(i * 0.785) * 0.42, Math.sin(i * 0.785) * 0.42, cg); }
      this.couplings.push(cg);
    }
    this.blurDisc = [];
    for (const cg of this.couplings) { const d = this.mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.62, 24), new THREE.MeshStandardMaterial({ color: 0x8f969a, metalness: 0.8, roughness: 0.3, transparent: true, opacity: 0 }), 0, 0, 0, cg, false); d.rotation.z = Math.PI / 2; this.blurDisc.push(d); }
    // turning gear motor
    this.box(0.9, 0.9, 0.9, M.motor, 19.15, cy + 1.0, 1.3, T);
    this.tgLamp = this.mesh(new THREE.SphereGeometry(0.08, 8, 6), M.lampOff.clone(), 19.15, cy + 1.55, 1.3, T); this.lamps.push(this.tgLamp);
    // generator
    const gen = this.mesh(new THREE.CylinderGeometry(1.55, 1.55, 6.2, 40), M.gen, 23.2, cy + 0.1, 0, T); gen.rotation.z = Math.PI / 2;
    for (const x of [20.1, 26.3]) this.cylX(1.62, 0.25, M.turbDark, x, cy + 0.1, 0, T);
    for (let i = 0; i < 5; i++) this.cylX(1.6, 0.12, M.turbDark, 21 + i * 1.1, cy + 0.1, 0, T);
    this.box(4.5, 1.3, 1.2, M.gen, 23.2, cy + 1.5, -1.9, T); // coolers
    // exciter
    this.cylX(0.75, 1.4, M.gen, 28.6, cy, 0, T);
    // generator terminal box & isolated phase bus going outside
    this.box(1.6, 1.2, 1.6, M.gen, 23.2, deckY - 1.4, 0, T);
    for (let i = -1; i <= 1; i++) this.pipe([[23.2 + i * 0.6, deckY - 2.0, 0], [23.2 + i * 0.6, 2.4, 0], [23.2 + i * 0.6, 2.4, 2.2], [36 + i * 0.6, 2.4, 2.2], [36 + i * 0.6, 2.4, 6]], 0.22, M.steelGrey, 0.4);
    // main stop valve and control valves
    const msv = this.msvObj = new THREE.Group(); msv.position.set(9.0, cy + 0.2, 3.4); T.add(msv);
    this.cylY(0.55, 2.6, M.lagPlain, 0, 0.6, 0, msv);
    this.cylY(0.42, 1.2, M.red, 0, 2.5, 0, msv);
    this.msvStem = this.cylY(0.08, 1.2, M.chrome, 0, 3.4, 0, msv);
    this.addPick(msv, 'msv', 'Main stop valve');
    this.gvStems = [];
    for (let i = 0; i < 4; i++) {
      const x = 8.6 + i * 0.75;
      this.cylY(0.3, 0.8, M.turbDark, x, cy + 1.8, 0, T);
      this.cylY(0.22, 0.6, M.yellow, x, cy + 2.6, 0, T);
      const s = this.cylY(0.05, 0.9, M.chrome, x, cy + 3.2, 0, T);
      this.gvStems.push(s);
    }
    this.cylX(0.35, 3.4, M.turbDark, 9.7, cy + 1.6, 0, T); // steam chest
    this.addPick(hp, 'turbine', 'Steam turbine');
    this.addPick(lp, 'turbine', 'Steam turbine (LP exhaust)');
    this.addPick(gen, 'generator', 'Generator');
    this.label('TURBINE', 11, cy + 4.5, 0);
    this.label('GENERATOR', 23.2, cy + 3.2, 0);
    this.cy = cy;
    // lube oil console on ground
    this.box(4, 2.0, 2.2, M.oil, 9, 1.3, 9.5);
    this.aopObj = this.pumpSet(8.0, 2.3, 9.0, 0, 0.35, 'AC lube oil pump', 'lube');
    this.dcopObj = this.pumpSet(10.0, 2.3, 9.0, 0, 0.35, 'DC emergency oil pump', 'lube');
    this.gLube = this.gauge('LUBE OIL', 0, 0.3, 'MPa', 9, 1.5, 10.65, 0, 0.22, 6, null);
    this.pipe([[9, 1.0, 8.4], [9, 1.0, 3.6], [9, 5.0, 3.6], [13.5, 5.0, 3.6], [13.5, cy - 1.0, 1.0]], 0.08, M.oil, 0.3);
    this.label('LUBE OIL', 9, 3.4, 9.5);
    this.box(0.6, 1.4, 0.4, M.steelGrey, 7, deckY + 0.7, 2.8); // local trip / gauge board
    this.gVac = this.gauge('CONDENSER', -100, 0, 'kPa(g)', 7, deckY + 1.2, 3.02, 0, 0.2, 5, null);
    this.tripHandle = this.box(0.12, 0.3, 0.12, M.red, 7, deckY + 0.5, 3.05);
  }

  buildCondenser() {
    const M = this.M, deckY = 6;
    const c = this.box(5.0, 4.2, 5.6, M.steelGrey, 15.8, 2.6, 0);
    this.addPick(c, 'condenser', 'Surface condenser');
    // water boxes
    for (const x of [12.8, 18.8]) this.mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.2, 32, 1, false, 0, Math.PI), M.cw, x, 2.6, 0).rotation.z = x < 15 ? Math.PI / 2 : -Math.PI / 2;
    // hotwell + level glass
    this.box(4.0, 0.9, 4.8, M.steelGrey, 15.8, 0.45, 0);
    const lg = new THREE.Group(); lg.position.set(15.8, 1.6, 2.9); this.scene.add(lg);
    this.box(0.15, 1.8, 0.1, M.steelGrey, 0, 0, 0, lg);
    this.hwGlass = this.mesh(new THREE.BoxGeometry(0.08, 1, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a7fd4, emissive: 0x2a7fd4, emissiveIntensity: 0.8 }), 0, 0, 0.06, lg, false);
    // CW piping out to cooling tower
    this.pipe([[11.6, 2.0, -1.2], [10.6, 2.0, -1.2], [10.6, 2.0, -11], [42, 2.0, -11], [42, 2.0, 20]], 0.6, M.cw, 1.5);
    this.pipe([[20.0, 3.4, 1.2], [21, 3.4, 1.2], [21, 3.4, 11.5], [31, 3.4, 11.5], [31, 0.8, 11.5], [31, 0.8, 20]], 0.6, M.cw, 1.4);
    // condensate pumps (vertical can type)
    this.cpObjs = [];
    for (const [i, x] of [[0, 12.4], [1, 14.4]]) {
      const g = new THREE.Group(); g.position.set(x, 0, 6.8); this.scene.add(g);
      this.cylY(0.45, 1.2, M.pump, 0, 0.9, 0, g);
      const motor = this.cylY(0.5, 1.2, M.motor, 0, 2.3, 0, g);
      const fan = new THREE.Group(); fan.position.y = 3.0; g.add(fan);
      this.box(0.8, 0.04, 0.1, M.steelGrey, 0, 0, 0, fan); this.box(0.1, 0.04, 0.8, M.steelGrey, 0, 0, 0, fan);
      const lamp = this.mesh(new THREE.SphereGeometry(0.07, 8, 6), M.lampOff.clone(), 0.5, 2.6, 0, g); this.lamps.push(lamp);
      this.cpObjs.push({ g, coup: fan, lamp, axis: 'y' });
      this.addPick(g, 'cp' + i, `Condensate pump ${'AB'[i]}`);
    }
    this.pipe([[15.8, 0.5, 2.4], [15.8, 0.5, 6.8], [12.4, 0.5, 6.8]], 0.15, M.cond, 0.3);
    // condensate to deaerator
    this.pipe([[13.4, 1.6, 6.8], [13.4, 1.6, 12], [-2, 1.6, 12], [-2, 9, 12], [-2, 9, -5], [-3, 15.5, -5], [-3, 15.5, -6]], 0.13, M.cond, 0.5);
    this.lcvObj = this.valve(4, 1.6, 12, 0.16, { actuator: true, actMat: M.yellow });
    this.addPick(this.lcvObj.g, 'lcv', 'Deaerator level control valve');
    // makeup line from condensate storage tank
    this.cylY(3, 7, M.lagPlain, 26, 3.5, 22);
    this.pipe([[24, 0.8, 20], [24, 0.8, 4], [18, 0.8, 4], [18, 0.8, 2.6]], 0.1, M.cond, 0.3);
    this.makeupObj = this.valve(24, 0.8, 14, 0.14, { actuator: true, actMat: M.steelGrey, rotY: Math.PI / 2 });
    this.addPick(this.makeupObj.g, 'makeup', 'Condenser makeup valve');
    this.label('CONDENSATE STORAGE', 26, 8.5, 22);
    // vacuum pumps skid
    this.box(3.6, 0.3, 2, M.concrete, 21.5, 0.15, 7.8);
    this.vpObjs = [this.pumpSet(21.5, 0.3, 7.3, Math.PI, 0.4, 'Holding vacuum pump', 'vac'), this.pumpSet(21.5, 0.3, 8.4, Math.PI, 0.45, 'Hogging ejector / vacuum pump', 'vac')];
    this.pipe([[21.5, 1.0, 7.3], [19, 1.0, 7.3], [19, 1.0, 2.8], [18.2, 3, 2.8]], 0.08, M.steelGrey, 0.3);
    this.vbObj = this.valve(19.6, 4.5, 2.9, 0.12, { actuator: false });
    this.addPick(this.vbObj.g, 'vacbreaker', 'Vacuum breaker valve');
    this.label('CONDENSER', 15.8, 5.4, 4);
  }

  buildCoolingTower() {
    const M = this.M, x0 = 44, z0 = 28;
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b7378, roughness: 0.8, metalness: 0.2 });
    this.box(26, 1.2, 12, M.concrete, x0 + 6, 0.6, z0); // basin
    const water = this.mesh(new THREE.PlaneGeometry(25, 11), new THREE.MeshStandardMaterial({ color: 0x24465a, roughness: 0.15, metalness: 0.3 }), x0 + 6, 1.15, z0); water.rotation.x = -Math.PI / 2;
    this.ctFans = []; this.ctTips = [];
    for (let i = 0; i < 3; i++) {
      const x = x0 + i * 8;
      this.box(7.6, 8, 10, wood, x, 5.2, z0);
      // louvres
      for (let y = 2; y < 8; y += 0.5) { this.box(7.6, 0.06, 0.5, M.steelGrey, x, y, z0 + 5.1).rotation.x = 0.6; this.box(7.6, 0.06, 0.5, M.steelGrey, x, y, z0 - 5.1).rotation.x = -0.6; }
      this.box(7.8, 0.3, 10.2, M.steelGrey, x, 9.3, z0);
      this.mesh(new THREE.CylinderGeometry(3.0, 3.3, 3.0, 36, 1, true), new THREE.MeshStandardMaterial({ color: 0x8e9599, roughness: 0.6, side: THREE.DoubleSide }), x, 10.9, z0);
      const fan = new THREE.Group(); fan.position.set(x, 10.4, z0); this.scene.add(fan);
      for (let b = 0; b < 6; b++) { const bl = this.box(2.8, 0.05, 0.4, M.steelGrey, 0, 0, 0, fan); bl.position.set(Math.cos(b * 1.047) * 1.4, 0, Math.sin(b * 1.047) * 1.4); bl.rotation.y = -b * 1.047; bl.rotation.x = 0.25; }
      this.ctFans.push(fan); this.ctTips.push(V3(x, 12.6, z0));
    }
    this.label('COOLING TOWER', x0 + 8, 15, z0);
    // CW pumps at basin
    this.cwObjs = [];
    for (const [i, x] of [[0, 34], [1, 37]]) {
      const g = new THREE.Group(); g.position.set(x, 1.2, 21); this.scene.add(g);
      this.cylY(0.7, 1.4, M.pump, 0, 0.7, 0, g); this.cylY(0.8, 2.0, M.motor, 0, 2.4, 0, g);
      const fan = new THREE.Group(); fan.position.y = 3.5; g.add(fan);
      this.box(1.2, 0.05, 0.15, M.steelGrey, 0, 0, 0, fan); this.box(0.15, 0.05, 1.2, M.steelGrey, 0, 0, 0, fan);
      const lamp = this.mesh(new THREE.SphereGeometry(0.09, 8, 6), M.lampOff.clone(), 0.8, 3.1, 0, g); this.lamps.push(lamp);
      this.cwObjs.push({ g, coup: fan, lamp, axis: 'y' });
      this.addPick(g, 'cw' + i, `Circulating water pump ${'AB'[i]}`);
    }
    this.label('CW PUMPS', 35.5, 6, 21);
  }

  buildSwitchyard() {
    const M = this.M, x = 42, z = 0;
    this.box(12, 0.3, 12, M.gravel, x + 2, 0.15, z + 2);
    // step-up transformer
    const tr = this.box(4.5, 4, 3.2, M.transformer, x, 2.3, z + 6);
    for (let i = 0; i < 9; i++) this.box(0.08, 3.2, 1.4, M.transformer, x - 2 + i * 0.5, 2.2, z + 8.3);
    this.cylX(0.7, 3.6, M.transformer, x, 5.0, z + 5.2);
    for (let i = -1; i <= 1; i++) { this.cylY(0.12, 1.8, M.porcelain, x + i * 1.2, 5.2, z + 6.0); for (let k = 0; k < 6; k++) this.cylY(0.22, 0.06, M.porcelain, x + i * 1.2, 4.5 + k * 0.25, z + 6.0); }
    this.addPick(tr, 'transformer', 'Generator step-up transformer');
    this.label('GSU 13.8/138 kV', x, 7.6, z + 6);
    // HV breaker (dead tank)
    const brk = this.brkGroup = new THREE.Group(); brk.position.set(x + 5, 0, z + 1); this.scene.add(brk);
    for (let i = -1; i <= 1; i++) { this.cylX(0.5, 2.4, M.steelGrey, 0, 2.6, i * 1.4, brk); this.cylY(0.14, 2.0, M.porcelain, -0.8, 4.3, i * 1.4, brk); this.cylY(0.14, 2.0, M.porcelain, 0.8, 4.3, i * 1.4, brk); }
    this.box(1, 1.6, 0.8, M.steelGrey, 0, 0.8, 2.6, brk);
    this.brkLamp = this.mesh(new THREE.SphereGeometry(0.12, 10, 8), M.lampOff.clone(), 0.3, 1.4, 3.02, brk); this.lamps.push(this.brkLamp);
    this.addPick(brk, 'breaker', 'Generator breaker 52G');
    // lattice tower & lines
    const tw = new THREE.Group(); tw.position.set(x + 14, 0, z); this.scene.add(tw);
    for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) { const leg = this.beam([dx, 0, dz], [dx * 0.3, 22, dz * 0.3], M.steelGrey, 0.18); tw.add(leg); }
    for (let y = 3; y < 22; y += 3.5) { const w = 1.5 * (1 - y / 22 * 0.7); for (const [a, b] of [[[-w, y, -w], [w, y, -w]], [[w, y, -w], [w, y, w]], [[w, y, w], [-w, y, w]], [[-w, y, w], [-w, y, -w]]]) tw.add(this.beam(a, b, M.steelGrey, 0.1)); }
    for (const y of [15, 19]) tw.add(this.beam([0, y, -5], [0, y, 5], M.steelGrey, 0.2));
    for (const zz of [-4, 0, 4]) {
      const pts = []; for (let k = 0; k <= 20; k++) { const t = k / 20; pts.push(V3(x + 5 + t * 9, 6 + t * 9 - Math.sin(t * Math.PI) * 1.5, z + 1 + zz * 0.35 * (1 - t) + zz * t)); }
      this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.03, 4), M.black, 0, 0, 0, this.scene, false);
      const far = []; for (let k = 0; k <= 30; k++) { const t = k / 30; far.push(V3(x + 14 + t * 240, 15 - Math.sin(t * Math.PI) * 4 + t * 5, z + zz + t * 40)); }
      this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(far), 30, 0.04, 4), M.black, 0, 0, 0, this.scene, false);
    }
  }

  buildControlRoom() {
    const M = this.M, x = 0, z = 22;
    const cr = this.box(14, 4.2, 7, M.lagPlain, x, 2.1, z);
    cr.material = M.wall;
    const win = this.mesh(new THREE.PlaneGeometry(12, 1.8), M.window.clone(), x, 2.6, z - 3.52); win.rotation.y = Math.PI;
    win.material.map = TEX.window.clone(); win.material.map.repeat.set(4, 1); win.material.emissiveMap = TEX.windowLit.clone(); win.material.emissiveMap.repeat.set(4, 1); win.material.map.needsUpdate = true;
    this.crWindow = win;
    this.box(14.4, 0.3, 7.4, M.steelGrey, x, 4.35, z);
    this.box(1.4, 2.4, 0.1, M.steelGrey, x + 5, 1.2, z - 3.52);
    this.addPick(cr, 'controlroom', 'Central control room');
    this.label('CONTROL ROOM', x, 6, z);
    // HVAC units on roof
    for (const dx of [-4, 3]) this.box(2.2, 1.0, 1.6, M.steelGrey, x + dx, 5.0, z);
  }

  buildPiping() {
    const M = this.M, cx = -24, cy = this.cy;
    // main steam line: SH header -> turbine MSV
    const ms = [[cx + 5, 25.6, 3.4], [cx + 9.5, 25.6, 3.4], [cx + 9.5, 25.6, 12.5], [2, 25.6, 12.5], [2, cy + 0.2, 12.5], [9.0, cy + 0.2, 12.5], [9.0, cy + 0.2, 3.4]];
    this.mainSteam = this.pipe(ms.slice(0, -1).concat([[9.0, cy + 0.2, 4.0]]), 0.38, M.lag, 1.2);
    M.lag.map.repeat.set(1, 1);
    // crossover from MSV to steam chest
    this.pipe([[9.0, cy + 2.5, 3.4], [9.0, cy + 3.0, 3.4], [9.0, cy + 3.0, 1.2], [9.7, cy + 1.9, 0.5]], 0.28, M.lag, 0.6);
    // main steam line drains + trap
    this.drainObj = this.valve(2, 1.4, 11.2, 0.15, {});
    this.pipe([[2, 4.0, 12.5], [2, 2.4, 12.5], [2, 2.4, 11.2], [2, 1.7, 11.2]], 0.08, M.steelGrey, 0.2);
    this.pipe([[2, 1.0, 11.2], [2, 0.4, 11.2], [12, 0.4, 11.2], [12, 0.4, 3.0]], 0.08, M.steelGrey, 0.2);
    this.addPick(this.drainObj.g, 'drain', 'Main steam line drains');
    this.drainTip = V3(2.6, 0.6, 11.2);
    this.gMS = this.gauge('MAIN STEAM', 0, 14, 'MPa', 2.65, 6.2, 12.5, Math.PI / 2, 0.3, 7, 10);
    // pipe rack supports for main steam
    for (const z of [5, 9, 12.5]) { this.column(cx + 9.5, z, 25, M.steelBlue, 0.35); }
    for (const x of [-8, -2]) this.column(x, 12.5, 25, M.steelBlue, 0.35);
    // feedwater: BFP -> FW station -> economizer inlet (backpass)
    for (const zz of [5, 9]) this.pipe([[-9.6, 1.25, zz], [-11, 1.25, zz], [-11, 2.2, zz], [-11, 2.2, 7.2]], 0.13, M.green, 0.3);
    this.pipe([[-11, 2.2, 7.2], [-13, 2.2, 7.2], [-13, 1.3, 7.2], [-13, 1.3, 9.0], [-15.2, 1.3, 9.0]], 0.16, M.green, 0.4);
    this.pipe([[-15.8, 1.3, 9.0], [-17.5, 1.3, 9.0], [-17.5, 1.3, 9.0], [-17.5, 14, 9.0], [-17.5, 14, -6], [cx + 4.2, 14, -6]], 0.16, M.green, 0.7);
    this.pipe([[-15.2, 1.3, 10.4], [-17.0, 1.3, 10.4], [-17.0, 1.3, 9.2]], 0.08, M.green, 0.2);
    // economizer outlet to drum
    this.pipe([[cx + 4.2, 21, -10], [cx + 6, 21, -10], [cx + 6, 27.5, -10], [cx + 6, 27.5, -1], [cx + 5.0, 27.0, -1]], 0.15, M.green, 0.6);
    // DA -> BFP suction (downcomer from storage tank)
    this.pipe([[-4, 13.9, -6], [-4, 2.0, -6], [-4, 2.0, 2.5], [-4, 1.25, 2.5], [-4, 1.25, 9.0], [-5.6, 1.25, 9.0]], 0.22, M.green, 0.6);
    this.pipe([[-4, 1.25, 5.0], [-5.6, 1.25, 5.0]], 0.18, M.green, 0.2);
    // recirc back to DA
    this.pipe([[-11, 2.6, 7.2], [-11, 3.4, 7.2], [-11, 3.4, -8.5], [-10, 13.9, -8.5]], 0.07, M.green, 0.5);
    // spray water line to SH
    this.pipe([[-17.5, 14, 6], [-17.5, 24.8, 6], [cx + 4.5, 24.8, 6], [cx + 4.5, 25.6, 4.1]], 0.06, M.green, 0.4);
    this.sprayObj = this.valve(-17.5, 22, 6.0, 0.13, { actuator: true, actMat: M.yellow, rotY: Math.PI / 2 });
    this.addPick(this.sprayObj.g, 'spray', 'Attemperator spray valve');
    // extraction to DA from turbine & pegging steam
    this.pipe([[12.5, cy - 1.2, -1.8], [12.5, 3.5, -1.8], [12.5, 3.5, -10], [-2, 3.5, -10], [-2, 22, -10], [-9.5, 22, -10], [-9.5, 22, -7], [-9.5, 21.4, -7]], 0.14, M.lag, 0.6);
    this.pipe([[cx + 9.5, 25.6, 8], [-9.5, 25.6, 8], [-9.5, 21.3, 8], [-9.5, 21.3, -7]], 0.09, M.lag, 0.5);
    // gas header from site boundary
    this.pipe([[-80, 0.5, 9.5], [cx - 12, 0.5, 9.5]], 0.14, M.gas, 0.3);
  }

  setupPost() {
    const r = this.renderer;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.particles.mat.uniforms.scale.value = h * 0.9;
  }

  setNight(on) {
    this.night = on;
    const elev = on ? -4 : 38, az = on ? 200 : 215;
    const phi = THREE.MathUtils.degToRad(90 - elev), th = THREE.MathUtils.degToRad(az);
    this.sunDir.setFromSphericalCoords(1, phi, th);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.sun.position.copy(this.sunDir).multiplyScalar(150);
    this.sun.target.position.set(0, 0, 0);
    this.sun.intensity = on ? 0.08 : 4.2;
    this.sun.color.set(on ? 0x8aa0ff : 0xfff1dd);
    this.hemi.intensity = on ? 0.1 : 1.3;
    this.renderer.toneMappingExposure = on ? 1.1 : 0.62;
    this.scene.fog.color.set(on ? 0x0b0f16 : 0xaab6c0);
    this.scene.fog.density = on ? 0.0035 : 0.0008;
    this.sky.visible = !on;
    this.updateEnv();
    this.particles.mat.uniforms.light.value = on ? 0.16 : 1.0;
    this.scene.background = on ? new THREE.Color(0x05070c) : null;
    for (const l of this.hallLights) l.material.emissiveIntensity = on ? 3 : 0.4;
    for (const L of this.hallPL) L.intensity = on ? 260 : 60;
    for (const y of this.yardLights) { y.lens.material.emissiveIntensity = on ? 4 : 0; y.L.intensity = on ? 380 : 0; }
    this.M.window.emissive.set(on ? 0xffffff : 0x000000); this.M.window.emissiveIntensity = on ? 0.9 : 0;
    this.crWindow.material.emissive.set(on ? 0xffffff : 0x000000); this.crWindow.material.emissiveIntensity = on ? 1.1 : 0;
    this.bloom.strength = on ? 0.45 : 0.3;
  }

  updateEnv() {
    const pm = this._pmrem || (this._pmrem = new THREE.PMREMGenerator(this.renderer));
    const es = new THREE.Scene();
    const sky = new Sky(); sky.scale.setScalar(1000); es.add(sky);
    Object.entries(this.sky.material.uniforms).forEach(([k, u]) => { if (sky.material.uniforms[k]) sky.material.uniforms[k].value = u.value.clone ? u.value.clone() : u.value; });
    if (this.night) { es.background = new THREE.Color(0x0a0d14); sky.visible = false; }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({ color: this.night ? 0x050505 : 0x6a675f })); ground.rotation.x = -Math.PI / 2; ground.position.y = -1; es.add(ground);
    if (this._envRT) this._envRT.dispose();
    this._envRT = pm.fromScene(es, 0.02);
    this.scene.environment = this._envRT.texture;
    this.scene.environmentIntensity = this.night ? 0.2 : 0.38;
  }

  setXray(on) {
    this.xray = on;
    for (const m of [this.M.casingX]) { m.transparent = on; m.opacity = on ? 0.12 : 1; m.depthWrite = !on; m.needsUpdate = true; }
    this.boilerInner.visible = on;
    this.drumMesh.material.opacity = on ? 0.18 : 1; this.drumMesh.material.depthWrite = !on;
    this.drumWater.visible = on;
  }

  setLabels(on) { for (const t of this.tags || []) t.visible = on; }
  setRoof(on) { for (const r of this.hallRoof) r.visible = on; }

  // -------------------------------------------------------------- per-frame update from simulation
  update(sim, dt, ts) {
    const t = (this.time += dt);
    const M = this.M;
    const fu = sim.furn, b = sim.bms, dr = sim.drum, tb = sim.tb, cd = sim.cond;
    // flames
    const mainP = b.mainFlame ? clampS(0.35 + fu.firing * 0.75, 0, 1.2) : 0;
    const pilotP = b.pilotFlame ? 1 : 0;
    const flick = 0.92 + 0.08 * Math.sin(t * 31) * Math.sin(t * 17.3);
    this.fireMat.uniforms.uTime.value = t;
    this.fireMat.uniforms.uPower.value = Math.max(mainP, pilotP * 0.6) * flick;
    this.fireMat.uniforms.uLambda.value = fu.lambda;
    this.flame.visible = mainP > 0.01;
    const len = 0.5 + 0.7 * clampS(fu.firing, 0, 1.2) * (fu.lambda > 1.6 ? 0.8 : 1) * (fu.lambda < 1 ? 1.25 : 1);
    this.flame.scale.set(0.7 + 0.4 * fu.firing, len, 0.7 + 0.4 * fu.firing);
    this.pilotFlame.visible = pilotP > 0 && !b.mainFlame;
    const heat = mainP + pilotP * 0.1;
    this.flameLight.intensity = this.xray ? (heat * 2600 + (fu.T > 400 ? (fu.T - 400) * 2 : 0)) * flick : 0;
    this.burnerGlowLight.intensity = heat * 6 * flick * (this.night ? 3 : 1);
    // refractory glow based on furnace temperature
    const glowK = clampS((fu.T - 450) / 700, 0, 1);
    const pc = new THREE.Color().setRGB(1.0 * (heat + glowK) * 3 * flick, 0.55 * (heat + glowK * 0.6) * 3 * flick, 0.15 * heat * 2);
    for (const p of this.peep) p.material.color.copy(pc);
    // waterwall / SH tube incandescence in x-ray mode
    const shT = sim.sh.Tm;
    const glow = clampS((shT - 480) / 300, 0, 1);
    this.shTubeMat.emissive.setRGB(glow * 1.6, glow * glow * 0.5, 0);
    // drum water level (x-ray) & gauge glass (true level)
    const lvl = dr.level;
    const ggF = clampS((lvl + 650) / 1300, 0, 1);
    this.ggWater.scale.y = Math.max(0.001, ggF * 1.3);
    this.ggWater.position.y = -0.65 + ggF * 0.65;
    this.ggWater.material.emissiveIntensity = 0.8 + 0.4 * Math.sin(t * 9) * clampS(fu.firing, 0, 1) * 0.3;
    if (this.drumWater.visible && Math.abs(this.drumWater.userData.lvl - lvl) > 6) {
      this.drumWater.userData.lvl = lvl;
      const R = 0.78, h = clampS(lvl / 1000 + 0.8, 0.02, 1.58);
      const a = Math.acos(clampS((h - R) / R, -1, 1));
      // segment below the water surface: angle measured from +y, from a through the bottom (pi) to 2pi - a
      const pts = [];
      for (let k = 0; k <= 32; k++) { const th = a + (2 * Math.PI - 2 * a) * k / 32; pts.push(new THREE.Vector2(Math.sin(th) * R, Math.cos(th) * R)); }
      const shape = new THREE.Shape(pts);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 9.8, bevelEnabled: false, curveSegments: 4 });
      geo.translate(0, 0, -4.9); geo.rotateY(Math.PI / 2);
      this.drumWater.geometry.dispose(); this.drumWater.geometry = geo;
    }
    // valve animations
    const stem = (v, pos, turns = 6) => { if (!v) return; v.stem.position.y = v.y0 + pos * v.size * 0.6; if (v.wheel) v.wheel.rotation.z = pos * turns * Math.PI * 2; if (v.g.userData.indicator) v.g.userData.indicator.position.y = -v.size * 0.35 + pos * v.size * 0.6; };
    stem(this.ventObj, sim.vent.pos); stem(this.drainObj, sim.drain.pos); stem(this.cbdObj, sim.cbd.pos); stem(this.ibdObj, sim.ibd.pos);
    stem(this.drumVentObj, sim.drumVent.pos); stem(this.fwcvObj, sim.fwcv.pos); stem(this.fwbpObj, sim.fwbp.pos); stem(this.fcvObj, sim.fcv.pos);
    stem(this.sprayObj, sim.spray.pos); stem(this.lcvObj, sim.cpLcv.pos); stem(this.makeupObj, cd.makeup.pos); stem(this.vbObj, cd.vacBreaker.pos);
    stem(this.damperObj, sim.damper.pos); stem(this.recircObj, sim.fw.recirc.pos); stem(this.ervObj, sim.erv.open ? 1 : 0); stem(this.pegObj, sim.da.peg / 4);
    this.ssovObjs.forEach(v => stem(v, sim.fuel.ssov ? 1 : 0));
    this.msvStem.position.y = 3.4 + tb.msvPos * 0.6;
    this.gvStems.forEach((s, i) => { const p = clampS(tb.gv.pos * 4 - i * 0.9, 0, 1) * tb.msvPos; s.position.y = this.cy + 3.2 + p * 0.45; });
    this.tripHandle.rotation.z = tb.latched ? 0 : 0.7;
    // rotating machinery
    const rps = tb.rpm / 60;
    const ang = (this._shaftAng = ((this._shaftAng || 0) + rps * Math.PI * 2 * dt * ts) % (Math.PI * 2));
    const blur = clampS((tb.rpm - 150) / 400, 0, 1);
    for (const c of this.couplings) c.rotation.x = blur > 0.98 ? t * 7.3 : ang;
    for (const d of this.blurDisc) d.material.opacity = blur * 0.92;
    this.fdImpeller.rotation.z -= sim.fd.speed * 2 * Math.PI * 14 * dt * Math.min(ts, 1) * (sim.fd.speed > 0.7 ? 0.23 : 1);
    const spin = (obj, speed, axis = 'x') => { if (obj) obj.coup.rotation[axis] += speed * dt * 60 * (speed > 0.6 ? 0.13 : 1); };
    sim.bfp.forEach((p, i) => { spin(this.bfpObjs[i], p.speed); this.setLamp(this.bfpObjs[i].lamp, p.tripped ? 'trip' : p.speed > 0.05 ? 'run' : 'stop'); });
    sim.cp.forEach((p, i) => { spin(this.cpObjs[i], p.speed, 'y'); this.setLamp(this.cpObjs[i].lamp, p.speed > 0.05 ? 'run' : 'stop'); });
    [cd.cwA, cd.cwB].forEach((on, i) => { spin(this.cwObjs[i], on ? 1 : 0, 'y'); this.setLamp(this.cwObjs[i].lamp, on ? 'run' : 'stop'); });
    spin(this.aopObj, tb.lube.aop ? 1 : 0); this.setLamp(this.aopObj.lamp, tb.lube.aop ? 'run' : 'stop');
    spin(this.dcopObj, tb.lube.dcop ? 1 : 0); this.setLamp(this.dcopObj.lamp, tb.lube.dcop ? 'run' : 'stop');
    spin(this.vpObjs[0], cd.vacPump ? 1 : 0); this.setLamp(this.vpObjs[0].lamp, cd.vacPump ? 'run' : 'stop');
    spin(this.vpObjs[1], cd.hogger ? 1 : 0); this.setLamp(this.vpObjs[1].lamp, cd.hogger ? 'run' : 'stop');
    this.setLamp(this.fdLamp, sim.fd.run ? 'run' : 'stop');
    this.setLamp(this.tgLamp, tb.tgEngaged ? 'run' : 'stop');
    this.setLamp(this.brkLamp, sim.gen.breaker ? 'run' : 'stop');
    const ctSpeed = cd.cwFlow > 100 ? 1 : 0;
    for (const f of this.ctFans) f.rotation.y += ctSpeed * dt * 4.5;
    // gauges
    this.gDrum.set(dr.p); this.gMS.set(sim.sh.p); this.gDA.set(sim.da.p); this.gTach.set(tb.rpm);
    this.gBfp[0].set(sim.bfp[0].speed > 0.05 ? sim.fw.pDis : sim.da.p + 0.15); this.gBfp[1].set(sim.bfp[1].speed > 0.05 ? sim.fw.pDis : sim.da.p + 0.15);
    this.gFw.set(sim.fw.pDis); this.gGas.set(sim.env.gasP); this.gLube.set(tb.lube.p); this.gVac.set((cd.p - 0.1013) * 1000);
    this.gFurnP.set(fu.pres);
    this.daGlass.scale.y = clampS(sim.da.level / 100, 0.01, 1) * 2.2; this.daGlass.position.y = -1.1 + this.daGlass.scale.y / 2;
    this.hwGlass.scale.y = clampS(cd.hwLevel / 100, 0.01, 1) * 1.6; this.hwGlass.position.y = -0.8 + this.hwGlass.scale.y / 2;
    this.diaph.forEach(d => d.visible = !cd.diaphragm);
    // alarm beacon & aviation light
    const anyUnack = sim.alarmUnack;
    const rot = t * 6;
    this.beacon.material.emissiveIntensity = anyUnack ? 4 : 0;
    this.beaconLight.intensity = anyUnack ? 400 : 0;
    this.beaconLight.target.position.set(3 + Math.cos(rot) * 5, 0, 15 + Math.sin(rot) * 5);
    this.aviation.material.color.setRGB(Math.sin(t * 3) > 0.3 ? 3 : 0.15, 0, 0);
    // crane slow drift for life
    this.crane.position.x = 16 + Math.sin(t * 0.02) * 6;

    // ----- particles
    const P = this.particles, wind = this.wind;
    const em = (pos, rate, f) => { this._acc = this._acc || {}; const k = f.key; this._acc[k] = (this._acc[k] || 0) + rate * dt; while (this._acc[k] >= 1) { this._acc[k] -= 1; f.fn(pos); } };
    const steamJet = (pos, rate, vel, size, key, life = 3.5) => em(pos, rate, { key, fn: p => P.emit(p, vel, { color: [0.95, 0.96, 0.98], alpha: 0.55, size, grow: size * 1.6, life, drag: 0.9, buoy: 2.0, spread: vel.length() * 0.18, jitter: 0.2 }) });
    // safety valves
    sim.svs.forEach((sv, i) => { if (sv.open || sv.q > 0.1) steamJet(this.svObjs[i].tip, 140, V3(0, 34, 0), 0.6, 'sv' + i, 3); this.svObjs[i].lever.rotation.x = sv.open ? -0.3 : 0; });
    if (sim.vent.pos > 0.02 && sim.sh.p > 0.12) steamJet(this.ventTip, 25 + 140 * sim.vent.pos * clampS(sim.sh.p / 3, 0.2, 1), V3(0, 9 + 10 * sim.vent.pos, 0), 1.0, 'vent', 4.5);
    if (sim.erv.open) steamJet(this.ervTip, 110, V3(0, 26, 0), 0.5, 'erv', 3);
    if (sim.drumVent.pos > 0.02 && dr.p > 0.11) steamJet(this.drumVentTip, 20 * sim.drumVent.pos + 6, V3(0, 6, 0), 0.25, 'dv', 2.5);
    if ((sim.ibd.pos > 0.05 || sim.cbd.pos > 0.3) && dr.p > 0.2) steamJet(this.bdTankTip, 30 * (sim.ibd.pos + sim.cbd.pos * 0.3), V3(0, 6, 0), 0.6, 'bd', 3);
    if (sim.sh.qdrain > 0.05) steamJet(this.drainTip, 12 * Math.min(sim.sh.qdrain, 2), V3(0.5, 1.5, 0), 0.25, 'drain', 2);
    if (sim.da.p > 0.12) steamJet(this.daVentTip, 6, V3(0, 3, 0), 0.25, 'davent', 2.2);
    if (cd.diaphragm && (tb.q > 0.5)) steamJet(this.diaphTip, 80, V3(0, 12, 0), 0.8, 'diaph', 3);
    if (sim.fault.tubeLeak > 0.5) steamJet(V3(-24 + 5.1, 9 + Math.random() * 6, Math.random() * 4 - 2), 8 + sim.fault.tubeLeak * 3, V3(4, 3, 0), 0.5, 'leak', 3);
    // stack: exhaust is a faint condensing plume (gas firing) or black smoke when running rich
    const fl = sim.air.flow;
    if (fl > 1) {
      const smoke = fu.smoke;
      const cold = clampS((15 - sim.env.Tamb) / 25, 0, 1) * 0.3 + 0.12;
      const alpha = smoke > 0.05 ? 0.3 + smoke * 0.5 : cold * clampS(fu.firing, 0, 1) + 0.04;
      const col = smoke > 0.05 ? [0.12, 0.11, 0.1].map(c => c + (1 - smoke) * 0.6) : [0.92, 0.93, 0.95];
      em(this.stackTip, 6 + fl * 0.6, { key: 'stack', fn: p => P.emit(p, V3(0, 4 + fl * 0.12, 0), { color: col, alpha, size: 2.2, grow: 3.5, life: 9, drag: 0.35, buoy: 0.6, spread: 1.2, jitter: 1.2 }) });
    }
    // cooling tower plumes
    if (cd.cwFlow > 100) this.ctTips.forEach((p, i) => em(p, 5 + cd.Q / 6000, { key: 'ct' + i, fn: q => P.emit(q, V3(0, 5 + Math.random() * 2, 0), { color: [0.93, 0.94, 0.96], alpha: 0.28 + clampS(cd.Q / 60000, 0, 1) * 0.25, size: 3, grow: 3, life: 8, drag: 0.4, buoy: 0.5, spread: 1.5, jitter: 4 }) }));
    P.update(dt, wind);

    // camera shake from vibration and events
    const camDist = this.camera.position.distanceTo(V3(16, this.cy, 0));
    const vibShake = clampS((tb.vib - 60) / 400, 0, 0.25) / Math.max(1, camDist / 8);
    this.shake = Math.max(this.shake * Math.exp(-dt * 3), vibShake);
    if (this.walk && this.walk.enabled) this.walk.update(dt); else this.controls.update();
    const sh = this.shake;
    const off = V3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    this.camera.position.add(off);
    this.composer.render();
    this.labels.render(this.scene, this.camera);
    this.camera.position.sub(off);
  }

  setLamp(lamp, state) {
    const c = state === 'run' ? 0xff2a1a : state === 'trip' ? 0xffb000 : 0x22dd44; // power-plant convention: red = running/closed, green = stopped/open
    if (lamp.userData.state === state) return;
    lamp.userData.state = state;
    lamp.material.emissive.setHex(c); lamp.material.emissiveIntensity = 2.5; lamp.material.color.setHex(c);
  }

  // big transient effects
  flash(pos, color, intensity, size) {
    const L = new THREE.PointLight(color, intensity, size * 6, 2); L.position.copy(pos); this.scene.add(L);
    const t0 = this.time;
    const tick = () => { const k = this.time - t0; L.intensity = intensity * Math.exp(-k * 3); if (k < 2) requestAnimationFrame(tick); else this.scene.remove(L); };
    tick();
  }
  burst(pos, n, color, speed, size, life, buoy = 0.5) {
    for (let i = 0; i < n; i++) {
      const d = V3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      this.particles.emit(pos, d, { color, alpha: 0.7, size, grow: size, life, drag: 1.2, buoy, spread: 0, jitter: 1 });
    }
  }
  event(e) {
    const B = V3(-24, 10, 0);
    if (e.type === 'explosion') {
      const pos = e.what === 'turbine' ? V3(15, this.cy, 0) : e.what === 'tube' ? V3(-24, 10, 2) : B;
      const big = e.what !== 'tube';
      this.flash(pos, 0xffa040, big ? 400000 : 30000, big ? 40 : 10);
      this.burst(pos, big ? 400 : 120, [0.3, 0.28, 0.26], big ? 30 : 12, 2.5, 8, 0.8);
      this.burst(pos, big ? 200 : 80, [0.95, 0.95, 0.97], 18, 2, 6, 1.6);
      this.shake = big ? 1.8 : 0.5;
    } else if (e.type === 'puff') {
      this.flash(V3(-24, 6, 4.5), 0xff8030, 60000 * e.sev, 12); this.shake = 0.4 * e.sev;
      this.burst(V3(-24, 4.2, 6.5), 60, [0.3, 0.28, 0.25], 10, 1.2, 4, 0.8);
    } else if (e.type === 'lightoff') {
      this.flash(V3(-24, 4.2, 3), 0xffb060, 8000, 8);
    } else if (e.type === 'hammer') {
      this.shake = Math.max(this.shake, 0.25 * e.sev);
    } else if (e.type === 'badSync') {
      this.shake = Math.max(this.shake, 0.6 * e.sev); this.flash(V3(47, 4, 1), 0x9fd0ff, 50000, 10);
    } else if (e.type === 'svLift') {
      this.shake = Math.max(this.shake, 0.08);
    }
  }

  // ------------------------------------------------------------------ picking
  raycast(nx, ny) {
    const rc = this._rc || (this._rc = new THREE.Raycaster());
    rc.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hits = rc.intersectObjects(this.pick, true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.pickName) o = o.parent; if (o) return { id: o.userData.pickId, name: o.userData.pickName, point: h.point }; }
    return null;
  }
  focus(id) {
    const target = this.pick.find(p => p.userData.pickId === id);
    if (!target) return;
    const box = new THREE.Box3().setFromObject(target);
    const c = box.getCenter(V3(0, 0, 0)), s = box.getSize(V3(0, 0, 0)).length();
    this.flyTo(c, Math.max(4, s * 1.4));
  }
  flyTo(target, dist) {
    const from = this.controls.target.clone(), camFrom = this.camera.position.clone();
    const dir = camFrom.clone().sub(from).normalize();
    if (dir.y < 0.15) dir.y = 0.25;
    dir.normalize();
    const camTo = target.clone().addScaledVector(dir, dist);
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 900), e = k * k * (3 - 2 * k);
      this.controls.target.lerpVectors(from, target, e); this.camera.position.lerpVectors(camFrom, camTo, e);
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }
}

// First-person walk controls (pointer lock), with Q/E to rise/descend between platform levels
export class WalkControls {
  constructor(camera, dom) {
    this.camera = camera; this.dom = dom; this.enabled = false; this.keys = {}; this.yaw = 0; this.pitch = 0; this.eye = 1.7;
    this.onKey = e => { if (!this.enabled) return; this.keys[e.code] = e.type === 'keydown'; };
    this.onMove = e => { if (!this.enabled || document.pointerLockElement !== this.dom) return; this.yaw -= e.movementX * 0.0022; this.pitch = clampS(this.pitch - e.movementY * 0.0022, -1.45, 1.45); };
    addEventListener('keydown', this.onKey); addEventListener('keyup', this.onKey); addEventListener('mousemove', this.onMove);
  }
  enable(on) {
    this.enabled = on;
    if (on) {
      const d = new THREE.Vector3(); this.camera.getWorldDirection(d);
      this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(clampS(d.y, -1, 1));
      this.camera.position.y = Math.max(this.camera.position.y, this.eye);
      try { const p = this.dom.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* optional */ }
    } else if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }
  update(dt) {
    if (!this.enabled) return;
    const k = this.keys, sp = (k.ShiftLeft || k.ShiftRight ? 9 : 3.5) * dt;
    const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const u = (k.KeyE || k.Space ? 1 : 0) - (k.KeyQ || k.KeyC ? 1 : 0);
    const c = this.camera;
    c.position.x += (-Math.sin(this.yaw) * f + Math.cos(this.yaw) * s) * sp;
    c.position.z += (-Math.cos(this.yaw) * f - Math.sin(this.yaw) * s) * sp;
    c.position.y = Math.max(this.eye, c.position.y + u * sp * 0.8);
    c.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
