// Kontaktformular im Impressum
document.addEventListener('DOMContentLoaded', () => {
  const f = document.getElementById('kontakt-form');
  if (!f) return;
  f.elements.t.value = String(Date.now());
  const msg = document.getElementById('kontakt-msg');
  const show = (text, cls) => { msg.innerHTML = `<div class="notice ${cls}">${text}</div>`; };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    const data = Object.fromEntries(new FormData(f));
    try {
      const r = await fetch('/api/kontakt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Senden fehlgeschlagen.');
      f.reset();
      f.elements.t.value = String(Date.now());
      show('Danke! Deine Nachricht ist angekommen. Ich melde mich so bald wie möglich.', 'ok');
    } catch (err) {
      show(err.message.replace(/[<>&]/g, ''), 'err');
    } finally {
      btn.disabled = false;
    }
  });
});
