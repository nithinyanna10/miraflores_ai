# Notes: decisions and tradeoffs

## Phase 0: audit (2026-10-14)

- `scripts/audit.ts` runs with plain `node` (Node 22 strips types). No dependencies, no build step. It reads the packet read-only and records its sha256 in `findings.json`, so every finding is tied to the exact packet it came from.
- What the audit trusts: `printed_content`, agency records (IRS transcript, FTB account), the 2024 return as filed, and arithmetic. What it does not trust: `extracted_values` and every `return_versions` value.
- Severity levels:
  - `error`: the return disagrees with a printed document, an agency record or arithmetic.
  - `judgment`: someone has to decide (HVAC repair vs improvement, crypto basis evidence, SEP excess, an ambiguous receipt).
  - `warning`: a gap or process issue (variance needing an explanation, a document with no landing, a compliance item).
  - `info`: something that was checked and agrees, or was already handled (D10 duplicate counted once, D30 superseded). Passing checks are kept on purpose: "checked and agrees" is evidence too.
- Tax effects are first order: delta x v3 `tax_effect_rates`, as the readme prescribes. Two exceptions:
  - SALT crosses the cap, so the federal effect is computed on the capped change.
  - HVAC uses the engine's own `what_if`.
  - Effects are not netted against each other. The SEHI and Schedule C changes also move QBI and the SEP limit, and the readme says the real system recomputes.
- Some checks are generic: lot parsing, sum recompute, version diffs, landings, variance, FX and day proration. Others are rules a CPA would write for this household: RSU supplemental basis, the 1099-K overlap, SEHI eligibility, the vehicle 1098-C, the payoff interest, the property tax proration, mixed-use phone. These are still computed from packet data, not from hard-coded numbers. Tradeoff: they are specific to this packet. In the product they would be a library of checks keyed on document types.
- The app's "open items" will be `findings.json`. Each finding carries `refs` and `lines` in packet ref format, so it attaches straight to the graph.

### Things the packet's own engine got right (useful for the video)
- D10 is a duplicate of D09 and is counted once.
- D30 is superseded by D31 from v2 on.
- The S corp basis was fixed in v3 once the 2023 K-1 (D40) arrived.
- The IRA basis came from the 2024 Form 8606 even though the client said "none".
- The ESPP ordinary-income adjustment was applied.

### Things it got wrong silently
- No diagnostic for: RSU basis, the 1099-K double count, the duplicate mileage page, the duplicate Northlake interest, the FX year, the CA wages, the FTB payment designation, the Q4 estimate, SEHI, the vehicle, payoff interest, property tax proration.
- Its broker summary/detail diagnostic fired in every version and nobody resolved it (the missing M18 lot is on page 32).

## Phase 1: resolver, event log, trace view

Stack decisions:
- **SQLite via `node:sqlite`.** Built into Node 22, so no new dependency. It is marked experimental; swap to better-sqlite3 if that bites.
- **Hono server, Vite/React client.** The client fetches the packet once and resolves refs locally with `shared/packet.ts`. The same module is used by the server.
- **Packet served raw for now.** Role-based masking moves server-side in Phase 2, when roles are enforced.
- **Findings are seeded as `finding_opened` events** (actor `audit`, idempotent by finding id and packet hash). Open items therefore have the same lifecycle as everything else: later events resolve them.
- **`DocumentSource` interface.** `SimulatedSource` renders `printed_content` and marks the matched text span. The synthetic `position` box is kept in the highlight object for a future PDF source, but not drawn: drawn over flowing text it would point at the wrong words.

### Screen plan: workpaper (outline | proof thread | document)
1. Left: the return grouped by area. Each line shows its value and a status mark: its own finding (filled) or inherited from an input (outline). Form 8949 shows rollups by box and broker; only exceptions are listed.
2. Middle, nothing selected: the return's bottom line and "Blocking filing", listing every open item and jumping to its line.
3. Middle, line selected: the proof thread. Line, then rule in plain words, then input lines, then each extracted field, then the document region. A finding breaks the thread at its hop in Copy A red, with the problem and the fix in serif. Evidence the return ignored shows as dashed hops.
4. Right: the facsimile with the field marked, plus "also used in" (or the recorded reason it landed nowhere).
5. Header: role switcher, blocking count, cmd-K palette; keyboard j/k/enter. Verify and note (v, n) come in Phase 2.

