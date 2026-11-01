# Design: Trayek Angkot

Scope: the whole web app. The user side (phone) is the night register described first; the operator console (`/konsol`) is the paper register at the end.

Every call is one angkot route. The incident is the paint on the van; the call is the route board whose stops fill in as the operator learns each fact. Built for a deaf user in a panic, one-handed, often in the dark or in smoke.

## Colour

One dark theme on purpose (night scene; silent mode needs a dim screen anyway). Colour appears only where it means something.

| Token | Value | Job |
|---|---|---|
| `--asphalt` | `#15171b` | Page ground |
| `--asphalt-2` | `#1f2228` | Raised surface: cards, strips, sheets |
| `--asphalt-3` | `#2b2f37` | Borders, secondary buttons, inactive progress |
| `--paint-white` | `#f4f1ea` | Text, default button paint |
| `--paint-muted` | `#bdb8ad` | Secondary text (9.6:1 on asphalt) |
| `--sos` | `#e0261b` | SOS bar, call failure, cancel confirm |
| `--signal` | `#f5c518` | Focus ring, LATIHAN badge, warnings, caret, selection |
| `--done` | `#3ccf7a` | Answer spoken, help dispatched |

Route paints, one per incident, each with the ink that passes AA (`lib/incidents.ts`, `paintOf()`):

| Incident | Paint | Ink |
|---|---|---|
| Kebakaran | `#f26b1d` | dark |
| Kecelakaan | `#f5c518` | dark |
| Sakit | `#18a999` | dark |
| Kejahatan | `#2f5bd3` | white |
| KDRT | `#a23ec9` | white |
| Bencana | `#8a8f99` | dark |
| Umum | `#f4f1ea` | dark |

Legacy names (`--color-primary`, `--color-surface`, `--color-text-muted`, …) are kept and mapped onto these, and the shadcn/ui tokens (`--background`, `--primary`, `--ring`, …) map onto the same values. `--color-primary` is white paint, so anything on it uses `text-ink`, never `text-white`.

## Type

Atkinson Hyperlegible Next 400/700/800, root 18px.

- Screen title: 34px / 38px, 800, tracking -0.02em
- Question on a card: 34px / 40px, 800, balanced
- Current route stop: 26px / 32px, 800
- Plate and button labels: 18–21px, 800
- Body: 18px / 28px; secondary 15–17px in `--paint-muted`
- Clock: Atkinson Hyperlegible Mono, tabular numerals

## Shape and touch

- Plates 14px radius, buttons 12px, SOS bar 18px. Solid paint, no gradients, no glass.
- Touch floor 48px; answers 68px; primary actions 64px (`Button size="xl"`); SOS bar 104px.
- Spacing on a 4px base; plates sit in a 2-column grid with 10px gaps. Screens are a single 480px column with 20px side gutters.
- Shadows only to lift a selected plate or the SOS bar: `0 8px 20px rgb(0 0 0 / .5)`.

## Components

- `IncidentTile`: route-paint plate, icon top-left, label bottom-left. Selected = 4px white paint ring + check badge; the others drop to 60% opacity.
- `SosHoldButton`: red bar; while held, white paint fills it left to right, the ring counts 3-2-1, the label reads "Terus tahan…". Space works from page load on keyboard devices.
- `RouteBoard` (signature): vertical stops in the incident paint. Done = filled dot with check and a solid segment; current = larger dot with a ping (off under reduced motion) and a 26px label; todo = dashed hollow dot. `compact` is a one-line strip above a question card.
- `CallHeader`: incident paint band with icon, name, clock, LATIHAN chip and a 3px-outline cancel button.
- `QuestionCard`: question first, answers as white paint buttons with dark ink, "Tidak tahu" as an outline, spoken answer turns `--done`. Instruction cards are signal yellow with dark ink, like a warning sign. The operator transcript is folded under "Lihat kata operator".
- Officer screen: the whole viewport in the incident paint, "Saya tuli. Tolong bantu saya." at 44px.
- shadcn/ui: `components/ui/button.tsx` (variants `default`, `sos`, `outline`, `secondary`, `ghost`, `link`; sizes up to `xl`) and `components/ui/dialog.tsx` (used for cancel confirmation). Icons are the in-house Tabler-style set in `components/icons`; no other icon library.

