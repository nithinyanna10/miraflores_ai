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
