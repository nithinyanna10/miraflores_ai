# Video walkthrough (about 9 minutes)

**Setup.** https://miraflores-workpaper.fly.dev is in the mid-season state; it resets there after every test run. To be sure, sign in as Jo Kimura, choose **Reset demo**, then **Mid-season, as of July 2026**. Use a 1440-wide window. Each step lists who to sign in as, what to click, and what to say. The *decision* lines are the tradeoffs from NOTES.md to say out loud.

---

## 0:00 to 0:40. Sign-in and the idea
**Screen:** the root URL (sign-in). Let the animation play once.

> "This is a workpaper for one household's 2025 return. The animation is the whole product in miniature: find the double-counted number and check it off. The rule I built on: the packet is an immutable base layer, and everything a person does is an append-only event. The workpaper you see is the packet plus those events, replayed."

*Decision:* no passwords, but a real session. Choosing a person sets a signed HttpOnly cookie, and the server takes the role only from it. A forged header is ignored; a test sends one to prove it.

Sign in as **Daniel Ortiz, reviewer**.

## 0:40 to 1:40. Home: the return and what blocks filing
**Screen:** Home.
- The summary shows 2024, 2025 and change. Red marks appear only where an error starts; totals built from it show a quiet "affected by N".
- The first strip says 8 adjustments change federal tax by −19,994: "first-order estimates, change times the v3 rate, as the readme prescribes".
- Blockers come largest tax effect first. The SEP review note leads.
- The right pane is the document index; the 4 documents that land nowhere with no reason are in red.

*Decision:* the home screen is the return itself, not a dashboard of tiles.

## 1:40 to 3:10. The proof thread (the one bold element)
- Open **Capital gains**, then **Corvane Systems (RSU), lot N1** (or press ⌘K and type `N1`).
- The thread runs: rule in plain words, then the four fields that match page 3 (collapsed into one step), then **"D28 Lot N1 cost basis: not on the printed page"**, broken in red. The connector runs to the facsimile, where the lot's entry is underlined in red because "basis (not reported)" was read as 0.
- Show the adjustment: 19,240 struck through, now 140, by Priya, with the reason and Treas. Reg. 1.6045-1(d)(6). The estimated tax is −6,647 federal and −1,222 California. Approved by Helen, because it is over 1,000.

> "The audit's 19 errors aren't a separate list. Each one breaks the thread of the line it affects, at the exact step."

- Open **Schedule CA, wages, California amount**. The break is at the W-2 box 16. The paystub (D73) appears as a dashed step, *evidence the return did not use*: it shows 22,469 of California wages at the move. That is 88,831 overstated.

*Decisions:*
- Documents are facsimiles of the printed text behind a `DocumentSource` interface, so real PDFs drop in later.
- The synthetic position boxes are not drawn over flowing text, because they would point at the wrong words. 3,007 of 3,012 fields are placed exactly; the 5 misses are two checkboxes and three of the errors.

## 3:10 to 4:00. Reconciliation: how the numbers tie
**Screen:** Records, then **Books to tax**.
- QuickBooks 89,834 plus eight reconciling items equals Schedule C line 31 (81,854) exactly, as the engine computed it.
- Below that tie, the three Schedule C adjustments (F-005, F-014, F-015) are shown separately as an estimate.

*Decision:* no propagation of adjustments into dependent totals, because the engine cannot be rerun and a second engine would disagree with the first. Known knock-ons, such as the SEP and SE health insurance limits and QBI, become "needs recompute" judgment items. Open **Sch1.16** to show one.

- Mention `scripts/reconcile.ts`. Every demo number ties to the audit findings: the approval refund of 15,774 = v3 owed 4,220 minus 19,994 of audit fixes.
- Say what it caught: my audit had the wrong sign on three expense-side errors. The audit and the app now share one `effectOf`.

## 4:00 to 4:50. Review: verify, review notes, sign-offs that reopen
- Open **Interest and dividends** in the outline. Its sign-offs show **Reopened**: Priya verified the Ridgeline interest after Daniel signed, so the hash of the signed work changed.
- On any line: **Verify** (press v), choose a method. Then **Write a review note**: it blocks filing, and the blocking count goes up. Only the author or the partner can clear it.

*Decision:* sign-offs store a hash of the lines, values, source refs and evidence events. Firm rules live in one policy file, enforced by the server: no signing off on what you prepared; adjustments over 1,000 need the partner.

## 4:50 to 5:30. Roles and masking
- **Change role** to **Marcus Bell** (a preparer without clearance) and open D08: SSNs are masked to the last 4 digits, and there is no unmask control.
- Change role to **Jo Kimura**, then **Firm**: the view log shows Priya's unmasked view and Marcus's refused attempt.

*Decision:* masking happens in everything the server sends. Unmasking is a separate, logged request. Only the firm administrator and the partner receive the view log.

## 5:30 to 6:10. The client
- Change role to **Ngozi Okafor**. She sees two answered questions (St. Brigid, and the crypto lot, which Erik answered), her documents, and the approval section. Nothing internal.
- Say: "The server decides what a client receives. A test shows that even a forged staff header gets a 403."

## 6:10 to 7:40. Filing
- Sign in as **Helen Strand**, then **Filing**.
  - **Ready to file:** the firm's 12 required steps, computed from the work, never ticked.
  - On Home, the whole return is signed in order: **Priya** (preparer), then **Daniel** (reviewer), then **Helen** (partner). Then, as Helen, **Send to the client for approval** in Filing, and open "How these amounts tie to the audit".
- As **Ngozi**, then **Erik**: tick the box, enter a 5-digit PIN, **Sign Forms 8879**. PINs are masked like SSNs.
- As **Helen**: transmitting with unmet steps requires a reason for each one. The log shows a red block, "Transmitted with N required steps not done", with each reason in serif.
- **Record the IRS response:** the replay brings the real July 13 rejection for Theo's SSN. It links back to the open item the audit raised in March.

> "Fix it before transmitting and this rejection never happens. Agency responses replay from the packet, and a rejection whose cause is already fixed is skipped."

- Resolve it as Daniel on `F8812.4`. All three whole-return sign-offs reopen, because the fix is new evidence; re-sign them. Retransmit; IRS and FTB accept. **Frozen**, with the event cursor and the return hash.
- Try to change anything: refused, "Open an amendment". Open one: the change is tagged to it, and the filed values stay as filed.

## 7:40 to 8:30. After filing
- **Build the response packet** for the 2028 Letter 566. It is one HTML file with both examined items: the 1098-C sale price that caps the car donation, and the 1099-K / 1099-NEC reconciliation. It carries the evidence, the adjustments with authority, and the frozen hash, with no raw SSNs.
- **Carry forward**: the 2026 opening file (AMT credit 3,871, SEP excess, assets, Form 3520 still open).
- **Season**, then **Replay** as of 2026-03-15: the whole app shows that day, read-only. The Wages reviewer sign-off isn't there yet.

*Decision:* replay is the same derivation over fewer events. Ceiling: return values stay v3; version switching by date is not built.

## 8:30 to 9:15. Records, the firm, and how it's checked
- Records: **Sales detail** (D31 is 250 short; that's the unextracted page 32), **Basis by year** (the 2023 K-1 closes the gap), **Prior preparer vs us**.
- **Firm**: budget vs time (investments over budget), assignments, deadlines with days left (the extended due date is October 15, 2026).
- Close:

> "Four Playwright suites, 97 checks, run against the live URL and reset the demo afterwards. Plus the audit, the reconciliation and the masking checks. The stack is boring on purpose: React, a small Hono server, `node:sqlite`, server-sent events, and one Fly machine with a volume."
