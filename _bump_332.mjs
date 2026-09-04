import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const appFiles = [
  'superprint/app/index.html',
  'superprint/app/service-worker.js',
  'superprint/app/landing.html',
  'superprint/app/llms.txt',
  'superprint/app/llms-full.txt',
  'superprint/app/documentation.html',
  'superprint/landing.html',
  'superprint/service-worker.js',
  'superprint/llms.txt',
  'superprint/llms-full.txt',
  'superprint/documentation.html',
  'superprint/version.txt',
  'superprint/VERSIONING.md',
  'superprint/sp213-studio.html',
  'sp213-local/public/superprint/app/index.html',
  'sp213-local/public/superprint/app/service-worker.js',
  'sp213-local/public/superprint/app/landing.html',
  'sp213-local/public/superprint/app/llms.txt',
  'sp213-local/public/superprint/app/llms-full.txt',
  'sp213-local/public/superprint/app/documentation.html',
  'sp213-local/public/superprint/landing.html',
  'sp213-local/public/superprint/service-worker.js',
  'sp213-local/public/superprint/llms.txt',
  'sp213-local/public/superprint/llms-full.txt',
  'sp213-local/public/superprint/documentation.html',
  'sp213-local/public/superprint/version.txt',
  'sp213-local/public/superprint/sp213-studio.html',
  'sp213-local/package.json',
  'sp213-local/package-lock.json'
];

for (const relative of appFiles) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`Missing release file: ${relative}`);
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replaceAll('1.7.331', '1.7.332').replaceAll('v331', 'v332');
  if (after === before && !before.includes('1.7.332') && !before.includes('v332')) {
    throw new Error(`No app version marker found: ${relative}`);
  }
  fs.writeFileSync(file, after);
}

const cliFile = path.join(root, 'superprint-npm/cli.mjs');
const cliBefore = fs.readFileSync(cliFile, 'utf8');
const cliAfter = cliBefore.replace("const MIN_APP_VERSION = '1.7.331';", "const MIN_APP_VERSION = '1.7.332';");
if (cliAfter === cliBefore) throw new Error('MIN_APP_VERSION marker not found');
fs.writeFileSync(cliFile, cliAfter);

console.log(`Bumped ${appFiles.length} app files to 1.7.332 and npm launcher minimum to 1.7.332.`);