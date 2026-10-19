// =====================================================================================
//  Interface : HUD, panneau de paramètres (un groupe par steering behavior, avec sa case
//  « debug »), graphique de fitness et écran de statistiques de fin de défilé.
// =====================================================================================
import { GENES, GENE_INFO, defaultGenes } from './genes.js';

// Paramètres d'environnement (non évolués). [clé, libellé, min, max, défaut, pas, unité]
const ENV = {
  poseDur:       ['Durée de la pose', 0.5, 5, 1.6, 0.1, 's'],
  fleeR:         ['Rayon d’effet du flash', 1, 10, 4.5, 0.1, 'm'],
  flashRate:     ['Fréquence des flashs', 0.2, 3, 1.0, 0.05, '×'],
  wanderDist:    ['Distance du cercle', 0.5, 5, 1.8, 0.1, 'm'],
  wanderRadius:  ['Rayon du cercle', 0.2, 3, 0.9, 0.05, 'm'],
  wanderDisplace:['Variation d’angle', 0.05, 1.5, 0.45, 0.05, 'rad'],
  phSpeed:       ['Vitesse des photographes', 0.4, 2.2, 1.15, 0.05, 'm/s'],
  pursueT:       ['Temps de prédiction', 0.1, 2.5, 0.8, 0.05, 's'],
  shootDist:     ['Distance de prise de vue', 1.5, 8, 3.6, 0.1, 'm'],
  evadeR:        ['Rayon d’évitement', 0.8, 4.5, 1.6, 0.1, 'm'],
  boidSepW:      ['Poids séparation', 0, 4, 1.6, 0.05, '×'],
  boidSepR:      ['Rayon séparation', 0.5, 6, 1.8, 0.1, 'm'],
  boidAliW:      ['Poids alignement', 0, 4, 1.0, 0.05, '×'],
  boidAliR:      ['Rayon alignement', 1, 12, 5, 0.1, 'm'],
  boidCohW:      ['Poids cohésion', 0, 4, 0.8, 0.05, '×'],
  boidCohR:      ['Rayon cohésion', 1, 15, 7, 0.1, 'm'],
  boidSeekW:     ['Poids Seek (orbite)', 0, 3, 0.5, 0.05, '×'],
  boidSpeed:     ['Vitesse des lucioles', 0.5, 6, 2.8, 0.1, 'm/s'],
  mutation:      ['Taux de mutation', 0.02, 0.5, 0.15, 0.01, ''],
  size:          ['Taille des mannequins', 0.8, 1.25, 1.0, 0.01, '×'],
  grace:         ['Balancement des hanches', 0.2, 1.6, 1.0, 0.05, '×'],
  volume:        ['Volume de la musique', 0, 1, 0.7, 0.01, ''],
};

// Groupes du panneau : titre, explication, clé de debug, gènes concernés, paramètres d'environnement
const SECTIONS = [
  { title: 'Seek', info: 'Aller vers un point : vitesse désirée − vitesse actuelle, limitée par la force max.', debug: 'seek', genes: ['maxSpeed', 'maxForce'],
    legend: 'vert = vitesse désirée · bleu = vitesse · rouge = force' },
  { title: 'Path Following + projection scalaire', info: 'On projette la position future sur le chemin ; on vise un point plus loin sur le chemin.', debug: 'path', genes: ['predictT', 'lookAhead', 'wPath'],
    legend: 'rouge = position future · vert = point normal (projection) · jaune = point visé · bleu = couloir' },
  { title: 'Arrival', info: 'Ralentir dans un cercle pour s’arrêter pile sur la marque de pose.', debug: 'arrival', genes: ['arrivalR', 'wArrive'], env: ['poseDur'],
    legend: 'orange = cercle de ralentissement' },
  { title: 'Obstacle Avoidance', info: 'Deux vecteurs « ahead » devant la mannequin ; elle contourne l’obstacle menaçant.', debug: 'avoid', genes: ['aheadT', 'wAvoid'],
    legend: 'jaune = ahead · violet = ahead/2 · rouge = obstacle élargi' },
  { title: 'Séparation', info: 'Rester à distance des autres mannequins.', debug: 'separate', genes: ['sepR', 'wSep'], legend: 'cyan = rayon de séparation' },
  { title: 'Flee (flashs)', info: 'Fuir un flash : force ∝ proximité × fraîcheur.', debug: 'flee', genes: ['wFlee'], env: ['fleeR', 'flashRate'], legend: 'rose = rayon d’effet du flash' },
  { title: 'Wander (photographes)', info: 'Errance : un point glisse sur un cercle placé devant le photographe.', debug: 'wander', env: ['wanderDist', 'wanderRadius', 'wanderDisplace', 'phSpeed'],
    legend: 'bleu = cercle · vert = point visé' },
  { title: 'Pursue / Evade (photographes)', info: 'Les photographes suivent la mannequin de tête (position prédite) le long du bord de la barre, et s’écartent si elle approche trop.', debug: 'pursue', env: ['pursueT', 'shootDist', 'evadeR'],
    legend: 'vert = position prédite · rouge = rayon d’évitement' },
  { title: 'Boids (lucioles)', info: 'Séparation + alignement + cohésion, avec Seek vers un point qui orbite.', debug: 'boids', env: ['boidSepW', 'boidSepR', 'boidAliW', 'boidAliR', 'boidCohW', 'boidCohR', 'boidSeekW', 'boidSpeed'],
    legend: 'cyan = séparation · vert = alignement · orange = cohésion' },
  { title: 'Évolution & affichage', info: '', env: ['mutation', 'size', 'grace', 'volume'] },
];

