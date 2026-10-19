// Photographes-journalistes : obstacles MOBILES. Ce sont des Vehicle qui combinent
// Wander (errance), Pursue (rejoindre la mannequin à shooter), Evade (s'écarter d'une
// mannequin trop proche), Séparation, Avoidance des obstacles fixes et garde-fou du podium.
// Ils déclenchent les flashs.
import * as THREE from 'three';
import { Vehicle, combine } from './vehicle.js';
import { photoInside, PODIUM_H, PHOTO_ZONE } from './config.js';
import { lerpAngle, mulberry32, TAU, limit } from './utils.js';

const suit = new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.7 });
const skinM = new THREE.MeshStandardMaterial({ color: 0xd9a784, roughness: 0.6 });
const camM = new THREE.MeshStandardMaterial({ color: 0x0c0c0f, roughness: 0.4, metalness: 0.7 });
const lensM = new THREE.MeshPhysicalMaterial({ color: 0x0a1020, roughness: 0.05, metalness: 0.2, clearcoat: 1 });
const pressM = new THREE.MeshStandardMaterial({ color: 0xffe14d, roughness: 0.5, emissive: 0x3a3000, emissiveIntensity: 0.3 });

export class Photographer extends Vehicle {
  constructor(x, z, idx) {
    super(x, z);
    this.idx = idx;
    this.r = 0.38;
    this.maxSpeed = 1.15; this.maxForce = 2.4;
    this.wanderDistance = 1.8; this.wanderRadius = 0.9; this.displaceRange = 0.45;
    this.cooldown = (1 + 2 * this.rr());
    this.yaw = this.rr() * TAU; this.walkPhase = 0;
    this.target = null; this.flashAnim = 0;
    this.state = 'wander';
    this.group = this.buildModel();
    this.vel.set(Math.sin(this.yaw) * 0.5, 0, Math.cos(this.yaw) * 0.5);
  }

  // remise à zéro au début de chaque passage (mêmes conditions pour toutes les générations)
  resetState(x, z) {
    this.rng = mulberry32(900 + this.idx * 31);
    this.pos.set(x, 0, z); this.acc.set(0, 0, 0);
    this.cooldown = (1 + 2 * this.rr()); this.yaw = this.rr() * TAU; this.wanderTheta = this.rr() * TAU; this.avoidSide = 0;
    this.vel.set(Math.sin(this.yaw) * 0.5, 0, Math.cos(this.yaw) * 0.5);
  }

