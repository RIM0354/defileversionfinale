// Tests des steering behaviors (sans navigateur) : npm install && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Vehicle, combine } from '../js/vehicle.js';
import { Path } from '../js/path.js';
import { scalarProjection } from '../js/utils.js';
import { path, marks, podiumInside, fixedObstacles, photoInside, PHOTO_ZONE } from '../js/config.js';
import { DNA, nextGeneration, mutate, crossover } from '../js/genetic.js';
import { GENES } from '../js/genes.js';

const V = (x = 0, z = 0) => new THREE.Vector3(x, 0, z);
const DT = 1 / 50;
// Fait avancer un véhicule : forces() renvoie la liste des forces à appliquer à chaque pas
function run(v, seconds, forces) {
  for (let t = 0; t < seconds; t += DT) { for (const f of [].concat(forces(v, t))) v.applyForce(f); v.update(DT); }
}
const seeded = (v, seed = 1) => { let a = seed; v.rng = () => ((a = (a * 16807) % 2147483647) / 2147483647); return v; };

test('scalarProjection : projette sur le segment et borne t dans [0,1]', () => {
  const r = scalarProjection(V(3, 4), V(0, 0), V(10, 0));
  assert.ok(Math.abs(r.point.x - 3) < 1e-9 && Math.abs(r.point.z) < 1e-9);
  assert.ok(Math.abs(r.t - 0.3) < 1e-9);
  assert.equal(scalarProjection(V(-5, 2), V(0, 0), V(10, 0)).t, 0);
  assert.equal(scalarProjection(V(50, 2), V(0, 0), V(10, 0)).t, 1);
});

test('Seek : atteint la cible, vitesse bornée par maxSpeed', () => {
  const v = new Vehicle(0, 0); v.maxSpeed = 2; v.maxForce = 5;
  let vmax = 0;
  run(v, 8, (a) => { vmax = Math.max(vmax, a.vel.length()); return a.seek(V(10, 0)); });
  assert.ok(vmax <= 2 + 1e-9);
  assert.ok(v.pos.x > 9, `x=${v.pos.x}`);
});

test('Arrival : s’arrête sur la cible (< 5 cm, vitesse < 5 cm/s) sans dépasser de plus de 10 cm', () => {
  for (const [speed, force, radius] of [[1.0, 2.0, 1.2], [1.9, 2.0, 1.2], [1.9, 4.5, 3.5], [1.3, 3, 2.2]]) {
    const v = new Vehicle(0, 0); v.maxSpeed = speed; v.maxForce = force;
    let over = 0;
    run(v, 40, (a) => { over = Math.max(over, a.pos.x - 10); return a.arrive(V(10, 0), radius); });
    assert.ok(v.pos.distanceTo(V(10, 0)) < 0.05, `dist=${v.pos.distanceTo(V(10, 0))} (v=${speed},F=${force},R=${radius})`);
    assert.ok(v.vel.length() < 0.05);
    assert.ok(over < 0.1, `dépassement ${over}`);
  }
});

test('Flee : on s’éloigne de la menace', () => {
  const v = new Vehicle(1, 0);
  const d0 = v.pos.distanceTo(V(0, 0));
  run(v, 3, (a) => a.flee(V(0, 0)));
  assert.ok(v.pos.distanceTo(V(0, 0)) > d0 + 2);
});

test('Pursue : rattrape une cible mobile plus lente (et vise devant elle)', () => {
  const target = new Vehicle(8, 0); target.vel.set(0, 0, 1);   // avance en +z à 1 m/s
  const hunter = new Vehicle(0, 0); hunter.maxSpeed = 2.2; hunter.maxForce = 6;
  const f = hunter.pursue(target, 1.0);
  assert.ok(hunter.dbg.pursue.future.z > target.pos.z, 'le point visé est en avance sur la cible');
  let caught = false;
  for (let t = 0; t < 20 && !caught; t += DT) {
    target.pos.addScaledVector(target.vel, DT);
    hunter.applyForce(hunter.pursue(target, 1.0)); hunter.update(DT);
    caught = hunter.pos.distanceTo(target.pos) < 0.5;
  }
  assert.ok(caught);
});

test('Evade : s’éloigne de la position future d’un poursuivant', () => {
  const chaser = new Vehicle(-3, 0); chaser.vel.set(1, 0, 0);
  const v = new Vehicle(0, 0); v.maxSpeed = 1.5;
  const d0 = v.pos.distanceTo(chaser.pos);
  let d = d0;
  for (let t = 0; t < 4; t += DT) { chaser.pos.addScaledVector(chaser.vel, DT); v.applyForce(v.evade(chaser, 0.8)); v.update(DT); d = v.pos.distanceTo(chaser.pos); }
  assert.ok(d > d0 - 0.5, `d=${d}`);
  assert.ok(v.vel.x > 0.5, 'il fuit dans le sens opposé au poursuivant');
});

