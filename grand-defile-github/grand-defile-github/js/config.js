// Géométrie du monde (mètres) : podium en T, chemin, marques de pose, obstacles fixes.
import * as THREE from 'three';
import { Path } from './path.js';

export const STEM_HALF = 2.0;            // demi-largeur du couloir
export const STEM_Z0 = -12.4, STEM_Z1 = 8.2;
export const BAR_Z0 = 8.2, BAR_Z1 = 14.2, BAR_HALF = 7.4;
export const BACK_Z0 = -15.2, BACK_HALF = 4.2;
export const PODIUM_H = 0.9;             // hauteur du podium

// Contour exact du podium (x, z) : couloir + barre en T + plateforme backstage
export const OUTLINE = [
  [-BACK_HALF, BACK_Z0], [BACK_HALF, BACK_Z0], [BACK_HALF, STEM_Z0], [STEM_HALF, STEM_Z0], [STEM_HALF, STEM_Z1],
  [BAR_HALF, BAR_Z0], [BAR_HALF, BAR_Z1], [-BAR_HALF, BAR_Z1], [-BAR_HALF, BAR_Z0], [-STEM_HALF, STEM_Z1],
  [-STEM_HALF, STEM_Z0], [-BACK_HALF, STEM_Z0],
];

// distance signée vers l'INTÉRIEUR du podium (positive dedans, négative dehors) :
// distance exacte au contour + test point-dans-polygone (règle pair/impair)
export function podiumInside(p) {
  const n = OUTLINE.length;
  let d2 = Infinity, inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, zi] = OUTLINE[i], [xj, zj] = OUTLINE[j];
    if ((zi > p.z) !== (zj > p.z) && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) inside = !inside;
    const ex = xi - xj, ez = zi - zj;
    const t = Math.max(0, Math.min(1, ((p.x - xj) * ex + (p.z - zj) * ez) / (ex * ex + ez * ez)));
    const dx = p.x - (xj + t * ex), dz = p.z - (zj + t * ez);
    d2 = Math.min(d2, dx * dx + dz * dz);
  }
  return inside ? Math.sqrt(d2) : -Math.sqrt(d2);
}

// Zone des photographes : bande au bord avant de la barre, entre la voie de marche et le public.
// Ils n'occupent donc jamais les voies où marchent les mannequins.
export const PHOTO_ZONE = { x0: -6.6, x1: 6.6, z0: 12.5, z1: 13.9 };
export function photoInside(p) {
  return Math.min(p.x - PHOTO_ZONE.x0, PHOTO_ZONE.x1 - p.x, p.z - PHOTO_ZONE.z0, PHOTO_ZONE.z1 - p.z);
}

// Boucle : backstage -> couloir (voie droite) -> tour de la barre en T -> couloir (voie gauche) -> backstage
const W = [
  [0.95, -13.6], [0.95, -11.5], [0.95, -6], [0.95, 0], [0.95, 6], [1.05, 8.0], [1.6, 9.3],
  [2.7, 9.95], [5.4, 9.95], [6.55, 10.6], [5.4, 11.3],
  [2.7, 11.35], [0, 11.35], [-2.7, 11.35], [-5.4, 11.3],
  [-6.55, 10.6], [-5.4, 9.95], [-2.7, 9.95], [-1.6, 9.3], [-1.05, 8.0],
  [-0.95, 6], [-0.95, 0], [-0.95, -6], [-0.95, -11.5], [-0.95, -13.6],
];
export const path = new Path(W, 0.35);

// Marques de pose : abscisses curvilignes sur le chemin
function sOf(x, z, from = 0) {
  const p = new THREE.Vector3(x, 0, z);
  let best = null;
  for (let i = 0; i < path.points.length - 1; i++) {
    if (path.cum[i] < from) continue;
    const r = path.project(p, i, 0, 0);
    if (!best || r.dist < best.dist) best = r;
  }
  return best.s;
}
const sRight = sOf(5.0, 11.3);
const sCenter = sOf(0, 11.35, sRight + 1);
const sLeft = sOf(-5.0, 11.3, sCenter + 1);
export const marks = [sRight, sCenter, sLeft].map((s, i) => ({
  s, index: i, pos: path.pointAt(s), face: 0, // on fait face au public (+Z)
}));

// Obstacles fixes, posés SUR la trajectoire (aucun n'est près d'une marque de pose : la file d'attente
// d'une marque doit rester libre).
export const fixedObstacles = [
  { type: 'vase', pos: new THREE.Vector3(0.95, 0, -7.2), r: 0.32 },
  { type: 'spot', pos: new THREE.Vector3(-0.98, 0, -3.2), r: 0.28 },
  { type: 'vase', pos: new THREE.Vector3(0.95, 0, 2.2), r: 0.32 },
  { type: 'spot', pos: new THREE.Vector3(-0.98, 0, 6.0), r: 0.28 },
  { type: 'vase', pos: new THREE.Vector3(2.3, 0, 9.95), r: 0.32 },
  { type: 'spot', pos: new THREE.Vector3(-2.6, 0, 9.95), r: 0.28 },
];

export const N_MANNEQUINS = 10;
export const SPAWN_DELAY = 2.0; // s entre deux départs

export const NAMES = ['Yasmine', 'Camille', 'Inès', 'Kenza', 'Zoé', 'Salma', 'Anaïs', 'Nour', 'Margaux', 'Lina'];
