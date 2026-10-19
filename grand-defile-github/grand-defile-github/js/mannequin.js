// =====================================================================================
//  Mannequin = Vehicle autonome. Ses comportements de steering :
//    Path Following (projection scalaire) + Seek  → suivre la boucle du podium
//    Arrival                                     → s'arrêter EXACTEMENT sur chacune des 3 marques
//    Obstacle Avoidance                          → vases, projecteurs, photographes
//    Séparation                                  → ne pas percuter les autres mannequins
//    Flee                                        → s'éloigner des flashs
//    Garde-fou                                   → ne jamais sortir du podium
//  Les forces sont composées par priorité (budget de force, voir combine() dans vehicle.js).
//  Ses paramètres de steering sont ses GÈNES (genes.js) : l'algorithme génétique les fait évoluer.
//
//  Marques de pose : une seule mannequin à la fois par marque. Les suivantes font la queue derrière
//  la marque, sur le chemin (rang calculé par main.js : la plus proche de la marque passe en premier).
//  Queuing (Reynolds) : une mannequin ne rattrape jamais celle qui la précède sur le chemin.
// =====================================================================================
import * as THREE from 'three';
import { Vehicle, combine } from './vehicle.js';
import { path, marks, podiumInside, PODIUM_H, NAMES } from './config.js';
import { MannequinRig } from './rig.js';
import { clamp, lerp, lerpAngle, angleDiff, limit, mulberry32, TAU } from './utils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SKINS = ['#f2c9b0', '#e0ac86', '#c68a62', '#9a6340', '#6a4029', '#f6d5c0'];
const HAIRS = ['#2a1a12', '#0e0b0b', '#d8b46c', '#e9dcc0', '#7a2e1c', '#5b3420', '#4a1426', '#1c1a2a'];
const SHEEN = [0xffc890, 0xaab4ff, 0xfff2c0, 0xffffff, 0xff9a70, 0xffb080, 0xff7aa0, 0x90a0ff];
const LIPS = ['#b4132f', '#d9446a', '#8f1b3a', '#c8505a', '#e2607a', '#9b1c2e'];
const SHADOWS = ['#a04070', '#6a5acd', '#c08a50', '#4a8a8a', '#b05a8a', '#8a5030'];
const EYES = ['#5a3a1e', '#3a6a4a', '#4a6aa0', '#2a1c14', '#7a5a2a'];
const SHOES = [0xb0102a, 0x0b0b0e, 0xd4a017, 0xf4f0ea, 0x7a1fa0, 0x0b4a8a];

const JOIN_DIST = 6;        // m : à cette distance (le long du chemin) d'une marque, on rejoint sa file
const QUEUE_GAP = 1.5;      // m : espacement des mannequins qui attendent derrière la marque
const STOP_DIST = 0.3;      // m : « arrêtée sur la marque » = à moins de 30 cm du centre…
const STOP_SPEED = 0.15;    // m/s : … et quasi immobile

export class Mannequin extends Vehicle {
  constructor(index, dna, scene) {
    super(path.start.x, path.start.z);
    this.rng = mulberry32(5000 + index * 17);
    this.index = index; this.dna = dna; this.name = NAMES[index % NAMES.length]; this.tag = dna.elite ? '♛' : '';
    this.r = 0.32;
    this.state = 'queued';      // queued (pas partie) → walking → posing → done
    this.active = false; this.done = false;
    this.nextMark = 0; this.poseT = 0; this.queueRank = -1; this.cruising = false;
    this.phase = this.rr() * TAU; this.yaw = 0; this.walkAmp = 0; this.poseBlend = 0;
    this.poseType = 0; this.poseSide = index % 2 ? 1 : -1; this.poseLeg = -this.poseSide;
    this.lookYaw = 0;
    // statistiques de la mannequin sur ce défilé
    this.stat = { start: 0, end: 0, moveDist: 0, moveT: 0, latSum: 0, latN: 0, collisions: 0, stopErr: [], coolCol: 0, causes: [], join: [], markWait: [] };
    this.fitness = 0; this.result = null;

    const skin = SKINS[(index * 3 + 1) % SKINS.length], hair = HAIRS[(index * 5 + 2) % HAIRS.length];
    this.rig = new MannequinRig({
      seed: 1000 + index, name: this.name, skin, hair, hairSheen: SHEEN[(index * 5 + 2) % HAIRS.length], shoe: SHOES[index % SHOES.length],
      face: { seed: 1000 + index, skin, blush: '#e0607a', shadow: SHADOWS[index % SHADOWS.length], eye: EYES[(index * 2) % EYES.length], brow: index % 3 === 2 ? '#c8a050' : '#2a1a10', lip: LIPS[index % LIPS.length] },
    });
    this.rig.setDress({ h: (index * 36 + 10) % 360, s: 80, l: 52, p: index % 4 });
    this.rig.root.visible = false;
    this.rig.setLabel(this.name, this.tag);
    scene.add(this.rig.root);
  }

