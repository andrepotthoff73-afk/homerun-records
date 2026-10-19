// Shop-Übersicht: Suche, Filter, Sortierung, Seiten
document.addEventListener('DOMContentLoaded', () => {
  const { api, esc, eur, num, imgTag, discount, cartButton, bindCartButtons } = HR;
  const P = new URLSearchParams(location.search);
  const PER = 48;
  // Alle Such- und Filterfelder (auch von der erweiterten Suche)
  const FILTERS = {
    q: 'Suche', artist: 'Künstler', title: 'Album/Titel', track: 'Track', label: 'Label', catno: 'Kat.-Nr.',
    format: 'Format', genre: 'Genre/Stil', country: 'Land', year_from: 'Jahr ab', year_to: 'Jahr bis',
    cond: 'Zustand Platte', sleeve: 'Zustand Hülle', min: 'Preis ab', max: 'Preis bis',
  };
  const KEYS = Object.keys(FILTERS);
  const state = { sort: P.get('sort') || 'new', page: Math.max(1, parseInt(P.get('page'), 10) || 1) };
  for (const k of KEYS) state[k] = (P.get(k) || '').trim();
  let view = 'list';
  try { view = localStorage.getItem('hr_view') || 'list'; } catch { /* ignorieren */ }
  let items = [];

  const $ = (id) => document.getElementById(id);
  const results = $('results');
  bindCartButtons(results, (id) => items.find((r) => r.id === id));

  // Kopfzeilen-Suche ohne Neuladen
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'hdr-search') return;
    e.preventDefault();
    state.q = e.target.q.value.trim();
    state.page = 1;
    load();
  });

  document.querySelectorAll('[data-filter]').forEach((group) => {
    group.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      state[group.dataset.filter] = b.dataset.v;
      state.page = 1;
      load();
    });
  });
  $('price-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.min = e.target.min.value.replace(',', '.').trim();
    state.max = e.target.max.value.replace(',', '.').trim();
    state.page = 1;
    load();
  });
  $('quick-search').addEventListener('submit', (e) => {
    e.preventDefault();
    for (const k of ['artist', 'title', 'track']) state[k] = e.target[k].value.trim();
    state.page = 1;
    load();
    document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('reset').addEventListener('click', () => {
    for (const k of KEYS) state[k] = '';
    state.page = 1;
    const s = document.querySelector('#hdr-search input');
    if (s) s.value = '';
    load();
  });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; state.page = 1; load(); });
  $('filter-toggle').addEventListener('click', () => $('filters').classList.toggle('open'));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    try { localStorage.setItem('hr_view', view); } catch { /* ignorieren */ }
    render();
  }));
  $('active').addEventListener('click', (e) => {
    const b = e.target.closest('[data-clear]');
    if (!b) return;
    b.dataset.clear.split(',').forEach((k) => { state[k] = ''; });
    if (b.dataset.clear.split(',').includes('q')) { const s = document.querySelector('#hdr-search input'); if (s) s.value = ''; }
    state.page = 1;
    load();
  });
  $('pager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b) return;
    state.page = Number(b.dataset.page);
    load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  function syncControls() {
    if (typeof renderCategories === 'function' && facets.tags) renderCategories();
    document.querySelectorAll('[data-filter]').forEach((g) => {
      g.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.v === state[g.dataset.filter]));
    });
    $('sort').value = state.sort;
    const f = $('price-form');
    f.min.value = state.min;
    f.max.value = state.max;
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));

    const qs = $('quick-search');
    for (const k of ['artist', 'title', 'track']) if (document.activeElement !== qs[k]) qs[k].value = state[k];
    $('adv-link').href = `/suche${params().toString() ? `?${params()}` : ''}`;

    const chips = [];
    // Ein ganzes Jahrzehnt als ein Hinweis („Jahrzehnt: 70er“) statt „Jahr ab“ + „Jahr bis“
    const dec = Number(state.year_from);
    const wholeDecade = dec % 10 === 0 && state.year_to === String(dec + 9);
    if (wholeDecade) chips.push(['year_from,year_to', `Jahrzehnt: ${decadeLabel(dec)}`]);
    for (const k of KEYS) {
      if (!state[k] || ['min', 'max'].includes(k)) continue;
      if (wholeDecade && (k === 'year_from' || k === 'year_to')) continue;
      const value = k === 'genre' && GENRES[state[k]] ? GENRES[state[k]] : state[k];
      chips.push([k, `${k === 'genre' ? (GENRES[state[k]] ? 'Genre' : 'Stil') : FILTERS[k]}: ${value}`]);
    }
    if (state.min || state.max) chips.push(['min,max', `Preis: ${state.min || '0'} – ${state.max || '∞'} €`]);
    $('active').innerHTML = chips.map(([k, l]) => `<button class="chip active" data-clear="${k}">${esc(l)} ✕</button>`).join('');
  }

  function params() {
    const qs = new URLSearchParams();
    for (const k of KEYS) if (state[k]) qs.set(k, state[k]);
    if (state.sort !== 'new') qs.set('sort', state.sort);
    if (state.page > 1) qs.set('page', state.page);
    return qs;
  }

  let total = 0;
  let seq = 0;
  async function load() {
    const qs = params();
    history.replaceState(null, '', qs.toString() ? `?${qs}` : location.pathname);
    syncControls();
    const my = ++seq;
    results.className = view;
    results.innerHTML = Array.from({ length: 6 }, () =>
      `<div class="row"><div class="cover skeleton"></div><div><div class="skeleton" style="height:18px;width:60%"></div><div class="skeleton" style="height:14px;width:40%;margin-top:8px"></div></div><div></div></div>`).join('');
    try {
      qs.set('per', PER);
      qs.set('sort', state.sort);
      const data = await api(`/api/shop?action=list&${qs}`);
      if (my !== seq) return;
      items = data.items;
      total = data.total;
      $('stat-stock').textContent = num(data.stock);
      render();
    } catch (e) {
      if (my !== seq) return;
      $('count').textContent = 'Fehler';
      results.innerHTML = `<div class="empty"><p>Die Platten konnten nicht geladen werden.</p><p class="small muted">${esc(e.message)}</p></div>`;
      $('pager').innerHTML = '';
    }
  }

  function title(r) {
    return `<a class="row-title" href="${link(r)}"><span class="by">${esc(r.artist)}</span> – ${esc(r.title)}</a>`;
  }
  function link(r) {
    return `/record?id=${r.id}${state.track ? `&track=${encodeURIComponent(state.track)}` : ''}`;
  }
  function meta(r) {
    return [r.label, r.catno, r.format, r.country, r.released].filter(Boolean).map(esc).join(' · ');
  }
  function priceBlock(r) {
    return `<div class="price">${eur(r.price)}</div>`;
  }

  function render() {
    results.className = view;
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    const from = total ? (state.page - 1) * PER + 1 : 0;
    const to = Math.min(total, state.page * PER);
    $('count').innerHTML = total ? `${num(from)}–${num(to)} <span>von ${num(total)} Platten</span>` : '0 Platten';

    if (!items.length) {
      results.innerHTML = `<div class="empty"><img src="/assets/vinyl.svg" alt="" width="72" style="margin:0 auto 12px;border-radius:50%"><p><strong>Keine Platten gefunden.</strong></p><p class="small">Versuch es mit einem anderen Suchbegriff oder weniger Filtern.</p></div>`;
      $('pager').innerHTML = '';
      return;
    }

    if (view === 'grid') {
      results.innerHTML = items.map((r) => `
        <article class="card">
          <a class="cover" href="${link(r)}">${imgTag(r)}</a>
          <div>${title(r)}<div class="row-meta">${esc(r.format || '')}${r.media_condition ? ` · ${esc(shortCond(r.media_condition))}` : ''}</div></div>
          <div class="card-foot"><div>${priceBlock(r)}</div>${cartButton(r)}</div>
        </article>`).join('');
    } else {
      results.innerHTML = items.map((r) => `
        <article class="row">
          <a class="cover" href="${link(r)}">${imgTag(r)}</a>
          <div>
            ${title(r)}
            <div class="row-meta">${meta(r)}</div>
            <div class="row-cond">
              ${r.media_condition ? `<span>Platte: <b>${esc(r.media_condition)}</b></span>` : ''}
              ${r.sleeve_condition ? `<span>Hülle: <b>${esc(r.sleeve_condition)}</b></span>` : ''}
            </div>
          </div>
          <div class="row-buy">${priceBlock(r)}${cartButton(r)}</div>
        </article>`).join('');
    }
    renderPager();
  }

  function shortCond(c) {
    const m = String(c).match(/\(([^)]+)\)/);
    return m ? m[1] : c;
  }

  function renderPager() {
    const pages = Math.ceil(total / PER);
    if (pages <= 1) { $('pager').innerHTML = ''; return; }
    const p = state.page;
    const set = new Set([1, pages, p - 2, p - 1, p, p + 1, p + 2].filter((n) => n >= 1 && n <= pages));
    const nums = [...set].sort((a, b) => a - b);
    let html = `<button data-page="${p - 1}" ${p === 1 ? 'disabled' : ''} aria-label="Vorherige Seite">‹</button>`;
    nums.forEach((n, i) => {
      if (i && n - nums[i - 1] > 1) html += '<span class="gap">…</span>';
      html += `<button data-page="${n}" class="${n === p ? 'active' : ''}">${n}</button>`;
    });
    html += `<button data-page="${p + 1}" ${p === pages ? 'disabled' : ''} aria-label="Nächste Seite">›</button>`;
    $('pager').innerHTML = html;
  }

  // ---------- Kategorien: Genre, Stil, Jahrzehnt ----------
  // Die groben Genres des Katalogs; alles andere sind Stile (House, Techno, Schlager …)
  const GENRES = {
    Rock: 'Rock', Electronic: 'Electronic', Pop: 'Pop', Jazz: 'Jazz', 'Funk / Soul': 'Funk & Soul', 'Hip Hop': 'Hip-Hop',
    Reggae: 'Reggae', Blues: 'Blues', Latin: 'Latin', Classical: 'Klassik', 'Folk World & Country': 'Folk & Country',
    'Stage & Screen': 'Film & Musical', "Children's": 'Kinder', 'Brass & Military': 'Blasmusik', 'Non-Music': 'Sonstiges',
  };
  const STYLE_LIMIT = 14;
  let facets = { tags: [], decades: [] };
  let showAllStyles = false;
  const decadeLabel = (d) => (d >= 2000 ? `${d}er` : `${String(d).slice(2)}er`);
  const isDecade = (d) => state.year_from === String(d) && state.year_to === String(d + 9);

  function chip(attrs, label, n, active) {
    return `<button class="chip ${active ? 'active' : ''}" ${attrs}>${esc(label)}${n != null ? `<span class="n">${num(n)}</span>` : ''}</button>`;
  }

  function renderCategories() {
    const genres = facets.tags.filter((t) => GENRES[t.name]);
    const styles = facets.tags.filter((t) => !GENRES[t.name]);
    const decades = facets.decades.filter((d) => d.decade >= 1900);

    $('genre-chips').innerHTML = genres.map((t) => chip(`data-genre="${esc(t.name)}"`, GENRES[t.name], t.n, state.genre === t.name)).join('');
    $('fg-genre').classList.toggle('hidden', !genres.length);

    const shown = showAllStyles ? styles : styles.slice(0, STYLE_LIMIT);
    $('style-chips').innerHTML = shown.map((t) => chip(`data-genre="${esc(t.name)}"`, t.name, t.n, state.genre === t.name)).join('');
    $('fg-style').classList.toggle('hidden', !styles.length);
    $('style-more').classList.toggle('hidden', styles.length <= STYLE_LIMIT);
    $('style-more').textContent = showAllStyles ? 'Weniger anzeigen' : `Alle ${styles.length} Stile anzeigen`;

    $('decade-chips').innerHTML = decades.map((d) => chip(`data-decade="${d.decade}"`, decadeLabel(d.decade), d.n, isDecade(d.decade))).join('');
    $('fg-decade').classList.toggle('hidden', !decades.length);

    // Schnellzugriff oben: die größten Genres und alle Jahrzehnte
    const top = genres.slice(0, 8);
    const strip = $('cat-strip');
    strip.classList.toggle('hidden', !top.length && !decades.length);
    strip.innerHTML = [
      top.length ? `<span class="label">Genres</span>${top.map((t) => chip(`data-genre="${esc(t.name)}"`, GENRES[t.name], null, state.genre === t.name)).join('')}` : '',
      top.length && decades.length ? '<span class="sep"></span>' : '',
      decades.length ? `<span class="label">Jahrzehnte</span>${decades.map((d) => chip(`data-decade="${d.decade}"`, decadeLabel(d.decade), null, isDecade(d.decade))).join('')}` : '',
    ].join('');
  }

  // Klick auf eine Kategorie: setzen bzw. erneut klicken zum Aufheben
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-genre]');
    const d = e.target.closest('[data-decade]');
    if (!g && !d) return;
    if (g) state.genre = state.genre === g.dataset.genre ? '' : g.dataset.genre;
    if (d) {
      const dec = Number(d.dataset.decade);
      const active = isDecade(dec);
      state.year_from = active ? '' : String(dec);
      state.year_to = active ? '' : String(dec + 9);
    }
    state.page = 1;
    load();
    if (e.target.closest('#cat-strip')) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('style-more').addEventListener('click', () => { showAllStyles = !showAllStyles; renderCategories(); });

  api('/api/shop?action=facets').then((f) => { facets = f; renderCategories(); }).catch(() => {});

  load();
});
