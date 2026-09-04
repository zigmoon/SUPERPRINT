/* =========================================================================
   SUPERPRINT — PRINT BRIDGE (pont d'impression local)
   ------------------------------------------------------------------------
   Mini-serveur Node lancé AVEC la version locale (sp213-local) qui permet
   à la pop-in VPS (Virtual Print Studio) de :
     1. DÉTECTER les imprimantes du réseau local (mDNS/IPP),
     2. LIRE leurs capacités (formats, couleur, recto-verso, bac, …),
     3. ENVOYER le PDF d'impression directement via IPP (Print-Job).

   Dépendances npm : bonjour-service (mDNS) + ipp (protocole IPP).

   Endpoints (CORS ouvert pour le dev local) :
     GET  /api/health   → { ok: true }                 (le front teste ça)
     GET  /api/printers → liste des imprimantes réseau + capacités
     POST /api/print    → { printerId, pdfBase64, copies, color, media,
                            duplex, orientation } → envoie le job IPP

   Démarré par : node scripts/print-bridge.mjs   (port 8766 par défaut)
   ========================================================================= */
import http from 'node:http';
import os from 'node:os';
import { Bonjour } from 'bonjour-service';
import ipp from 'ipp';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.SP_PRINT_PORT || 8766);
const HOST = process.env.SP_PRINT_HOST || '127.0.0.1';
const DISCOVERY_SECONDS = 4;

