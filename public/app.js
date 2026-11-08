// Most Irritating Club: ön yüz (framework yok)
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
    setupTableFilter();

    // Paylaşılan tablo bağlantısı: ?period=2026-11&scope=league:tur1
    const q = new URLSearchParams(location.search);
    const sharedTable = q.has('period') || q.has('scope');
    if (sharedTable) pickTable(q.get('period'), q.get('scope'));
    await refreshHome();
    if (sharedTable) $('tables').scrollIntoView();
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
    b.textContent = `${S.clubById[S.selected].name} irritates me`;
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
      ${canVote ? `<button class="btn modal-vote">${esc(club.name)} irritates me</button>` : ''}
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
      if (navigator.share) { try { await navigator.share({ title: 'Most Irritating Club', text: shareText, url: shareUrl }); return; } catch { /* iptal */ } }
      try { await navigator.clipboard.writeText(shareText + ' ' + shareUrl); e.target.textContent = 'Copied!'; } catch { prompt('Copy this link:', shareUrl); }
    };
    const sr = body.querySelector('.see-results');
    if (sr) sr.onclick = () => { closeModal(); gotoTable(S.month, 'league:' + club.league, club.id); };
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
      api('/api/leaders'),
      api('/api/movers'),
      loadTables(true),
    ]);
    renderLeaders(lead);
    S.movers = mv;
    renderMovers();
  }

  // Ana sayfa tablosu: dönem, ülke ve lig filtresi. Eski aylar da buradan seçilir.
  function setupTableFilter() {
    const seen = new Set();
    const countries = S.leagues.filter((l) => !seen.has(l.cc) && seen.add(l.cc));
    $('tableCountry').innerHTML = '<option value="">All countries</option>' +
      countries.map((l) => `<option value="${esc(l.cc)}">${esc(l.country)}</option>`).join('');
    $('tableCountry').onchange = () => { fillTableLeagues(); loadTables(true); };
    $('tableLeague').onchange = () => loadTables(true);
    $('moreBtn').onclick = () => { tableLimit += 50; loadTables(false); };
    $('tableShare').onclick = () => shareTable($('period').value, tableScope());
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
  let tablesRun = 0, tableLimit = 10, highlightId = null;
  async function loadTables(reset) {
    if (reset) tableLimit = 10;
    const run = ++tablesRun, period = $('period').value, scope = tableScope();
    const r = await api(`/api/rankings?period=${encodeURIComponent(period)}&scope=${encodeURIComponent(scope)}&limit=${tableLimit}`);
    if (run !== tablesRun) return; // daha yeni bir filtre seçildi
    $('tableTitle').textContent = period === S.month ? "This month's table" : period === 'all' ? 'All-time table' : `${periodLabel(period)} table`;
    $('tableMeta').textContent = `${scopeLabel(scope)} · ${fmt(r.total)} vote${r.total === 1 ? '' : 's'} · ${fmt(r.count)} club${r.count === 1 ? '' : 's'}`;
    renderList($('tableList'), r.rows, { highlight: highlightId }, scope === 'world' && period === S.month ? undefined : 'No votes here yet.');
    $('moreBtn').hidden = r.rows.length >= r.count;
    $('tableShare').hidden = !r.rows.length;
  }

  // Manşet: bu ay, bu yıl ve tüm zamanların 1.si; altında bir önceki dönemin 1.si
  // Yıl, tüm zamanlar ve "geçen ay / geçen yıl / önceki lider" satırları şimdilik gizli. Açmak için true yap.
  const SHOW_HISTORY = false;
  function renderLeaders(L) {
    const year = S.month.slice(0, 4);
    const votes = (c) => `${fmt(c.votes)} vote${c.votes === 1 ? '' : 's'}`;
    // Telefonda kısa etiket ve kısa satır, geniş ekranda uzunları görünür.
    const card = (cls, kick, short, cur, more, prevLabel, prev, prevExtra = votes, extraOnPhone = false) => `
      <article class="leader ${cls}${cur ? '' : ' empty'}">
        <span class="kick"><span class="wide-only">${kick}</span><span class="narrow-only">${short}</span></span>
        <h2 class="${cur && cur.name.length > 16 ? 'long' : ''}" style="--w:${cur ? Math.max(...cur.name.split(' ').map((w) => w.length)) : 10}">${cur ? `<button data-id="${cur.id}">${esc(cur.name)}</button>` : 'Nobody yet'}</h2>
        <p class="deck">${cur ? `${votes(cur)}<span class="wide-only"> ${more}</span>` : 'No votes yet'}</p>
        ${SHOW_HISTORY ? '' : '<!--'}<p class="prev">${prevLabel}: ${prev ? `<button data-id="${prev.id}">${esc(prev.name)}</button><span class="${extraOnPhone ? 'prev-extra' : 'wide-only'}"><span class="wide-only"> · </span>${prevExtra(prev)}</span>` : prevExtra(null)}</p>${SHOW_HISTORY ? '' : '-->'}
      </article>`;
    $('leaders').innerHTML =
      card('main', "This month's worst offender", 'This month', L.thisMonth, 'and counting this month.',
        `Last month<span class="wide-only"> (${monthName(prevMonth(S.month)).split(' ')[0]})</span>`, L.lastMonth, (c) => (c ? votes(c) : 'no votes')) +
      (SHOW_HISTORY ? `<div class="side-leaders">` +
      card('', `Worst of ${year}`, year, L.thisYear, 'this year.', `Last year<span class="wide-only"> (${Number(year) - 1})</span>`, L.lastYear, (c) => (c ? votes(c) : 'no votes')) +
      card('', 'Worst of all time', 'All time', L.allTime, 'in total.', 'Previous leader', L.previousLeader,
        (c) => (c ? `until ${monthName(c.until)}` : 'none yet'), true) +
      `</div>` : '') +
      `<div class="lead-actions">
        <a class="btn" href="#vote">Vote now</a>
        <a class="btn ghost" href="#tables">See the results</a>
      </div>`;
    $('leaders').classList.toggle('single', !SHOW_HISTORY);
    $('leaders').querySelectorAll('button[data-id]').forEach((b) => (b.onclick = () => openClub(Number(b.dataset.id))));
  }
  const prevMonth = (m) => { const d = new Date(m + '-15T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

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

  // ---------- Dönemler ----------
  function setupPeriods(p) {
    const opts = [`<option value="${p.current}">This month</option>`,
      `<option value="all">All time</option>`];
    const past = p.months.filter((m) => m !== p.current);
    if (past.length) opts.push(`<optgroup label="Past months">${past.map((m) => `<option value="${m}">${monthName(m)}</option>`).join('')}</optgroup>`);
    opts.push(`<optgroup label="Full year">${p.years.map((y) => `<option value="${y}">${y} total</option>`).join('')}</optgroup>`);
    $('period').innerHTML = opts.join('');
    $('period').onchange = () => loadTables(true);
  }
  // Paylaşılan bağlantıdaki ya da oy sonrası istenen tabloyu filtrelere yansıtır.
  function pickTable(period, scope) {
    if ([...$('period').options].some((o) => o.value === period)) $('period').value = period;
    scope = scope || 'world';
    let cc = '', league = '';
    if (scope.startsWith('league:') && S.leagueById[scope.slice(7)]) { league = scope.slice(7); cc = S.leagueById[league].cc; }
    else if (scope.startsWith('country:') && S.leagues.some((l) => l.cc === scope.slice(8))) cc = scope.slice(8);
    $('tableCountry').value = cc;
    fillTableLeagues();
    if (league && S.leagues.filter((l) => l.cc === cc).length > 1) $('tableLeague').value = league;
  }
  function gotoTable(period, scope, hl) {
    pickTable(period, scope);
    highlightId = hl || null;
    loadTables(true).then(() => $('tables').scrollIntoView({ behavior: 'smooth' }));
  }

  // ---------- Tablo paylaşımı ----------
  const periodLabel = (p) => (p === 'all' ? 'All time' : /^\d{4}$/.test(p) ? `${p} total` : monthName(p));
  function scopeLabel(scope) {
    if (scope.startsWith('league:')) { const l = S.leagueById[scope.slice(7)]; return l ? `${l.country}: ${l.name}` : 'League'; }
    if (scope.startsWith('country:')) { const l = S.leagues.find((x) => x.cc === scope.slice(8)); return l ? l.country : 'Country'; }
    if (scope.startsWith('cc:')) return `Votes from ${regionName(scope.slice(3))}`;
    return 'Worldwide';
  }
  // Kart, sitenin renkleriyle ve sunucusuz çizilir. Bayrak yüklenemezse onsuz devam eder.
  async function tableImage(place, period, rows) {
    const W = 1080, ROW = 92, TOP = 330, H = TOP + rows.length * ROW + 120;
    const chars = rows.map((r) => r.name).join('').toUpperCase() + place + period + 'MOST IRRITATING CLUBS';
    await Promise.allSettled([document.fonts.load('60px Anton', chars), document.fonts.load('600 36px "Source Serif 4"', chars + 'votes')]);
    const flags = await Promise.all(rows.map((r) => new Promise((done) => {
      const l = S.leagueById[r.league], img = new Image();
      if (!l) return done(null);
      img.crossOrigin = 'anonymous';
      img.onload = () => done(img);
      img.onerror = () => done(null);
      img.src = `https://flagcdn.com/w80/${l.cc}.png`;
    })));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const INK = '#141414', RED = '#cf1018', LINE = '#b9b4a6';
    const fit = (text, weight, size, font, max) => {
      do { g.font = `${weight} ${size}px ${font}`; size -= 2; } while (g.measureText(text).width > max && size > 20);
    };
    g.fillStyle = '#f4f0e6'; g.fillRect(0, 0, W, H);
    g.fillStyle = INK; g.fillRect(60, 60, W - 120, 8);
    g.textBaseline = 'alphabetic';
    fit('MOST IRRITATING CLUBS', 400, 112, 'Anton, Impact, sans-serif', W - 120);
    g.fillText('MOST IRRITATING CLUBS', 60, 196);
    fit(place, 600, 44, '"Source Serif 4", Georgia, serif', W - 120);
    g.fillStyle = RED; g.fillText(place, 60, 256);
    g.fillStyle = '#5f5b50'; g.font = '400 34px "Source Serif 4", Georgia, serif'; g.fillText(period, 60, 300);
    rows.forEach((r, i) => {
      const y = TOP + i * ROW, base = y + 62;
      g.fillStyle = LINE; g.fillRect(60, y, W - 120, 2);
      g.fillStyle = i === 0 ? RED : INK;
      g.font = '400 44px Anton, Impact, sans-serif';
      g.textAlign = 'left'; g.fillText(String(r.rank), 60, base);
      if (flags[i]) { const f = flags[i], h = 34; g.drawImage(f, 140, y + 29, Math.min(h * f.width / f.height, 60), h); }
      const votes = fmt(r.votes);
      g.textAlign = 'right'; g.fillStyle = INK; g.font = '600 38px "Source Serif 4", Georgia, serif';
      const vw = g.measureText(votes).width; g.fillText(votes, W - 60, base);
      g.textAlign = 'left';
      fit(r.name.toLocaleUpperCase('en'), 400, 46, 'Anton, Impact, sans-serif', W - 60 - vw - 30 - 215);
      g.fillText(r.name.toLocaleUpperCase('en'), 215, base);
    });
    const end = TOP + rows.length * ROW;
    g.fillStyle = INK; g.fillRect(60, end, W - 120, 8);
    g.font = '400 30px "Source Serif 4", Georgia, serif';
    g.fillText(window.DEMO_MODE ? 'Demo: made-up sample numbers' : 'Which club irritates you the most? Vote now.', 60, end + 58);
    g.textAlign = 'right'; g.font = '600 30px "Source Serif 4", Georgia, serif';
    g.fillText(location.hostname, W - 60, end + 58);
    return new Promise((done) => cv.toBlob(done, 'image/png'));
  }
  async function shareTable(period, scope) {
    const r = await api(`/api/rankings?period=${encodeURIComponent(period)}&scope=${encodeURIComponent(scope)}&limit=10`);
    if (!r.rows.length) return;
    const place = scopeLabel(scope), when = periodLabel(period);
    const url = `${location.origin}${location.pathname}?period=${encodeURIComponent(period)}&scope=${encodeURIComponent(scope)}`;
    const text = `Most irritating football clubs (${place}, ${when}):\n` +
      r.rows.slice(0, 3).map((x) => `${x.rank}. ${x.name}`).join('\n') + '\nDo you agree?';
    $('modalBody').innerHTML = `
      <h3 class="share-title">Share this table</h3>
      <p class="club-league">${esc(place)} · ${esc(when)}</p>
      <img class="share-preview" alt="Image of this table">
      <div class="share">
        <a target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}">X</a>
        <a target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}">WhatsApp</a>
        <a target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}">Facebook</a>
        <button class="copy">Copy link</button>
      </div>
      <button class="btn ghost share-image" disabled>Preparing image…</button>`;
    $('modal').hidden = false;
    const body = $('modalBody');
    body.querySelector('.copy').onclick = async (e) => {
      try { await navigator.clipboard.writeText(url); e.target.textContent = 'Copied!'; } catch { prompt('Copy this link:', url); }
    };
    const btn = body.querySelector('.share-image');
    const blob = await tableImage(place, when, r.rows);
    if (!blob) { btn.textContent = 'Image not available'; return; }
    const name = `most-irritating-${norm(place).replace(/[^a-z0-9]+/g, '-')}-${period}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    const href = URL.createObjectURL(blob);
    body.querySelector('.share-preview').src = href;
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    btn.textContent = canShare ? 'Share image' : 'Save image';
    btn.disabled = false;
    btn.onclick = async () => {
      if (canShare) { try { await navigator.share({ files: [file], text: `${text} ${url}` }); } catch { /* iptal */ } return; }
      const a = document.createElement('a');
      a.href = href; a.download = name; a.click();
    };
  }

  init().catch((e) => { console.error(e); $('voteError').textContent = 'Could not load. Please refresh the page.'; $('voteError').hidden = false; });
})();
