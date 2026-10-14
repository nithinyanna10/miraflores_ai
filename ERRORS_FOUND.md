# Errors found in the packet, and how the design surfaced them

`scripts/audit.ts` reads the packet and trusts only:

- the printed text of each document;
- the IRS transcript and FTB account;
- the 2024 return as filed;
- arithmetic.

It does not trust the extracted values or any engine version. It produced 19 errors, 4 judgment calls, 71 warnings (53 of them prior-year swings over the firm threshold) and 47 checks that passed. The full output, with every reference, is in `ERRORS.md` and `findings.json`.

**Tax effect** = change × the v3 rate for the line's category (readme). It is computed by the same `effectOf` the app uses, so the two cannot disagree: `node scripts/reconcile.ts` checks it. Fixing all the errors would lower tax by **11,805 federal and 7,636 California**. Two payment errors work the other way, raising the balance due by 1,000 federal and 3,500 California. Net: −10,805 federal, −4,136 California.

**How the design surfaces an error.** The audit's findings are seeded into the event log as open items; nothing is entered by hand. Each one shows up four ways:
- **Thread:** the proof thread of the line it affects breaks, in red, at the exact step: the extracted field, the source document, or the rule.
- **Outline and Home:** a red mark on that line in the outline. Totals built from it show a quiet "affected by N" ring instead.
- **Blocking list:** an entry in Home's blocking list, sorted by tax effect.
- **Evidence the return ignored:** shown as dashed steps. The document pane lists the open items that cite each document.

**Where to see it:** each "where" below is a deep link into the live app. You sign in first, then land on the line: https://miraflores-workpaper.fly.dev/app#line=KEY.

## Errors (the return disagrees with a document, an agency record or arithmetic)

| # | Error | Effect fed / CA | How it was found | How the design shows it | Where |
|---|---|---|---|---|---|
| F-001, F-002, F-007 | RSU lots N1, N3, N4 reported with $0 basis. The broker printed "basis (not reported)"; the stock-plan supplemental statement (D11) gives 19,100, 19,100 and 9,420, already taxed as wages. | −15,536 / −2,764 | Matched D11 lots to the 1099-B lots by vest date; the engine never matched them. | The thread breaks at "D28 Lot N1 cost basis: not on the printed page". The lot's entry on page 3 is underlined in red. **Apply the fix** prefills 140. Sales detail lists the three lots as exceptions. | `#line=F8949.B.N1` |
| F-003 | California-source wages overstated by 88,831. The Halvorsen W-2 box 16 (111,300) includes Texas-period wages; payroll kept CA as the work state until 09/30. | 0 / −5,685 | Paystub D73 shows CA wages 22,469 at the move date; qa-45 confirms the payroll mistake. | The thread breaks at "D09 Box 16". The paystub D73 appears as dashed *evidence the return did not use*. D73 was also one of four documents that landed nowhere. | `#line=SchCA540NR.1.E` |
| F-004 | Self-employed health insurance deduction of 14,400, though Erik could join Ngozi's employer plan all year (IRC 162(l)(2)(B)). | +4,464 / +605 | qa-25 answer, and the 2024 return's own note. | The thread breaks at D25. qa-25 shows as unused evidence. The 2024-vs-2025 swing (0 to 14,400) is flagged too. | `#line=Sch1.17` |
| F-005 | Schedule C gross receipts 163,700 count the 12,400 Form 1099-K twice: it was the card portion of Atlas's 41,200, already deposited in the books. | −4,402 / −384 | D15 p3: "deposited gross". Books 151,300 = 1099-NEC 142,000 + clients with no 1099 9,300. This is the item the IRS examines in 2028. | The thread breaks at "D21 Box 1a". Books to tax shows the 12,400 reconciling item. The notice packet carries this reconciliation. | `#line=SchC.1` |
| F-006 | California estimates 14,000 on the return; the FTB credits 10,500. The 9/15 payment was designated tax year 2024. | CA refund overstated 3,500 | FTB account record vs return; D68 prints "tax year 2024". | The thread breaks at the 9/15 payment field. The readiness step "Estimated payments agreed to IRS and FTB records" stays open. | `#line=F540NR.72` |
| F-008 | Home property tax 13,420 includes the seller's 6,912 share (closing statement credit, D54). | +1,462 / +332 | D54 vs the Form 1098 escrow amount. The SALT total falls under the 40,000 cap, so the federal effect is on the capped change. | The thread breaks at the escrow field. D54 (no landing, no reason) shows red in the document index. | `#line=SchA.5b` |
| F-009 | Q4 federal estimate: the client said 4,000 on 1/14; the IRS transcript shows 3,000 on 1/15. | Balance +1,000 | No EFTPS confirmation for Q4, so the engine used the questionnaire. | The thread breaks on the questionnaire step; the "document sources support 9,000" warning appears too. | `#line=F1040.26` |
| F-010 | Mileage log page 3 is a second scan of page 2: 3,700 miles counted twice. | +919 / +80 | Duplicate-page check (same text, a scan note) plus the odometer total. | The thread breaks on SchC.44a. Both page totals are visible as sources. | `#line=SchC.44a` |
| F-011 | Vehicle donation claimed at 6,000 (Kelley Blue Book); the charity sold it for 2,900 (Form 1098-C box 4c), which caps the deduction. Examined in 2028. | +806 / +149 | 1098-C box 4c landed nowhere. | The thread breaks at the client's 6,000 estimate (qa-39). D66 box 4c shows as *evidence the return did not use*. The notice packet includes it. | `#line=F8283.A1.vehicle` |
| F-012 | Northlake interest of 1,840 counted twice: the sweep bank's 1099-INT (D29) repeats the one on the brokerage statement (D28), same account ending 7731. | −640 / −127 | Equal Schedule B amounts whose source documents share an account number. | Schedule B.1.2 is red; Total interest shows "affected by". | `#line=SchB.1.2` |
| F-013 | Payoff interest of 2,150 counted twice. The lender's statement says it is already on the Form 1098. | +559 / +103 | D56 text: "Interest is reported on the 2025 Form 1098." | The thread breaks at the payoff field. | `#line=SchA.8a` |
| F-014 | Phone and internet deducted at 100%; the client says 70% and 50% business. | +464 / +41 | call-01 notes vs D15 detail. | The thread breaks at the books internet field (D14); the call note shows as unused evidence. | `#line=SchC.25` |
| F-015 | Personal Spotify Family (216) inside business software. | +77 / +7 | call-01: "personal, booked by mistake". | The thread breaks at the rule (the software line); the call note and D15's Spotify line show as unused evidence. | `#line=SchC.27a.1` |
| F-016 | Swedish interest converted at the 2024 average rate (10.56) instead of 2025 (9.86). | +43 / +9 | The fx ref year differs from the income year. | The thread breaks at the SEK amount (D36); the `2024_average` rate it used is the next step in the same thread. | `#line=SchB.1.6` |
| F-017 | Meridian lot M18 (page 32, "Additional transactions") never extracted. The engine's own summary/detail warning fired in all three versions and nobody resolved it. | −21 / −2 | Lot parser on the printed pages; summary 71,965 vs lots 71,715. | Sales detail: "D31 broker summary 71,965 ≠ lots 71,715; 250 missing", in red. | Records, Sales detail |
| F-018 | The Little Sprouts tax ID on Form 2441 has transposed digits (74-3829516 vs 74-3829156). | none (form error) | Extracted value not found on the printed page. | The facsimile marks nothing and says "Not printed on the page". | `#line=F2441.1b` |
| F-019 | Theo's SSN mistyped in the organizer (…3309 vs …3390 on his 2024 return and his card). This is the real 7/13 e-file rejection. | none (rejection) | Organizer vs 2024 return vs D71. | In the Filing view, the replayed IRS rejection links back to this open item: "The audit flagged this before filing". If it is fixed before transmitting, the rejection never happens. | `#line=F8812.4` |

