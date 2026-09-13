#!/usr/bin/env node
// tools/serve.mjs — serveur statique minimal pour tester les pages en local.
//
// SuperPrint est du HTML/CSS/JS pur : aucun build n'est nécessaire pour
// l'éditeur. Ce serveur sert simplement un dossier (par défaut `superprint/`).
//
// Usage :
//   node tools/serve.mjs                     -> sert superprint/ sur le port 8080
//   node tools/serve.mjs superprint 9000     -> dossier + port au choix
//
// Puis : http://127.0.0.1:8080/app/index.html
//
// NOTE : pour tester un fichier modifié malgré le service worker, ouvrir avec
// un paramètre de cache, par exemple ?v=test — sinon le SW peut servir
// l'ancienne version.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const target = path.resolve(ROOT, process.argv[2] || 'superprint');
const port = Number(process.argv[3]) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.icc': 'application/vnd.iccprofile', '.icm': 'application/vnd.iccprofile',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.wasm': 'application/wasm'
};

if (!fs.existsSync(target)) {
  console.error('ERREUR : dossier introuvable ->', target);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const filePath = path.join(target, urlPath);
  // Garde-fou : ne jamais sortir du dossier servi.
  if (!filePath.startsWith(target)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log('SuperPrint server up');
  console.log('  dossier : ' + target);
  console.log('  editeur : http://127.0.0.1:' + port + '/app/index.html');
  console.log('  studio  : http://127.0.0.1:' + port + '/sp213-studio.html');
  console.log('  accueil : http://127.0.0.1:' + port + '/');
  console.log('  (Ctrl+C pour arreter)');
});
