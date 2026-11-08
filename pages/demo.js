// GitHub Pages demo: stands in for server.js inside the browser by answering /api/* calls.
// Numbers are generated samples; a visitor's own votes stay in their localStorage.
(() => {
  window.DEMO_MODE = true;
  const WEEK = 7 * 24 * 3600 * 1000;
  const STORE = 'mhc-demo-votes';
  const COUNTRIES = ['TR', 'GB', 'US', 'ES', 'DE', 'IT', 'FR', 'BR', 'AR', 'NL'];
  const FAVOURITES = new Set(['Real Madrid', 'Barcelona', 'Manchester City', 'Manchester United', 'Liverpool', 'Chelsea', 'Arsenal',
    'Paris Saint-Germain', 'Bayern Munich', 'Juventus', 'Inter', 'Milan', 'Galatasaray', 'Fenerbahçe', 'Beşiktaş', 'Trabzonspor',
    'Boca Juniors', 'River Plate', 'Flamengo', 'Corinthians', 'Palmeiras', 'Atlético Madrid', 'Borussia Dortmund', 'Tottenham Hotspur',
    'Benfica', 'Porto', 'Ajax', 'Celtic', 'Rangers', 'Al Hilal', 'Al Nassr', 'Inter Miami', 'Al Ahly', 'Zamalek']);

  const clubs = [];
  for (const l of window.DEMO_LEAGUES) {
    for (const name of l.clubs.split('|')) clubs.push({ id: clubs.length + 1, name, league: l.id, active: 1 });
  }
  const clubById = new Map(clubs.map((c) => [c.id, c]));
  const leagueCc = Object.fromEntries(window.DEMO_LEAGUES.map((l) => [l.id, l.cc]));

  const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
  const monthsBack = (n) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); return monthKey(d); };
  const CURRENT = monthKey();
  const country = (/^[a-z]{2,3}-([A-Z]{2})/i.exec(navigator.language || '') || [])[1]?.toUpperCase() || 'ZZ';

  // Same numbers for every visitor: the generator is seeded, not random per page load.
  let seed = 20261;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const sample = [];
  const voted = clubs.filter((c) => FAVOURITES.has(c.name) || rnd() >= 0.35);
  for (const age of [3, 2, 1, 0]) {
    for (const c of voted) {
      const fav = FAVOURITES.has(c.name);
      const scale = (age === 0 ? 0.25 : 1) * (fav ? 300 + rnd() * 1400 : 3 + rnd() * 90);
      const countries = fav ? COUNTRIES : [COUNTRIES[Math.floor(rnd() * COUNTRIES.length)]];
      for (const cc of countries) {
        const n = Math.max(1, Math.round((scale / countries.length) * (0.4 + rnd() * 1.2)));
        sample.push({ club: c.id, league: c.league, month: monthsBack(age), country: cc, n });
      }
    }
  }

  const mine = () => { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } };
  const allVotes = () => sample.concat(mine().map((v) => ({ ...v, n: 1 })));

  function ranking(period, scope) {
    const counts = new Map();
    for (const v of allVotes()) {
      if (period !== 'all' && !(period.length === 4 ? v.month.startsWith(period + '-') : v.month === period)) continue;
      if (scope.startsWith('cc:') && v.country !== scope.slice(3)) continue;
      if (scope.startsWith('league:') && v.league !== scope.slice(7)) continue;
      if (scope.startsWith('country:') && leagueCc[v.league] !== scope.slice(8)) continue;
      counts.set(v.club, (counts.get(v.club) || 0) + v.n);
    }
    const rows = [...counts].map(([id, votes]) => { const c = clubById.get(id); return { id, name: c.name, league: c.league, votes }; })
      .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
    let total = 0, rank = 0, last = -1;
    rows.forEach((r, i) => { total += r.votes; if (r.votes !== last) { rank = i + 1; last = r.votes; } r.rank = rank; });
    return { rows, total, byId: new Map(rows.map((r) => [r.id, r])) };
  }

  function clubStats(id) {
    const club = clubById.get(id);
    if (!club) return null;
    const pick = (r) => { const row = r.byId.get(id); return { rank: row?.rank ?? null, votes: row?.votes ?? 0, of: r.rows.length, total: r.total }; };
    return {
      club, month: CURRENT,
      stats: {
        month: pick(ranking(CURRENT, 'world')),
        all: pick(ranking('all', 'world')),
        league: pick(ranking(CURRENT, 'league:' + club.league)),
        country: country !== 'ZZ' ? { cc: country, ...pick(ranking(CURRENT, 'cc:' + country)) } : null,
      },
    };
  }

  function movers() {
    const cur = ranking(CURRENT, 'world'), prev = ranking(monthsBack(1), 'world');
    const risers = cur.rows.map((r) => {
      const p = prev.byId.get(r.id), from = p ? p.rank : prev.rows.length + 1;
      return { id: r.id, name: r.name, league: r.league, rank: r.rank, from, change: from - r.rank, isNew: !p, votes: r.votes };
    }).filter((r) => r.change > 0).sort((a, b) => b.change - a.change || a.rank - b.rank).slice(0, 10);
    const fallers = prev.rows.map((r) => {
      const c = cur.byId.get(r.id), to = c ? c.rank : cur.rows.length + 1;
      return { id: r.id, name: r.name, league: r.league, rank: to, from: r.rank, change: r.rank - to, votes: c?.votes ?? 0 };
    }).filter((r) => r.change < 0).sort((a, b) => a.change - b.change || a.from - b.from).slice(0, 10);
    const trending = cur.rows.slice(0, 10).map((r) => ({ id: r.id, name: r.name, league: r.league, votes: Math.ceil(r.votes * 0.4) }));
    return { month: CURRENT, prev: monthsBack(1), risers, fallers, trending };
  }

  // server.js'teki previousLeader ile aynı mantık
  function previousLeader() {
    const months = [...new Set(allVotes().map((v) => v.month))].sort();
    const total = new Map();
    let holder = null, holderUntil = null, previous = null;
    for (const m of months) {
      for (const v of allVotes()) if (v.month === m) total.set(v.club, (total.get(v.club) || 0) + v.n);
      let best = null;
      for (const [id, votes] of total) {
        const name = clubById.get(id).name;
        if (!best || votes > best.votes || (votes === best.votes && name < best.name)) best = { id, name, league: clubById.get(id).league, votes };
      }
      if (holder && best.id !== holder.id) previous = { id: holder.id, name: holder.name, league: holder.league, until: holderUntil };
      if (!holder || best.id !== holder.id) holder = best;
      holderUntil = m;
    }
    return previous;
  }

  function route(url, opts = {}) {
    const p = url.pathname, q = url.searchParams;
    if (p.endsWith('/api/clubs')) {
      return [200, {
        leagues: window.DEMO_LEAGUES.map(({ id, country: c, cc, name, tier }) => ({ id, country: c, cc, name, tier })),
        clubs: [...clubs].sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.id, c.name, c.league]),
      }];
    }
    if (p.endsWith('/api/me')) {
      const votes = {};
      for (const v of mine()) if (v.ts > Date.now() - WEEK) votes[v.league] = { club: v.club, next: v.ts + WEEK };
      return [200, { country, month: CURRENT, votes }];
    }
    if (p.endsWith('/api/vote')) {
      const club = clubById.get(Number(JSON.parse(opts.body || '{}').club));
      if (!club) return [404, { error: 'Club not found' }];
      const list = mine(), now = Date.now();
      const prior = list.find((v) => v.league === club.league && v.ts > now - WEEK);
      if (prior) return [429, { error: 'You already voted in this league this week.', next: prior.ts + WEEK }];
      list.push({ club: club.id, league: club.league, month: CURRENT, country, ts: now });
      localStorage.setItem(STORE, JSON.stringify(list));
      return [200, { ok: true, next: now + WEEK, ...clubStats(club.id) }];
    }
    if (p.endsWith('/api/rankings')) {
      const period = q.get('period') || CURRENT, scope = q.get('scope') || 'world';
      const r = ranking(period, scope);
      return [200, { period, scope, total: r.total, count: r.rows.length, rows: r.rows.slice(0, Number(q.get('limit')) || 50) }];
    }
    if (p.includes('/api/club/')) {
      const s = clubStats(Number(p.split('/').pop()));
      return s ? [200, s] : [404, { error: 'Club not found' }];
    }
    if (p.endsWith('/api/movers')) return [200, movers()];
    if (p.endsWith('/api/leaders')) {
      const top = (period) => { const t = ranking(period, 'world').rows[0]; return t ? { id: t.id, name: t.name, league: t.league, votes: t.votes } : null; };
      const y = CURRENT.slice(0, 4);
      return [200, { month: CURRENT, thisMonth: top(CURRENT), lastMonth: top(monthsBack(1)), thisYear: top(y), lastYear: top(String(Number(y) - 1)),
        allTime: top('all'), previousLeader: previousLeader() }];
    }
    if (p.endsWith('/api/periods')) {
      const months = [0, 1, 2, 3].map(monthsBack);
      return [200, { current: CURRENT, months, years: [...new Set(months.map((m) => m.slice(0, 4)))] }];
    }
    return [404, { error: 'Not found' }];
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, opts) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.includes('/api/')) return realFetch(input, opts);
    const [status, body] = route(url, opts);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };

  // Keep it obvious that the rankings are not real results.
  const banner = document.createElement('div');
  banner.textContent = 'Demo preview: all numbers are made-up samples. Your votes stay in this browser only.';
  banner.style.cssText = 'background:#ffd54a;color:#111;text-align:center;font-size:13px;font-weight:600;padding:7px 12px';
  document.body.prepend(banner);
})();
