# Okafor-Lindqvist 2025: a workpaper that proves the return

**Live:** https://miraflores-workpaper.fly.dev. Pick a person on the sign-in page; the server enforces that person's role.

| Read | What it is |
|---|---|
| [ONE_PAGER.md](ONE_PAGER.md) | The core idea and the data model |
| [ERRORS_FOUND.md](ERRORS_FOUND.md) | Each error in the packet, how the design surfaced it, where to see it live |
| `findings.json` | Full audit output: every error, judgment call and warning, with refs and tax effects |

## Run it

```sh
npm install
npm run audit            # independent checks on the packet: writes findings.json (and a readable ERRORS.md)
npm run dev              # server on :8787 and Vite on :5173; open http://localhost:5173
node scripts/reconcile.ts                  # every demo number ties to the audit findings
node server/mask.ts                        # masking cases
node scripts/e2e-phase2.ts [url]           # also e2e-phase3, -phase4, -phase5 (Playwright)
scripts/reset.sh <url> clean|midseason     # reset the demo as the firm administrator
```

Node 22.13 or later (for `node:sqlite`). The packet in `data/` is read-only and is never edited.

## How I used AI

I directed the build and made the product and design calls; AI wrote most of the code.
- Claude Code implemented each phase from my specs: the audit script, server, UI and tests. Every phase ended with a commit, screenshots and a test run I reviewed before approving the next.
- **What I owned:** the product and UI decisions and the errors in the return. I decided what the workpaper should be (one proof thread from any number to its source, findings shown where they break the thread instead of in a separate list), and I shaped the interface through rounds of review: the sign-in flow and role picker, the softer palette, cutting crowded screens down to one question each, and the story-led walkthrough. I defined which checks to run against the printed documents and verified every error against the source pages myself, not against a model's summary.
- **Where it helped most:** reconciling the demo numbers exposed a sign error in three of the expense checks. I made the audit and the app share one tax-effect function, with `scripts/reconcile.ts` proving every number on screen ties back.
