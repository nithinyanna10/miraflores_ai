// Packet (immutable base layer) + append-only event log in SQLite + SSE fan-out.
// Every response is masked; unmasking is a logged request; every write passes shared/policy.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Graph } from '../shared/packet.ts';
import { refuse, isActive, visibleTo, ATTACH_ROLES, type Actor, type StoredEvent } from '../shared/policy.ts';
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

// Everything people create lives under DATA_DIR (a Fly volume in production): the event log and attached files.
const DATA_DIR = process.env.DATA_DIR ?? root;
const ATTACH_DIR = DATA_DIR + '/attachments';
mkdirSync(ATTACH_DIR, { recursive: true });
const db = new DatabaseSync(DATA_DIR + '/workpaper.db');
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

const listeners = new Set<(e: StoredEvent) => void>();
function append(actor: string, type: string, refs: string[], payload: any): StoredEvent {
  const r = insertStmt.run(new Date().toISOString(), actor, type, JSON.stringify(refs), JSON.stringify(payload ?? {}));
  const ev = rowToEvent(db.prepare('SELECT * FROM events WHERE seq = ?').get(r.lastInsertRowid));
  for (const l of listeners) l(ev);
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
app.get('/api/people', c => c.json(people.map(({ id, name, role, sensitive_data_clearance, active_from }) => ({ id, name, role, sensitive_data_clearance, active_from }))));
const userOf = (c: any) => actorOf(c.req.header('x-user') ?? c.req.query('user'));
const staffOnly = (c: any) => { const a = userOf(c); return a && a.role !== 'client' ? null : c.json({ error: a ? 'Clients see their own documents and questions, not the workpaper.' : 'Pick who you are first.' }, 403); };
app.get('/api/packet', c => staffOnly(c) ?? c.body(MASKED_PACKET, 200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' }));
app.get('/api/findings', c => staffOnly(c) ?? c.body(FINDINGS, 200, { 'content-type': 'application/json' }));
app.get('/api/events', c => {
  const a = userOf(c);
  return c.json(allEvents().filter(e => e.seq > Number(c.req.query('after') ?? 0) && visibleTo(a, e, people)).map(masked));
});
// What a client sees of the packet: their household, their questionnaire and messages, and the documents
// they gave us (plus the engagement letter and consent they signed). No extracted values, no return lines.
const CLIENT_PACKET = mask(JSON.stringify({
  packet: P.packet, household: P.household, client: P.client,
  documents: P.documents.filter((d: any) => d.uploaded_by === 'client' || ['engagement_letter', 'consent_7216'].includes(d.document_type))
    .map(({ extraction, ...d }: any) => d),
}));
app.get('/api/client', c => (userOf(c) ? c.body(CLIENT_PACKET, 200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' }) : c.json({ error: 'Pick who you are first.' }, 401)));

// Attachments: the file is stored by content hash; an evidence_attached event says what it is evidence of.
const MAX_BYTES = 15 * 1024 * 1024;
app.post('/api/attachments', async c => {
  const a = userOf(c);
  if (!a || !ATTACH_ROLES.includes(a.role) || !isActive(a)) return c.json({ error: 'Pick an active user first.' }, 403);
  const refs = (c.req.query('refs') ?? '').split(',').filter(Boolean);
  const name = (c.req.query('name') ?? 'file').replace(/[^\w .()-]/g, '_').slice(0, 120);
  if (!refs.length) return c.json({ error: 'Say what this file is evidence of.' }, 400);
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (!buf.length) return c.json({ error: 'The file is empty.' }, 400);
  if (buf.length > MAX_BYTES) return c.json({ error: 'Files are limited to 15 MB.' }, 413);
  const id = createHash('sha256').update(buf).digest('hex');
  if (!existsSync(`${ATTACH_DIR}/${id}`)) writeFileSync(`${ATTACH_DIR}/${id}`, buf);
  const type = c.req.header('content-type') ?? 'application/octet-stream';
  const ev = append(a.id, 'evidence_attached', refs, { id, name, type, size: buf.length, note: c.req.query('note') || undefined, question: Number(c.req.query('question')) || undefined, shared_with_client: c.req.query('share') === '1' || undefined });
  return c.json(masked(ev), 201);
});
app.get('/api/attachments/:id', c => {
  const a = userOf(c);
  const id = c.req.param('id');
  const ev = allEvents().find(e => e.type === 'evidence_attached' && e.payload.id === id && visibleTo(a, e, people));
  if (!ev || !/^[0-9a-f]{64}$/.test(id) || !existsSync(`${ATTACH_DIR}/${id}`)) return c.json({ error: 'No such file, or not yours to see.' }, 404);
  return c.body(readFileSync(`${ATTACH_DIR}/${id}`), 200, { 'content-type': ev.payload.type, 'content-disposition': `inline; filename="${ev.payload.name}"`, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'", 'cache-control': 'private, no-store' });
});

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
  const a = userOf(c);
  const send = (e: StoredEvent) => { if (visibleTo(a, e, people)) s.writeSSE({ data: JSON.stringify(masked(e)), id: String(e.seq) }); };
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
