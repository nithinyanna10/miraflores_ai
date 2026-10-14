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