## Motion

Short ease-out only: 150–200ms on press scale (0.97–0.98), tile dimming and answer colour. The route's current stop pings; new cards slide in 24px. Everything respects `prefers-reduced-motion`.

## Rules

- No colour without a job: outside the home grid, only the active incident paint and status colours appear.
- Nothing is labelled twice: an icon and a word never repeat each other, and one status line per screen.
- Each call stage keeps the same column, scale and baseline so a change reads without re-reading.
- The route only grows downward; stops never jump back.
- No claims of user testing or real 112 integration anywhere in the UI.

## Console: paper register

The dispatch office's copy of the same route, for a lit room and a projector. Tokens are scoped to `.console-shell` in `app/konsol/console.css`.

| Token | Value | Job |
|---|---|---|
| `--paper` | `#f4f1ea` | Page ground |
| `--panel` | `#ffffff` | Panels |
| `--rule` | `#e2ded3` | Dividers, input borders, idle toggles |
| `--ink` | `#15171b` | Text, primary buttons, top bar |
| `--ink-muted` | `#5d5a52` | Secondary text (6.6:1 on paper) |
| `--done-paper` | `#1f9d55` | Latency on target, "Petugas dikirim" |
| `--amber-paper` | `#b7791f` | Latency over target but under the warn line |

Incident paints, SOS red and signal yellow are shared with the phone. Notices use signal yellow with ink; red is reserved for SOS, hang-up and forced failures.

Layout at 1280–1600: asphalt top bar (`ConsoleBar`: name, SIMULASI chip, connection dot, page actions). Call screen in three columns:

- Left 340px: incident paint plate with a 40px mono clock, the shared `RouteBoard` with `tone="light"`, and the action stack (Angkat ink 64px, Petugas dikirim green, Tutup panggilan red, Tolak outline).
- Centre: two latency readouts (last value 44px mono, coloured against the paper's targets A ≤ 3 dtk and B ≤ 1 dtk, median and turn count beneath), the conversation as bubbles (operator ink on the right, system paper on the left), and the operator input where Enter sends and Shift+Enter breaks a line.
- Right 380px: a phone-frame preview of the user's current card in the night register, failure simulation L1–L3 as 56px toggles, codec switch, mic level bar, simulated SMS.

Below 1180px the right column drops under the other two; below 860px everything stacks.

## User side, November 2026 pass (Sill register)

The user screens now follow the Sill panels in `app/globals.css` (light default, dark in Menu or forced by silent mode); the Trayek tokens above remain for the console. Body font is Atkinson Hyperlegible Next, headings Gabarito.

- Home: mode chip (LATIHAN / SIMULASI) and a one-line mode sentence, explicit silent toggle (the 2 s title hold still works), a readiness panel (location, name, contacts, each with a fix link), quick actions (Kartu darurat, Coba latihan, SMS darurat), and the SOS bar in a sticky bottom dock that names the picked incident. No entrance animation on emergency surfaces (`.s-instant`).
- `/kartu`: officer card from the profile (local copy when offline), "papan tulis" quick phrases and own text shown full screen (`ShowCard`, with a 180° flip for the person opposite), contacts with call/SMS.
- `/latihan`: four sample cards (ya_tidak, lokasi, angka, instruksi) on the real `CallHeader`, `RouteBoard` and `QuestionCard`; nothing leaves the phone. Sets `j112.practiced`.
- Menu (`/pengaturan`): grouped rows (`.m-row`), real switches (`.m-switch`), "Teks besar" applies at once (`html.large-text`, zoom 1.15), sign-out.
- New classes: `.m-chip`, `.m-icon-btn`, `.m-row`, `.m-switch`, `.s-dock`, `.m-press`.
- Resilience: profile reads fall back to the IndexedDB copy after 4 s; profile saves write locally first. `/kartu` and `/latihan` work without a session.
- PWA shortcuts: Kebakaran, Sakit, Kecelakaan (`/?kejadian=…` preselects the plate) and Kartu darurat.
