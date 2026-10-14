// Erweiterte Suche: Formular vorbelegen, Trefferzahl live anzeigen, Ergebnisse im Shop öffnen
document.addEventListener('DOMContentLoaded', () => {
  const { api, num } = HR;
  const form = document.getElementById('adv');
  const live = document.getElementById('live');

  // Felder aus der Adresse übernehmen (z. B. vom Link „Erweiterte Suche“ im Shop)
  const P = new URLSearchParams(location.search);
  for (const el of form.elements) if (el.name && P.has(el.name)) el.value = P.get(el.name);

  function params() {
    const qs = new URLSearchParams();
    for (const el of form.elements) {
      if (!el.name) continue;
      let v = el.value.trim();
      if (el.name === 'min' || el.name === 'max') v = v.replace(',', '.');
      if (v && !(el.name === 'sort' && v === 'new')) qs.set(el.name, v);
    }
    return qs;
  }

  let timer;
  let seq = 0;
  async function count() {
    const qs = params();
    qs.delete('sort');
    const my = ++seq;
    live.textContent = 'Zähle Treffer …';
    try {
      const d = await api(`/api/shop?action=list&per=1&${qs}`);
      if (my === seq) live.innerHTML = `<strong>${num(d.total)}</strong> ${d.total === 1 ? 'Platte passt' : 'Platten passen'}`;
    } catch {
      if (my === seq) live.textContent = '';
    }
  }
  form.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(count, 350); });
  form.addEventListener('change', () => { clearTimeout(timer); timer = setTimeout(count, 100); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const qs = params().toString();
    location.href = qs ? `/?${qs}` : '/';
  });
  document.getElementById('adv-reset').addEventListener('click', () => {
    form.reset();
    for (const el of form.elements) if (el.name) el.value = el.tagName === 'SELECT' ? el.options[0].value : '';
    history.replaceState(null, '', location.pathname);
    count();
  });

  count();
});
