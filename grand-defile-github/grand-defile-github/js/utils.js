// Utilitaires mathématiques partagés (plan XZ, Y = hauteur)
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const map = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
export const smooth = (t) => t * t * (3 - 2 * t);
// Aléa de la simulation : reproductible (même graine à chaque génération => comparaison équitable)
const R = { fn: Math.random };
export const rnd = () => R.fn();
export function seedRandom(seed) { R.fn = mulberry32(seed); }
export const rand = (a = 1, b) => (b === undefined ? R.fn() * a : a + R.fn() * (b - a));
export const pick = (arr) => arr[Math.floor(R.fn() * arr.length)];

// Gaussienne (Box-Muller)
export function gaussian(mean = 0, sd = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

// Interpolation d'angles (chemin le plus court)
export function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
}
export function angleDiff(a, b) {
  return ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

// Limite la norme d'un vecteur
export function limit(v, max) {
  const l = v.length();
  if (l > max) v.multiplyScalar(max / l);
  return v;
}

// Projection scalaire (cours "Path Following") :
// renvoie le point de la droite (a -> b) le plus proche de p.
// t = (ap . ab) / |ab|  est la projection scalaire de ap sur ab.
const _ap = new THREE.Vector3();
const _ab = new THREE.Vector3();
export function scalarProjection(p, a, b, out = new THREE.Vector3()) {
  _ap.subVectors(p, a);
  _ab.subVectors(b, a);
  const len = _ab.length() || 1e-6;
  _ab.divideScalar(len);
  const sp = _ap.dot(_ab);             // projection scalaire
  const t = clamp(sp / len, 0, 1);     // position normalisée dans le segment
  out.copy(a).addScaledVector(_ab, t * len);
  return { point: out, t, sp };
}

// Pas de fitness en dehors d'une valeur finie
export const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

// Générateur pseudo-aléatoire déterministe (pour l'apparence stable des mannequins)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