## Judgment calls (someone has to decide and record the authority)

| # | Question | Effect if changed | Where |
|---|---|---|---|
| F-020 | HVAC replacement (11,000, whole system, permit): repair or improvement? Treas. Reg. 1.263(a)-3. | +3,633 / +896 (engine what-if) | What-ifs view; `#line=SchE.14A` |
| F-021 | Coinhaven lot C6: zero basis and a 17-day holding period, but the client says it was bought in March 2021 for 3,050, backed only by a bank-statement line. | −1,312 / −195 | `#line=F8949.H.C6` (the client question and answer are on this line) |
| F-022 | SEP contribution 18,000 exceeds the 15,214 limit by 2,786: withdraw it, or pay the 6% excise. | none on the return | `#line=Sch1.16` (open review note in the mid-season demo) |
| F-023 | St. Brigid receipt prints "$?,500"; the bank record supports 1,500. | none | `#line=SchA.11` |

## Warnings worth reading

- **Four documents land nowhere, with no reason recorded:**
  - D15 (books transaction detail);
  - D47 (the HVAC invoice);
  - D54 (buyer's closing statement);
  - D73 (paystub).

  Each one hides an error above. The document index on Home shows them in red.
- **The engine claimed documents it did not use.** v2 lists D69 (the IRS transcript) as used, yet no line draws on it: the payments were never checked against it. v3 does the same with D73.
- **Unresolved items carried into 2026:** the prior preparer left Form 3520 for the 2023 foreign inheritance unresolved. The Ridgeline outside basis has never been computed.
- **Compliance gaps:** Form 8867 due diligence is not completed. Forms 1099-NEC were never filed for the two contractors.
- **The questionnaire contradicts the documents:** "no investments sold" against 283 broker sales; "didn't really sell" crypto against 12 dispositions.
- **53 changes from 2024 are over the firm threshold.** Each needs an explanation; they can be explained in bulk, with one reason each.

## What the engine got right (checked, and recorded as passing)

- D10 is a duplicate image of D09 and was counted once.
- D30 was superseded by the corrected D31 from v2 on.
- The S corporation basis was fixed in v3 once the 2023 K-1 arrived.
- The IRA basis came from the 2024 Form 8606, despite the client's "none".
- The ESPP ordinary income was adjusted on the lot.
- 1,342 of 1,343 sum, carry and source-sum checks pass; the one exception is F-009.
- The capital-loss and passive-loss carryovers recompute from the 2024 return.
- The 195/365 California proration matches the residency dates.
