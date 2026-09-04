// Mini serveur HTTP statique pour tester le studio + SuperPrint en local
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 🛡️ v1.7.293 : chemin DYNAMIQUE (plus de c:/Users/... en dur).
// Le dossier du script est <racine>/scripts → la racine de l'app est
// <racine>/public/superprint (où vivent sp213-studio.html et app/).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'public', 'superprint');
const PORT = 8765;const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/sp213-studio.html';
    // Résolution sécurisée : on remplace les \ par / pour Windows, on retire les ..
    const safePath = urlPath.replace(/\\/g, '/').replace(/\.\./g, '');
    const filePath = ROOT + (safePath.startsWith('/') ? safePath : '/' + safePath);
    const st = await stat(filePath).catch(() => null);
    if (!st || !st.isFile()) {
      res.writeHead(404); res.end('Not found: ' + urlPath); return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});

server.listen(PORT, () => {
  console.log('Studio SP213 : http://localhost:' + PORT + '/sp213-studio.html');
  console.log('SuperPrint   : http://localhost:' + PORT + '/app/index.html');
});
