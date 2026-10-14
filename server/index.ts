// Packet (immutable base layer) + append-only event log in SQLite + SSE fan-out.
// Every response is masked; unmasking is a logged request; every write passes shared/policy.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Graph } from '../shared/packet.ts';
import { refuse, isActive, type Actor, type StoredEvent } from '../shared/policy.ts';
import { buildMasker } from './mask.ts';

const root = new URL('../', import.meta.url).pathname;
const RAW = readFileSync(root + 'data/okafor_lindqvist_2025_packet.json', 'utf8');
const PACKET_SHA = createHash('sha256').update(RAW).digest('hex');
const P = JSON.parse(RAW);
const g = new Graph(P);
const mask = buildMasker(P);
const MASKED_PACKET = mask(RAW);
const people: Actor[] = [...P.firm.staff, ...P.firm.client_users];
const actorOf = (id?: string | null) => people.find(p => p.id === id);

const db = new DatabaseSync(process.env.DB_PATH ?? root + 'workpaper.db');
db.exec(`CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  refs TEXT NOT NULL,
  payload TEXT NOT NULL
)`);
const insertStmt = db.prepare('INSERT INTO events (at, actor, type, refs, payload) VALUES (?, ?, ?, ?, ?)');
const rowToEvent = (r: any): StoredEvent => ({ ...r, refs: JSON.parse(r.refs), payload: JSON.parse(r.payload) });
const allEvents = (): StoredEvent[] => (db.prepare('SELECT * FROM events ORDER BY seq').all() as any[]).map(rowToEvent);
const masked = (e: StoredEvent) => JSON.parse(mask(JSON.stringify(e)));

const listeners = new Set<(e: any) => void>();
function append(actor: string, type: string, refs: string[], payload: any): StoredEvent {
  const r = insertStmt.run(new Date().toISOString(), actor, type, JSON.stringify(refs), JSON.stringify(payload ?? {}));
  const ev = rowToEvent(db.prepare('SELECT * FROM events WHERE seq = ?').get(r.lastInsertRowid));
  for (const l of listeners) l(masked(ev));
  return ev;
}

// Seed audit findings as open items, once per (packet, finding).
{
  const f = JSON.parse(readFileSync(root + 'findings.json', 'utf8'));
  if (f.packet_sha256 !== PACKET_SHA) console.warn('findings.json was produced from a different packet; rerun npm run audit');
  const seeded = new Set((db.prepare(`SELECT json_extract(payload, '$.id') id FROM events WHERE type = 'finding_opened' AND json_extract(payload, '$.packet') = ?`).all(PACKET_SHA) as any[]).map(r => r.id));
  let n = 0;
  for (const x of f.findings) {
    if (x.severity === 'info' || seeded.has(x.id)) continue;
    append('audit', 'finding_opened', [...x.lines, ...x.refs], { ...x, packet: PACKET_SHA });
    n++;
  }
  if (n) console.log(`seeded ${n} open items from findings.json`);
}
const FINDINGS = mask(readFileSync(root + 'findings.json', 'utf8'));

const app = new Hono();
app.get('/api/packet', c => c.body(MASKED_PACKET, 200, { 'content-type': 'application/json', 'cache-control': 'private, max-age=3600' }));
app.get('/api/findings', c => c.body(FINDINGS, 200, { 'content-type': 'application/json' }));
app.get('/api/events', c => c.json(allEvents().filter(e => e.seq > Number(c.req.query('after') ?? 0)).map(masked)));

app.post('/api/events', async c => {
  const a = actorOf(c.req.header('x-user'));
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.type !== 'string' || !Array.isArray(body.refs)) return c.json({ error: 'Send a type and refs.' }, 400);
  const why = refuse(a, body, allEvents(), g);
  if (why) return c.json({ error: why }, 403);
  return c.json(masked(append(a!.id, body.type, body.refs, body.payload)), 201);
});

// Unmask one thing. Staff need sensitive-data clearance; clients see their own household's data.
// Every request is logged, refusals included.
app.post('/api/reveal', async c => {
  const a = actorOf(c.req.header('x-user'));
  if (!a) return c.json({ error: 'Pick who you are in the role switcher first.' }, 401);
  const { ref } = await c.req.json().catch(() => ({ ref: '' }));
  const value = reveal(String(ref));
  if (value === undefined) return c.json({ error: 'Nothing sensitive at that reference.' }, 404);
  if (!(a.role === 'client' || (a.sensitive_data_clearance && isActive(a)))) {
    append(a.id, 'sensitive_view_refused', [ref], { reason: 'no sensitive-data clearance' });
    return c.json({ error: `${a.name} does not have sensitive-data clearance. The attempt was logged.` }, 403);
  }
  append(a.id, 'sensitive_viewed', [ref], {});
  return c.json({ ref, value });
});
function reveal(ref: string): unknown {
  const n = g.resolve(ref);
  const v = n.kind === 'page' ? g.docs[n.docId!].pages.find((p: any) => p.page === n.page)?.printed_content
    : n.kind === 'ev' || n.kind === 'household' ? n.value
    : ref === 'household:bank' ? P.household.bank_account_for_refund_or_payment : undefined;
  if (v === undefined) return undefined;
  const s = JSON.stringify(v);
  return mask(s) === s ? undefined : v; // only sensitive things go through this door
}

app.get('/api/stream', c => streamSSE(c, async s => {
  const send = (e: any) => s.writeSSE({ data: JSON.stringify(e), id: String(e.seq) });
  listeners.add(send);
  s.onAbort(() => { listeners.delete(send); });
  await s.writeSSE({ event: 'hello', data: '' }); // flush headers so clients see the stream open
  while (!s.aborted) await s.sleep(25000).then(() => s.writeSSE({ event: 'ping', data: '' }));
}));

if (existsSync(root + 'dist')) {
  app.use('/*', serveStatic({ root: 'dist' }));
  app.get('*', serveStatic({ path: 'dist/index.html' }));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`workpaper server on :${port}`));
