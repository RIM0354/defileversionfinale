// Banc de lucioles lumineuses au-dessus de la salle : BOIDS (séparation, alignement, cohésion)
// + Seek vers un point qui orbite autour du podium + garde-fou des murs de la salle.
// Chaque luciole est un Vehicle ; les poids et rayons de perception sont réglables (panneau « Boids »).
import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { HALL } from './world.js';
import { rand, TAU } from './utils.js';

export class Firefly extends Vehicle {
  constructor(x, z) {
    super(x, z);
    this.speedK = rand(0.75, 1.15); this.maxForce = 2.2; this.r = 0.2;
    this.alt = rand(4, 8); this.altPhase = rand(0, TAU);
    this.vel.set(rand(-1, 1), 0, rand(-1, 1));
    this.hue = Math.random() < 0.6 ? rand(0.86, 0.96) : rand(0.08, 0.14);
  }
}

export class FireflySwarm {
  constructor(scene, glow, n = 46) {
    this.flies = Array.from({ length: n }, () => new Firefly(rand(-14, 14), rand(-8, 22)));
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.55, map: glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    this.points.frustumCulled = false; scene.add(this.points);
    this.c = new THREE.Color();
  }
  // altitude d'affichage de la luciole i
  altOf(i) { const f = this.flies[i]; return f.alt + Math.sin(this.t * 0.8 + f.altPhase) * 0.8; }

  // P : { boidSepW, boidSepR, boidAliW, boidAliR, boidCohW, boidCohR, boidSpeed, boidSeekW }
  step(dt, t, beat, P) {
    const orbit = new THREE.Vector3(Math.cos(t * 0.18) * 9, 0, 4 + Math.sin(t * 0.18 * 1.3) * 12);
    this.orbit = orbit; this.t = t;
    const inside = (p) => Math.min(HALL.x - 2 - Math.abs(p.x), p.z - (HALL.zMin + 3), (HALL.zMax - 3) - p.z);
    this.flies.forEach((f, i) => {
      f.maxSpeed = P.boidSpeed * f.speedK;
      const forces = [
        f.separate(this.flies, P.boidSepR).multiplyScalar(P.boidSepW),
        f.align(this.flies, P.boidAliR).multiplyScalar(P.boidAliW),
        f.cohesion(this.flies, P.boidCohR).multiplyScalar(P.boidCohW),
        f.seek(orbit).multiplyScalar(P.boidSeekW),
        f.boundaries(inside, 3).multiplyScalar(2.5),
      ];
      forces.forEach((x) => f.applyForce(x));
      f.update(dt);
      const y = f.alt + Math.sin(t * 0.8 + f.altPhase) * 0.8;
      this.pos[i * 3] = f.pos.x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = f.pos.z;
      this.c.setHSL(f.hue, 0.9, 0.55 + 0.25 * beat); const k = 0.6 + 0.8 * beat;
      this.col[i * 3] = this.c.r * k; this.col[i * 3 + 1] = this.c.g * k; this.col[i * 3 + 2] = this.c.b * k;
    });
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true;
  }
}
