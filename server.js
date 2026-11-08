// Most Irritating Club: tek dosyalık sunucu. Harici paket yok (Node 22.13+ gerekir).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from './data/leagues.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- Ayarlar (ortam değişkenleri) ----------
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const IP_LIMIT = Number(process.env.IP_VOTES_PER_LEAGUE_PER_WEEK) || 3; // aynı IP'den bir ligde haftada en fazla oy
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'votes.db');
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';   // ağustos hatırlatması için (ntfy.sh)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || ''; // ntfy bu adrese e-posta da gönderir
const WEEK = 7 * 24 * 3600 * 1000;

// ---------- Veritabanı ----------
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS leagues (
    id TEXT PRIMARY KEY, country TEXT NOT NULL, cc TEXT NOT NULL,
    name TEXT NOT NULL, tier INTEGER NOT NULL, sort INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS clubs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, cc TEXT NOT NULL,
    league_id TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (cc, name)
  );
  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER NOT NULL, league_id TEXT NOT NULL,
    voter TEXT NOT NULL, ip TEXT NOT NULL, country TEXT NOT NULL,
    ts INTEGER NOT NULL, month TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS votes_month ON votes (month, club_id);
  CREATE INDEX IF NOT EXISTS votes_voter ON votes (voter, league_id, ts);
  CREATE INDEX IF NOT EXISTS votes_ip ON votes (ip, league_id, ts);
  CREATE INDEX IF NOT EXISTS votes_ts ON votes (ts);
  CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
