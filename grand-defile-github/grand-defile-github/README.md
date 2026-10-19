# Le Grand Défilé — steering behaviors 3D + algorithme génétique

Dix mannequins autonomes défilent sur un podium en T. Chacune est un **Vehicle** (Reynolds, GDC 1999) piloté
uniquement par des **steering behaviors** : elle suit un chemin, s'arrête sur les 3 marques de pose, évite
vases / projecteurs / photographes, fuit les flashs et reste à distance des autres. Les **paramètres de steering**
de chaque mannequin sont ses gènes : un **algorithme génétique** les fait évoluer de génération en génération.

## Lancer

```bash
cd grand-defile
python3 -m http.server 8000      # puis ouvrir http://localhost:8000
```
Three.js est fourni dans `libs/` (rien à installer). Clique « Commencer » (ou ENTRÉE).

## Déroulement

1. Un défilé : 10 mannequins partent du backstage (une toutes les 2 s), font la boucle (couloir → tour de la barre en T → retour).
2. **Chacune s'arrête sur les 3 marques** (une seule mannequin à la fois par marque, les autres font la queue derrière), pose, repart.
3. À la fin : **écran de statistiques** (classement, vitesse, écart à l'axe, écart d'arrêt sur chaque marque, collisions, fitness,
   évolution moyenne des 12 paramètres). Il **reste affiché jusqu'à ce que tu appuies sur ENTRÉE**.
4. ENTRÉE → algorithme génétique → génération suivante.

Commandes : souris (orbite/zoom) · clic sur une mannequin (la suivre en debug) · `1-4` vues · `Espace` pause · `Entrée` génération suivante ·
`P` panneau · `H` HUD · `M` son · `F` plein écran · ×1/×2/×4 vitesse · « ⏩ 10 générations » enchaîne 10 générations sans pause (stats à la fin).

## Les steering behaviors (panneau de droite — « voir » dessine le comportement)

| Comportement | Principe (code) | Paramètres | Ce que dessine « voir » |
|---|---|---|---|
| **Seek** (`vehicle.js › seek`) | vitesse désirée = direction de la cible × vitesse max ; force = désirée − vitesse (limitée) | vitesse max, force max | vert = vitesse désirée · bleu = vitesse · rouge = force |
| **Path Following + projection scalaire** (`followPath`, `path.js › project`, `utils.js › scalarProjection`) | position future → projection scalaire sur le segment → point normal → on vise un point plus loin sur le chemin | prédiction (s), distance du point visé (m), poids | rouge = position future · vert = point normal · jaune = point visé · bleu = couloir |
| **Arrival** (`arrive`) | Seek dont la vitesse désirée décroît linéairement dans un cercle | rayon de ralentissement, poids, durée de pose | cercle orange |
| **Obstacle Avoidance** (`avoid`) | vecteurs « ahead » et « ahead/2 » ; si leur bout entre dans le cercle élargi d'un obstacle, déviation latérale du côté libre | portée du ahead (s), poids | jaune = ahead · violet = ahead/2 · rouge = obstacle élargi |
| **Séparation** (`separate`) | chaque voisin plus proche que le rayon repousse (∝ 1/d) | rayon, poids | cercle cyan |
| **Flee** (`flee`) | Seek inversé ; force ∝ proximité × fraîcheur du flash | poids (gène) ; rayon d'effet et fréquence des flashs | cercle rose autour du flash |
| **Wander** (`wander`, photographes) | un point glisse sur un cercle placé devant le véhicule | distance, rayon, variation d'angle, vitesse | cercle bleu + point visé vert |
| **Pursue / Evade** (`pursue`, `evade`, photographes) | on vise la position **future** de la cible (pos + vitesse × T) ; Evade = l'inverse. Les photographes suivent la mannequin de tête le long du bord de la barre | temps de prédiction, rayon d'évitement | position prédite verte, rayon rouge |
| **Boids** (`align`, `cohesion`, `separate`, `flock.js`, lucioles) | séparation + alignement + cohésion + Seek vers un point qui orbite | 3 poids, 3 rayons de perception, Seek, vitesse | 3 cercles autour d'une luciole |
| **Queuing** (`mannequin.js`) | on ne rattrape jamais la mannequin qui précède (vitesse plafonnée selon l'écart réel) | — | — |
| **Garde-fou** (`boundaries`) | distance signée exacte au contour du podium ; rappel vers l'intérieur | — | — |

Les forces sont composées **par priorité avec un budget de force** (`combine()`, Reynolds « Combining behaviors ») :
garde-fou > évitement > queuing > séparation > fuite > chemin/arrêt.

### Gènes (paramètres évolués) et mode manuel
12 gènes (`genes.js`) : vitesse max, force max, prédiction, distance du point visé, poids du path following, rayon d'arrivée,
poids d'arrivée, portée du ahead, poids d'évitement, rayon et poids de séparation, poids de fuite.
En mode **Évolution**, chaque mannequin a ses gènes (les sliders affichent la moyenne). En mode **Manuel**, tes sliders s'appliquent à
toutes les mannequins (l'évolution est suspendue) : pratique pour comprendre l'effet d'un paramètre avec « voir ».

## Algorithme génétique (`genetic.js`)
Sélection par tournoi (3) · croisement uniforme gène par gène · mutation gaussienne (taux réglable) · élitisme (2 meilleures, marquées ♛, gardent leur emplacement de départ → mêmes conditions d'évaluation).

**Fitness** (mesures physiques, normalisées 0-1) :
`30·vitesse de croisière + 30·précision d'arrêt (30 cm → 0) + 25·fidélité à l'axe (60 cm → 0) + 15·poses/3 − 10·collisions`.
Compromis : aller vite fait gagner des points mais dégrade l'arrêt et augmente les collisions.

Résultats mesurés sur 10 générations (simulation) : fitness moyenne 53 → 83 · écart d'arrêt 16 → 7 cm · collisions 9 → 0 · durée du défilé 103 s → 83 s simulées.

**Durée d'un défilé : ~1 minute.** La simulation tourne à ×2 par défaut (≈ 45 s réelles) ; au-delà de 45 s réelles elle accélère progressivement. Le chronomètre du HUD affiche la durée réelle.

Les photographes évoluent dans une bande au bord avant de la barre (entre la voie de marche et le public) : ils n'occupent jamais les voies où marchent les mannequins.

## Tests
```bash
npm install && npm test        # 16 tests des steering behaviors, du chemin, du podium et de l'algorithme génétique
```
`test/browser-soak.mjs` (Playwright, optionnel) fait tourner plusieurs générations dans un navigateur et vérifie : 3 poses par mannequin, aucune sortie du podium, aucune erreur.

## Fichiers
```
index.html style.css
js/vehicle.js      Vehicle + tous les steering behaviors + combine()
js/path.js         chemin, projection scalaire
js/config.js       podium (contour exact), chemin, 3 marques, obstacles fixes
js/mannequin.js    agent mannequin (steering, file d'attente, arrêt sur marque, fitness)
js/photographer.js photographes (Wander, Pursue, Evade) et flashs
js/flock.js        boids (lucioles)
js/genes.js        les 12 gènes (bornes, unités)
js/genetic.js      algorithme génétique
js/debug.js        dessin des rayons et vecteurs
js/ui.js main.js   interface, simulation à pas fixe, générations
js/world.js rig.js audio.js   décor 3D, modèle de mannequin, musique
```

