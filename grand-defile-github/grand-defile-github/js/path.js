// Chemin du défilé : polyligne dense + projection scalaire (Path Following).
import * as THREE from 'three';
import { scalarProjection, clamp } from './utils.js';

export class Path {
  constructor(waypoints, spacing = 0.4) {
    const curve = new THREE.CatmullRomCurve3(waypoints.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
    const n = Math.ceil(curve.getLength() / spacing);
    this.points = curve.getSpacedPoints(n).map((p) => { p.y = 0; return p; });
    this.cum = [0];
    for (let i = 1; i < this.points.length; i++) this.cum.push(this.cum[i - 1] + this.points[i].distanceTo(this.points[i - 1]));
    this.length = this.cum[this.cum.length - 1];
    this.radius = 0.55; // demi-largeur du couloir de marche
  }

  get start() { return this.points[0]; }
  get end() { return this.points[this.points.length - 1]; }

  // Projection scalaire sur les segments proches de `hint` (index) :
  // renvoie le point le plus proche, la progression s (m) et l'écart latéral signé.
  // Cherche le segment le plus proche autour du dernier segment connu (hint). Pour ne jamais « couper »
  // vers une autre voie (le chemin repasse près de lui-même), un segment lointain le long du chemin est
  // pénalisé : score = distance + 0,15 × (avance au-delà de 3 m) + 0,3 × (retard au-delà de 1,5 m).
  project(p, hint = 0, back = 3, fwd = 30) {
    const i0 = Math.max(0, hint - back), i1 = Math.min(this.points.length - 2, hint + fwd);
    const curS = this.cum[Math.min(hint, this.cum.length - 1)];
    let best = null, bestScore = Infinity;
    const tmp = new THREE.Vector3();
    for (let i = i0; i <= i1; i++) {
      const a = this.points[i], b = this.points[i + 1];
      const { t } = scalarProjection(p, a, b, tmp);
      const d2 = tmp.distanceToSquared(p);
      const segS = this.cum[i];
      const score = Math.sqrt(d2) + 0.15 * Math.max(0, segS - curS - 3) + 0.3 * Math.max(0, curS - segS - 1.5);
      if (score < bestScore) { bestScore = score; best = { i, t, d2, point: tmp.clone() }; }
    }
    const a = this.points[best.i], b = this.points[best.i + 1];
    const tan = new THREE.Vector3().subVectors(b, a).normalize();
    const off = new THREE.Vector3().subVectors(p, best.point);
    best.s = this.cum[best.i] + best.t * (this.cum[best.i + 1] - this.cum[best.i]);
    best.tangent = tan;
    best.lateral = tan.x * off.z - tan.z * off.x; // >0 : à gauche de la marche
    best.dist = Math.sqrt(best.d2);
    return best;
  }

  pointAt(s, out = new THREE.Vector3()) {
    s = clamp(s, 0, this.length);
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    const f = (s - this.cum[lo]) / (this.cum[hi] - this.cum[lo] || 1);
    return out.lerpVectors(this.points[lo], this.points[hi], f);
  }

  tangentAt(s) {
    const a = this.pointAt(s - 0.3), b = this.pointAt(s + 0.3);
    return b.sub(a).setY(0).normalize();
  }

  // courbure locale (rad/m), signée
  curvatureAt(s) {
    const t1 = this.tangentAt(s - 0.5), t2 = this.tangentAt(s + 0.5);
    return Math.atan2(t1.x * t2.z - t1.z * t2.x, t1.dot(t2)) / 1.0;
  }

  indexAt(s) {
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    return lo;
  }
}