test('Wander : errance continue ; displaceRange plus grand = virages plus irréguliers', () => {
  // petit displaceRange : le point visé reste à angle quasi fixe → courbure constante (grands cercles) ;
  // grand displaceRange : le point saute → la vitesse de rotation varie beaucoup (écart-type élevé)
  const turnStd = (range) => {
    let acc = 0;
    for (const seed of [3, 5, 7, 11]) {
      const v = seeded(new Vehicle(0, 0), seed); v.maxSpeed = 1.2; v.vel.set(0, 0, 1); v.displaceRange = range;
      const rates = []; let prev = v.heading();
      run(v, 40, (a) => { const f = a.wander(); const h = a.heading(); rates.push(Math.atan2(Math.sin(h - prev), Math.cos(h - prev)) / DT); prev = h; return f; });
      assert.ok(v.vel.length() > 0.5, 'il avance toujours');
      const mean = rates.reduce((s, r) => s + r, 0) / rates.length;
      acc += Math.sqrt(rates.reduce((s, r) => s + (r - mean) ** 2, 0) / rates.length);
    }
    return acc / 4;
  };
  const calm = turnStd(0.03), wild = turnStd(1.4);
  assert.ok(wild > calm * 1.5, `${wild} > 1.5 × ${calm}`);
});

test('Path : project() trouve le point du chemin le plus proche, progression et écart latéral signés', () => {
  const p = new Path([[0, 0], [0, 10], [0, 20]], 0.5);
  const r = p.project(V(0.4, 7), 0);
  assert.ok(Math.abs(r.s - 7) < 0.3 && Math.abs(r.dist - 0.4) < 0.05);
  assert.ok(r.lateral * p.project(V(-0.4, 7), 0).lateral < 0, 'côtés gauche/droite de signes opposés');
  assert.ok(Math.abs(p.length - 20) < 0.2);
});

test('Path Following : revient sur le chemin et le parcourt jusqu’au bout', () => {
  const p = new Path([[0, 0], [0, 10], [5, 15], [10, 15]], 0.4);
  const v = new Vehicle(-2, -1); v.maxSpeed = 1.5; v.maxForce = 4; v.vel.set(0, 0, 0.5);
  let maxDev = 0;
  run(v, 30, (a, t) => { const f = a.followPath(p, 0.8, 1.8); if (t > 4) maxDev = Math.max(maxDev, Math.abs(a.lateral)); return f; });
  assert.ok(v.s > p.length - 2, `s=${v.s} / ${p.length}`);
  assert.ok(maxDev < 1.0, `écart max après stabilisation ${maxDev}`);
});

test('Obstacle Avoidance : ne rentre jamais dans l’obstacle (sur la trajectoire)', () => {
  for (const seed of [1, 2, 3]) {
    const obstacle = { pos: V(0, 8), r: 0.5 };
    const v = seeded(new Vehicle(0, 0), seed); v.maxSpeed = 1.4; v.maxForce = 3; v.vel.set(0, 0, 1);
    let min = Infinity;
    run(v, 14, (a) => { min = Math.min(min, a.pos.distanceTo(obstacle.pos)); return [a.seek(V(0, 20)), a.avoid([obstacle], 1.4, 0.25)]; });
    assert.ok(min > obstacle.r + v.r, `distance min ${min}`);
    assert.ok(v.pos.z > 15, 'il continue vers son but');
  }
});

test('Séparation : deux véhicules proches s’écartent', () => {
  const a = new Vehicle(0, 0), b = new Vehicle(0.4, 0);
  for (let t = 0; t < 3; t += DT) { a.applyForce(a.separate([a, b], 1.5)); b.applyForce(b.separate([a, b], 1.5)); a.update(DT); b.update(DT); }
  assert.ok(a.pos.distanceTo(b.pos) > 1.2);
});

