// =====================================================================================
//  Le Grand Défilé — orchestrateur : rendu, simulation à pas fixe, générations, caméras.
//
//  Déroulement :  défilé de 10 mannequins  →  écran de statistiques (reste affiché)
//                 →  ENTRÉE  →  algorithme génétique  →  génération suivante.
// =====================================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { Mannequin } from './mannequin.js';
import { Photographer } from './photographer.js';
import { FireflySwarm } from './flock.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { DebugDraw } from './debug.js';
import { DNA, nextGeneration, meanGenes } from './genetic.js';
import { fixedObstacles, marks, N_MANNEQUINS, SPAWN_DELAY, PODIUM_H, path } from './config.js';
import { clamp, lerp, smooth } from './utils.js';

// ---------------------------------------------------------------- rendu
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;

const world = new World(renderer);
const scene = world.scene;
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 140);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.07; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 1.2; controls.maxDistance = 60;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 1.2);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let fx = true;

// ---------------------------------------------------------------- caméras
const VIEWS = [
  { pos: [0, 4.2, 27], tgt: [0, 1.7, 4], fov: 46 },      // salle
  { pos: [18, 12, 24], tgt: [0, 0.5, 2.5], fov: 48 },    // aérienne
  { pos: [0, 34, 3.5], tgt: [0, 0, -0.5], fov: 44 },     // dessus
];
let viewMode = 0, tween = null;
function setView(i) {
  viewMode = i; ui.markView(i);
  if (i < 3) {
    const v = VIEWS[i];
    tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...v.pos), t1: new THREE.Vector3(...v.tgt), f0: camera.fov, f1: v.fov };
  } else if (focus) {
    const p = focus.pos, h = focus.vel.lengthSq() > 0.01 ? focus.vel.clone().normalize() : new THREE.Vector3(0, 0, 1);
    tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(p.x - h.z * 2.4 - h.x * 1.5, PODIUM_H + 1.5, p.z + h.x * 2.4 - h.z * 1.5), t1: new THREE.Vector3(p.x, PODIUM_H + 1.1, p.z), f0: camera.fov, f1: 40 };
  }
}

// ---------------------------------------------------------------- agents
const audio = new AudioEngine();
const mannequins = [];
const PH_START = [[-4, 13.2], [0.5, 13.2], [4.5, 13.2]];
const photographers = PH_START.map(([x, z], i) => new Photographer(x, z, i));
const swarm = new FireflySwarm(scene, world.glowTexture());
photographers.forEach((p) => scene.add(p.group));
const flashes = [];
const flashSprites = Array.from({ length: 8 }, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: world.glowTexture(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  s.visible = false; scene.add(s); return { s, t0: -10 };
});
const debug = new DebugDraw(scene);

// ---------------------------------------------------------------- état du jeu
let ui;
let pop = Array.from({ length: N_MANNEQUINS }, () => new DNA());
let gen = 1, record = -1e9, passT = 0, spawnIdx = 0, running = false, started = false, paused = false, timeScale = 2;
let realT = 0, stepAcc = 0, simT = 0, intensity = 0, focus = null, selected = null;
let training = 0, awaitingNext = false, lastMean = null, prevMeanGenes = null, prevMeanFit = null, lastFlashClock = 0;
const ctx = {
  P: null, t: 0, obstacles: [], mannequins, photographers, flashes, manual: false, manualGenes: null,
  beat: 0, tryFlash,
};

// Un défilé : 10 mannequins créées à partir de la population courante
function startPassage() {
  ui.hideStats(); awaitingNext = false;
  for (const m of mannequins) m.dispose(scene);
  mannequins.length = 0;
  pop.forEach((dna, i) => mannequins.push(new Mannequin(i, dna, scene)));
  flashes.length = 0;
  photographers.forEach((p, i) => p.resetState(...PH_START[i]));
  passT = 0; realT = 0; spawnIdx = 0; running = true;
  ui.showMeanGenes(meanGenes(pop));
}

// Fin du défilé : fitness, historique, statistiques (affichées jusqu'à ENTRÉE)
function endPassage() {
  running = false;
  const results = mannequins.map((m, i) => { pop[i].fitness = m.fitness; return m.result; });
  const fits = results.map((r) => r.fitness);
  const best = Math.max(...fits), mean = fits.reduce((a, b) => a + b, 0) / fits.length;
  const manual = ctx.manual;
  if (!manual) { record = Math.max(record, best); ui.pushHistory(best, mean); }
  const now = meanGenes(pop);
  const payload = { gen, manual, results, meanGenesNow: now, meanGenesPrev: manual ? null : prevMeanGenes, record: record > -1e8 ? record : best, prevMean: manual ? null : prevMeanFit, duration: training ? passT : realT };
  if (!manual) { prevMeanGenes = now; prevMeanFit = mean; }
  lastMean = mean;
  if (training && gen < training && !manual) { nextGen(); return; }                // entraînement : on enchaîne
  if (training) { training = 0; ui.setTraining(''); }
  audio.cheer(0.8);
  ui.showStats(payload); awaitingNext = true;
}