const f2 = (v, step) => (+v).toFixed(step < 0.1 ? 2 : 1);

export class UI {
  constructor(hooks) {
    this.hooks = hooks;
    this.$ = (id) => document.getElementById(id);
    this.P = {};
    for (const [k, v] of Object.entries(ENV)) this.P[k] = v[3];
    this.manual = false;
    this.manualGenes = defaultGenes();
    this.history = [];
    this.geneInputs = {};
    this.buildPanel();
    this.chart = this.$('chart'); this.cx = this.chart.getContext('2d');
    this.bindButtons();
  }

  // ---------------------------------------------------------------------------- panneau
  buildPanel() {
    const host = this.$('sliders');
    // mode des gènes
    const mode = document.createElement('div'); mode.className = 'mode';
    mode.innerHTML = `<b>Paramètres des mannequins</b>
      <label><input type="radio" name="gmode" value="evo" checked> Évolution : chaque mannequin a ses gènes (affichés = moyenne)</label>
      <label><input type="radio" name="gmode" value="man"> Manuel : mes réglages pour toutes (l’évolution est suspendue)</label>`;
    host.appendChild(mode);
    mode.querySelectorAll('input').forEach((r) => r.addEventListener('change', () => this.setManual(r.value === 'man')));

    const mk = (key, label, min, max, def, step, unit, isGene) => {
      const row = document.createElement('label'); row.className = 'row';
      row.innerHTML = `<span class="lab">${label}</span><output>${f2(def, step)} ${unit}</output><input type="range" min="${min}" max="${max}" step="${step}" value="${def}">`;
      const input = row.querySelector('input'), out = row.querySelector('output');
      input.addEventListener('input', () => {
        const v = +input.value; out.textContent = `${f2(v, step)} ${unit}`;
        if (isGene) this.manualGenes[key] = v; else { this.P[key] = v; if (key === 'volume') this.hooks.setVolume(v); }
      });
      if (isGene) { input.disabled = true; this.geneInputs[key] = { input, out, step, unit }; }
      return row;
    };
    for (const s of SECTIONS) {
      const d = document.createElement('details'); d.open = ['Seek', 'Path Following + projection scalaire', 'Arrival'].includes(s.title);
      const head = document.createElement('summary');
      head.innerHTML = `<span>${s.title}</span>`;
      if (s.debug) {
        const cb = document.createElement('label'); cb.className = 'dbgcb'; cb.innerHTML = `<input type="checkbox"> voir`;
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.querySelector('input').addEventListener('change', (e) => { this.hooks.setDebug(s.debug, e.target.checked); });
        head.appendChild(cb);
      }
      d.appendChild(head);
      if (s.info) { const p = document.createElement('p'); p.className = 'info'; p.textContent = s.info; d.appendChild(p); }
      if (s.legend) { const p = document.createElement('p'); p.className = 'legend2'; p.textContent = s.legend; d.appendChild(p); }
      for (const g of s.genes || []) { const i = GENE_INFO[g]; d.appendChild(mk(g, i.label, i.min, i.max, i.def, i.step, i.unit, true)); }
      for (const e of s.env || []) { const [label, min, max, def, step, unit] = ENV[e]; d.appendChild(mk(e, label, min, max, def, step, unit, false)); }
      host.appendChild(d);
    }
  }

  setManual(m) {
    this.manual = m;
    for (const [k, g] of Object.entries(this.geneInputs)) {
      g.input.disabled = !m;
      if (m) { g.input.value = this.manualGenes[k]; g.out.textContent = `${f2(this.manualGenes[k], g.step)} ${g.unit}`; }
    }
    document.body.classList.toggle('manual', m);
    this.hooks.setManual(m);
  }