  buildModel() {
    const g = new THREE.Group();
    const add = (geo, mat, p, parent = g) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; parent.add(m); if (p) m.position.set(...p); return m; };
    this.torso = new THREE.Group(); this.torso.position.y = 1.0; g.add(this.torso);
    add(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), suit, [0, 0.3, 0], this.torso);
    const head = add(new THREE.SphereGeometry(0.115, 18, 14), skinM, [0, 0.82, 0], this.torso);
    add(new THREE.SphereGeometry(0.122, 14, 10, 0, TAU, 0, 1.7), suit, [0, 0.84, -0.01], this.torso);
    this.legs = [-1, 1].map((s) => { const l = new THREE.Group(); l.position.set(s * 0.085, 1.0, 0); g.add(l); const m = add(new THREE.CapsuleGeometry(0.065, 0.78, 4, 8), suit, [0, -0.45, 0], l); return l; });
    // bras tendus tenant l'appareil devant le visage
    this.cam = new THREE.Group(); this.cam.position.set(0, 0.55, 0.3); this.torso.add(this.cam);
    add(new THREE.BoxGeometry(0.22, 0.14, 0.12), camM, [0, 0, 0], this.cam);
    const lens = add(new THREE.CylinderGeometry(0.06, 0.07, 0.17, 16), lensM, [0, 0, 0.13], this.cam); lens.rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.07, 0.04, 0.05), camM, [0.06, 0.09, 0], this.cam);
    for (const s of [-1, 1]) {
      const arm = add(new THREE.CapsuleGeometry(0.05, 0.34, 4, 8), suit, [s * 0.2, 0.52, 0.12], this.torso);
      arm.rotation.set(-1.1, 0, -s * 0.5);
    }
    // brassard PRESS
    add(new THREE.BoxGeometry(0.12, 0.07, 0.22), pressM, [0.0, 0.45, 0], this.torso).position.set(0.2, 0.5, 0.0);
    this.flashBulb = add(new THREE.SphereGeometry(0.03, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), [0.06, 0.12, 0.0], this.cam);
    this.flashBulb.castShadow = false; this.flashBulb.scale.setScalar(0.001);
    g.scale.setScalar(1.0);
    return g;
  }

  // ctx : { P (paramètres), mannequins, photographers, tryFlash }
  // Les photographes évoluent dans la bande au bord avant de la barre (PHOTO_ZONE), face au public.
  // Comportements : Wander (errance) · Pursue (suivre la mannequin de tête, le long de la bande) ·
  // Evade (s'écarter d'une mannequin trop proche) · Séparation · garde-fou de la bande.
  step(dt, ctx) {
    const P = ctx.P;
    this.maxSpeed = P.phSpeed; this.maxForce = 2.4;
    this.wanderDistance = P.wanderDist; this.wanderRadius = P.wanderRadius; this.displaceRange = P.wanderDisplace;
    const mans = ctx.mannequins.filter((m) => m.active && !m.done);
    // cible : la mannequin de tête (la plus avancée sur le chemin)
    let lead = null;
    for (const m of mans) if (!lead || m.s > lead.s) lead = m;
    this.target = lead;

    const forces = [];
    forces.push(this.boundaries(photoInside, 0.35).multiplyScalar(3));
    // Evade : s'écarter de toute mannequin plus proche que evadeR
    this.dbg.evade = null;
    for (const m of mans) {
      const d = m.pos.distanceTo(this.pos);
      if (d < P.evadeR) forces.push(this.evade(m, P.pursueT).multiplyScalar(2.2 * (1 - d / P.evadeR) + 0.4));
    }
    forces.push(this.separate(ctx.photographers, 2.0).multiplyScalar(1.2));
    // Pursue : on suit la mannequin de tête, mais seulement le long de la bande (on vise sa projection sur la bande)
    if (lead && Math.abs(lead.pos.z - this.pos.z) < 12) {
      this.state = 'pursue';
      const ghost = { pos: new THREE.Vector3(Math.max(PHOTO_ZONE.x0 + 0.6, Math.min(PHOTO_ZONE.x1 - 0.6, lead.pos.x)), 0, (PHOTO_ZONE.z0 + PHOTO_ZONE.z1) / 2), vel: new THREE.Vector3(lead.vel.x, 0, 0) };
      forces.push(this.pursue(ghost, P.pursueT).multiplyScalar(0.8));
      forces.push(this.wander().multiplyScalar(0.3));
    } else {
      this.state = 'wander';
      this.dbg.pursue = null;
      forces.push(this.wander());
    }
    this.applyForce(combine(forces, this.maxForce * 2.2));
    this.update(dt);
    // garde-fou dur : on ne sort jamais de la bande
    const sd = photoInside(this.pos);
    if (sd < 0.15) {
      const e = 0.05;
      const g = new THREE.Vector3(photoInside(new THREE.Vector3(this.pos.x + e, 0, this.pos.z)) - photoInside(new THREE.Vector3(this.pos.x - e, 0, this.pos.z)), 0,
        photoInside(new THREE.Vector3(this.pos.x, 0, this.pos.z + e)) - photoInside(new THREE.Vector3(this.pos.x, 0, this.pos.z - e))).normalize();
      this.pos.addScaledVector(g, 0.15 - sd); const vn = this.vel.dot(g); if (vn < 0) this.vel.addScaledVector(g, -vn);
    }
    // flash : intervalle aléatoire divisé par la fréquence réglée
    this.cooldown -= dt * P.flashRate;
    this.flashAnim = Math.max(0, this.flashAnim - dt * 6);
    let near = null;
    for (const m of mans) if (m.pos.distanceTo(this.pos) < 11 && (!near || m.pos.distanceTo(this.pos) < near.pos.distanceTo(this.pos))) near = m;
    if (this.cooldown <= 0 && near) { ctx.tryFlash(this, near); this.cooldown = 1 + 2.4 * this.rr(); this.flashAnim = 1; }
    this.flashBulb.scale.setScalar(0.001 + 0.3 * this.flashAnim * this.flashAnim);
  }

  show(dt, t) {
    const sp = this.vel.length();
    this.walkPhase += sp * dt * 5;
    // orientation : vers la cible si elle existe, sinon dans le sens de la marche
    let want = sp > 0.1 ? Math.atan2(this.vel.x, this.vel.z) : this.yaw;
    if (this.target) { const d = this.target.pos.clone().sub(this.pos); if (d.length() < 12) want = Math.atan2(d.x, d.z); }
    this.yaw = lerpAngle(this.yaw, want, 1 - Math.exp(-dt * 5));
    this.group.position.set(this.pos.x, PODIUM_H, this.pos.z);
    this.group.rotation.y = this.yaw;
    const k = Math.min(1, sp / 1.0);
    this.legs[0].rotation.x = Math.sin(this.walkPhase) * 0.5 * k;
    this.legs[1].rotation.x = -Math.sin(this.walkPhase) * 0.5 * k;
    this.torso.position.y = 1.0 + Math.abs(Math.sin(this.walkPhase)) * 0.025 * k;
    this.torso.rotation.x = -0.05 + this.flashAnim * -0.08;
    this.cam.position.z = 0.3 - this.flashAnim * 0.04;
  }
}
