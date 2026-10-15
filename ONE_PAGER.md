# A workpaper that proves the return

**Live:** https://miraflores-workpaper.fly.dev. Pick a person; the server enforces that person's role.

## The core idea

The packet is an immutable base layer. Everything a person does is an append-only event pointing at refs in the packet. The current state of the workpaper is the packet plus the replayed events, and every screen is a view of that derivation.

This one decision gives most of the brief for free:

- **The original is never lost.** An adjustment is an event that says from, to, who, why, the authority relied on, and the tax effect. Reversing it is another event.
- **Who, when and why** are on everything, because every event carries them.
- **"What changed since I last looked"** is the events after my cursor.
- **Undo** (including bulk undo) is one compensating event.
- **Sign-offs reopen** when the signed work changes. A sign-off stores a hash of the lines, values, source refs and evidence events it covers; any later change makes the hash differ.
- **Freeze at filing** records the event cursor and a hash at the IRS acceptance. After that the server refuses changes until a partner opens an amendment, which layers on top.
- **Replay as of any date** runs the same derivation over the events up to that day.
- **The notice-response packet** is a self-contained export of a few lines' threads as frozen.

The user interface is organized around the return's line graph, not around forms. Every line has a rule, input lines and source refs. One resolver turns any ref string (`ev-0016`, `D09`, `doc:D30#page32`, `py:/carryovers_into_2025/...`, `agency:/efile/0`, `qa-25`, `asset:SAC-ROOF`, `ref:fx.SEK.2025_average`) into a node.

Selecting a number draws its **proof thread**: line, then rule in plain words, then input lines, then the extracted field, then the marked text on a facsimile of the printed page. The thread is the one bold element in the design.

The audit's findings are not a separate error list. Each one breaks the thread at the step it affects, in Copy A red, with the problem, the fix and the tax effect.

## Trust model

- **The packet's printed text is ground truth. Extracted values and engine output are claims to check.**
  - `scripts/audit.ts` runs independent checks and finds 19 errors, 4 judgment calls and 71 warnings. See ERRORS_FOUND.md.
  - The audit seeds the open items; nothing is hand-entered.
- **Tax effect = change × v3 rate,** as the readme prescribes, computed once on the server (`effectOf`) and shared by the audit and the app.
  - Adjustments are not propagated into dependent totals. The engine cannot be rerun, and a second engine would disagree with the first.
  - Known knock-ons the rate misses (Schedule C moves the SEP and SE health insurance limits; those move QBI) become "needs recompute" judgment items.
  - `scripts/reconcile.ts` proves every demo number ties to the audit findings.
- **Roles are enforced on the server.**
  - Identity comes only from a signed, HttpOnly session cookie; a forged header is ignored, and a test checks it.
  - One policy file (`shared/policy.ts`) holds the firm's rules: no reviewing your own work, adjustments over 1,000 need the partner, judgment calls need an authority, open review notes block filing, staff start dates. Refusals come back in plain words.
- **Sensitive data is masked in everything the server sends.** That covers SSNs, IP PIN, bank account, IBAN and e-file PINs, keeping the last 4 digits. Unmasking is a separate, logged request, and only the firm administrator and the partner see the view log.
- **Clients get a server-scoped view:** their questions, their documents and uploads, then approval and e-signature. Review notes, open items, verifications and sign-offs never leave the server for a client user.

## Data model

```
packet (read-only JSON, sha256 recorded)            events (SQLite, append-only)
  documents, pages.printed_content                    seq      integer, ordered
  extracted_values (claims)                           at       timestamp
  return_versions v1..v3 lines {rule, inputs, sources} actor   person id (from the session) | audit | system
  client, firm, prior_years, tax_agency_records       type     verified | adjusted | review_note_opened | signed_off | ...
  timeline, engine_reference, what_if                 refs[]   packet refs and line keys it is about
                                                      payload  method, from/to, reason, authority, hash, ...
attachments: files on the volume, named by sha256; an evidence_attached event says what each proves.

derived on read (shared/*.ts, same code on server and client):
  open items = findings opened - resolved - addressed by a live adjustment - explained
  line status (Unverified / Verified / Adjusted / Question open / Blocked / Reopened / Frozen)
  current value = engine value, or the latest live adjustment
  sign-offs (current or reopened, by hash), readiness for the 12 required steps, e-file state, freeze
```

About 35 event types. Each is checked by `refuse()` before it is written. Each change type is refused after the freeze unless an amendment is open.

## Stack and ceilings

- **Stack:** Vite and React, a small Hono server, `node:sqlite` (built into Node 22, so no ORM), server-sent events for live updates, and one always-on Fly machine with a volume.
- **Tests:** four Playwright suites (97 checks) run against any URL and reset the live demo afterwards. Also `audit.ts`, `reconcile.ts` and `mask.ts`.
- **Ceilings:**
  - No real authentication.
  - Agency responses replay from the packet.
  - Replay rewinds the event state; return values stay v3.
  - The list of knock-on effects is hand-written for this return.
  - The documents are facsimiles of the printed text; real PDFs would plug into the `DocumentSource` interface instead.
