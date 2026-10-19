// Test de longue durée dans un navigateur (optionnel) : npm i -D playwright && node test/browser-soak.mjs [générations]
// Vérifie sur plusieurs générations : 3 poses par mannequin, aucun passage hors du podium, aucune erreur.
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); s.end(d); } });
}).listen(8199);
const G = +process.argv[2] || 5;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 700, height: 440 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8199/index.html?auto=1'); await page.waitForTimeout(1500);
const report = await page.evaluate(async (G) => {
  const g = window.__game, cfg = await import('/js/config.js'); g.setSpeed(0);
  const out = []; let minInside = 9;
  for (let k = 0; k < G; k++) {
    let n = 0;
    while (!g.awaitingNext && n++ < 80000) {
      g.simStep(1 / 50);
      for (const m of g.mannequins) if (m.active) minInside = Math.min(minInside, cfg.podiumInside(m.pos));
    }
    const rs = g.mannequins.map((m) => m.result);
    out.push({ gen: g.gen, duree_s: Math.round(g.passT), poses: rs.map((r) => r.poses).join(''), collisions: rs.reduce((a, r) => a + r.collisions, 0), fitness_moy: +(rs.reduce((a, r) => a + r.fitness, 0) / rs.length).toFixed(1) });
    g.onNext();
  }
  return { out, minInside };
}, G);
console.table(report.out);
const ok = report.out.every((r) => r.poses === '3'.repeat(10)) && report.minInside > 0 && errors.length === 0;
console.log(`marge minimale au bord du podium : ${report.minInside.toFixed(2)} m · erreurs : ${errors.length} → ${ok ? 'OK' : 'ÉCHEC'}`);
await browser.close(); srv.close(); process.exit(ok ? 0 : 1);
