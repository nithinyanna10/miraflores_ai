// Packet (immutable base layer) + append-only event log in SQLite + SSE fan-out.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url).pathname;
const RAW = readFileSync(root + 'data/okafor_lindqvist_2025_packet.json');
const PACKET_SHA = createHash('sha256').update(RAW).digest('hex');
const P = JSON.parse(RAW.toString('utf8'));
const people = [...P.firm.staff, ...P.firm.client_users];

const db = new DatabaseSync(process.env.DB_PATH ?? root + 'workpaper.db');
db.exec(`CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  refs TEXT NOT NULL,
  payload TEXT NOT NULL
)`);
const insert = db.prepare('INSERT INTO events (at, actor, type, refs, payload) VALUES (?, ?, ?, ?, ?)');
const rowToEvent = (r: any) => ({ ...r, refs: JSON.parse(r.refs), payload: JSON.parse(r.payload) });

// Seed audit findings as open items, once per (packet, finding).
{
  const f = JSON.parse(readFileSync(root + 'findings.json', 'utf8'));
  if (f.packet_sha256 !== PACKET_SHA) console.warn('findings.json was produced from a different packet; rerun npm run audit');
  const seeded = new Set((db.prepare(`SELECT json_extract(payload, '$.id') id FROM events WHERE type = 'finding_opened' AND json_extract(payload, '$.packet') = ?`).all(PACKET_SHA) as any[]).map(r => r.id));
  let n = 0;
  for (const x of f.findings) {
    if (x.severity === 'info' || seeded.has(x.id)) continue;
    insert.run(new Date().toISOString(), 'audit', 'finding_opened', JSON.stringify([...x.lines, ...x.refs]), JSON.stringify({ ...x, packet: PACKET_SHA }));
    n++;
  }
  if (n) console.log(`seeded ${n} open items from findings.json`);
}

const listeners = new Set<(e: any) => void>();
const app = new Hono();

app.get('/api/packet', c => c.body(RAW, 200, { 'content-type': 'application/json', 'cache-control': 'private, max-age=3600' }));
const FINDINGS = readFileSync(root + 'findings.json');
app.get('/api/findings', c => c.body(FINDINGS, 200, { 'content-type': 'application/json' }));
app.get('/api/people', c => c.json(people));
app.get('/api/events', c => {
  const after = Number(c.req.query('after') ?? 0);
  return c.json((db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq').all(after) as any[]).map(rowToEvent));
});
app.post('/api/events', async c => {
  const actor = c.req.header('x-user');
  if (!people.some(p => p.id === actor)) return c.json({ error: 'Pick a user in the role switcher first.' }, 401);
  const body = await c.req.json();
  if (typeof body.type !== 'string' || !Array.isArray(body.refs)) return c.json({ error: 'type and refs are required' }, 400);
  // ponytail: no per-role rules yet; Phase 2 adds them here, in one place.
  const r = insert.run(new Date().toISOString(), actor!, body.type, JSON.stringify(body.refs), JSON.stringify(body.payload ?? {}));
  const ev = rowToEvent(db.prepare('SELECT * FROM events WHERE seq = ?').get(r.lastInsertRowid));
  for (const l of listeners) l(ev);
  return c.json(ev, 201);
});
app.get('/api/stream', c => streamSSE(c, async s => {
  const send = (e: any) => s.writeSSE({ data: JSON.stringify(e), id: String(e.seq) });
  listeners.add(send);
  await s.writeSSE({ event: 'hello', data: '' }); // flush headers so clients see the stream open
  s.onAbort(() => { listeners.delete(send); });
  while (!s.aborted) await s.sleep(25000).then(() => s.writeSSE({ event: 'ping', data: '' }));
}));

if (existsSync(root + 'dist')) {
  app.use('/*', serveStatic({ root: 'dist' }));
  app.get('*', serveStatic({ path: 'dist/index.html' }));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`workpaper server on :${port}`));
