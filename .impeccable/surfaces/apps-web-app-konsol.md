---
version: 1
slug: "apps-web-app-konsol"
primary_target: "apps/web/app/konsol"
related_targets: []
---

Scope: simulated 112 operator console (apps/web/app/konsol). Mode: Operate. Desktop 1280–1600 wide, also shown on a projector to judges.

Audience and task: the person playing the 112 operator during the demo picks up, types or speaks questions, dispatches help; judges watch latency, the user's card and failure simulation. Constraints: WebSocket, audio worklet and protocol untouched; no new server data (no GPS map: the console never receives coordinates).

## Direction contract

THESIS: the console is the dispatch office's copy of the same angkot route: the call's paint band, its route board and the passenger's screen side by side, on dispatch-board paper. Refuses the grey admin dashboard with a sidebar and stat cards.

OWN-WORLD: extension of Trayek Angkot in a light register for a lit room and a projector. Paper ground #f4f1ea, white panels, asphalt #15171b top bar and ink, the same six incident paints with their AA inks, SOS red #e0261b, signal yellow #f5c518 for focus and warnings, done green #1f9d55 (darkened for paper). Atkinson Hyperlegible Next 800 for numbers and labels, mono tabular for clocks and milliseconds.

STORY: the operator sees an incoming call as a painted plate, picks up, watches the route advance, reads the conversation, sees exactly the card the deaf user sees, and the judge reads latency A/B against the paper's targets in numbers big enough for the back row.

FIRST VIEWPORT: 1440x900 call screen. Asphalt top bar (product name, SIMULASI chip, connection, Keluar). Left column 340px: incident paint band with icon, label, mode and a 40px clock; route board; action stack (Angkat 64px white-on-asphalt, Petugas dikirim green, Tutup panggilan red, Tolak outline). Centre: latency strip of two big readouts (A and B, last value 44px, median and target beneath, colour by target), then the conversation log and an operator input where Enter sends. Right column 380px: a phone-frame preview of the user's current card in the dark user world, then failure simulation L1–L3 as large toggles, codec, mic level, simulated SMS.

Signature move: the shared route board, the same component as the phone, so both screens advance together during the demo.

FORM: extension of the established Trayek Angkot world to a second surface; no new roll.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
