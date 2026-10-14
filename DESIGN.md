# Design direction for the workpaper UI

Read this before writing any UI. It is binding. If something here fights a requirement, ask me.

## Who it's for and what it must feel like
A 20-year CPA who has to trust every number, and a new hire on day one. It should feel like a precise instrument: calm, dense where density helps, and never decorative. Trust comes from showing evidence, not from styling.

## The one memorable thing: the proof thread
Spend the design boldness here and keep everything else quiet. When you select any number, its lineage draws as a visible thread: return line, then the rule (in plain words from engine_reference.rules), then each input line, then the exact extracted field, ending on a highlighted region of the simulated document. Each hop shows its verification state. If the extracted value disagrees with the printed text, the thread breaks visibly at that hop in Copy A red. That break is how the audit findings show up without a separate error list.

## Layout
```
+--------------------------------------------------------------------------------+
| Okafor-Lindqvist 2025   v3   [role: Reviewer v]   7 blocking   search (cmd-K)  |
+-------------------+--------------------------------+---------------------------+
| Return outline    | Selected number                | Source document           |
| grouped by area   | 212,400  Wages (W-2 box 1)     | facsimile from            |
| (Wages, Invest,   | built from:                    | printed_content, field    |
| Business, Rental, |   ev-0016  Halvorsen  190,…  ● | highlighted via position  |
| K-1s, State ...)  |   ev-0035  Corvane     22,…  ● |                           |
| status pip each   | rule, note, history, comments  | "also used in" list       |
+-------------------+--------------------------------+---------------------------+
```
Left-aligned everywhere. Numbers right-aligned in tabular figures. The right pane is the document, never a modal. Large sets (Form 8949 lots, 260 on D74) collapse to rollups by broker and term, with only exceptions expanded.

## Tokens
Color (soft, cool, paper-on-a-desk; only source documents are true white so they read as paper; red is the "dropout red" of Copy A forms):
- Desk   #E9EDF0  app background, header, outline rail
- Panel  #F3F5F7  working panes (summary, proof thread)
- Paper  #FFFFFF  ONLY the document facsimiles and the login card stack
- Ink    #18202E  text and numbers
- Muted  #5B6573  secondary text
- Rule   #D3D9E0  dividers (1px, used sparingly)
- Copy A red #C8102E  errors, broken threads, blockers only
- Verified teal #0E6B5C  verified and signed
- Pending amber #A86A00  unverified, open questions
Soft shadow only under document paper (0 1px 2px rgba(24,32,46,.06), 0 8px 24px rgba(24,32,46,.06)). No other shadows. Never use beige or cream.
Every state also has a shape or icon, never color alone.

Type (Google Fonts):
- Public Sans (the US government's web typeface) for all UI. Numbers use `font-variant-numeric: tabular-nums`. Scale: 13 / 15 / 18 / 24 / 32, weights 400 and 600 only.
- Source Serif 4 for the document facsimiles and for written memos, judgment calls and review notes, so human reasoning reads differently from machine output.
- No monospace except actual ref ids like ev-0016, and only when shown.

## Status vocabulary (use these exact words everywhere)
Unverified, Verified, Adjusted, Question open, Blocked, Signed, Reopened, Frozen.

## Interaction
cmd-K jumps to any line, document, ref or person. j/k moves through lines, enter opens trace, v verifies, n adds a note. Every rule id shows a plain-English tooltip, so a new hire can learn by hovering. "Since I last looked" highlights changed values with a quiet underline and lists them in one drawer. The only animation is the thread drawing on select (under 300ms, off with prefers-reduced-motion).

## Do not
Gradients, glassmorphism, emoji, identical rounded cards for everything, drop shadows on every box, ALL-CAPS eyebrow labels, "A · B · C" meta strings, arrows appended to button text, purple, Inter, a dark mode as the default, fade-in on every section, or a dashboard of big-number tiles as the home screen. The home screen is the return itself with what's blocking filing.

## Copy
Plain, specific, active. Buttons say what happens: "Verify against document", "Send question to client", "Sign off on Wages". Errors name the problem and the fix. Empty states tell you what to do next.

## Quality bar and process
Before building each screen, write a 5-line plan in NOTES.md. After building, run the app, take Playwright screenshots (Chromium is installed), look at them, and fix anything that looks generic, cramped or misaligned before telling me it's done. Keyboard focus visible, works at 1280px and degrades sensibly to tablet.

## Sign-in screen (the first page at the root URL)
The root URL always opens sign-in. No workpaper data loads until someone signs in. Every app route redirects to sign-in when there is no session, and returns to the requested page after sign-in (deep links keep working). The session is a server-side cookie holding the person id; the server takes the role from it, never from the client.

Background for this page only: soft off-white #F6F6F3. Three columns, vertically centered, generous whitespace:

Left (small, about 280px): a friendly, funny SVG animation, no numbers or tables. A little magnifying glass with two dot eyes hops onto a receipt. Two identical coins pop out of the receipt ("counted twice"), the glass does a double take (eyes widen, small tilt), one coin poofs into a puff, a round teal "Checked" stamp thumps onto the receipt, and the glass does a happy wiggle. About 7 seconds, loop with a pause, soft easing. Palette limited to ink, teal and one muted lilac. prefers-reduced-motion shows the final frame. One short line below it, muted: "We find the doubles so you don't have to."

Center: white card with soft shadow. Header: initials avatar, name, role of the selected person. Email field prefilled with the person's firm email (make one up from their name at the firm's domain), Password field with placeholder "Not checked in this prototype", primary button "Sign in as <first name>". Small note under it: "No real authentication in this prototype. Pick a person on the right."
Above the card, centered: firm name, then "Sign in to your workspace" in Source Serif 4 italic.

Right (about 420px): "Choose who's signing in" then the people from firm.staff and firm.client_users only (never invented names), grouped "Firm" and "Client". Each row: initials avatar, name, role and credential, one muted line of what they can do here. Selected row has an ink outline. Arrow keys move the selection, Enter signs in.

Inside the app the header shows the person and a "Change role" link that signs out and returns to this page.
