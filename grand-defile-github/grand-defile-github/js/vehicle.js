// =====================================================================================
//  Vehicle 3D — base de TOUTES les entités mobiles (mannequins, photographes, lucioles)
//  Modèle : Craig Reynolds, « Steering Behaviors for Autonomous Characters » (GDC 1999).
//
//  Principe : un comportement NE déplace RIEN. Il renvoie une FORCE (vecteur).
//  La scène additionne les forces, appelle applyForce(), puis update() qui intègre :
//        vitesse  += accélération * dt        (limitée à maxSpeed)
//        position += vitesse * dt
//  Le mouvement se fait dans le plan XZ (Y = hauteur, toujours 0 pour le centre).
//
//  Chaque comportement mémorise dans this.dbg les éléments à dessiner en mode « debug »
//  (rayons, vecteurs, points) : ce que l'on voit à l'écran est exactement ce qui est calculé.
// =====================================================================================
import * as THREE from 'three';
import { clamp, limit, TAU } from './utils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class Vehicle {
  constructor(x = 0, z = 0) {
    this.pos = V(x, 0, z);
    this.vel = V();
    this.acc = V();
    this.maxSpeed = 1.4;   // m/s  : vitesse maximale
    this.maxForce = 3.0;   // m/s² : force (accélération) maximale d'un steering
    this.r = 0.3;          // m    : rayon de collision

    // ----- Wander : cercle placé devant le véhicule
    this.wanderDistance = 1.6;   // m   : distance du centre du cercle
    this.wanderRadius = 0.8;     // m   : rayon du cercle
    this.wanderTheta = this.rr() * TAU;
    this.displaceRange = 0.5;    // rad : variation maximale de l'angle à chaque pas

    // ----- Path following : mémoire de la position sur le chemin
    this.hint = 0;               // index du segment courant
    this.s = 0;                  // abscisse curviligne (m) atteinte sur le chemin

    this.dbg = {};               // données de debug (voir debug.js)
  }

  // Flux aléatoire propre au véhicule (reproductible si this.rng est fixé)
  rr() { return this.rng ? this.rng() : Math.random(); }

  // Cap (rad) : angle du vecteur vitesse dans le plan XZ
  heading() { return Math.atan2(this.vel.x, this.vel.z); }

  applyForce(f) { this.acc.add(f); }

  // Intégration d'Euler semi-implicite
  update(dt) {
    this.vel.addScaledVector(this.acc, dt);
    this.vel.y = 0;
    limit(this.vel, this.maxSpeed);
    this.pos.addScaledVector(this.vel, dt);
    this.pos.y = 0;
    this.acc.set(0, 0, 0);
  }

  // ===================================================================== SEEK
  // Vitesse désirée = direction vers la cible à vitesse maximale.
  // Force de steering = vitesse désirée − vitesse actuelle (limitée à maxForce).
  seek(target, arrival = false, slowRadius = 2) {
    const desired = V().subVectors(target, this.pos);
    desired.y = 0;
    let speed = this.maxSpeed, gain = 1;
    if (arrival) {
      const d = desired.length();
      if (d < slowRadius) speed = this.maxSpeed * (d / slowRadius);   // rampe linéaire d'arrêt
      gain = 4;   // l'Arrival corrige la vitesse 4 fois plus vite (sinon la mannequin glisse au-delà de la cible)
    }
    desired.setLength(speed);
    const force = limit(V().subVectors(desired, this.vel).multiplyScalar(gain), this.maxForce);
    this.dbg.seek = { target: target.clone(), desired: desired.clone(), force: force.clone() };
    return force;
  }

  // ================================================================== ARRIVAL
  // Seek qui ralentit dans un cercle de rayon slowRadius pour s'arrêter sur la cible.
  arrive(target, slowRadius = 2) {
    const f = this.seek(target, true, slowRadius);
    this.dbg.arrival = { target: target.clone(), radius: slowRadius };
    return f;
  }

  // ==================================================================== FLEE
  // Seek inversé : on s'éloigne de la cible.
  flee(target) { return this.seek(target).multiplyScalar(-1); }

  // ================================================================== PURSUE
  // On vise la position FUTURE de la cible : pos + vitesse * T (T secondes d'anticipation).
  pursue(other, T = 0.8) {
    const future = other.pos.clone().addScaledVector(other.vel, T);
    this.dbg.pursue = { from: other.pos.clone(), future };
    return this.seek(future);
  }

  // =================================================================== EVADE
  // Pursue inversé : on fuit la position future de la menace.
  evade(other, T = 0.8) {
    const future = other.pos.clone().addScaledVector(other.vel, T);
    this.dbg.evade = { from: other.pos.clone(), future };
    return this.seek(future).multiplyScalar(-1);
  }

  // =================================================================== WANDER
  // On place un cercle devant le véhicule ; un point glisse sur ce cercle (angle theta qui
  // varie au hasard de ±displaceRange) et on fait Seek vers ce point : trajectoire d'errance lisse.
  wander() {
    const dir = this.vel.lengthSq() > 1e-4 ? this.vel.clone().normalize() : V(0, 0, 1);
    const center = this.pos.clone().addScaledVector(dir, this.wanderDistance);
    this.wanderTheta += (this.rr() * 2 - 1) * this.displaceRange;
    const a = this.wanderTheta + this.heading();
    const point = V(Math.sin(a) * this.wanderRadius, 0, Math.cos(a) * this.wanderRadius).add(center);
    this.dbg.wander = { center, radius: this.wanderRadius, point };
    return this.seek(point);
  }

  // ============================================================ PATH FOLLOWING
  // 1. position future  = pos + vitesse * predictT
  // 2. PROJECTION SCALAIRE de cette position sur le segment du chemin le plus proche
  //    (point « normal » : le point du chemin le plus proche de la position future)
  // 3. cible = ce point avancé de lookAhead mètres le long du chemin, puis Seek.
  // La force est d'autant plus forte que la position future s'écarte de l'axe
  // (au-delà de la demi-largeur du couloir, on rappelle franchement vers le chemin).
  followPath(path, predictT = 0.8, lookAhead = 1.8) {
    const now = this.track(path);
    const dirNow = this.vel.lengthSq() > 0.01 ? this.vel : path.tangentAt(this.s);
    const future = this.pos.clone().addScaledVector(dirNow, predictT);
    const proj = path.project(future, this.hint);            // projection scalaire
    const target = path.pointAt(proj.s + lookAhead);
    const dev = clamp(proj.dist / path.radius, 0, 1.6);      // écart / demi-largeur du couloir
    const force = this.seek(target).multiplyScalar(0.55 + 0.9 * dev);
    this.dbg.path = { future, normal: proj.point, target, corridor: path.radius, lateral: now.lateral };
    return force;
  }

  // Suivi de la position sur le chemin : projection scalaire de la position COURANTE.
  // Met à jour la progression s (ne recule jamais) et l'écart latéral signé à l'axe.
  track(path) {
    const now = path.project(this.pos, this.hint);
    this.hint = now.i;
    this.s = Math.max(this.s, now.s);
    this.lateral = now.lateral;
    return now;
  }

  // ========================================================= OBSTACLE AVOIDANCE
  // Deux vecteurs « ahead » (longueur = vitesse * lookTime, et la moitié) sont projetés devant le
  // véhicule. Un obstacle est menaçant si le bout d'un vecteur (ou le véhicule lui-même) entre dans son
  // cercle élargi (rayon obstacle + rayon véhicule + marge). On dévie LATÉRALEMENT, du côté libre.
  avoid(obstacles, lookTime = 1.4, margin = 0.25, inside = null) {
    const speed = this.vel.length();
    // à l'arrêt, la « direction de marche » est celle du dernier Seek (vers où l'on veut aller)
    let dir = V(0, 0, 1);
    if (speed > 0.05) dir = this.vel.clone().normalize();
    else if (this.dbg.seek) { const w = V().subVectors(this.dbg.seek.target, this.pos); w.y = 0; if (w.lengthSq() > 1e-4) dir = w.normalize(); }
    const len = Math.max(0.8, speed * lookTime);
    const ahead = this.pos.clone().addScaledVector(dir, len);
    const ahead2 = this.pos.clone().addScaledVector(dir, len * 0.5);
    this.dbg.avoid = { ahead, ahead2, threat: null, radius: 0 };

    let best = null, bestDist = Infinity;
    for (const o of obstacles) {
      if (o === this) continue;
      const R = o.r + this.r + margin;
      const d0 = this.pos.distanceTo(o.pos), d1 = ahead.distanceTo(o.pos), d2 = ahead2.distanceTo(o.pos);
      const dMin = Math.min(d0, d1, d2);
      if (dMin < R && d0 < bestDist) {
        bestDist = d0;
        best = { o, R, dMin, pt: dMin === d0 ? this.pos : dMin === d2 ? ahead2 : ahead };
      }
    }
    if (!best) return V();

    const side = V(-dir.z, 0, dir.x);
    const rel = V().subVectors(best.pt, best.o.pos); rel.y = 0;
    let sgn = rel.dot(side);
    if (Math.abs(sgn) < 0.12) { if (!this.avoidSide) this.avoidSide = this.rr() < 0.5 ? 1 : -1; sgn = this.avoidSide; }
    if (inside) {
      // on contourne du côté qui a la place de passer (bord du podium)
      const gap = best.R + 0.12;
      const cPos = inside(V().copy(best.o.pos).addScaledVector(side, gap));
      const cNeg = inside(V().copy(best.o.pos).addScaledVector(side, -gap));
      if (cPos < 0.5 && cNeg > cPos + 0.15) sgn = -1;
      else if (cNeg < 0.5 && cPos > cNeg + 0.15) sgn = 1;
    }
    this.avoidSide = Math.sign(sgn) || 1;
    const urgency = clamp(1.5 - best.dMin / best.R, 0.35, 1.5);
    const f = side.multiplyScalar(this.avoidSide * this.maxForce * urgency);
    if (best.dMin < best.R * 0.6) f.addScaledVector(dir, -this.maxForce * 0.25);   // freinage si très près
    this.dbg.avoid.threat = best.o.pos.clone();
    this.dbg.avoid.radius = best.R;
    return f;
  }

  // ================================================================ SÉPARATION
  // Chaque voisin plus proche que « radius » repousse le véhicule, d'autant plus qu'il est proche (1/d).
  separate(others, radius = 1.2) {
    const sum = V();
    let n = 0;
    for (const o of others) {
      if (o === this) continue;
      const d = this.pos.distanceTo(o.pos);
      if (d > 0 && d < radius) { sum.add(V().subVectors(this.pos, o.pos).normalize().divideScalar(d)); n++; }
    }
    this.dbg.separate = { radius };
    if (!n) return sum;
    sum.divideScalar(n).setLength(this.maxSpeed).sub(this.vel);
    return limit(sum, this.maxForce);
  }

  // ============================================================== ALIGNEMENT
  // On adopte la vitesse moyenne des voisins situés dans le rayon de perception.
  align(others, radius = 4) {
    const sum = V(); let n = 0;
    for (const o of others) if (o !== this && this.pos.distanceTo(o.pos) < radius) { sum.add(o.vel); n++; }
    this.dbg.align = { radius };
    if (!n) return sum;
    sum.divideScalar(n).setLength(this.maxSpeed).sub(this.vel);
    return limit(sum, this.maxForce);
  }

  // =============================================================== COHÉSION
  // Seek vers le centre de gravité des voisins situés dans le rayon de perception.
  cohesion(others, radius = 6) {
    const c = V(); let n = 0;
    for (const o of others) if (o !== this && this.pos.distanceTo(o.pos) < radius) { c.add(o.pos); n++; }
    this.dbg.cohesion = { radius, center: n ? c.clone().divideScalar(n) : null };
    if (!n) return c;
    return this.seek(c.divideScalar(n));
  }

  // ============================================================== GARDE-FOU
  // inside(p) renvoie la distance signée au bord (positive dedans). Sous « margin », on rappelle
  // vers l'intérieur en suivant le gradient (calculé numériquement) : jamais de chute.
  boundaries(inside, margin = 0.5) {
    const sd = inside(this.pos);
    if (sd > margin) return V();
    const e = 0.05;
    const g = V(
      inside(V(this.pos.x + e, 0, this.pos.z)) - inside(V(this.pos.x - e, 0, this.pos.z)), 0,
      inside(V(this.pos.x, 0, this.pos.z + e)) - inside(V(this.pos.x, 0, this.pos.z - e)));
    if (g.lengthSq() < 1e-9) return V();
    g.normalize();
    const k = clamp((margin - sd) / margin, 0, 2);
    const f = limit(g.multiplyScalar(this.maxSpeed).sub(this.vel), this.maxForce * (1 + 2 * k));
    return f.multiplyScalar(0.5 + k);
  }
}

// Composition des forces par priorité avec budget (Reynolds, « Combining behaviors ») :
// on additionne dans l'ordre jusqu'à épuisement du budget ; les forces moins prioritaires sont tronquées.
export function combine(forces, budget) {
  const total = V();
  for (const f of forces) {
    const l = f.length();
    if (l < 1e-9) continue;
    const use = Math.min(l, budget);
    total.addScaledVector(f, use / l);
    budget -= use;
    if (budget <= 0) break;
  }
  return total;
}
