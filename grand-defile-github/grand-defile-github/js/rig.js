// Mannequin 3D stylisée construite entièrement en code, avec squelette d'articulations :
// hanches, genoux, chevilles, épaules, coudes, cou/tête. Chaque articulation est un Object3D
// pivot ; l'animation est procédurale (démarche de défilé + poses).
import * as THREE from 'three';
import { clamp, lerp, mulberry32, TAU } from './utils.js';

// --------------------------------------------------------------------------- géométries partagées
const geoCache = {};
function limbGeo(key, len, r0, rmid, r1, bulgeAt = 0.3) {
  if (geoCache[key]) return geoCache[key];
  const pts = [new THREE.Vector2(0.0001, r0 * 0.1)];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // rayon : r0 -> rmid (au bulgeAt) -> r1, interpolation douce
    const a = t < bulgeAt ? lerp(r0, rmid, Math.sin((t / bulgeAt) * Math.PI / 2)) : lerp(rmid, r1, Math.sin(((t - bulgeAt) / (1 - bulgeAt)) * Math.PI / 2));
    pts.push(new THREE.Vector2(a, -t * len));
  }
  pts.push(new THREE.Vector2(0.0001, -len - r1 * 0.2));
  const g = new THREE.LatheGeometry(pts, 20);
  g.computeVertexNormals();
  return (geoCache[key] = g);
}
function lathe(points, seg = 36) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.computeVertexNormals();
  return g;
}
const sphere = new THREE.SphereGeometry(1, 28, 20);
// tête : sphère dont le bas est resserré pour dessiner la mâchoire et le menton
const headGeo = (() => {
  const g = new THREE.SphereGeometry(1, 64, 48), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < 0.15) {
      const t = Math.min(1, (0.15 - y) / 1.15);
      const k = 1 - 0.34 * t * t - 0.08 * t;
      p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * (1 - 0.18 * t * t));
    }
  }
  g.computeVertexNormals();
  return g;
})();