  get progress() { return this.s / path.length; }

  spawn(clock = 0) {
    this.stat.start = clock; this.active = true; this.state = 'walking';
    this.pos.set(path.start.x, 0, path.start.z);
    const t = path.tangentAt(0.5);
    this.vel.copy(t).multiplyScalar(0.4);
    this.yaw = Math.atan2(t.x, t.z);
    this.rig.root.visible = true;
  }

  // ---------------------------------------------------------------------- pilotage
  // G : paramètres de steering effectifs (gènes de l'ADN, ou sliders en mode manuel)
  steer(dt, ctx, G) {
    const P = ctx.P;
    this.maxSpeed = G.maxSpeed; this.maxForce = G.maxForce;
    const forces = [];
    const mk = marks[this.nextMark];
    const posing = this.state === 'posing';

    this.track(path);   // progression s et écart latéral (projection scalaire)

    // --- rang dans la file d'attente de la prochaine marque (calculé par main.js, -1 = hors file)
    const rank = this.queueRank;
    const ds = mk ? mk.s - this.s : Infinity;
    // anti-blocage : immobile trop longtemps (hors pose et file d'attente normale) -> pendant 4 s on coupe
    // queuing / séparation et on réduit l'évitement : la mannequin se dégage et reprend sa route.
    if (this.state === 'walking' && this.vel.length() < 0.08) this.idleT += dt; else this.idleT = 0;
    if (this.idleT > (rank > 0 ? 25 : rank === 0 ? 8 : 6)) { this.recoverT = 4; this.idleT = 0; this.stat.recoveries++; }
    this.recoverT = Math.max(0, this.recoverT - dt);
    const free = this.recoverT > 0;
    const atMark = rank === 0 && mk && this.pos.distanceTo(mk.pos) < 2.0;   // zone de pose : rien ne doit nous en écarter

    // 1. garde-fou : ne jamais sortir du podium
    forces.push(this.boundaries(podiumInside, 0.45).multiplyScalar(3.5));
    // 2. évitement des obstacles (fixes + photographes)
    forces.push(this.avoid(ctx.obstacles, G.aheadT, 0.22, podiumInside).multiplyScalar(G.wAvoid * 1.3 * (free ? 0.4 : 1)));
    // 3. queuing : ne pas rattraper la mannequin qui nous précède sur le chemin
    const others = ctx.mannequins.filter((m) => m.active && !m.done);
    let leader = null, gap = Infinity;
    for (const o of others) { const dsl = o.s - this.s, d = o.pos.distanceTo(this.pos); if (dsl > 0 && dsl < 4 && d < 3.5 && d < gap) { leader = o; gap = d; } }   // écart réel (m), pas le long du chemin : sûr dans les virages
    this.braked = false;
    if (leader && !free) {
      const cap = Math.max(0, leader.vel.length() + 0.9 * (gap - 1.3));      // vitesse qui garde ~1,3 m d'écart réel
      const sp = this.vel.length();
      if (sp > cap) {
        const dir = sp > 0.01 ? this.vel.clone().normalize() : path.tangentAt(this.s);
        forces.push(limit(dir.multiplyScalar(cap).sub(this.vel), this.maxForce * 1.5)); this.braked = true;
      }
      this.dbg.queuing = { from: this.pos.clone(), to: leader.pos.clone() };
    } else this.dbg.queuing = null;
    // 3b. séparation entre mannequins
    forces.push(this.separate(others, G.sepR).multiplyScalar(G.wSep * 1.2 * (atMark ? 0.15 : 1) * (free ? 0 : 1)));
    // 4. fuite des flashs : force ∝ proximité × fraîcheur du flash
    const flee = V();
    this.dbg.flashes = [];
    for (const f of ctx.flashes) {
      const age = ctx.t - f.t0;
      if (age > 1.6) continue;
      const d = Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z);
      this.dbg.flashes.push({ pos: f.pos, radius: P.fleeR });
      if (d > P.fleeR) continue;
      flee.add(this.flee(V(f.pos.x, 0, f.pos.z)).multiplyScalar((1 - d / P.fleeR) * Math.exp(-age * 2.2)));
    }
    forces.push(flee.multiplyScalar(G.wFlee * 1.6 * (posing || atMark ? 0 : 1)));