### Phase 1 outcome
- **Highlight placement.** `locate()` puts 3,007 of 3,012 extracted fields on their exact span of the printed page. It matches whole tokens only, so `0.00` never matches inside `19,240.00`. The 5 misses are two checkboxes plus the D08 box 10 blank, the transposed D62 TIN and the ambiguous D64 receipt. When a value is not printed (RSU basis "(not reported)"), the entry it belongs to is underlined in dashed red instead.
- **Where a finding breaks the thread.** It breaks only the most upstream line the finding names. Totals built from that line inherit the status and show it as an outline mark: "Unverified, built from lines that are Blocked". Without this, every total re-shows every break and the thread stops pointing at a cause.
- **Prior-year variances do not break threads.** They are questions about the line as a whole and sit under the line heading, not on a hop.
- **Evidence a finding cites that the line never used** (the D73 paystub, qa-25) shows as dashed hops. The document pane lists the open items that cite each document, so a document with no landing still points at the break it explains.
- **Selection lives in the URL hash** (`#line=SchCA540NR.1.E&src=ev-0047`). Any trace is a shareable link, and the back button works.
- **Screenshots:** `npm run shots` (Playwright, using the Chromium already installed locally).

## Polish pass (one question per screen)
- **Outline:** areas are collapsed. Each header shows open items and verified/reviewable. 71 worksheet lines (pass-through carries and generic steps like "Line 3 minus line 4") sit behind "Show worksheet lines". Labels wrap instead of truncating. Duplicate labels get their form and line appended.
- **Marks:** red marks only where an error originates. Totals built from a broken line show a quiet grey ring ("affected by N"), and that count leaves out prior-year variances.
- **Findings:** each card shows the problem, the fix and the tax effect, one line each. The reasoning opens on click.
- **Home:** federal and California summary with 2024, 2025 and change columns. The top 5 blockers by tax effect, then "Show all". The right pane is the document index; a document with no landing and no recorded reason is red.
- **Proof thread:** steps grouped into stages (Computed by / Built from / Read from / Cited but not used). Clean fields from one page collapse into one step. A connector runs from the selected step to the page margin beside the marked text: red when the step is broken, dashed when the mark is scrolled out of view, hidden in the stacked tablet layout.
- **Landings:** prior-year refs (`py:`, `asset:`) now count as landings on D06/D07, matching the audit.

## Phase 2: roles, masking, review layer

- **One policy file (`shared/policy.ts`).** It maps each event type to the roles allowed to create it, plus the stateful firm rules. The server runs `refuse()` on every write and returns the reason in plain words: "You prepared part of Business, so someone else must sign off on it as reviewer." The client imports the same `can()` only to hide buttons. There is no auth system: the role switcher sends `x-user` (per the brief).
- **Staff `active_from` is enforced.** The quality reviewer (starts 2027-01-04) cannot act yet.
- **Masking is server-side and total.** The packet, the findings, the event payloads and the SSE stream all pass through one masker, so a client never receives a raw SSN unless it asks.
  - Covered: SSNs (by value and by shape), IP PIN, bank routing and account, the IBAN, and the 8879 e-file PINs in timeline text. Last 4 digits stay visible.
  - Masking keeps string length, so highlight offsets still line up after unmasking.
  - `node server/mask.ts` asserts the cases.