// --------------------------------------------------------------------------- textures
export function hairTexture(base) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 260; i++) {
    const px = Math.random() * 128, a = Math.random();
    x.strokeStyle = a > 0.5 ? `rgba(255,255,255,${0.04 + Math.random() * 0.1})` : `rgba(0,0,0,${0.08 + Math.random() * 0.16})`;
    x.lineWidth = 0.6 + Math.random() * 1.4;
    x.beginPath(); x.moveTo(px, 0);
    x.bezierCurveTo(px + (Math.random() - 0.5) * 10, 80, px + (Math.random() - 0.5) * 10, 170, px + (Math.random() - 0.5) * 8, 256);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

export function faceTexture(o) {
  const W = 1024, H = 512, cx = 256, cy = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const rnd = mulberry32(o.seed);
  // peau
  x.fillStyle = o.skin; x.fillRect(0, 0, W, H);
  let g = x.createRadialGradient(cx, cy - 20, 10, cx, cy, 190);
  g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(60,20,10,0.10)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // joues
  for (const s of [-1, 1]) {
    g = x.createRadialGradient(cx + s * 78, cy + 52, 2, cx + s * 78, cy + 52, 52);
    g.addColorStop(0, o.blush + 'aa'); g.addColorStop(1, o.blush + '00');
    x.fillStyle = g; x.fillRect(cx + s * 78 - 60, cy + 52 - 60, 120, 120);
    // contour / ombre sous la pommette
    g = x.createRadialGradient(cx + s * 92, cy + 88, 2, cx + s * 92, cy + 88, 46);
    g.addColorStop(0, 'rgba(70,30,20,0.16)'); g.addColorStop(1, 'rgba(70,30,20,0)');
    x.fillStyle = g; x.fillRect(cx + s * 92 - 50, cy + 88 - 50, 100, 100);
  }
  // nez : ombres latérales + narines
  g = x.createLinearGradient(cx - 22, 0, cx + 22, 0);
  g.addColorStop(0, 'rgba(80,35,20,0.14)'); g.addColorStop(0.3, 'rgba(80,35,20,0)'); g.addColorStop(0.7, 'rgba(80,35,20,0)'); g.addColorStop(1, 'rgba(80,35,20,0.14)');
  x.fillStyle = g; x.fillRect(cx - 24, cy - 10, 48, 62);
  x.fillStyle = 'rgba(60,25,15,0.35)';
  for (const s of [-1, 1]) { x.beginPath(); x.ellipse(cx + s * 9, cy + 54, 4, 2.4, 0, 0, TAU); x.fill(); }
  // yeux
  for (const s of [-1, 1]) {
    const ex = cx + s * 60, ey = cy - 18;
    // fard à paupières
    g = x.createRadialGradient(ex, ey - 10, 2, ex, ey - 10, 36);
    g.addColorStop(0, o.shadow + 'cc'); g.addColorStop(1, o.shadow + '00');
    x.fillStyle = g; x.beginPath(); x.ellipse(ex, ey - 10, 38, 24, 0, 0, TAU); x.fill();
    // blanc
    x.fillStyle = '#f7f3f0';
    x.beginPath(); x.moveTo(ex - s * 30, ey + 2); x.quadraticCurveTo(ex, ey - 22, ex + s * 30, ey - 2);
    x.quadraticCurveTo(ex, ey + 14, ex - s * 30, ey + 2); x.fill();
    // iris
    x.save(); x.beginPath(); x.moveTo(ex - s * 30, ey + 2); x.quadraticCurveTo(ex, ey - 22, ex + s * 30, ey - 2);
    x.quadraticCurveTo(ex, ey + 14, ex - s * 30, ey + 2); x.clip();
    g = x.createRadialGradient(ex, ey - 2, 1, ex, ey - 2, 12);
    g.addColorStop(0, '#000'); g.addColorStop(0.4, o.eye); g.addColorStop(1, '#000');
    x.fillStyle = g; x.beginPath(); x.arc(ex, ey - 2, 12, 0, TAU); x.fill();
    x.fillStyle = '#05050a'; x.beginPath(); x.arc(ex, ey - 2, 5, 0, TAU); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.arc(ex + 4, ey - 7, 2.4, 0, TAU); x.fill();
    x.restore();
    // eye-liner + aile
    x.strokeStyle = '#08080c'; x.lineWidth = 4.2; x.lineCap = 'round';
    x.beginPath(); x.moveTo(ex - s * 30, ey + 2); x.quadraticCurveTo(ex, ey - 24, ex + s * 31, ey - 3); x.lineTo(ex + s * 40, ey - 12); x.stroke();
    x.lineWidth = 1.6;
    x.beginPath(); x.moveTo(ex - s * 28, ey + 3); x.quadraticCurveTo(ex, ey + 14, ex + s * 28, ey - 1); x.stroke();
    // cils
    x.lineWidth = 1.8;
    for (let i = 0; i < 9; i++) {
      const t = i / 8, px = lerp(ex - s * 24, ex + s * 30, t), py = ey - 14 * Math.sin(Math.PI * t) - 2 + 3 * t;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + s * (3 + t * 5), py - 8 - 3 * Math.sin(Math.PI * t)); x.stroke();
    }
    // sourcils
    x.strokeStyle = o.brow; x.lineWidth = 7; x.globalAlpha = 0.85;
    x.beginPath(); x.moveTo(ex - s * 34, ey - 36); x.quadraticCurveTo(ex + s * 4, ey - 56, ex + s * 44, ey - 38); x.stroke();
    x.globalAlpha = 1;
  }
  // bouche
  const my = cy + 92;
  x.fillStyle = o.lip;
  x.beginPath(); x.moveTo(cx - 36, my);
  x.bezierCurveTo(cx - 22, my - 17, cx - 6, my - 14, cx, my - 8);
  x.bezierCurveTo(cx + 6, my - 14, cx + 22, my - 17, cx + 36, my);
  x.bezierCurveTo(cx + 22, my + 20, cx - 22, my + 20, cx - 36, my); x.fill();
  x.strokeStyle = 'rgba(40,5,10,0.55)'; x.lineWidth = 1.6;
  x.beginPath(); x.moveTo(cx - 35, my); x.quadraticCurveTo(cx, my + 5, cx + 35, my); x.stroke();
  g = x.createRadialGradient(cx, my + 10, 1, cx, my + 10, 14);
  g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(cx - 16, my, 32, 22);
  // grain de beauté
  if (rnd() > 0.5) { x.fillStyle = 'rgba(40,15,10,0.7)'; x.beginPath(); x.arc(cx + 54, my - 24, 2.4, 0, TAU); x.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// Robe : teinte, saturation, luminosité, motif (0 rayures, 1 pois, 2 losanges, 3 zigzags)
export function dressTexture(look, canvas) {
  const c = canvas || document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const base = `hsl(${look.h},${look.s}%,${look.l}%)`;
  const acc = `hsl(${(look.h + 150) % 360},${Math.min(100, look.s + 10)}%,${clamp(look.l + (look.l > 50 ? -30 : 38), 8, 92)}%)`;
  x.fillStyle = base; x.fillRect(0, 0, 128, 128);
  x.fillStyle = acc; x.strokeStyle = acc;
  if (look.p === 0) { for (let i = 0; i < 128; i += 32) x.fillRect(i, 0, 14, 128); }
  else if (look.p === 1) { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.beginPath(); x.arc(16 + i * 32 + (j % 2) * 16, 16 + j * 32, 8, 0, TAU); x.fill(); } }
  else if (look.p === 2) { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const cx = 32 + i * 64, cy = 32 + j * 64; x.beginPath(); x.moveTo(cx, cy - 26); x.lineTo(cx + 18, cy); x.lineTo(cx, cy + 26); x.lineTo(cx - 18, cy); x.closePath(); x.fill(); } }
  else { x.lineWidth = 7; for (let j = 0; j < 5; j++) { x.beginPath(); for (let i = 0; i <= 8; i++) { const px = i * 16, py = j * 28 + (i % 2 ? 0 : 14); i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); } }
  // reflet satiné
  const g = x.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return c;
}

