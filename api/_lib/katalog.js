import { db } from './db.js';

// Lädt Cover, Trackliste, Genre und Land einer Platte über die Katalog-API (Token: DISCOGS_TOKEN)
// und speichert sie. Leerer String = "geprüft, nichts vorhanden" (wird nicht erneut abgefragt).
export async function fetchCover(rec) {
  const token = process.env.DISCOGS_TOKEN;
  if (!token || !rec.release_id) return { status: 'skip' };
  const r = await fetch(`https://api.discogs.com/releases/${rec.release_id}`, {
    headers: { 'User-Agent': 'HomerunRecords/1.0', Authorization: `Discogs token=${token}` },
  });
  if (r.status === 429) return { status: 'ratelimit' };
  if (!r.ok && r.status !== 404) return { status: 'error' };

  let cover = '';
  let thumb = '';
  let genre = null;
  let tracks = '';
  let country = null;
  let year = null;
  if (r.ok) {
    const j = await r.json();
    const imgs = j.images || [];
    const img = imgs.find((i) => i.type === 'primary') || imgs[0];
    if (img) { cover = img.uri || ''; thumb = img.uri150 || img.uri || ''; }
    genre = [...(j.genres || []), ...(j.styles || [])].join(', ') || null;
    tracks = (j.tracklist || [])
      .filter((t) => t.type_ !== 'heading' && t.title)
      .map((t) => `${t.position ? `${t.position}\t` : ''}${t.title}`)
      .join('\n');
    country = j.country || null;
    year = j.year ? String(j.year) : null;
  }
  await db().query(
    `UPDATE records SET cover_url = $2, thumb_url = $3, genre = coalesce(genre, $4), tracks = coalesce(nullif(tracks, ''), $5),
       country = coalesce(country, $6), released = coalesce(nullif(released, ''), $7) WHERE id = $1`,
    [rec.id, cover, thumb, genre, tracks, country, year],
  );
  return { status: 'ok', cover, thumb };
}