    // 5. chemin / arrêt sur la marque
    if (!mk) {
      forces.push(this.followPath(path, G.predictT, G.lookAhead).multiplyScalar(G.wPath));
    } else if (rank < 0) {
      forces.push(this.followPath(path, G.predictT, G.lookAhead).multiplyScalar(G.wPath));
    } else if (rank === 0) {
      // première de la file : Arrival sur le centre de la marque
      forces.push(this.arrive(mk.pos, G.arrivalR).multiplyScalar(G.wArrive * 1.5));
      if (!posing && ds > 1.0) forces.push(this.followPath(path, G.predictT, G.lookAhead).multiplyScalar(G.wPath * 0.3));
      const dm = this.pos.distanceTo(mk.pos);
      if (!posing && dm < STOP_DIST && this.vel.length() < STOP_SPEED) this.beginPose(ctx, dm);
    } else {
      // attente : on s'arrête derrière celle qui nous précède, sur le chemin
      const hold = path.pointAt(Math.max(0, mk.s - QUEUE_GAP * rank));
      forces.push(this.arrive(hold, 1.2).multiplyScalar(1.6));
      this.dbg.arrival = { target: hold, radius: 1.2 };
    }
    this.dbg.rank = rank; this.dbg.forces = forces.map((f) => [+f.x.toFixed(2), +f.z.toFixed(2)]);
    if (rank >= 0 && this.stat.join[this.nextMark] === undefined) this.stat.join[this.nextMark] = ctx.t;
    this.cruising = rank < 0 && !this.braked;
    this.lastForce = combine(forces, this.maxForce * 2.0);
    this.applyForce(this.lastForce);
  }

  beginPose(ctx, dist) {
    this.state = 'posing'; this.poseT = 0;
    this.poseType = this.nextMark;           // 1re marque : main sur la hanche, 2e : main dans les cheveux, 3e : deux mains
    this.poseDur = ctx.P.poseDur;
    this.stat.stopErr.push(dist); this.stat.markWait.push(+(ctx.t - this.stat.join[this.nextMark]).toFixed(1));
  }

  // ----------------------------------------------------------------------- mise à jour
  step(dt, ctx) {
    if (!this.active || this.done) return;
    const G = ctx.manual ? ctx.manualGenes : this.dna.genes;
    this.steer(dt, ctx, G);
    const before = this.pos.clone();
    this.update(dt);
    this.updateStats(dt, ctx, before);

    // garde-fou dur : on ne tombe jamais du podium
    const sd = podiumInside(this.pos);
    if (sd < 0.12) {
      const e = 0.05;
      const g = V(podiumInside(V(this.pos.x + e, 0, this.pos.z)) - podiumInside(V(this.pos.x - e, 0, this.pos.z)), 0,
        podiumInside(V(this.pos.x, 0, this.pos.z + e)) - podiumInside(V(this.pos.x, 0, this.pos.z - e))).normalize();
      this.pos.addScaledVector(g, 0.12 - sd);
      const vn = this.vel.dot(g); if (vn < 0) this.vel.addScaledVector(g, -vn);
    }

    if (this.state === 'posing') {
      this.poseT += dt;
      if (this.poseT >= this.poseDur) {
        this.nextMark++; this.state = 'walking'; this.queueRank = -1;
      }
    }
    if (this.nextMark >= marks.length && this.s > path.length - 1.2) this.finish(ctx);
  }

  updateStats(dt, ctx, before) {
    const st = this.stat, sp = this.vel.length();
    if (this.cruising && sp > 0.2) { st.moveT += dt; st.moveDist += before.distanceTo(this.pos); }   // vitesse de croisière
    if (this.lateral !== undefined) { st.latSum += Math.abs(this.lateral); st.latN++; }
    st.coolCol -= dt;
    if (st.coolCol <= 0) {
      for (const o of ctx.obstacles) if (this.pos.distanceTo(o.pos) < (this.r + o.r) * 0.92) { st.collisions++; st.coolCol = 1.2; st.causes.push(o.type || 'photographe'); return; }
      for (const m of ctx.mannequins) if (m !== this && m.active && !m.done && this.pos.distanceTo(m.pos) < (this.r + m.r) * 0.85) { st.collisions++; st.coolCol = 1.2; st.causes.push('mannequin@' + this.nextMark + (this.state === 'posing' ? 'P' : '')); return; }
    }
  }

  // ------------------------------------------------------------------------- fitness
  // Mesures physiques, toutes normalisées entre 0 et 1 (plus c'est grand, mieux c'est) :
  //   vitesse   = vitesse de croisière (hors file d'attente et arrêts) / 1,6 m/s
  //   précision = moyenne sur les 3 marques de (1 − distance d'arrêt / 30 cm)
  //   axe       = 1 − écart moyen à l'axe du chemin / 60 cm
  //   fitness = 30·vitesse + 30·précision + 25·axe + 15·(poses / 3) − 10·collisions
  finish(ctx) {
    if (this.done) return;
    const st = this.stat; st.end = ctx.t;
    const avgSpeed = st.moveT > 0 ? st.moveDist / st.moveT : 0;
    const avgLat = st.latN ? st.latSum / st.latN : 0;
    const prec = st.stopErr.length ? st.stopErr.reduce((a, e) => a + (1 - clamp(e / STOP_DIST, 0, 1)), 0) / st.stopErr.length : 0;
    const speedScore = clamp(avgSpeed / 1.6, 0, 1), axisScore = 1 - clamp(avgLat / 0.6, 0, 1);
    this.fitness = 30 * speedScore + 30 * prec + 25 * axisScore + 15 * (st.stopErr.length / marks.length) - 10 * st.collisions;
    this.result = { name: this.name, tag: this.tag, avgSpeed, avgLat, stopErr: st.stopErr.slice(), poses: st.stopErr.length, collisions: st.collisions, causes: st.causes, markWait: st.markWait, time: st.end - st.start, fitness: this.fitness, genes: { ...this.dna.genes } };
    this.done = true; this.active = false; this.state = 'done';
    this.rig.root.visible = false;
  }

  // --------------------------------------------------------------------------- rendu
  show(dt, ctx) {
    if (!this.active || this.done) return;
    const sp = this.vel.length();
    this.walkAmp = lerp(this.walkAmp, clamp(sp / 1.1, 0, 1), 1 - Math.exp(-dt * 8));
    this.phase += (sp * dt / 1.3) * TAU * (sp > 0.12 ? 1 : 0);          // une foulée (2 pas) tous les 1,3 m
    const target = this.state === 'posing' ? 0 : (sp > 0.12 ? Math.atan2(this.vel.x, this.vel.z) : this.yaw);
    const prevYaw = this.yaw;
    this.yaw = lerpAngle(this.yaw, target, 1 - Math.exp(-dt * (this.state === 'posing' ? 4 : 6)));
    const turn = angleDiff(prevYaw, this.yaw) / Math.max(dt, 1e-3);
    const posing = this.state === 'posing';
    const k = posing ? Math.min(1, this.poseT / 0.45) * Math.min(1, (this.poseDur - this.poseT) / 0.4 + 0.0001) : 0;
    this.poseBlend = lerp(this.poseBlend, clamp(k, 0, 1), 1 - Math.exp(-dt * 10));
    // le regard se tourne vers le public (centre des gradins face à la barre)
    const bearing = Math.atan2(0 - this.pos.x, 15 - this.pos.z);
    this.lookYaw = lerp(this.lookYaw, angleDiff(this.yaw, bearing), 1 - Math.exp(-dt * 4));
    this.rig.root.position.set(this.pos.x, PODIUM_H, this.pos.z);
    this.rig.root.rotation.y = this.yaw;
    this.rig.animate({
      phase: this.phase, walk: this.walkAmp, sway: 0.8, grace: ctx.P.grace, poseType: this.poseType, pose: this.poseBlend,
      poseLeg: this.poseLeg, poseSide: this.poseSide, lookYaw: this.lookYaw, lookGain: 0.6, beat: ctx.beat, speed: sp / 1.4,
      turn: clamp(turn * 0.2, -1, 1), dt,
    });
    this.rig.setScale(ctx.P.size);
  }

  dispose(scene) { scene.remove(this.rig.root); }
}
