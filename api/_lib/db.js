import { neon } from '@neondatabase/serverless';

let client;
export function db() {
  if (!client) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('Datenbank nicht verbunden (DATABASE_URL fehlt). Siehe README.');
    client = neon(url);
  }
  return client;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS records (
    id               serial PRIMARY KEY,
    import_key       text UNIQUE NOT NULL,
    release_id       bigint,
    listing_id       text,
    artist           text NOT NULL,
    title            text NOT NULL,
    label            text,
    catno            text,
    format           text,
    released         text,
    genre            text,
    media_condition  text,
    sleeve_condition text,
    description      text,
    notes            text,
    avg_price        numeric(10,2),
    price            numeric(10,2),
    price_locked     boolean NOT NULL DEFAULT false,
    status           text NOT NULL DEFAULT 'available',
    cover_url        text,
    thumb_url        text,
    batch            text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    sold_at          timestamptz
  )`,
  `ALTER TABLE records ADD COLUMN IF NOT EXISTS tracks text`,
  `ALTER TABLE records ADD COLUMN IF NOT EXISTS country text`,
  `CREATE INDEX IF NOT EXISTS records_status_idx ON records (status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS records_price_idx ON records (status, price)`,
  `CREATE INDEX IF NOT EXISTS records_artist_idx ON records (lower(artist))`,
  `CREATE TABLE IF NOT EXISTS orders (
    id               serial PRIMARY KEY,
    paypal_order_id  text UNIQUE NOT NULL,
    record_ids       int[] NOT NULL,
    items            jsonb NOT NULL,
    item_total       numeric(10,2) NOT NULL,
    shipping         numeric(10,2) NOT NULL,
    total            numeric(10,2) NOT NULL,
    status           text NOT NULL DEFAULT 'created',
    payer_email      text,
    payer_name       text,
    shipping_address jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    completed_at     timestamptz
  )`,
];

let ready;
export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const sql = db();
      for (const stmt of SCHEMA) await sql.query(stmt);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}
