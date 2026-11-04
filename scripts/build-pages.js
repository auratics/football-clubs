// Builds the static demo for GitHub Pages into dist/. The real site runs on server.js and does not use this.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../data/leagues.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const SKIP = new Set(['admin.html', 'ads.txt', 'robots.txt']); // no server or domain root on Pages

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), dist, { recursive: true, filter: (f) => !SKIP.has(path.basename(f)) });
fs.copyFileSync(path.join(root, 'pages', 'demo.js'), path.join(dist, 'demo.js'));
fs.writeFileSync(path.join(dist, 'demo-data.js'), `window.DEMO_LEAGUES = ${JSON.stringify(LEAGUES)};\n`);

const index = path.join(dist, 'index.html');
const html = fs.readFileSync(index, 'utf8');
const tag = '<script src="app.js"></script>';
if (!html.includes(tag)) throw new Error('app.js script tag not found in index.html');
fs.writeFileSync(index, html
  .replace(tag, `<script src="demo-data.js"></script>\n  <script src="demo.js"></script>\n  ${tag}`)
  .replace('<head>', '<head>\n  <meta name="robots" content="noindex">'));
console.log('Demo built in dist/');
