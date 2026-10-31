---
version: 1
slug: "apps-web-app-pengguna"
primary_target: "apps/web/app/(pengguna)"
related_targets: ["apps/web/app/masuk","apps/web/app/mulai"]
---

Scope: user side of the PWA (apps/web/app/(pengguna), masuk, mulai, offline). Mode: Operate. Platform: mobile web, one-handed, often at night or in smoke.

Audience and task: deaf user (BISINDO) in an emergency picks an incident, holds SOS, answers operator questions by tap, sees help is coming. Constraints: WCAG 2.2 AA, Atkinson Hyperlegible, Tabler-style icons, no claims of user testing, WebSocket and state machine untouched.

## Direction contract

THESIS: every call is one angkot route ("trayek"). The incident is the paint on the van, the call is the route board with stops ticked as the operator learns each fact. Refuses the white SOS-circle app with a list of rows.

OWN-WORLD: night asphalt ground (#15171b, raised #1f2228) with warm white paint text (#f4f1ea). Six solid route paints, one per incident (orange, yellow, teal, blue, violet, grey) with dark or white ink chosen for AA. SOS red #e0261b. Yellow #f5c518 for focus and LATIHAN. Plates have square-ish 14px corners and thick paint, no gradients, no glass. Plates and spacing snap to a 24px cell rhythm; the grid itself is not drawn (detector: decorative grid backgrounds read as generated UI). Atkinson Hyperlegible Next 800 for plate labels.

STORY: the user sees six painted plates, picks one, holds the red bar; then watches the route fill in (Menelepon, Tersambung, Kejadian & alamat dibacakan, Petugas berangkat) and answers each question on a single painted card.

FIRST VIEWPORT: home at 375x812. Top row: LATIHAN badge left, Atur right. "Darurat apa?" 34px/800. 2x3 grid of 120px paint plates (icon 36px top-left, label 21px/800 bottom-left), selected plate outlined in white paint with a check. Location strip below. SOS bar 104px tall, full width, pinned near the bottom under the thumb, progress ring left, "TAHAN 3 DETIK" 28px/800.

Signature move: the call route board, a vertical line of stops in the incident paint; the current stop is a filled paint marker that advances one stop at a time; done stops show a check; future stops are dashed. Raises kept: no colour without meaning (ikeda); fixed scale and baseline across call stages (folio); time flows one way, the route only grows downward (laban); plates snap to whole grid cells (crouwel); nothing labelled twice (saville).

FORM: own grounded list position 7 (angkot route paint), seed key fff9d4dc; user switched from the pick to the assigned direction.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
