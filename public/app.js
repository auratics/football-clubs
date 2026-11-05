// Most Irritated Club: ön yüz (framework yok)
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const flag = (cc) => `<img class="flag" src="https://flagcdn.com/w40/${esc(cc.toLowerCase())}.png" alt="" loading="lazy">`;
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const monthName = (m) => new Date(m + '-15T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dateStr = (ts) => new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/ø/g, 'o').replace(/ł/g, 'l').replace(/ß/g, 'ss').toLowerCase();
  const regionName = (() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (cc) => d.of(cc); } catch { return (cc) => cc; } })();

  async function api(url, opts) {
    const r = await fetch(url, { credentials: 'same-origin', ...opts });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { data, status: r.status });
    return data;
  }

  const S = { leagues: [], leagueById: {}, clubs: [], clubById: {}, me: { votes: {}, country: 'ZZ' }, selected: null, month: '' };

  // ---------- Başlangıç ----------
  async function init() {
    const [clubs, me, periods] = await Promise.all([api('/api/clubs'), api('/api/me'), api('/api/periods')]);
    S.leagues = clubs.leagues;
    S.leagues.forEach((l) => (S.leagueById[l.id] = l));
    S.clubs = clubs.clubs.map(([id, name, league]) => ({ id, name, league, n: norm(name) }));
    S.clubs.forEach((c) => (S.clubById[c.id] = c));
    S.me = me;
    S.month = me.month;
    $('edition').textContent = `${monthName(S.month)} edition`;

    setupPickers();
    setupPeriods(periods);
    setupScopes();
    setupTableFilter();
    refreshHome();

    const q = new URLSearchParams(location.search);
    if (q.get('club')) openClub(Number(q.get('club')));
  }

  // ---------- Oy verme ----------
  function setupPickers() {
    const countries = [];
    for (const l of S.leagues) if (!countries.find((c) => c.cc === l.cc)) countries.push({ cc: l.cc, name: l.country });
    $('country').innerHTML = countries.map((c) => `<option value="${esc(c.cc)}">${esc(c.name)}</option>`).join('');
    // Kullanıcının ülkesi listedeyse onu seç
    const mine = countries.find((c) => c.cc.toUpperCase() === S.me.country) ||
      (S.me.country === 'GB' && countries.find((c) => c.cc === 'gb-eng'));
    if (mine) $('country').value = mine.cc;
    $('country').onchange = fillLeagues;
    $('league').onchange = fillClubs;
    $('club').onchange = () => { S.selected = Number($('club').value) || null; updateVoteBtn(); };
    $('voteBtn').onclick = () => S.selected && vote(S.selected);
    fillLeagues();
  }
  function fillLeagues() {
    const cc = $('country').value;
    $('league').innerHTML = S.leagues.filter((l) => l.cc === cc)
      .map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    fillClubs();
  }
  function fillClubs() {
    const lid = $('league').value;
    const voted = S.me.votes[lid];
    S.selected = null;
    $('voteError').hidden = true;
    $('clubFlag').innerHTML = flag(S.leagueById[lid].cc);
    $('club').innerHTML = '<option value="">Choose a club…</option>' + S.clubs.filter((c) => c.league === lid)
      .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    $('club').disabled = Boolean(voted);
    if (voted) {
      const c = S.clubById[voted.club];
      $('voteNotice').innerHTML = `You already voted for <b>${esc(c ? c.name : 'a club')}</b> in this league. Your next vote here opens <b>${dateStr(voted.next)}</b>. You can still vote in other leagues!`;
      $('voteNotice').hidden = false;
    } else $('voteNotice').hidden = true;
    updateVoteBtn();
  }
  function updateVoteBtn() {
    const b = $('voteBtn');
    const lid = $('league').value;
    if (S.me.votes[lid]) { b.disabled = true; b.textContent = 'Already voted this week'; return; }
    if (!S.selected) { b.disabled = true; b.textContent = 'Pick a club first'; return; }
    b.disabled = false;
    b.textContent = `I can't stand ${S.clubById[S.selected].name}`;
  }

  async function vote(clubId) {
    const btns = document.querySelectorAll('#voteBtn, .modal-vote');
    btns.forEach((b) => (b.disabled = true));
    try {
      const res = await api('/api/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ club: clubId }),
      });
      const c = S.clubById[clubId];
      S.me.votes[c.league] = { club: clubId, next: res.next };
      fillClubs();
      showClub(res, true);
      refreshHome();
    } catch (e) {
      if (e.data && e.data.next) {
        const c = S.clubById[clubId];
        S.me.votes[c.league] = { club: clubId, next: e.data.next };
        fillClubs();
      }
      $('voteError').textContent = e.message;
      $('voteError').hidden = false;
      if (!$('modal').hidden) { const err = $('modalBody').querySelector('.error'); if (err) { err.textContent = e.message; err.hidden = false; } }
      btns.forEach((b) => (b.disabled = false));
      updateVoteBtn();
    }
  }

  // ---------- Kulüp penceresi ----------
  async function openClub(id) {
    try { showClub(await api('/api/club/' + id), false); } catch { /* kulüp yoksa sessiz geç */ }
  }
  function statBox(s, label) {
    return `<div class="stat"><b>${s.rank ? '#' + s.rank : '–'}</b><span>${label}<br>${fmt(s.votes)} vote${s.votes === 1 ? '' : 's'}</span></div>`;
  }
  function showClub(data, justVoted) {
    const { club, stats } = data;
    const l = S.leagueById[club.league] || { name: '', cc: 'un', country: '' };
    const canVote = club.active && !S.me.votes[club.league];
    const shareText = stats.month.rank
      ? `${club.name} is the ${ordinal(stats.month.rank)} most irritating football club in the world this month 😤 Do you agree?`
      : `Does ${club.name} irritate you too? Vote now 😤`;
    const shareUrl = `${location.origin}${location.pathname}?club=${club.id}`;
    $('modalBody').innerHTML = `
      ${justVoted ? '<span class="kick">Your vote is in</span>' : ''}
      <div class="club-head">${flag(l.cc)}<h3>${esc(club.name)}</h3></div>
      <p class="club-league">${esc(l.name)} · ${esc(l.country)}</p>
      ${justVoted && stats.month.rank ? `<div class="big-rank">${ordinal(stats.month.rank)}</div><p class="big-line">${esc(club.name)} is now the ${ordinal(stats.month.rank)} most irritating club in the world this month.</p>` : ''}
      <div class="stats">
        ${statBox(stats.month, 'World, ' + monthName(data.month).split(' ')[0])}
        ${statBox(stats.all, 'World, all-time')}
        ${statBox(stats.league, 'In ' + esc(l.name) + ', this month')}
        ${stats.country ? statBox(stats.country, 'Votes from ' + esc(regionName(stats.country.cc)) + ', this month') : ''}
      </div>
      ${canVote ? `<button class="btn modal-vote">I can't stand ${esc(club.name)}</button>` : ''}
      <p class="error" hidden></p>
      <p class="meta" style="margin-top:14px">Share it:</p>
      <div class="share">
        <a target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}">X</a>
        <a target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}">WhatsApp</a>
        <a target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}">Facebook</a>
        <button class="copy">Copy link</button>
      </div>
      ${justVoted ? '<button class="btn ghost see-results">See the full league table</button>' : ''}`;
    const body = $('modalBody');
    const mv = body.querySelector('.modal-vote');
    if (mv) mv.onclick = () => vote(club.id);
    body.querySelector('.copy').onclick = async (e) => {
      if (navigator.share) { try { await navigator.share({ title: 'Most Irritated Club', text: shareText, url: shareUrl }); return; } catch { /* iptal */ } }
      try { await navigator.clipboard.writeText(shareText + ' ' + shareUrl); e.target.textContent = 'Copied!'; } catch { prompt('Copy this link:', shareUrl); }
    };
    const sr = body.querySelector('.see-results');
    if (sr) sr.onclick = () => { closeModal(); gotoExplore(S.month, 'league:' + club.league, club.id); };
    $('modal').hidden = false;
    history.replaceState(null, '', '?club=' + club.id);
  }
  function closeModal() { $('modal').hidden = true; history.replaceState(null, '', location.pathname); }
  $('modalClose').onclick = closeModal;
  $('modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });

  // ---------- Arama ----------
  $('search').oninput = () => {
    const q = norm($('search').value.trim());
    const box = $('searchResults');
    if (q.length < 2) { box.hidden = true; return; }
    const hits = S.clubs.filter((c) => c.n.includes(q))
      .sort((a, b) => (a.n.startsWith(q) ? 0 : 1) - (b.n.startsWith(q) ? 0 : 1) || a.name.localeCompare(b.name)).slice(0, 15);
    box.innerHTML = hits.length ? hits.map((c) => {
      const l = S.leagueById[c.league];
      return `<button data-id="${c.id}">${flag(l.cc)} ${esc(c.name)} <small>${esc(l.name)}</small></button>`;
    }).join('') : '<button disabled>No club found</button>';
    box.hidden = false;
    box.querySelectorAll('button[data-id]').forEach((b) => (b.onclick = () => {
      box.hidden = true; $('search').value = ''; openClub(Number(b.dataset.id));
    }));
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) $('searchResults').hidden = true; });

  // ---------- Listeler ----------
  function rowHtml(r, { right, highlight } = {}) {
    const l = S.leagueById[r.league] || { cc: 'un', name: '' };
    return `<li data-id="${r.id}" class="${highlight === r.id ? 'mine' : ''}">
      <span class="pos">${r.rank ?? ''}</span>
      <span class="name">${flag(l.cc)}<span>${esc(r.name)}</span><small>${esc(l.name)}</small></span>
      <span class="val">${r.right ?? right ?? fmt(r.votes)}</span>
    </li>`;
  }
  function renderList(el, rows, opts = {}, emptyText = 'No votes yet. Be the first!') {
    el.innerHTML = rows.length ? rows.map((r) => rowHtml(r, opts)).join('') : `<li class="empty">${emptyText}</li>`;
    el.querySelectorAll('li[data-id]').forEach((li) => (li.onclick = () => openClub(Number(li.dataset.id))));
  }

  async function refreshHome() {
    const [lead, mv] = await Promise.all([
      api(`/api/rankings?period=${S.month}&limit=1`),
      api('/api/movers'),
      loadTables(),
    ]);
    renderLead(lead.rows[0]);
    S.movers = mv;
    renderMovers();
    loadExplore(true);
  }

  // Ana sayfa tabloları: ülke ve lig filtresi
  function setupTableFilter() {
    const seen = new Set();
    const countries = S.leagues.filter((l) => !seen.has(l.cc) && seen.add(l.cc));
    $('tableCountry').innerHTML = '<option value="">All countries</option>' +
      countries.map((l) => `<option value="${esc(l.cc)}">${esc(l.country)}</option>`).join('');
    $('tableCountry').onchange = () => { fillTableLeagues(); loadTables(); };
    $('tableLeague').onchange = loadTables;
    fillTableLeagues();
  }
  function fillTableLeagues() {
    const cc = $('tableCountry').value;
    $('tableLeague').innerHTML = '<option value="">All leagues</option>' + S.leagues.filter((l) => l.cc === cc)
      .map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    $('tableLeague').disabled = !cc;
  }
  function tableScope() {
    const cc = $('tableCountry').value, league = $('tableLeague').value;
    if (league) return 'league:' + league;
    if (!cc) return 'world';
    const leagues = S.leagues.filter((l) => l.cc === cc);
    return leagues.length === 1 ? 'league:' + leagues[0].id : 'country:' + cc;
  }
  let tablesRun = 0;
  async function loadTables() {
    const run = ++tablesRun, scope = encodeURIComponent(tableScope());
    const [m, a] = await Promise.all([
      api(`/api/rankings?period=${S.month}&scope=${scope}&limit=10`),
      api(`/api/rankings?period=all&scope=${scope}&limit=10`),
    ]);
    if (run !== tablesRun) return; // daha yeni bir filtre seçildi
    const none = scope === 'world' ? undefined : 'No votes here yet.';
    renderList($('topMonth'), m.rows, {}, none);
    renderList($('topAll'), a.rows, {}, none);
  }

  // Ayın 1. sırası manşet olur
  function renderLead(first) {
    const name = $('leadName');
    if (!first) {
      name.className = '';
      name.textContent = 'Nobody yet';
      $('leadDeck').textContent = 'The table is empty. Be the first to vote this month.';
      return;
    }
    name.className = first.name.length > 16 ? 'long' : '';
    name.innerHTML = `<button>${esc(first.name)}</button>`;
    name.firstChild.onclick = () => openClub(first.id);
    $('leadDeck').textContent = `${fmt(first.votes)} vote${first.votes === 1 ? '' : 's'} and counting this month.`;
  }

  // ---------- Yükselenler / düşenler ----------
  let mvTab = 'risers';
  document.querySelectorAll('[data-mv]').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('[data-mv]').forEach((x) => x.classList.toggle('active', x === b));
    mvTab = b.dataset.mv; renderMovers();
  }));
  function renderMovers() {
    const mv = S.movers; if (!mv) return;
    const list = $('moversList');
    const none = 'Not enough votes yet to compare with last month.';
    if (mvTab === 'risers') renderList(list, mv.risers.map((r, i) => ({ ...r, rank: i + 1,
      right: `<span class="up">▲ ${r.isNew ? 'NEW' : r.change}</span><small>now #${r.rank}</small>` })), {}, none);
    else if (mvTab === 'fallers') renderList(list, mv.fallers.map((r, i) => ({ ...r, rank: i + 1,
      right: `<span class="down">▼ ${-r.change}</span><small>${r.votes ? `#${r.from} → #${r.rank}` : 'no votes yet'}</small>` })), {}, none);
    else renderList(list, mv.trending.map((r, i) => ({ ...r, rank: i + 1,
      right: `${fmt(r.votes)}<small>this week</small>` })), {}, 'No votes in the last 7 days.');
  }

  // ---------- Keşfet (arşiv) ----------
  let exploreLimit = 50, highlightId = null;
  function setupPeriods(p) {
    const opts = [`<option value="${p.current}">This month (${monthName(p.current)})</option>`,
      `<option value="all">All time</option>`];
    const past = p.months.filter((m) => m !== p.current);
    if (past.length) opts.push(`<optgroup label="Past months">${past.map((m) => `<option value="${m}">${monthName(m)}</option>`).join('')}</optgroup>`);
    opts.push(`<optgroup label="Full year">${p.years.map((y) => `<option value="${y}">${y} total</option>`).join('')}</optgroup>`);
    $('period').innerHTML = opts.join('');
    $('period').onchange = () => loadExplore(true);
  }
  function setupScopes() {
    const opts = ['<option value="world">Worldwide</option>'];
    if (S.me.country !== 'ZZ') opts.push(`<option value="cc:${S.me.country}">Votes from ${esc(regionName(S.me.country))}</option>`);
    for (const cc of new Set(S.leagues.map((l) => l.cc))) {
      const leagues = S.leagues.filter((l) => l.cc === cc), name = esc(leagues[0].country);
      const all = leagues.length > 1 ? `<option value="country:${esc(cc)}">${name}: all leagues</option>` : '';
      opts.push(`<optgroup label="${name}">${all}${leagues.map((l) => `<option value="league:${l.id}">${name}: ${esc(l.name)}</option>`).join('')}</optgroup>`);
    }
    $('scope').innerHTML = opts.join('');
    $('scope').onchange = () => loadExplore(true);
    $('moreBtn').onclick = () => { exploreLimit += 50; loadExplore(false); };
  }
  async function loadExplore(reset) {
    if (reset) { exploreLimit = 50; }
    const period = $('period').value, scope = $('scope').value;
    const r = await api(`/api/rankings?period=${encodeURIComponent(period)}&scope=${encodeURIComponent(scope)}&limit=${exploreLimit}`);
    const pLabel = period === 'all' ? 'all time' : /^\d{4}$/.test(period) ? `${period} total` : monthName(period);
    $('exploreMeta').textContent = `${fmt(r.total)} votes · ${fmt(r.count)} clubs · ${pLabel}`;
    renderList($('exploreList'), r.rows, { highlight: highlightId });
    $('moreBtn').hidden = r.rows.length >= r.count;
  }
  function gotoExplore(period, scope, hl) {
    if ([...$('period').options].some((o) => o.value === period)) $('period').value = period;
    if (scope && [...$('scope').options].some((o) => o.value === scope)) $('scope').value = scope;
    highlightId = hl || null;
    loadExplore(true).then(() => $('explore').scrollIntoView({ behavior: 'smooth' }));
  }
  document.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () =>
    gotoExplore(b.dataset.goto === 'all' ? 'all' : S.month, tableScope())));

  init().catch((e) => { console.error(e); $('voteError').textContent = 'Could not load. Please refresh the page.'; $('voteError').hidden = false; });
})();