// --------------------------------------------------------------------------- matériaux
const goldMat = new THREE.MeshPhysicalMaterial({ color: 0xffc94d, metalness: 1, roughness: 0.18, clearcoat: 0.6, emissive: 0x3a2400, emissiveIntensity: 0.4 });
const skinMats = {};
function skinMat(color) {
  return skinMats[color] || (skinMats[color] = new THREE.MeshPhysicalMaterial({ color, roughness: 0.52, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffb09a), clearcoat: 0.08, clearcoatRoughness: 0.5 }));
}

// --------------------------------------------------------------------------- le rig
export class MannequinRig {
  constructor(o) {
    this.o = o;
    this.root = new THREE.Group();
    this.scaleBase = 1;
    const skin = skinMat(o.skin);
    const mesh = (geo, mat, parent, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = false; parent && parent.add(m); return m; };
    const pivot = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    const L = { thigh: 0.43, shin: 0.43, ankle: 0.105, upper: 0.275, fore: 0.25 };
    this.L = L;

    // ----- bassin / buste
    this.pelvis = pivot(this.root, 0, 0.965, 0);
    const pelvisGeo = lathe([[0.001, -0.07], [0.1, -0.06], [0.155, -0.015], [0.172, 0.05], [0.155, 0.13], [0.118, 0.2]]);
    const pelvisM = mesh(pelvisGeo, skin, this.pelvis); pelvisM.scale.z = 0.72;
    this.chest = pivot(this.pelvis, 0, 0.2, 0);
    const chestGeo = lathe([[0.001, 0.0], [0.118, 0.0], [0.13, 0.05], [0.152, 0.12], [0.158, 0.18], [0.162, 0.235], [0.135, 0.29], [0.06, 0.318], [0.001, 0.322]]);
    const chestM = mesh(chestGeo, skin, this.chest); chestM.scale.z = 0.66;

    // ----- robe (jupe + buste + bretelles)
    const dressCanvas = document.createElement('canvas');
    this.dressTex = new THREE.CanvasTexture(dressTexture({ h: 330, s: 80, l: 55, p: 0 }, dressCanvas));
    this.dressCanvas = dressCanvas;
    this.dressTex.colorSpace = THREE.SRGBColorSpace; this.dressTex.wrapS = this.dressTex.wrapT = THREE.RepeatWrapping;
    this.dressTex.repeat.set(3, 2); this.dressTex.anisotropy = 4;
    this.dressMat = new THREE.MeshPhysicalMaterial({
      map: this.dressTex, emissiveMap: this.dressTex, emissive: 0xffffff, emissiveIntensity: 0.0,
      roughness: 0.34, metalness: 0.05, sheen: 0.8, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.3, side: THREE.DoubleSide,
    });
    const skirtGeo = lathe([[0.001, -0.3], [0.232, -0.3], [0.222, -0.27], [0.2, -0.18], [0.186, -0.08], [0.18, 0.0], [0.178, 0.07], [0.162, 0.14], [0.124, 0.2], [0.121, 0.205]]);
    const skirt = mesh(skirtGeo, this.dressMat, this.pelvis); skirt.scale.z = 0.8; skirt.scale.x = 1.0;
    const bodiceGeo = lathe([[0.121, -0.005], [0.133, 0.05], [0.157, 0.12], [0.166, 0.17], [0.162, 0.2]]);
    const bodice = mesh(bodiceGeo, this.dressMat, this.chest); bodice.scale.z = 0.72;
    // bandeau doré à la taille
    const belt = mesh(new THREE.TorusGeometry(0.128, 0.007, 8, 40), goldMat, this.pelvis); belt.rotation.x = Math.PI / 2; belt.position.y = 0.2; belt.scale.set(1, 0.74, 1);
    this.belt = belt;
    for (const s of [-1, 1]) {
      const strap = mesh(new THREE.CapsuleGeometry(0.008, 0.12, 4, 8), this.dressMat, this.chest);
      strap.position.set(s * 0.06, 0.255, 0.098); strap.rotation.set(-0.12, 0, s * 0.22);
    }

    // ----- cou, tête
    const neck = mesh(new THREE.CylinderGeometry(0.037, 0.047, 0.12, 16), skin, this.chest);
    neck.position.y = 0.33;
    this.neckPivot = pivot(this.chest, 0, 0.375, 0);
    this.head = pivot(this.neckPivot, 0, 0.0, 0.0);
    const faceTex = faceTexture(o.face);
    const headM = mesh(headGeo, new THREE.MeshPhysicalMaterial({ map: faceTex, roughness: 0.5, sheen: 0.5, sheenColor: new THREE.Color(0xffb09a), clearcoat: 0.1, clearcoatRoughness: 0.4 }), this.head);
    headM.scale.set(0.086, 0.108, 0.096); headM.position.y = 0.082;
    // sphere : face = +Z à u=0.25 => tourner pour que u=0.25 soit devant (déjà le cas)
        const nose = mesh(sphere, skin, this.head); nose.scale.set(0.009, 0.014, 0.014); nose.position.set(0, 0.075, 0.094);
    for (const s of [-1, 1]) {
      const ear = mesh(sphere, skin, this.head); ear.scale.set(0.008, 0.02, 0.013); ear.position.set(s * 0.085, 0.082, -0.005);
      const ring = mesh(new THREE.SphereGeometry(0.009, 12, 10), goldMat, this.head); ring.position.set(s * 0.088, 0.058, -0.005);
      const drop = mesh(new THREE.CapsuleGeometry(0.006, 0.03, 4, 8), goldMat, this.head); drop.position.set(s * 0.088, 0.032, -0.005);
    }
    // collier
    const neck2 = mesh(new THREE.TorusGeometry(0.052, 0.0045, 8, 32), goldMat, this.chest); neck2.position.set(0, 0.315, 0.012); neck2.rotation.x = Math.PI / 2 - 0.25;
    const pend = mesh(new THREE.OctahedronGeometry(0.014, 0), goldMat, this.chest); pend.position.set(0, 0.272, 0.062);

    // ----- cheveux longs
    const hairTex = hairTexture(o.hair);
    this.hairMat = new THREE.MeshPhysicalMaterial({ map: hairTex, bumpMap: hairTex, bumpScale: 0.4, roughness: 0.38, metalness: 0.0, sheen: 1, sheenColor: new THREE.Color(o.hairSheen), sheenRoughness: 0.35, clearcoat: 0.25, clearcoatRoughness: 0.25, side: THREE.DoubleSide });
    this.hairPivot = pivot(this.head, 0, 0.082, -0.005);
    const sideHair = new THREE.SphereGeometry(1, 32, 22, Math.PI / 2 + 0.95, TAU - 1.9, 0, 2.15);
    const hsp = mesh(sideHair, this.hairMat, this.hairPivot); hsp.scale.set(0.094, 0.118, 0.104);
    const topHair = new THREE.SphereGeometry(1, 32, 16, 0, TAU, 0, 0.98);
    const htp = mesh(topHair, this.hairMat, this.hairPivot); htp.scale.set(0.095, 0.119, 0.105); htp.position.y = 0.002;
    // la longue chevelure : coque ouverte devant, suspendue dans le dos
    const hp = []; const N = 14;
    for (let i = 0; i <= N; i++) { const t = i / N; hp.push(new THREE.Vector2(0.095 + 0.03 * Math.sin(t * 2.6) - 0.045 * t * t * t, -0.045 - t * 0.62)); }
    hp.push(new THREE.Vector2(0.001, -0.67));
    const longGeo = new THREE.LatheGeometry(hp, 28, 0.8, TAU - 1.6);
    longGeo.computeVertexNormals();
    this.hairLong = pivot(this.hairPivot, 0, 0, 0);
    const hl = mesh(longGeo, this.hairMat, this.hairLong); hl.scale.set(1.25, 1, 0.8); hl.position.z = -0.03;

    // ----- jambes
    this.legs = [];
    for (const s of [1, -1]) {
      const hip = pivot(this.pelvis, s * 0.088, 0.0, 0);
      const thigh = mesh(limbGeo('thigh', L.thigh, 0.07, 0.066, 0.047, 0.25), skin, hip);
      const kneeJ = pivot(hip, 0, -L.thigh, 0);
      const kneeBall = mesh(sphere, skin, kneeJ); kneeBall.scale.setScalar(0.044);
      const shin = mesh(limbGeo('shin', L.shin, 0.047, 0.053, 0.03, 0.22), skin, kneeJ);
      const ankleJ = pivot(kneeJ, 0, -L.shin, 0);
      const foot = pivot(ankleJ, 0, 0, 0);
      const shoeMat = new THREE.MeshPhysicalMaterial({ color: o.shoe, roughness: 0.18, metalness: o.shoe === 0xd4a017 ? 0.9 : 0.1, clearcoat: 1, clearcoatRoughness: 0.08 });
      const toe = mesh(sphere, shoeMat, foot); toe.scale.set(0.034, 0.028, 0.09); toe.position.set(0, -0.012, 0.075);
      const inst = mesh(sphere, shoeMat, foot); inst.scale.set(0.033, 0.03, 0.07); inst.position.set(0, 0.0, -0.005);
      const heelP = pivot(foot, 0, -0.02, -0.048);
      const heel = mesh(new THREE.CylinderGeometry(0.013, 0.006, 0.122, 10), shoeMat, heelP); heel.position.y = -0.061;
      const sole = mesh(new THREE.TorusGeometry(0.0, 0.0, 3, 3), shoeMat, foot, false); sole.visible = false;
      // bracelet de cheville
      const anklet = mesh(new THREE.TorusGeometry(0.032, 0.0035, 6, 20), goldMat, kneeJ); anklet.position.y = -L.shin + 0.045; anklet.rotation.x = Math.PI / 2;
      this.legs.push({ s, hip, kneeJ, ankleJ, foot, heelP });
    }

    // ----- bras
    this.arms = [];
    for (const s of [1, -1]) {
      const sh = pivot(this.chest, s * 0.172, 0.245, 0);
      const ball = mesh(sphere, skin, sh); ball.scale.setScalar(0.04);
      const upper = mesh(limbGeo('upper', L.upper, 0.043, 0.04, 0.034, 0.3), skin, sh);
      const el = pivot(sh, 0, -L.upper, 0);
      const eb = mesh(sphere, skin, el); eb.scale.setScalar(0.031);
      const fore = mesh(limbGeo('fore', L.fore, 0.034, 0.033, 0.024, 0.2), skin, el);
      const wrist = pivot(el, 0, -L.fore, 0);
      const palm = mesh(sphere, skin, wrist); palm.scale.set(0.03, 0.045, 0.012); palm.position.y = -0.04;
      for (let f = 0; f < 4; f++) {
        const fin = mesh(new THREE.CapsuleGeometry(0.0065, f === 1 || f === 2 ? 0.05 : 0.04, 3, 6), skin, wrist);
        fin.position.set((f - 1.5) * 0.0145 * s * -1, -0.1, 0); fin.rotation.z = (f - 1.5) * 0.06 * s;
        const nail = mesh(sphere, redNail, fin, false); nail.scale.set(0.0058, 0.008, 0.003); nail.position.set(0, -0.03, 0.0055);
      }
      const thumb = mesh(new THREE.CapsuleGeometry(0.0075, 0.035, 3, 6), skin, wrist); thumb.position.set(s * 0.03, -0.05, 0.006); thumb.rotation.z = s * 0.7;
      const bracelet = mesh(new THREE.TorusGeometry(0.027, 0.005, 8, 20), goldMat, wrist); bracelet.rotation.x = Math.PI / 2; bracelet.position.y = -0.003;
      const ring = mesh(new THREE.TorusGeometry(0.0085, 0.0022, 6, 12), goldMat, wrist); ring.position.set(0.0145 * s * 0.5, -0.075, 0); ring.rotation.y = Math.PI / 2;
      this.arms.push({ s, sh, el, wrist });
    }

    // ----- étiquette flottante
    this.labelCanvas = document.createElement('canvas'); this.labelCanvas.width = 512; this.labelCanvas.height = 128;
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas); this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTex, transparent: true, depthTest: false, depthWrite: false }));
    this.label.scale.set(0.9, 0.225, 1); this.label.position.y = 2.12; this.label.renderOrder = 10;
    this.root.add(this.label);
    this.setLabel(o.name);

    // ressort des cheveux
    this.hairSpring = { x: 0, v: 0, z: 0, vz: 0 };
    this.armPose = { l: 0, r: 0 }; this.smoothed = {};
  }

  setDress(look) {
    dressTexture(look, this.dressCanvas);
    this.dressTex.needsUpdate = true;
    this.dressMat.emissive.set(`hsl(${look.h},${Math.min(100, look.s)}%,${clamp(look.l, 25, 70)}%)`);
  }

  // étiquette flottante : prénom (précédé de ♛ pour une élite)
  setLabel(name, tag = '') {
    const x = this.labelCanvas.getContext('2d');
    x.clearRect(0, 0, 512, 128);
    x.fillStyle = 'rgba(10,6,16,0.62)';
    x.beginPath(); x.roundRect(6, 14, 500, 100, 26); x.fill();
    x.strokeStyle = 'rgba(255,205,110,0.9)'; x.lineWidth = 3; x.stroke();
    x.fillStyle = '#fff'; x.font = 'italic 600 46px "Palatino Linotype", Georgia, serif'; x.textBaseline = 'middle'; x.textAlign = 'center';
    x.fillText((tag ? tag + ' ' : '') + name, 256, 66);
    x.textAlign = 'left';
    this.labelTex.needsUpdate = true;
  }

  setScale(s) { this.root.scale.setScalar(s); this.scaleBase = s; }

  // ------------------------------------------------------------------------------ animation
  // st : { phase, walk(0..1), sway(0..1), grace, poseType, pose(0..1), poseLeg, lookYaw, lookGain, beat, speed, turn, dt }
  animate(st) {
    const { phase, walk, grace } = st;
    const p = st.pose, w = walk * (1 - p);
    const A = 0.43 * w, K = 1.0 * w;
    let depthMax = 0;
    const lerpJ = lerp;

    for (const lg of this.legs) {
      const s = lg.s;
      const ph = phase + (s > 0 ? 0 : Math.PI);
      const fwd = Math.sin(ph);
      // marche : flexion de hanche, genou en phase d'oscillation, croisement des jambes
      let hipX = -A * fwd - 0.04 * w;
      let knee = 0.05 + K * Math.max(0, Math.cos(ph)) * 0.95 * (0.55 + 0.45 * Math.max(0, fwd + 0.6));
      let hipZ = -s * (0.025 + 0.2 * w * (0.4 + 0.6 * Math.max(0, fwd))) * (0.7 + 0.5 * grace) + s * 0.015;
      // pose : jambe d'appui droite, jambe libre en avant et sur le côté
      const free = s === st.poseLeg;
      const pHipX = free ? -0.24 : -0.02, pKnee = free ? 0.18 : 0.03, pHipZ = free ? s * 0.16 : -s * 0.02;
      hipX = lerpJ(hipX, pHipX, p); knee = lerpJ(knee, pKnee, p); hipZ = lerpJ(hipZ, pHipZ, p);
      lg.hip.rotation.set(hipX, 0, hipZ);
      lg.kneeJ.rotation.set(knee, 0, 0);
      const worldPitch = hipX + knee;
      const ankle = 0.78 - worldPitch * (free && p > 0.5 ? 0.9 : 0.85);
      lg.ankleJ.rotation.set(ankle - 0.0, 0, 0);
      lg.heelP.rotation.set(-(hipX + knee + ankle), 0, 0);
      const alpha = -hipX;
      const depth = (this.L.thigh * Math.cos(alpha) + this.L.shin * Math.cos(alpha - knee)) * Math.cos(hipZ);
      lg._depth = depth; depthMax = Math.max(depthMax, depth);
    }
    // le bassin se place pour que le pied d'appui touche le podium
    const baseY = this.L.ankle + depthMax;
    this.pelvis.position.y = baseY + 0.012 * Math.cos(phase * 2) * w * grace;

    // balancement des hanches (catwalk) + contre-rotation des épaules
    const sway = st.sway * grace;
    const hipYaw = 0.2 * sway * Math.sin(phase) * w;
    const hipRoll = 0.075 * sway * Math.cos(phase) * w;
    // pose : hanche cassée (contrapposto) du côté de la jambe libre
    const cont = st.poseLeg * 0.09 * p;
    this.pelvis.rotation.set(0.0, hipYaw, hipRoll + cont * 0.8);
    this.pelvis.position.x = 0.035 * sway * Math.sin(phase + Math.PI / 2) * w - cont * 0.15;
    this.chest.rotation.set(0.03 * w, -hipYaw * 0.9, -hipRoll * 0.9 - cont * 1.1);

    // bras
    const swing = 0.3 * w;
    for (const a of this.arms) {
      const s = a.s;
      const ph = phase + (s > 0 ? Math.PI : 0);
      let shX = -swing * Math.sin(ph) * 0.8 - 0.05, shZ = s * (0.11 + 0.05 * w), elX = -(0.18 + 0.2 * w * Math.max(0, Math.cos(ph))), elZ = 0;
      let wr = 0;
      // poses
      const pz = st.poseType;
      let tgt = null;
      const hip = (s0) => ({ shX: -0.12, shZ: s0 * 0.62, elX: -0.55, elZ: -s0 * 1.0, wr: 0.2 });
      const hair = (s0) => ({ shX: -1.15, shZ: s0 * 0.28, elX: -2.05, elZ: -s0 * 0.35, wr: -0.35 });
      const relax = (s0) => ({ shX: -0.06, shZ: s0 * 0.14, elX: -0.22, elZ: 0, wr: 0.1 });
      const side = s === st.poseSide ? 1 : 0;
      if (pz === 0) tgt = side ? hip(s) : relax(s);
      else if (pz === 1) tgt = side ? hair(s) : hip(s);
      else tgt = hip(s);
      shX = lerpJ(shX, tgt.shX, p); shZ = lerpJ(shZ, tgt.shZ, p); elX = lerpJ(elX, tgt.elX, p); elZ = lerpJ(elZ, tgt.elZ, p); wr = tgt.wr * p;
      a.sh.rotation.set(shX, 0, shZ);
      a.el.rotation.set(elX, 0, elZ);
      a.wrist.rotation.set(wr, 0, -s * 0.1 * p);
    }

    // cou / tête : regard vers le VIP ou le flash, tête relevée et menton haut
    const hy = clamp(st.lookYaw, -1.1, 1.1) * st.lookGain;
    this.head.rotation.set(-0.05 + 0.1 * p, hy * 0.75 + 0.05 * p * st.poseLeg, -hipRoll * 0.6 + 0.06 * p * st.poseLeg);
    this.neckPivot.rotation.set(0, hy * 0.25, 0);

    // cheveux : ressort amorti, poussés vers l'arrière par la vitesse et par le balancement
    const hs = this.hairSpring, dt = Math.min(st.dt, 0.05);
    const targetX = -0.05 - 0.35 * st.speed + 0.12 * Math.sin(phase * 2) * w;
    const targetZ = -hipYaw * 0.8 + 0.5 * (st.turn || 0);
    hs.v += ((targetX - hs.x) * 60 - hs.v * 6) * dt; hs.x += hs.v * dt;
    hs.vz += ((targetZ - hs.z) * 50 - hs.vz * 5) * dt; hs.z += hs.vz * dt;
    this.hairLong.rotation.set(-hs.x * 0.9, 0, hs.z);

    // lueur de la robe au rythme de la musique
    this.dressMat.emissiveIntensity = 0.05 + 0.5 * st.beat;
    this.belt.material.emissiveIntensity = 0.4 + 1.2 * st.beat;
  }
}
const redNail = new THREE.MeshPhysicalMaterial({ color: 0xb0102a, roughness: 0.15, clearcoat: 1 });