`);

const getSetting = (k) => db.prepare('SELECT v FROM settings WHERE k = ?').get(k)?.v;
const setSetting = (k, v) =>
  db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));

// Lig tanımları her açılışta güncellenir; kulüpler sadece ilk açılışta yüklenir
// (sonrasında kulüpler yönetici panelinden yönetilir).
{
  const up = db.prepare(`INSERT INTO leagues (id, country, cc, name, tier, sort) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET country = excluded.country, cc = excluded.cc, name = excluded.name,
    tier = excluded.tier, sort = excluded.sort`);
  LEAGUES.forEach((l, i) => up.run(l.id, l.country, l.cc, l.name, l.tier, i));
  if (db.prepare('SELECT COUNT(*) AS n FROM clubs').get().n === 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO clubs (name, cc, league_id) VALUES (?, ?, ?)');
    db.exec('BEGIN');
    for (const l of LEAGUES) for (const name of l.clubs.split('|')) ins.run(name.trim(), l.cc, l.id);
    db.exec('COMMIT');
  }
  if (!getSetting('salt')) setSetting('salt', crypto.randomBytes(32).toString('hex'));
}
const SALT = getSetting('salt');

// ---------- Yardımcılar ----------
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const prevMonthKey = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};

// Gerçek IP'yi sadece barındırma ortamının koyduğu başlıktan al (IP_HEADER), yoksa taklit edilebilir.
// Cloudflare arkasında: IP_HEADER=cf-connecting-ip  ·  Railway/Render vb.: IP_HEADER=x-forwarded-for
const IP_HEADER = (process.env.IP_HEADER || '').toLowerCase();
function clientIp(req) {
  let h = IP_HEADER ? req.headers[IP_HEADER] : '';
  if (h && IP_HEADER === 'x-forwarded-for') h = h.split(',').pop(); // son eklenen = platformun gördüğü
  return (h || req.socket.remoteAddress || '').trim();
}
function clientCountry(req) {
  const h = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country-code'];
  if (h && /^[A-Za-z]{2}$/.test(h) && h.toUpperCase() !== 'XX') return h.toUpperCase();
  const m = /^[a-z]{2,3}-([A-Z]{2})/i.exec(req.headers['accept-language'] || '');
  return m ? m[1].toUpperCase() : 'ZZ';
}
const hashIp = (ip) => crypto.createHmac('sha256', SALT).update(ip).digest('hex').slice(0, 32);

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function voterId(req, res) {
  let vid = parseCookies(req).vid;
  if (!vid || !/^[a-f0-9]{32}$/.test(vid)) {
    vid = crypto.randomBytes(16).toString('hex');
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `vid=${vid}; Path=/; Max-Age=63072000; HttpOnly; SameSite=Lax${secure}`);
  }
  return vid;
}

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 200_000) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// ---------- Kulüp listesi (önbellekli) ----------
let clubsCache = null;
function clubsPayload() {
  if (!clubsCache) {
    const leagues = db.prepare('SELECT id, country, cc, name, tier FROM leagues ORDER BY sort').all();
    const clubs = db.prepare('SELECT id, name, league_id FROM clubs WHERE active = 1 ORDER BY name').all()
      .map((c) => [c.id, c.name, c.league_id]);
    clubsCache = JSON.stringify({ leagues, clubs });
  }
  return clubsCache;
}

// ---------- Sıralamalar ----------
// period: 'all' | 'YYYY' | 'YYYY-MM'
// scope: 'world' | 'cc:XX' (oy verenin ülkesi) | 'country:gb-eng' (kulübün ülkesi) | 'league:ID'
let rankCache = new Map();
function ranking(period, scope) {
  const key = period + '|' + scope;
  if (rankCache.has(key)) return rankCache.get(key);
  const where = [], params = [];
  if (period === 'all') { /* hepsi */ }
  else if (/^\d{4}$/.test(period)) { where.push('v.month LIKE ?'); params.push(period + '-%'); }
  else if (/^\d{4}-\d{2}$/.test(period)) { where.push('v.month = ?'); params.push(period); }
  else if (/^before:\d{4}-\d{2}$/.test(period)) { where.push('v.month < ?'); params.push(period.slice(7)); } // o aya kadarki tüm zamanlar
  else return null;
  if (scope === 'world') { /* hepsi */ }
  else if (/^cc:[A-Z]{2}$/.test(scope)) { where.push('v.country = ?'); params.push(scope.slice(3)); }
  else if (/^country:[a-z]{2}(-[a-z]{3})?$/.test(scope)) { where.push('c.cc = ?'); params.push(scope.slice(8)); }
  else if (/^league:[a-z0-9]+$/.test(scope)) { where.push('v.league_id = ?'); params.push(scope.slice(7)); }
  else return null;

  const sql = `SELECT c.id, c.name, c.league_id AS league, COUNT(*) AS votes
    FROM votes v JOIN clubs c ON c.id = v.club_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY c.id ORDER BY votes DESC, c.name ASC`;
  const rows = db.prepare(sql).all(...params);
  let total = 0, rank = 0, last = -1;
  rows.forEach((r, i) => {
    total += r.votes;
    if (r.votes !== last) { rank = i + 1; last = r.votes; }
    r.rank = rank;
  });
  const result = { rows, total, byId: new Map(rows.map((r) => [r.id, r])) };
  rankCache.set(key, result);
  return result;
}

// Manşet: bu ay, bu yıl ve tüm zamanların 1.si ile bir önceki dönemin 1.si
function leaders() {
  const m = monthKey(), y = m.slice(0, 4);
  const top = (period) => { const t = ranking(period, 'world').rows[0]; return t ? { id: t.id, name: t.name, league: t.league, votes: t.votes } : null; };
  return {
    month: m,
    thisMonth: top(m), lastMonth: top(prevMonthKey(m)),
    thisYear: top(y), lastYear: top(String(Number(y) - 1)),
    allTime: top('all'), beforeMonth: top('before:' + m),
  };
}

function clubStats(clubId, country) {
  const club = db.prepare('SELECT id, name, league_id AS league, active FROM clubs WHERE id = ?').get(clubId);
  if (!club) return null;
  const m = monthKey();
  const pick = (r) => {
    const row = r.byId.get(club.id);
    return { rank: row?.rank ?? null, votes: row?.votes ?? 0, of: r.rows.length, total: r.total };
  };
  return {
    club,
    month: m,
    stats: {
      month: pick(ranking(m, 'world')),
      all: pick(ranking('all', 'world')),
      league: pick(ranking(m, 'league:' + club.league)),
      country: country !== 'ZZ' ? { cc: country, ...pick(ranking(m, 'cc:' + country)) } : null,
    },
  };
}

function movers() {
  const m = monthKey(), p = prevMonthKey(m);
  const cur = ranking(m, 'world'), prev = ranking(p, 'world');
  const strip = (r) => ({ id: r.id, name: r.name, league: r.league });
  const risers = cur.rows.map((r) => {
    const pr = prev.byId.get(r.id);
    const from = pr ? pr.rank : prev.rows.length + 1;
    return { ...strip(r), rank: r.rank, from, change: from - r.rank, isNew: !pr, votes: r.votes };
  }).filter((r) => r.change > 0).sort((a, b) => b.change - a.change || a.rank - b.rank).slice(0, 10);
  const fallers = prev.rows.map((r) => {
    const cr = cur.byId.get(r.id);
    const to = cr ? cr.rank : cur.rows.length + 1;
    return { ...strip(r), rank: to, from: r.rank, change: r.rank - to, votes: cr?.votes ?? 0 };
  }).filter((r) => r.change < 0).sort((a, b) => a.change - b.change || a.from - b.from).slice(0, 10);
  const since = Date.now() - WEEK;
  const trending = db.prepare(`SELECT c.id, c.name, c.league_id AS league, COUNT(*) AS votes
    FROM votes v JOIN clubs c ON c.id = v.club_id WHERE v.ts > ?
    GROUP BY c.id ORDER BY votes DESC, c.name LIMIT 10`).all(since);
  return { month: m, prev: p, risers, fallers, trending };
}

// ---------- Ağustos hatırlatması ----------
async function augustReminder() {
  const now = new Date();
  if (now.getUTCMonth() !== 7) return; // 7 = Ağustos
  const year = now.getUTCFullYear();
  if (getSetting('notified_' + year) || getSetting('season_updated_' + year)) return;
  const msg = `New season! Promoted/relegated clubs need updating. Open /admin on your site to update the club lists for ${year}/${String(year + 1).slice(2)}.`;
  console.log('[REMINDER]', msg);
  if (NTFY_TOPIC) {
    try {
      const headers = { Title: 'Update the club lists', Tags: 'soccer' };
      if (ADMIN_EMAIL) headers.Email = ADMIN_EMAIL;
      await fetch('https://ntfy.sh/' + encodeURIComponent(NTFY_TOPIC), { method: 'POST', body: msg, headers });
    } catch (e) { console.error('Reminder could not be sent:', e.message); return; }
  }
  setSetting('notified_' + year, now.toISOString());
}
setInterval(augustReminder, 3600 * 1000).unref();
augustReminder();

// ---------- Yönetici ----------
function isAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const pass = Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':');
  const a = Buffer.from(pass), b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function needAdmin(res) {
  send(res, 401, ADMIN_PASSWORD ? 'Login required' : 'Set the ADMIN_PASSWORD environment variable first.',
    { 'WWW-Authenticate': 'Basic realm="admin"' });
}

function saveLeagueClubs(leagueId, names) {
  const league = db.prepare('SELECT id, cc FROM leagues WHERE id = ?').get(leagueId);
  if (!league) throw new Error('unknown league');
  const clean = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
  const find = db.prepare('SELECT id FROM clubs WHERE cc = ? AND name = ?');
  const move = db.prepare('UPDATE clubs SET league_id = ?, active = 1 WHERE id = ?');
  const add = db.prepare('INSERT INTO clubs (name, cc, league_id) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  try {
    const keep = [];
    for (const name of clean) {
      const ex = find.get(league.cc, name);
      if (ex) { move.run(league.id, ex.id); keep.push(ex.id); }
      else keep.push(Number(add.run(name, league.cc, league.id).lastInsertRowid));
    }
    // Listeden çıkarılan kulüpler silinmez, pasif olur (eski oyları arşivde kalır).
    const current = db.prepare('SELECT id FROM clubs WHERE league_id = ? AND active = 1').all(league.id);
    const off = db.prepare('UPDATE clubs SET active = 0 WHERE id = ?');
    for (const c of current) if (!keep.includes(c.id)) off.run(c.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  clubsCache = null;
  rankCache = new Map();
}

// ---------- Statik dosyalar ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  if (pathname === '/privacy') pathname = '/privacy.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(buf);
  });
}

// ---------- Yönlendirme ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/clubs' && req.method === 'GET') {
      return send(res, 200, clubsPayload(), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    }

    if (p === '/api/me' && req.method === 'GET') {
      const vid = voterId(req, res);
      const rows = db.prepare('SELECT league_id, club_id, ts FROM votes WHERE voter = ? AND ts > ?').all(vid, Date.now() - WEEK);
      const votes = {};
      for (const r of rows) votes[r.league_id] = { club: r.club_id, next: r.ts + WEEK };
      return send(res, 200, { country: clientCountry(req), month: monthKey(), votes });
    }

    if (p === '/api/vote' && req.method === 'POST') {
      if (!(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'Bad request' });
      const body = await readJson(req);
      const club = db.prepare('SELECT id, league_id FROM clubs WHERE id = ? AND active = 1').get(Number(body.club));
      if (!club) return send(res, 404, { error: 'Club not found' });
      const vid = voterId(req, res);
      const now = Date.now(), since = now - WEEK;
      const mine = db.prepare('SELECT ts FROM votes WHERE voter = ? AND league_id = ? AND ts > ? ORDER BY ts DESC LIMIT 1')
        .get(vid, club.league_id, since);
      if (mine) return send(res, 429, { error: 'You already voted in this league this week.', next: mine.ts + WEEK });
      const ip = hashIp(clientIp(req));
      const ipCount = db.prepare('SELECT COUNT(*) AS n FROM votes WHERE ip = ? AND league_id = ? AND ts > ?')
        .get(ip, club.league_id, since).n;
      if (ipCount >= IP_LIMIT) return send(res, 429, { error: 'Too many votes from your network for this league this week.' });
      const country = clientCountry(req);
      db.prepare('INSERT INTO votes (club_id, league_id, voter, ip, country, ts, month) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(club.id, club.league_id, vid, ip, country, now, monthKey());
      rankCache = new Map();
      return send(res, 200, { ok: true, next: now + WEEK, ...clubStats(club.id, country) });
    }

    if (p === '/api/rankings' && req.method === 'GET') {
      const period = url.searchParams.get('period') || monthKey();
      const scope = url.searchParams.get('scope') || 'world';
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 500);
      const r = ranking(period, scope);
      if (!r) return send(res, 400, { error: 'Bad period or scope' });
      return send(res, 200, { period, scope, total: r.total, count: r.rows.length, rows: r.rows.slice(0, limit) });
    }

    if (p.startsWith('/api/club/') && req.method === 'GET') {
      const s = clubStats(Number(p.slice(10)), clientCountry(req));
      return s ? send(res, 200, s) : send(res, 404, { error: 'Club not found' });
    }

    if (p === '/api/movers' && req.method === 'GET') return send(res, 200, movers());
    if (p === '/api/leaders' && req.method === 'GET') return send(res, 200, leaders());

    if (p === '/api/periods' && req.method === 'GET') {
      const months = db.prepare('SELECT DISTINCT month FROM votes ORDER BY month DESC').all().map((r) => r.month);
      const cur = monthKey();
      if (!months.includes(cur)) months.unshift(cur);
      const years = [...new Set(months.map((m) => m.slice(0, 4)))];
      return send(res, 200, { current: cur, months, years });
    }

    // --- yönetici ---
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return needAdmin(res);
      if (p === '/api/admin/data' && req.method === 'GET') {
        const leagues = db.prepare('SELECT id, country, cc, name, tier FROM leagues ORDER BY sort').all();
        const clubs = db.prepare('SELECT name, league_id FROM clubs WHERE active = 1 ORDER BY name').all();
        for (const l of leagues) l.clubs = clubs.filter((c) => c.league_id === l.id).map((c) => c.name);
        const now = new Date(), y = now.getUTCFullYear();
        return send(res, 200, {
          leagues,
          reminder: now.getUTCMonth() === 7 && !getSetting('season_updated_' + y),
          seasonUpdated: getSetting('season_updated_' + y) || null,
          totalVotes: db.prepare('SELECT COUNT(*) AS n FROM votes').get().n,
        });
      }
      if (p === '/api/admin/league' && req.method === 'POST') {
        const body = await readJson(req);
        saveLeagueClubs(String(body.league), Array.isArray(body.clubs) ? body.clubs : []);
        return send(res, 200, { ok: true });
      }
      if (p === '/api/admin/season-done' && req.method === 'POST') {
        setSetting('season_updated_' + new Date().getUTCFullYear(), new Date().toISOString());
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (p === '/admin' || p === '/admin.html') {
      if (!isAdmin(req)) return needAdmin(res);
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
    return send(res, 405, 'Method not allowed');
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