- **Unmasking is a separate request** (`POST /api/reveal`). Staff need clearance and must be active; clients may see their own household's data. Every request is logged as an event, refusals included, and shows on the document as "Unmasked views". The firm admin's view-log screen (Phase 5) reads the same events.
- **Verification.** A verification records the method (from `starter_standards.verification_types`) and the value it saw. If the line's value later differs, it shows Reopened. Keys: v verifies, n adds a note.
- **Review notes** block filing (they add to the header count and lead Home's blocker list). Only the author or the partner can clear one; anyone on staff can reply.
- **Sign-offs** are per area (or the whole return), preparer, then reviewer, then partner.
  - Each stores a hash of the area's line keys, values, source refs and evidence events (verifications, resolutions, adjustments).
  - Any later change shows the sign-off as Reopened, at every level.
  - A sign-off whose hash no longer matches the server's is refused ("The work changed while you were signing").
  - The hash covers source refs, not source values: the packet is immutable, and masked and unmasked copies must hash the same.
- **Open items** can be resolved by a reviewer or the partner, with a written reason.
- **Checks:** `node scripts/e2e-phase2.ts` (12 assertions; needs a fresh DB and the dev stack running).
- **Not yet:** file attachments as evidence, and a client-facing view that hides internal review notes from clients. Today clients can read everything except unmasked data and cannot write anything but notes.

## Phase 2 finished: attachments and the client view
- **Attachments are stored by SHA-256 under `DATA_DIR/attachments`.** The file itself says nothing; an `evidence_attached` event says what it is evidence of (refs) and who attached it. The same file attached twice is stored once.
- **Viewing an attachment:** served with `nosniff` and a `default-src 'none'` CSP, so an uploaded HTML or SVG file cannot run script. It opens in the document pane (image or PDF inline; text in a sandboxed frame).
- **Client visibility is decided on the server** (`visibleTo` in `shared/policy.ts`), not hidden in the UI:
  - Clients get a client-scoped packet (`/api/client`): household, questionnaire and messages, the documents they gave us, plus the engagement letter and consent. No extracted values, no return lines, no firm data.
  - `/api/packet` and `/api/findings` return 403 for clients.
  - `/api/events` and the SSE stream are filtered per user. Clients receive questions addressed to them, their answers and uploads, files staff chose to share, and their own unmasked views. Review notes, open items, judgment calls, verifications and sign-offs never leave the server for a client user.
- **Questions to the client become evidence.** A staff member sends `client_question` from a line. The client answers with text and/or a file. The file is attached to the same line refs, so it shows in that line's proof thread as evidence.
- **Clients can no longer write internal notes.** Their only writes are answers and uploads.
- **Switching user reloads the page,** so every fetch and the live stream are re-scoped by the server.

## Deploy
- **One Fly machine** with a volume at `/data` (event log + attachments). SQLite means a single writer, so `--ha=false`. The packet and findings ship in the image, read-only.
- **Node pinned to 22.22.2** (`node:sqlite` is unflagged from 22.13).
- `node scripts/e2e-phase2.ts <url>` runs the same 23 browser checks against any deployment. It writes test data, so run it on a fresh volume.

## Phase 3 (in progress): changes
- **Adjustments keep the original.** An `adjusted` event records from, to, reason, the authority relied on, and the open item it addresses.
  - The server, not the browser, computes the tax effect (`effectOf` in `shared/packet.ts`: change x v3 rate). The category comes from the line, with the right sign for expenses; sales during California residency use `ca_source_income`; payments and credits are 1:1.
  - A refused stale edit says so: "The line is now X, not Y".
  - Effect over 1,000 (federal or California) needs a partner's approval (firm rule). Until then it blocks filing. A partner cannot approve their own adjustment.
  - Reversal is a compensating event with a reason. The original comes back, and so does the open item.
  - Lines show the engine value struck through next to the current value. Home shows "the return as adjusted" as a first-order total.
- **"Apply the fix"** on an open item prefills the amount from the audit's fix text (`SchC.1 = 151,300`, `gain 140`, `Remove X`, `Deduct N`). A person still records it, with a reason.
- **Bulk actions are one event over many refs.** "Verify the 110 sales with no open items against D74" records one `verified` event with each line's value. Undo is one compensating `verification_withdrawn`. Exceptions are never included in a bulk action.
- **Since I last looked.** A per-viewer cursor (last seen event seq) lives in localStorage; it is a convenience, not a record. The header shows "N new since you looked", the drawer lists who did what on which line, and changed values are underlined in amber in the outline.
- **Version compare.** Any two engine versions, with the trigger, documents added or superseded, summary deltas, and changed lines grouped by area. Lots collapse behind a toggle.
- **What-ifs.** The engine's precomputed alternatives, each with its federal and California effect. Choosing one is an `election_recorded` event; the server refuses it without a reason and an authority (firm rule: every judgment call records the authority).
- **Checks:** `node scripts/e2e-phase3.ts` (17 checks).