// ─── CORS helpers ───
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  };
}
function json(res, status, obj) {
  res.writeHead(status, { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// ─── Découverte mDNS des imprimantes ───
const bonjour = new Bonjour();
let discovered = [];
let discovering = false;

async function discoverPrinters() {
  if (discovering) return discovered;
  discovering = true;
  discovered = [];
  const found = new Map();

  const collect = (service) => {
    const key = (service.fqdn || '') + (service.port || '') + (service.host || '');
    if (found.has(key)) return;
    const txt = service.txt || {};
    // L'URL IPP est le point d'entrée pour envoyer un job
    const url = service.txt && (service.txt.ipp || service.txt.rp)
      ? `ipp://${service.host || service.referer?.host || 'localhost'}:${service.port}/${service.txt.rp || 'ipp/print'}`
      : `ipp://${service.host || 'localhost'}:${service.port}/ipp/print`;
    found.set(key, {
      id: randomUUID(),
      name: service.name || service.fqdn || 'Imprimante réseau',
      fqdn: service.fqdn || '',
      host: service.host || '',
      port: service.port || 631,
      type: service.type || '_ipp._tcp',
      txt,
      url,
      isLocalBridge: false
    });
  };

  // Types mDNS courants pour les imprimantes réseau
  const types = ['ipp', 'pdl-datastream', 'printer'];
  const browser = bonjour.find({ type: 'ipp' }, (s) => collect(s));
  // pdl-datastream (raw 9100) : souvent les imprimantes génériques
  try { bonjour.find({ type: 'pdl-datastream' }, (s) => collect(s)); } catch (_) {}
  try { bonjour.find({ type: 'printer' }, (s) => collect(s)); } catch (_) {}

  await new Promise((r) => setTimeout(r, DISCOVERY_SECONDS * 1000));
  try { browser.stop(); } catch (_) {}
  discovered = Array.from(found.values());
  discovering = false;
  return discovered;
}

// ─── Capacités via IPP (Get-Printer-Attributes) ───
function getPrinterAttributes(printer) {
  return new Promise((resolve) => {
    try {
      const printerObj = ipp.Printer(printer.url, { uri: printer.url });
      const msg = { 'operation-attributes-tag': { 'requested-attributes': ['printer-name', 'printer-make-and-model', 'printer-state', 'printer-info', 'printer-location', 'media-supported', 'color-supported', 'sides-supported', 'printer-resolution-supported', 'printer-is-accepting-jobs', 'marker-levels', 'marker-names', 'document-format-supported'] } };
      printerObj.execute('Get-Printer-Attributes', msg, (err, res2) => {
        if (err) { resolve({ ...printer, attributes: null, error: String(err.message || err) }); return; }
        const a = (res2 && res2['printer-attributes-tag']) || {};
        resolve({
          ...printer,
          attributes: {
            model: a['printer-make-and-model'] || a['printer-info'] || printer.name,
            state: a['printer-state'],
            accepting: a['printer-is-accepting-jobs'] === true,
            color: a['color-supported'] === true,
            media: a['media-supported'] || [],
            sides: a['sides-supported'] || [],
            formats: a['document-format-supported'] || [],
            resolution: a['printer-resolution-supported'] || [],
            markerLevels: a['marker-levels'] || [],
            markerNames: a['marker-names'] || [],
            location: a['printer-location']
          }
        });
      });
    } catch (e) {
      resolve({ ...printer, attributes: null, error: String(e.message || e) });
    }
  });
}

// ─── Envoi d'un job IPP (Print-Job) ───
function sendPrintJob(printer, opts) {
  return new Promise((resolve) => {
    try {
      const printerObj = ipp.Printer(printer.url, { uri: printer.url });
      const pdf = Buffer.from(opts.pdfBase64, 'base64');
      const msg = {
        'operation-attributes-tag': {
          'requesting-user-name': os.userInfo().username || 'superprint',
          'job-name': opts.jobName || 'SuperPrint job',
          'document-format': 'application/pdf'
        },
        'job-attributes-tag': {
          copies: Math.max(1, parseInt(opts.copies, 10) || 1),
          'print-color-mode': opts.color === 'bw' ? 'monochrome' : 'color',
          sides: opts.duplex === 'duplex' ? 'two-sided-long-edge' : 'one-sided',
          media: opts.media || 'iso_a4_210x297mm',
          orientation: opts.orientation === 'l' ? 'landscape' : 'portrait'
        },
        data: pdf
      };
      printerObj.execute('Print-Job', msg, (err, res2) => {
        if (err) {
          resolve({ ok: false, error: String(err.message || err) });
          return;
        }
        resolve({ ok: true, statusCode: res2['status-code'], jobId: res2['job-id'], message: (res2['status-message'] || 'ok') });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e.message || e) });
    }
  });
}

// ─── Serveur HTTP ───
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); res.end(); return; }
  const url = (req.url || '/').split('?')[0];

  try {
    if (req.method === 'GET' && url === '/api/health') {
      json(res, 200, { ok: true, name: 'superprint-print-bridge', version: 1, port: PORT });
      return;
    }
    if (req.method === 'GET' && url === '/api/printers') {
      const list = await discoverPrinters();
      const withAttrs = await Promise.all(list.map(getPrinterAttributes));
      json(res, 200, { printers: withAttrs });
      return;
    }
    if (req.method === 'POST' && url === '/api/print') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        let data = {};
        try { data = JSON.parse(body || '{}'); } catch (_) { json(res, 400, { ok: false, error: 'Invalid JSON' }); return; }
        const list = await discoverPrinters();
        const printer = list.find((p) => p.id === data.printerId);
        if (!printer) { json(res, 404, { ok: false, error: 'Printer not found — re-scan the network' }); return; }
        if (!data.pdfBase64) { json(res, 400, { ok: false, error: 'Missing pdfBase64' }); return; }
        const result = await sendPrintJob(printer, data);
        json(res, result.ok ? 200 : 502, result);
      });
      return;
    }
    json(res, 404, { ok: false, error: 'Not found' });
  } catch (e) {
    json(res, 500, { ok: false, error: String(e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('🖨️  SUPERPRINT PRINT BRIDGE');
  console.log('   http://' + HOST + ':' + PORT + '/api/health');
  console.log('   Imprimantes : GET  /api/printers');
  console.log('   Imprimer    : POST /api/print');
  console.log('');
});

process.on('SIGINT', () => { try { bonjour.destroy(); } catch (_) {} process.exit(0); });
