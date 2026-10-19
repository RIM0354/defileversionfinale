// =====================================================================================
//  Les « gènes » d'une mannequin = ses paramètres de steering.
//  Source unique : l'algorithme génétique les fait évoluer, l'interface les affiche et,
//  en mode manuel, les sliders les fixent pour toutes les mannequins.
//  [clé, libellé, min, max, valeur manuelle par défaut, pas, unité, comportement concerné]
// =====================================================================================
export const GENES = [
  ['maxSpeed',  'Vitesse maximale',               1.2, 1.9, 1.4, 0.01, 'm/s',  'Seek'],
  ['maxForce',  'Force maximale',                 2.0, 4.5, 3.0, 0.05, 'm/s²', 'Seek'],
  ['predictT',  'Prédiction de position future',  0.3, 1.5, 0.8, 0.05, 's',    'Path Following'],
  ['lookAhead', 'Distance du point visé',         1.0, 3.5, 1.8, 0.05, 'm',    'Path Following'],
  ['wPath',     'Poids du Path Following',        0.4, 2.0, 1.0, 0.05, '×',    'Path Following'],
  ['arrivalR',  'Rayon de ralentissement',        1.2, 3.5, 2.2, 0.05, 'm',    'Arrival'],
  ['wArrive',   'Poids de l’Arrival',             0.8, 2.5, 1.5, 0.05, '×',    'Arrival'],
  ['aheadT',    'Portée du vecteur « ahead »',    0.5, 2.5, 1.4, 0.05, 's',    'Obstacle Avoidance'],
  ['wAvoid',    'Poids de l’évitement',           0.5, 2.5, 1.2, 0.05, '×',    'Obstacle Avoidance'],
  ['sepR',      'Rayon de séparation',            0.6, 1.8, 1.0, 0.05, 'm',    'Séparation'],
  ['wSep',      'Poids de la séparation',         0.3, 2.0, 1.0, 0.05, '×',    'Séparation'],
  ['wFlee',     'Poids de la fuite des flashs',   0.2, 2.0, 1.0, 0.05, '×',    'Flee'],
];
export const GENE_KEYS = GENES.map((g) => g[0]);
export const GENE_INFO = Object.fromEntries(GENES.map(([k, label, min, max, def, step, unit, behavior]) => [k, { label, min, max, def, step, unit, behavior }]));
export const defaultGenes = () => Object.fromEntries(GENES.map((g) => [g[0], g[4]]));