  // en mode évolution, les sliders de gènes montrent la moyenne de la population
  showMeanGenes(mean) {
    if (this.manual) return;
    for (const [k, g] of Object.entries(this.geneInputs)) { g.input.value = mean[k]; g.out.textContent = `${f2(mean[k], g.step)} ${g.unit}`; }
  }

  // ---------------------------------------------------------------------------- boutons
  bindButtons() {
    const h = this.hooks;
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => h.setView(+b.dataset.view)));
    document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => { h.setSpeed(+b.dataset.speed); this.markSpeed(+b.dataset.speed); }));
    this.$('btn-pause').addEventListener('click', () => h.togglePause());
    this.$('btn-mute').addEventListener('click', () => h.toggleMute());
    this.$('btn-reset').addEventListener('click', () => h.reset());
    this.$('btn-train').addEventListener('click', () => h.startTraining(10));
    this.$('btn-panel').addEventListener('click', () => document.body.classList.toggle('panel-hidden'));
    this.$('btn-hud').addEventListener('click', () => document.body.classList.toggle('hud-hidden'));
    this.$('btn-fx').addEventListener('click', () => h.toggleFx());
    this.$('btn-next').addEventListener('click', () => h.nextGeneration());
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'radio' && e.target.type !== 'range') return;
      if (e.key === 'Enter') { if (this.statsOpen) { e.preventDefault(); h.nextGeneration(); } return; }
      if (e.key >= '1' && e.key <= '4') h.setView(+e.key - 1);
      else if (e.key === ' ') { e.preventDefault(); h.togglePause(); }
      else if (e.key.toLowerCase() === 'm') h.toggleMute();
      else if (e.key.toLowerCase() === 'p') document.body.classList.toggle('panel-hidden');
      else if (e.key.toLowerCase() === 'h') document.body.classList.toggle('hud-hidden');
      else if (e.key.toLowerCase() === 'f') h.toggleFullscreen();
    });
  }

  markSpeed(v) { document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === v)); }
  markView(v) { document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', +b.dataset.view === v)); }
  setPaused(p) { this.$('btn-pause').textContent = p ? '▶ Reprendre' : '❚❚ Pause'; }
  setMuted(m) { this.$('btn-mute').textContent = m ? '🔇' : '🔊'; }
  setTraining(txt) { const t = this.$('training'); t.textContent = txt; t.classList.toggle('show', !!txt); this.$('btn-train').classList.toggle('on', !!txt); }

  // ---------------------------------------------------------------------------- HUD
  hud({ gen, time, record, mean, active, total, focus, manual }) {
    this.$('h-gen').textContent = manual ? '—' : gen;
    this.$('h-time').textContent = `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
    this.$('h-rec').textContent = record > -1e8 ? record.toFixed(1) : '—';
    this.$('h-mean').textContent = mean === null ? '—' : mean.toFixed(1);
    this.$('h-active').textContent = `${active}/${total} sur le podium`;
    this.$('h-focus').textContent = focus ? `Suivie : ${focus.name}${focus.tag ? ' ' + focus.tag : ''}` : '';
    this.$('h-mode').textContent = manual ? 'MODE MANUEL' : 'ÉVOLUTION';
  }

  pushHistory(best, mean) {
    const rec = Math.max(best, this.history.length ? this.history[this.history.length - 1].rec : -1e9);
    this.history.push({ best, mean, rec }); this.drawChart();
  }
  clearHistory() { this.history = []; this.drawChart(); }

  drawChart() {
    const c = this.chart, x = this.cx, W = c.width, H = c.height; x.clearRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = 8 + (H - 22) * i / 4; x.beginPath(); x.moveTo(30, y); x.lineTo(W - 6, y); x.stroke(); }
    const h = this.history;
    if (!h.length) { x.fillStyle = 'rgba(255,255,255,0.45)'; x.font = '12px system-ui'; x.fillText('la courbe apparaît à la fin du 1er défilé', 40, H / 2); return; }
    const maxV = Math.max(100, ...h.map((d) => d.rec)) * 1.02, minV = Math.min(0, ...h.map((d) => d.mean));
    const X = (i) => 30 + (W - 40) * (h.length === 1 ? 0.5 : i / (h.length - 1)), Y = (v) => 8 + (H - 22) * (1 - (v - minV) / (maxV - minV));
    const line = (key, col, w) => { x.strokeStyle = col; x.lineWidth = w; x.beginPath(); h.forEach((d, i) => (i ? x.lineTo(X(i), Y(d[key])) : x.moveTo(X(i), Y(d[key])))); x.stroke(); x.fillStyle = col; h.forEach((d, i) => { x.beginPath(); x.arc(X(i), Y(d[key]), 3, 0, 6.3); x.fill(); }); };
    x.globalAlpha = 0.5; line('best', '#ff6fb5', 1.5); x.globalAlpha = 1; line('mean', '#7fd6ff', 2.4); line('rec', '#ffd36e', 2);
    x.fillStyle = 'rgba(255,255,255,0.6)'; x.font = '10px system-ui';
    x.fillText(maxV.toFixed(0), 2, 14); x.fillText(minV.toFixed(0), 2, H - 12); x.fillText(`gén. ${h.length}`, W - 48, H - 3);
  }

  // ------------------------------------------------------------------ statistiques de fin de défilé
  // results : un objet par mannequin ; prev : gènes moyens de la génération précédente (ou null)
  showStats({ gen, manual, results, meanGenesNow, meanGenesPrev, record, prevMean, duration }) {
    const sorted = [...results].sort((a, b) => b.fitness - a.fitness);
    const n = results.length;
    const mean = sorted.reduce((a, r) => a + r.fitness, 0) / n;
    const colls = sorted.reduce((a, r) => a + r.collisions, 0);
    const dur = duration;
    const delta = prevMean === null ? '' : `<small class="${mean >= prevMean ? 'up' : 'down'}">${mean >= prevMean ? '▲' : '▼'} ${Math.abs(mean - prevMean).toFixed(1)} vs gén. précédente</small>`;
    const cm = (v) => `${Math.round(v * 100)} cm`;
    const rows = sorted.map((r, i) => `<tr><td>${i + 1}</td><td>${r.tag ? r.tag + ' ' : ''}${r.name}</td><td>${r.avgSpeed.toFixed(2)} m/s</td><td>${cm(r.avgLat)}</td>
      <td>${r.stopErr.map(cm).join(' · ')}</td><td>${r.collisions}</td><td><b>${r.fitness.toFixed(1)}</b></td></tr>`).join('');
    let genesHtml = '';
    if (!manual) {
      genesHtml = `<h4>Évolution des paramètres de steering (moyenne de la population)</h4><div class="genes">` + GENES.map(([k, label, , , , step, unit]) => {
        const v = meanGenesNow[k], p = meanGenesPrev ? meanGenesPrev[k] : null;
        const d = p === null ? '' : `<i class="${v >= p ? 'up' : 'down'}">${v >= p ? '▲' : '▼'} ${Math.abs(((v - p) / p) * 100).toFixed(0)} %</i>`;
        return `<div><small>${label}</small><b>${f2(v, step)} ${unit}</b>${d}</div>`;
      }).join('') + '</div>';
    }
    this.$('stats').innerHTML = `
      <h2>${manual ? 'Défilé terminé — mode manuel' : `Génération ${gen} — défilé terminé`}</h2>
      <div class="sum"><div><small>Meilleure fitness</small><b>${sorted[0].fitness.toFixed(1)}</b><small>${sorted[0].name}</small></div>
        <div><small>Fitness moyenne</small><b>${mean.toFixed(1)}</b>${delta}</div>
        <div><small>Record</small><b>${record.toFixed(1)}</b></div>
        <div><small>Collisions</small><b>${colls}</b></div>
        <div><small>Durée du défilé</small><b>${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')}</b></div></div>
      <table><thead><tr><th>#</th><th>Mannequin</th><th>Vitesse de croisière</th><th>Écart à l’axe</th><th>Écart d’arrêt marques 1·2·3</th><th>Collisions</th><th>Fitness</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="formula">fitness = 30·vitesse + 30·précision d’arrêt + 25·fidélité à l’axe + 15·poses/3 − 10·collisions</p>
      ${genesHtml}
      <div class="go"><button id="btn-next2" class="primary">${manual ? 'Relancer un défilé' : 'Génération suivante'} ⏎</button>
        <span>${manual ? '' : '♛ les 2 meilleures sont conservées · 8 nouvelles naissent par croisement + mutation · '}appuie sur ENTRÉE</span></div>`;
    this.$('btn-next2').addEventListener('click', () => this.hooks.nextGeneration());
    this.$('stats').scrollTop = 0;
    this.$('stats').classList.add('show'); this.statsOpen = true;
  }
  hideStats() { this.$('stats').classList.remove('show'); this.statsOpen = false; }
}
