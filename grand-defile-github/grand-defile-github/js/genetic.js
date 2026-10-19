// =====================================================================================
//  Algorithme génétique : l'ADN d'une mannequin est l'ensemble de ses paramètres de steering.
//    • sélection par tournoi (taille 3)         • croisement uniforme (gène par gène)
//    • mutation gaussienne (taux réglable)      • élitisme (les 2 meilleures passent telles quelles)
//  Les élites gardent leur emplacement dans l'ordre de départ : mêmes conditions d'une génération
//  à l'autre, donc comparaison équitable.
// =====================================================================================
import { GENES, GENE_KEYS, GENE_INFO } from './genes.js';
import { gaussian, clamp } from './utils.js';

export class DNA {
  constructor(genes = null) {
    this.genes = {};
    for (const [k, , min, max] of GENES) this.genes[k] = genes ? genes[k] : min + Math.random() * (max - min);
    this.fitness = 0;
    this.born = 1;        // génération de naissance
    this.elite = false;
  }
  copy() { const d = new DNA(this.genes); d.fitness = this.fitness; d.born = this.born; d.elite = this.elite; return d; }
}

export function crossover(a, b) {
  const g = {};
  for (const k of GENE_KEYS) g[k] = Math.random() < 0.5 ? a.genes[k] : b.genes[k];
  return new DNA(g);
}

// Chaque gène a une probabilité « rate » de varier d'un bruit gaussien (écart-type = 12 % de la plage).
export function mutate(d, rate = 0.15) {
  for (const k of GENE_KEYS) {
    if (Math.random() < rate) {
      const { min, max } = GENE_INFO[k];
      d.genes[k] = clamp(d.genes[k] + gaussian(0, (max - min) * 0.12), min, max);
    }
  }
  return d;
}

export function tournament(pop, size = 3) {
  let best = null;
  for (let i = 0; i < size; i++) {
    const c = pop[Math.floor(Math.random() * pop.length)];
    if (!best || c.fitness > best.fitness) best = c;
  }
  return best;
}

export function nextGeneration(pop, mutRate = 0.15, elites = 2, gen = 1) {
  const order = pop.map((d, i) => i).sort((a, b) => pop[b].fitness - pop[a].fitness);
  const next = new Array(pop.length).fill(null);
  for (const i of order.slice(0, elites)) { const c = pop[i].copy(); c.fitness = 0; c.elite = true; next[i] = c; }
  for (let i = 0; i < next.length; i++) {
    if (next[i]) continue;
    const child = mutate(crossover(tournament(pop), tournament(pop)), mutRate);
    child.born = gen;
    next[i] = child;
  }
  return next;
}

// Valeur moyenne de chaque gène dans la population (pour suivre l'évolution)
export function meanGenes(pop) {
  const m = {};
  for (const k of GENE_KEYS) m[k] = pop.reduce((a, d) => a + d.genes[k], 0) / pop.length;
  return m;
}