// Génération suivante (ENTRÉE) : algorithme génétique puis nouveau défilé
function nextGen() {
  if (!ctx.manual) { pop = nextGeneration(pop, ui.P.mutation, 2, gen + 1); gen++; }
  if (training) ui.setTraining(`Simulation… génération ${gen}/${training}`);
  startPassage();
}
function onNext() { if (awaitingNext) nextGen(); }

function reset() {
  pop = Array.from({ length: N_MANNEQUINS }, () => new DNA());
  gen = 1; record = -1e9; lastMean = null; prevMeanGenes = null; prevMeanFit = null; training = 0; ui.setTraining('');
  ui.clearHistory();
  if (started) startPassage();
}

function startTraining(n = 10) {
  if (training) { training = 0; ui.setTraining(''); return; }
  if (ctx.manual || !started) return;
  training = gen + n; ui.hideStats(); ui.setTraining(`Simulation… génération ${gen}/${training}`);
  if (awaitingNext) nextGen();
}

// ---------------------------------------------------------------- flashs
function tryFlash(ph) {
  const pos = ph.pos.clone(); pos.y = PODIUM_H + 1.55;
  flashes.push({ pos, t0: ctx.t, photographer: ph });
  while (flashes.length > 24) flashes.shift();
  if (training) return;
  world.fireFlashLight(pos, performance.now() / 1000, 160);
  lastFlashClock = performance.now() / 1000;
  audio.flash(pos.x, clamp(1 - camera.position.distanceTo(pos) / 60, 0.3, 1));
  const fs = flashSprites.reduce((a, b) => (a.t0 < b.t0 ? a : b)); fs.t0 = performance.now() / 1000; fs.s.position.copy(pos); fs.s.visible = true;
}

// File d'attente de chaque marque : les mannequins qui visent la marque k et en sont à moins de 6 m
// (le long du chemin). Celle qui pose passe en premier, puis la plus proche de la marque.
function updateQueues() {
  for (let k = 0; k < marks.length; k++) {
    const list = mannequins.filter((m) => m.active && m.nextMark === k && marks[k].s - m.s < 6);
    list.sort((a, b) => (b.state === 'posing') - (a.state === 'posing') || b.s - a.s);
    list.forEach((m, i) => { m.queueRank = i; });
  }
  for (const m of mannequins) if (m.active && (m.nextMark >= marks.length || marks[m.nextMark].s - m.s >= 6)) m.queueRank = -1;
}

// ---------------------------------------------------------------- simulation (pas fixe 1/50 s)
function simStep(dt) {
  simT += dt;
  ctx.P = ui.P; ctx.manual = ui.manual; ctx.manualGenes = ui.manualGenes;
  ctx.beat = audio.started ? audio.getBeat().pulse : 0;
  if (running) {
    passT += dt; ctx.t = passT;                       // horloge de la simulation = temps du défilé
    while (spawnIdx < mannequins.length && passT >= spawnIdx * SPAWN_DELAY) mannequins[spawnIdx++].spawn(passT);
  } else ctx.t = simT;
  ctx.obstacles = fixedObstacles.concat(photographers);
  for (const p of photographers) p.step(dt, ctx);
  if (running) {
    updateQueues();
    for (const m of mannequins) m.step(dt, ctx);
    // sécurité : un défilé ne peut pas durer plus de 8 minutes simulées
    if (passT > 480) { console.warn('défilé interrompu (sécurité)'); mannequins.forEach((m) => { if (!m.done) m.finish(ctx); }); }
    if (spawnIdx >= mannequins.length && mannequins.every((m) => m.done)) endPassage();
  }
  if (!training) swarm.step(dt, simT, ctx.beat, ui.P);
}

// ---------------------------------------------------------------- sélection d'une mannequin au clic
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PODIUM_H);
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;   // glisser = orbite, pas un clic
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(plane, hit)) return;
  let best = null, bd = 1.6;
  for (const m of mannequins) { if (!m.active) continue; const d = Math.hypot(m.pos.x - hit.x, m.pos.z - hit.z); if (d < bd) { bd = d; best = m; } }
  selected = best;
});