test('Boids : l’alignement rapproche les vitesses, la cohésion regroupe', () => {
  const mk = (seed) => { const r = seeded(new Vehicle(), seed); return r; };
  const flock = Array.from({ length: 12 }, (_, i) => { const v = mk(i + 1); v.pos.set((v.rr() - 0.5) * 8, 0, (v.rr() - 0.5) * 8); v.vel.set(v.rr() - 0.5, 0, v.rr() - 0.5).multiplyScalar(2); v.maxSpeed = 2; return v; });
  const spreadV = () => { const m = new THREE.Vector3(); flock.forEach((f) => m.add(f.vel)); m.divideScalar(flock.length); return flock.reduce((s, f) => s + f.vel.distanceTo(m), 0) / flock.length; };
  const spreadP = () => { const m = new THREE.Vector3(); flock.forEach((f) => m.add(f.pos)); m.divideScalar(flock.length); return flock.reduce((s, f) => s + f.pos.distanceTo(m), 0) / flock.length; };
  const v0 = spreadV(), p0 = spreadP();
  for (let t = 0; t < 10; t += DT) { flock.forEach((f) => { f.applyForce(f.align(flock, 20)); f.applyForce(f.cohesion(flock, 20)); f.applyForce(f.separate(flock, 0.8).multiplyScalar(1.5)); }); flock.forEach((f) => f.update(DT)); }
  assert.ok(spreadV() < v0 * 0.7, `vitesses ${v0} -> ${spreadV()}`);
  assert.ok(spreadP() < p0, `positions ${p0} -> ${spreadP()}`);
});

test('Garde-fou : un véhicule lancé vers le bord reste dans le podium', () => {
  const v = new Vehicle(0, 0); v.maxSpeed = 1.5; v.maxForce = 4; v.vel.set(1.5, 0, 0);
  let minIn = Infinity;
  run(v, 12, (a) => { minIn = Math.min(minIn, podiumInside(a.pos)); return [a.boundaries(podiumInside, 0.6).multiplyScalar(3.5), a.seek(V(30, 0)).multiplyScalar(0.3)]; });
  assert.ok(minIn > -0.2, `distance min au bord ${minIn}`);
});

test('combine : respecte le budget de force', () => {
  const t = combine([V(3, 0), V(0, 3), V(5, 5)], 4);
  assert.ok(t.length() <= 4 + 1e-9);
  assert.ok(t.x > 0 && t.z >= 0);
});

test('Podium : le chemin reste à l’intérieur avec une marge, les 3 marques sont sur le chemin dans l’ordre', () => {
  assert.ok(podiumInside(V(0, 0)) > 0 && podiumInside(V(20, 0)) < 0);
  for (const p of path.points) assert.ok(podiumInside(p) > 0.6, `marge ${podiumInside(p)} en (${p.x}, ${p.z})`);
  assert.equal(marks.length, 3);
  marks.forEach((m, i) => { assert.ok(path.project(m.pos, 0, 400, 400).dist < 0.05); if (i) assert.ok(m.s > marks[i - 1].s + 3); });
  for (const o of fixedObstacles) for (const m of marks) assert.ok(o.pos.distanceTo(m.pos) > 2.5, 'aucun obstacle près d’une marque');
});

test('Algorithme génétique : élites conservées à leur emplacement, gènes dans leurs bornes', () => {
  const pop = Array.from({ length: 10 }, (_, i) => { const d = new DNA(); d.fitness = i; return d; });
  const next = nextGeneration(pop, 0.5, 2, 2);
  assert.equal(next.length, 10);
  for (const i of [9, 8]) { assert.ok(next[i].elite); assert.deepEqual(next[i].genes, pop[i].genes); }
  for (const d of next) for (const [k, , min, max] of GENES) assert.ok(d.genes[k] >= min && d.genes[k] <= max, k);
  const c = crossover(pop[0], pop[1]);
  for (const [k] of GENES) assert.ok(c.genes[k] === pop[0].genes[k] || c.genes[k] === pop[1].genes[k]);
  const m = mutate(new DNA(), 1);
  for (const [k, , min, max] of GENES) assert.ok(m.genes[k] >= min && m.genes[k] <= max);
});

test('Zone des photographes : dans le podium, et à plus de 1 m de toutes les voies de marche', () => {
  const corners = [[PHOTO_ZONE.x0, PHOTO_ZONE.z0], [PHOTO_ZONE.x1, PHOTO_ZONE.z0], [PHOTO_ZONE.x0, PHOTO_ZONE.z1], [PHOTO_ZONE.x1, PHOTO_ZONE.z1]];
  for (const [x, z] of corners) assert.ok(podiumInside(V(x, z)) > 0.2, `coin (${x}, ${z}) hors du podium`);
  assert.ok(photoInside(V(0, 13.2)) > 0 && photoInside(V(0, 11.35)) < 0);
  let minD = Infinity;
  for (const p of path.points) for (let x = PHOTO_ZONE.x0; x <= PHOTO_ZONE.x1; x += 0.3) for (const z of [PHOTO_ZONE.z0, PHOTO_ZONE.z1]) minD = Math.min(minD, Math.hypot(p.x - x, p.z - z));
  assert.ok(minD > 1.0, `distance min zone / chemin = ${minD}`);
});
