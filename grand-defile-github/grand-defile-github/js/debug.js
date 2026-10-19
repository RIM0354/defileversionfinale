// =====================================================================================
//  Dessin de debug : montre à l'écran EXACTEMENT ce que calculent les steering behaviors
//  (rayons, vecteurs, points). Chaque case cochée dans le panneau active un groupe de tracés.
//  Les données viennent de vehicle.dbg, remplies par les comportements eux-mêmes.
// =====================================================================================
import * as THREE from 'three';
import { PODIUM_H, path } from './config.js';

const MAX_SEG = 9000;
const Y0 = PODIUM_H + 0.04;           // les tracés posés sur le podium
const COL = {
  seek: 0x58ff8a, force: 0xff5a5a, path: 0x9aa7ff, future: 0xff4d4d, normal: 0x4dff88, target: 0xffe14d,
  arrival: 0xffa640, ahead: 0xffe14d, ahead2: 0xc084fc, threat: 0xff4d4d, sep: 0x4dd8ff, flee: 0xff5fd2,
  wander: 0x7fd6ff, wanderPt: 0x58ff8a, pursue: 0x58ff8a, evade: 0xff6a5a, align: 0x9affb0, coh: 0xffc27a,
};

export class DebugDraw {
  constructor(scene) {
    this.pos = new Float32Array(MAX_SEG * 6); this.col = new Float32Array(MAX_SEG * 6); this.n = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, toneMapped: false }));
    this.lines.frustumCulled = false; this.lines.renderOrder = 30; scene.add(this.lines);
    this.on = { seek: false, path: false, arrival: false, avoid: false, separate: false, flee: false, wander: false, pursue: false, boids: false };
    this.c = new THREE.Color();
  }

  // ---- primitives
  seg(a, b, color, ya = Y0, yb = Y0) {
    if (this.n >= MAX_SEG) return;
    const i = this.n++ * 6; this.c.set(color);
    this.pos[i] = a.x; this.pos[i + 1] = ya; this.pos[i + 2] = a.z; this.pos[i + 3] = b.x; this.pos[i + 4] = yb; this.pos[i + 5] = b.z;
    this.col[i] = this.col[i + 3] = this.c.r; this.col[i + 1] = this.col[i + 4] = this.c.g; this.col[i + 2] = this.col[i + 5] = this.c.b;
  }
  circle(c, r, color, y = Y0, n = 40) {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      this.seg({ x: c.x + Math.cos(a0) * r, z: c.z + Math.sin(a0) * r }, { x: c.x + Math.cos(a1) * r, z: c.z + Math.sin(a1) * r }, color, y, y);
    }
  }
  cross(p, color, y = Y0, s = 0.18) { this.seg({ x: p.x - s, z: p.z }, { x: p.x + s, z: p.z }, color, y, y); this.seg({ x: p.x, z: p.z - s }, { x: p.x, z: p.z + s }, color, y, y); }
  arrow(o, v, color, k = 1, y = Y0 + 0.02) {
    const e = { x: o.x + v.x * k, z: o.z + v.z * k }; this.seg(o, e, color, y, y);
    const l = Math.hypot(v.x, v.z) * k; if (l < 0.05) return;
    const ux = (e.x - o.x) / l, uz = (e.z - o.z) / l, h = Math.min(0.2, l * 0.4);
    this.seg(e, { x: e.x - ux * h - uz * h * 0.5, z: e.z - uz * h + ux * h * 0.5 }, color, y, y);
    this.seg(e, { x: e.x - ux * h + uz * h * 0.5, z: e.z - uz * h - ux * h * 0.5 }, color, y, y);
  }

  // ---- une image de debug
  update(ctx, focus, photographers, swarm) {
    this.n = 0;
    const on = this.on, P = ctx.P;
    if (on.path) this.drawPath();
    if (focus && focus.active) {
      const d = focus.dbg, p = focus.pos;
      if (on.seek && d.seek) {
        this.cross(d.seek.target, COL.seek);
        this.arrow(p, d.seek.desired, COL.seek, 0.8);       // vitesse désirée
        this.arrow(p, focus.vel, 0x4dd8ff, 0.8);            // vitesse actuelle
        this.arrow(p, d.seek.force, COL.force, 0.8);        // force de steering
      }
      if (on.path && d.path) {
        this.cross(d.path.future, COL.future); this.cross(d.path.normal, COL.normal); this.cross(d.path.target, COL.target, Y0, 0.25);
        this.seg(p, d.path.future, COL.future); this.seg(d.path.future, d.path.normal, COL.normal); this.seg(d.path.normal, d.path.target, COL.target);
      }
      if (on.arrival && d.arrival) { this.circle(d.arrival.target, d.arrival.radius, COL.arrival); this.cross(d.arrival.target, COL.arrival, Y0, 0.25); }
      if (on.avoid && d.avoid) {
        this.seg(p, d.avoid.ahead, COL.ahead); this.seg(p, d.avoid.ahead2, COL.ahead2);
        this.cross(d.avoid.ahead, COL.ahead); this.cross(d.avoid.ahead2, COL.ahead2);
        if (d.avoid.threat) this.circle(d.avoid.threat, d.avoid.radius, COL.threat);
      }
      if (on.separate && d.separate) this.circle(p, d.separate.radius, COL.sep);
      if (on.flee && d.flashes) for (const f of d.flashes) this.circle(f.pos, f.radius, COL.flee);
    }
    if (on.wander || on.pursue) {
      for (const ph of photographers) {
        const d = ph.dbg;
        if (on.wander && d.wander) {
          this.circle(d.wander.center, d.wander.radius, COL.wander, Y0, 28); this.cross(d.wander.center, COL.wander);
          this.seg(ph.pos, d.wander.center, COL.wander); this.seg(d.wander.center, d.wander.point, COL.wanderPt); this.cross(d.wander.point, COL.wanderPt, Y0, 0.14);
        }
        if (on.pursue) {
          if (ph.state === 'pursue' && d.pursue) { this.seg(d.pursue.from, d.pursue.future, COL.pursue); this.cross(d.pursue.future, COL.pursue, Y0, 0.25); this.seg(ph.pos, d.pursue.future, COL.pursue); }
          this.circle(ph.pos, P.evadeR, COL.evade, Y0, 32);
        }
      }
    }
    if (on.boids && swarm) {
      const f = swarm.flies[0], y = swarm.altOf(0);
      this.circle(f.pos, P.boidSepR, COL.sep, y, 32); this.circle(f.pos, P.boidAliR, COL.align, y, 40); this.circle(f.pos, P.boidCohR, COL.coh, y, 48);
      this.arrow(f.pos, f.vel, COL.seek, 1.2, y); this.cross(swarm.orbit, COL.target, y, 0.6);
    }
    const g = this.lines.geometry;
    g.setDrawRange(0, this.n * 2);
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }

  // chemin et couloir de marche (± demi-largeur)
  drawPath() {
    const pts = path.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      this.seg(a, b, COL.path);
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * path.radius, nz = dx / l * path.radius;
      if (i % 2 === 0) { this.seg({ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, 0x5560aa); this.seg({ x: a.x - nx, z: a.z - nz }, { x: b.x - nx, z: b.z - nz }, 0x5560aa); }
    }
  }
}
