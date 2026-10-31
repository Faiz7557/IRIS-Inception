# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: deaf adults with severe hearing loss (segment A, BISINDO as first language, about 1.02 million people in Indonesia per BPS LF SP2020) who are having or witnessing an emergency. They use their own phone, in panic, often one-handed, possibly in the dark or in smoke. They can read Indonesian, but long or spoken-style sentences are hard for them, most of all under stress.

Secondary: hard-of-hearing users who can speak (segment B), people who hear but cannot speak (segment C), and people who can hear and speak but are not safe to make a sound, such as domestic-violence victims (segment D).

Other audiences: the 112 operator, who receives an ordinary phone call and never installs anything; the user's emergency contacts, who get location and incident type when a call fails; local governments (Diskominfo) running 112, who are the payer.

## Product Purpose

Jembatan 112 is a two-way relay for the first emergency call. The user picks an incident by pictogram and holds SOS for 3 seconds; the system calls the operator and reads an opener aloud with TTS; every operator utterance is transcribed and turned into one short question with answer buttons; each tap is read back to the operator. Scope ends when the operator confirms help is dispatched.

Success: the operator knows the incident type and location within 60 seconds of SOS; operator questions get answered by tap without repeats; the user completes the call unaided.

## Positioning

The transcript becomes a choice, not text to read. AI is limited to language work (STT, question simplifier, TTS) with a deterministic fallback at every point, and answers always come from the user's tap. The relay enters as an ordinary phone call, so 112 call centres change nothing.

## Operating Context

Hackathon INCEPTION 2026 entry by Tim IRIS (Universitas Airlangga). The MVP never calls real 112: calls go to a browser-based simulated operator console. Practice mode ("LATIHAN") is the default for new users. Degradation levels L0 to L5 cover LLM, STT, TTS, call and internet failure; L5 offers a prefilled SMS.

## Capabilities and Constraints

- Next.js 15 App Router, React 19, Tailwind 4 PWA (`apps/web`); FastAPI backend (`apps/api`); Supabase auth (phone OTP) and Postgres.
- Six incident types plus a general one: kebakaran, kecelakaan, sakit, kejahatan, KDRT, bencana, umum.
- Six card kinds: ya_tidak, angka, lokasi, pilihan, terbuka, instruksi.
- WebSocket call protocol, nine-state call orchestrator and console audio are fixed; UI work must not change them.
- All user-facing copy is Indonesian.

## Brand Commitments

- Name: "Jembatan 112". No logo exists.
- Font: Atkinson Hyperlegible (declared in README, SIL OFL).
- Icons: Tabler Icons (MIT).

## Evidence on Hand

None yet. Pictograms, flows and the persona are team designs that have not been validated with the deaf community or a sign-language interpreter. The UI must not claim user testing, endorsements, adoption numbers or real 112 integration.

## Product Principles

1. Nothing to type in a panic: pick, hold, tap.
2. One question at a time, in five words or fewer, with the answer as a button.
3. The user always knows what is happening and what the operator already knows.
4. Every failure still leaves a way to get help.
5. The user's words come only from the user's taps; the system never answers for them.

## Accessibility & Inclusion

WCAG 2.2 AA. No information conveyed by sound alone; vibration (Android) and screen flash as signals. Large touch targets for one-handed use. High contrast. Reduced-motion respected.
