// Serveur statique minimal, sans dépendance, pour ouvrir le banc d'essai.
//
// Pourquoi un serveur : le `fetch()` d'un `.wasm` est **refusé** en `file://`
// par Chrome et Firefox (origine opaque). La page doit donc passer par HTTP,
// même en local, sinon elle tomberait systématiquement dans le repli et ne
// prouverait rien.
//
// C'est aussi une occasion de vérifier une chose que le déploiement réel doit
// faire : servir le `.wasm` avec le type MIME `application/wasm`. Un serveur qui
// répond `application/octet-stream` casse `instantiateStreaming` (nous utilisons
// `instantiate`, donc ça fonctionne quand même — mais autant le faire bien).
//
// Usage :
//   node scripts/serve-web.mjs [port]        (défaut : 8777)
//
// puis :
//   http://127.0.0.1:8777/web/demo.html

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const racineDossier = resolve(join(root, '..'));
const port = Number(process.argv[2] ?? 8777);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  // Le type officiel : sans lui, `instantiateStreaming` refuse le module.
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.icc': 'application/vnd.iccprofile',
};

/** Empêche de sortir du dossier racine du dépôt via `..` dans l'URL. */
function resoudre(urlPath) {
  const propre = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const cible = resolve(join(racineDossier, normalize(propre)));
  if (cible !== racineDossier && !cible.startsWith(racineDossier + sep)) return null;
  return cible;
}

const serveur = createServer(async (req, res) => {
  const cible = resoudre(req.url ?? '/');
  if (!cible) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('hors du dépôt');
    return;
  }

  let chemin = cible;
  try {
    const info = await stat(chemin);
    if (info.isDirectory()) chemin = join(chemin, 'index.html');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('introuvable : ' + req.url);
    return;
  }

  try {
    const corps = await readFile(chemin);
    res.writeHead(200, {
      'content-type': TYPES[extname(chemin).toLowerCase()] ?? 'application/octet-stream',
      'content-length': corps.length,
      'cache-control': 'no-store',
    });
    res.end(corps);
  } catch (erreur) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(erreur.message ?? erreur));
  }
});

serveur.listen(port, '127.0.0.1', () => {
  console.log(`banc d'essai : http://127.0.0.1:${port}/superprint_rust/web/demo.html`);
  console.log(`(racine servie : ${racineDossier})`);
});
