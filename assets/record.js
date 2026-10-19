// Detailseite einer Platte
document.addEventListener('DOMContentLoaded', async () => {
  const { api, esc, eur, imgTag, discount, cartButton, bindCartButtons, ICON } = HR;
  const P = new URLSearchParams(location.search);
  const id = parseInt(P.get('id'), 10);
  const hl = (P.get('track') || '').trim().toLowerCase();
  const box = document.getElementById('record');
  let rec;
  let more = [];
  bindCartButtons(document.querySelector('main'), (x) => (x === rec?.id ? rec : more.find((r) => r.id === x)));

  try {
    rec = await api(`/api/shop?action=get&id=${id || 0}`);
  } catch (e) {
    box.innerHTML = `<div class="empty"><p><strong>Diese Platte gibt es nicht (mehr).</strong></p><p><a class="btn" href="/">Zurück zum Shop</a></p></div>`;
    return;
  }

  document.title = `${rec.artist} – ${rec.title} | Homerun Records`;
  document.getElementById('crumbs').innerHTML =
    `<a href="/">Shop</a> › <a href="/?q=${encodeURIComponent(rec.artist)}">${esc(rec.artist)}</a> › ${esc(rec.title)}`;

  const rows = [
    ['Künstler', `<a href="/?q=${encodeURIComponent(rec.artist)}">${esc(rec.artist)}</a>`],
    ['Label', esc(rec.label)],
    ['Katalognummer', esc(rec.catno)],
    ['Format', esc(rec.format)],
    ['Land', esc(rec.country)],
    ['Erschienen', esc(rec.released)],
    ['Genre / Stil', esc(rec.genre)],
    ['Zustand Platte', esc(rec.media_condition)],
    ['Zustand Hülle', esc(rec.sleeve_condition)],
  ].filter(([, v]) => v);

  // Trackliste: eine Zeile pro Track ("Position<Tab>Titel"); gesuchter Track wird markiert
  function tracklist(raw) {
    const lines = String(raw || '').split(/\n|\s*;\s*/).map((l) => l.replace(/^ +| +$/g, '')).filter(Boolean);
    if (!lines.length) return '';
    const words = hl.split(/\s+/).filter(Boolean);
    return `<h2 style="margin-top:24px;font-size:1.05rem">Trackliste</h2><ol class="tracklist">${lines.map((l) => {
      const [pos, name] = l.includes('\t') ? l.split('\t') : ['', l];
      const hit = words.length && words.every((w) => name.toLowerCase().includes(w));
      return `<li><span class="pos">${esc(pos)}</span><span>${hit ? `<mark>${esc(name)}</mark>` : esc(name)}</span></li>`;
    }).join('')}</ol>`;
  }

  const sold = rec.status !== 'available';
  const perks = ['Bezahlung sicher über PayPal', 'Versand gut verpackt in stabilem LP-Karton', 'Zustand ehrlich nach Goldmine-Standard'];

  box.innerHTML = `
    <div class="detail">
      <div class="cover">${imgTag(rec, 'full', true)}</div>
      <div>
        <h1><span class="by">${esc(rec.artist)}</span>${esc(rec.title)}</h1>
        <table class="facts"><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>
        ${rec.description ? `<div class="desc">${esc(rec.description)}</div>` : ''}
        ${tracklist(rec.tracks)}
      </div>
      <aside class="buybox">
        ${sold
          ? `<span class="sold-tag">${rec.status === 'reserved' ? 'Gerade reserviert' : 'Verkauft'}</span><p class="muted small" style="margin:0">Diese Platte ist leider schon weg. Schau dir ähnliche Platten unten an.</p>`
          : `<div class="price">${eur(rec.price)}</div>
             ${cartButton(rec, 'btn-block btn-lg')}
             <ul>${perks.map((p) => `<li>${ICON.check}<span>${p}</span></li>`).join('')}</ul>
             <p class="small muted" style="margin:0">Einzelstück – nur 1× vorhanden. zzgl. <a href="/rechtliches#versand">Versand</a>. Versand an deine PayPal-Adresse.</p>`}
        <button class="btn btn-block wish-btn" id="wish">${ICON.heart} Merken</button>
      </aside>
    </div>`;

  // Merkliste (nur für angemeldete Kunden)
  const wishBtn = document.getElementById('wish');
  let wished = false;
  const paintWish = () => { wishBtn.classList.toggle('on', wished); wishBtn.innerHTML = `${ICON.heart} ${wished ? 'Gemerkt' : 'Merken'}`; };
  HR.me().then(async (c) => {
    if (!c) return;
    try { wished = (await api('/api/konto?action=wishlist')).items.some((r) => r.id === rec.id); paintWish(); } catch { /* egal */ }
  });
  wishBtn.addEventListener('click', async () => {
    if (!(await HR.me())) { location.href = `/konto?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    wished = !wished;
    paintWish();
    await api('/api/konto?action=wishlist', { body: { record_id: rec.id, remove: !wished } }).catch(() => {});
    HR.toast(wished ? 'Auf deiner Merkliste' : 'Von der Merkliste entfernt');
  });

  try {
    const data = await api(`/api/shop?action=list&artist_exact=${encodeURIComponent(rec.artist)}&exclude=${rec.id}&per=12`);
    more = data.items;
    if (more.length) {
      document.getElementById('more-title').textContent = `Mehr von ${rec.artist}`;
      document.getElementById('more-grid').innerHTML = more.map((r) => `
        <article class="card">
          <a class="cover" href="/record?id=${r.id}">${imgTag(r)}</a>
          <a class="row-title" href="/record?id=${r.id}">${esc(r.title)}</a>
          <div class="row-meta">${esc(r.format || '')}</div>
          <div class="card-foot"><div class="price">${eur(r.price)}</div>${cartButton(r)}</div>
        </article>`).join('');
      document.getElementById('more').classList.remove('hidden');
    }
  } catch { /* optional */ }
});