// ---------------------------------------------------------------- boucle
const clock = new THREE.Clock();
let hudT = 0, frame = 0;
function loop() {
  requestAnimationFrame(loop);
  const real = Math.min(clock.getDelta(), 0.05);
  if (running && !paused && !training) realT += real;   // durée réelle du défilé (chronomètre du HUD)
  if (!paused && started) {
    if (training) {
      const t0 = performance.now();
      while (performance.now() - t0 < 50 && training) simStep(1 / 50);
    } else {
      // un défilé ne doit pas dépasser ~1 minute réelle : au-delà de 45 s, la simulation accélère progressivement
      const boost = running ? 1 + Math.max(0, realT - 45) / 6 : 1;
      stepAcc = Math.min(stepAcc + real * timeScale * boost, 1.0);
      while (stepAcc >= 1 / 50) { simStep(1 / 50); stepAcc -= 1 / 50; }
    }
  }
  const active = mannequins.filter((m) => m.active);
  intensity = lerp(intensity, 10 * active.length / N_MANNEQUINS, 1 - Math.exp(-real * 0.8));
  audio.setIntensity(intensity);
  // mannequin suivie : celle qu'on a cliquée, sinon la plus avancée
  if (selected && !selected.active) selected = null;
  focus = selected || active.reduce((a, m) => (!a || m.s > a.s ? m : a), null);

  const b = audio.started ? audio.getBeat() : { pulse: 0, phase: 0 };
  const now = performance.now() / 1000;
  if (!training) {
    for (const m of mannequins) m.show(real, ctx);
    for (const p of photographers) p.show(real, simT);
  }
  world.update(real, now, b.pulse, intensity, audio.started ? audio.bpm : 100 + 3.4 * intensity);
  if (ctx.P) debug.update(ctx, focus, photographers, swarm);
  for (const f of flashSprites) { const a = now - f.t0; if (a > 0.3) f.s.visible = false; else { const k = 1 - a / 0.3; f.s.material.opacity = k * k; f.s.scale.setScalar(0.25 + 1.5 * (1 - k)); } }
  renderer.toneMappingExposure = 1.05 + 0.25 * Math.max(0, 1 - (now - lastFlashClock) * 7) + 0.05 * b.pulse;
  bloom.strength = 0.3 + 0.22 * b.pulse;

  if (tween) {
    tween.t = Math.min(1, tween.t + real / 1.3); const k = smooth(tween.t);
    camera.position.lerpVectors(tween.p0, tween.p1, k); controls.target.lerpVectors(tween.t0, tween.t1, k); camera.fov = lerp(tween.f0, tween.f1, k); camera.updateProjectionMatrix();
    if (tween.t >= 1) tween = null;
  } else if (viewMode === 3 && focus) {
    const goal = new THREE.Vector3(focus.pos.x, PODIUM_H + 1.1, focus.pos.z);
    const delta = goal.clone().sub(controls.target).multiplyScalar(1 - Math.exp(-real * 3));
    controls.target.add(delta); camera.position.add(delta);
  }
  controls.update();
  frame++;
  if (training && frame % 6) { /* simulation rapide : on ne rend qu'une image sur 6 */ } else if (fx) composer.render(); else renderer.render(scene, camera);

  hudT -= real;
  if (hudT <= 0) {
    hudT = 0.12;
    ui.hud({ gen, time: training ? passT : realT, record, mean: lastMean, active: active.length, total: N_MANNEQUINS, focus, manual: ui.manual });
  }
}

// ---------------------------------------------------------------- interface
function setSpeedUI(v) { timeScale = v; ui.markSpeed(v); }
ui = new UI({
  setView, setSpeed: setSpeedUI,
  togglePause: () => { paused = !paused; ui.setPaused(paused); if (audio.ctx) paused ? audio.ctx.suspend() : audio.ctx.resume(); },
  toggleMute: () => { audio.setMuted(!audio.muted); ui.setMuted(audio.muted); },
  setVolume: (v) => audio.setVolume(v),
  setDebug: (k, v) => { debug.on[k === 'pursue' ? 'pursue' : k] = v; },
  setManual: () => {},
  reset, startTraining, nextGeneration: onNext, toggleFx: () => { fx = !fx; },
  toggleFullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
});
ui.drawChart(); ui.markSpeed(timeScale);
ctx.P = ui.P; ctx.manualGenes = ui.manualGenes;
camera.position.set(...VIEWS[0].pos); controls.target.set(...VIEWS[0].tgt); controls.update();

function enter() {
  if (started) return;
  document.getElementById('intro').classList.add('gone');
  audio.start(); audio.setVolume(ui.P.volume);
  started = true; startPassage();
}
document.getElementById('go').addEventListener('click', enter);
window.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !started) enter(); });
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

// accès pour les tests automatiques
window.__game = {
  ui, world, mannequins, photographers, ctx, debug, swarm, camera, controls, enter, setView, simStep, nextGen, onNext, startTraining,
  setSpeed: (v) => { timeScale = v; },
  get gen() { return gen; }, get running() { return running; }, get passT() { return passT; }, get record() { return record; },
  get pop() { return pop; }, get awaitingNext() { return awaitingNext; }, get training() { return training; },
};
if (new URLSearchParams(location.search).has('auto')) enter();
document.getElementById('intro').classList.toggle('gone', new URLSearchParams(location.search).has('auto'));
loop();
