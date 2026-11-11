# CLAUDE.md

Briefing for Claude working in this repo. Read it before changing anything.

## What this is

Air Riders Stat Tracker: a local-first app for logging Kirby Air Riders (Switch 2) **amiibo** results and finding the best characters, machines and trained amiibo, with honest statistics. Three modes, kept completely separate:

- **Air Ride** and **Top Ride**: races (times and/or places).
- **City Trial**: matches (places, stat totals, stadium scores), plus Stadium-menu runs.

Two jobs drive every decision:
1. **Optimizing a solo world-record speedrun** (one amiibo, every course once, times summed).
2. **A knowledge library** of how characters, machines and individual amiibo behave.

The owner is a player, not a programmer. They use the app as a **single HTML file** they download and double-click (`npm run build:single` → `dist-single/Air Riders Tracker.html`). After any change they'll want, **hand them that file**. Explain things in plain English: no jargon, no p-values, short.

## Design rules (don't break these)

- **Modes never mix. Formats (rulesets) never mix.** Every stat is computed within one format. A format's rules lock once it has results; variations are new formats.
- **Change one thing at a time.** Rankings compare by *adjusted pace*: an additive log-time model (course + rider + machine + course×machine), so nothing gets credit for an easy schedule.
- **Be honest about uncertainty.** Comparisons show likely ranges and rank brackets (bootstrap, a few hundred reshuffles) and a confidence badge. Never crown a winner the data can't support.
- **"Counts in records"** (`includeInStats`) on every race/match. Excluded results stay visible in their session and lists but leave rankings, records and Sum of Best.
- **Game version** is stamped on every result so balance patches don't mix silently.
- **Baseline (Balanced) amiibo** (`isBaseline`) are a control group. They're out of rankings by default; the "Vs baseline" comparison only matches the same course and machine.
- **City Trial** ranks by **Finish score**: the share of the other riders in the stadium an amiibo finished ahead of, with ties counting half. Two record books stay apart: *Trial* (after a City Trial) and *Stadium* (from the Stadium menu, split by rider count).
- Deliberately **not** built (owner decided): personality rankings (too little data), course-length charts, target-time features, Ctrl+Enter shortcuts.

## Commands

Node **20.19+** (22 LTS fine).

```bash
npm install
npm run dev            # dev server
npm run typecheck      # must pass
npm run build:single   # web build + the single-file HTML the owner uses
npm run app            # desktop app (Electron)
npm run dist           # installers for this OS into release/
```

Before calling anything done: `npm run typecheck` and `npm run build:single` pass, **and** you've opened the built HTML and clicked through the pages you touched (no console errors). CI runs typecheck and build on every push.

## Code map

- `src/domain/schema.ts`: data model and all race statistics (no UI). `src/domain/cityTrial.ts`: City Trial reference lists (50 stadiums, 28 machines, field events and changes), stats, rankings and records.
- `src/db/`: IndexedDB (`database.ts`, numbered migrations), seeding and data upgrades (`seed.ts` → `ensureSeeded`), Zod schemas (`validation.ts`), cross-record checks (`integrity.ts`, `ctIntegrity.ts`), saving (`repo.ts`, `ctRepo.ts`), backup import/export (`backup.ts`).
- `src/pages/`: one file per page; `src/pages/city/` for City Trial. `src/components/`: Layout, UI kit, forms.
- `electron/main.cjs`: a sandboxed window loading `dist-single/index.html`. No Node access in the page.
- `.github/workflows/`: `ci.yml` (push) and `release.yml` (tags, `release` branch = publish, `release-test` = dry run).

## Data safety

- **Old backups must keep importing.** New fields are optional, or `.default([])` in Zod. Keep `SCHEMA_VERSION` at 1 unless a breaking change is unavoidable.
- **Store changes** go in the `MIGRATIONS` list in `db/database.ts` (append only). **Data upgrades** for existing users go in `ensureSeeded`, and must be idempotent.
- Every save validates (Zod + integrity) inside the same write transaction.
- Times are integer milliseconds in hundredths (`01:25.72` = 85720).

## Conventions

- TypeScript strict; React 19 function components; Tailwind 4 with the theme tokens in `src/index.css`. Valid `night-*` shades: 100, 300, 400, 600, 700, 800, 850, 900, 950. There's **no** `night-200` or `night-500`, and using them renders invisible.
- In comparisons write `Number(x) < y`, never `(x as number) < y`. Formatters strip the brackets and `x as number < y` doesn't parse.
- UI copy is plain English, short, and says what a number *means*. Use the game's own names (stadiums, machines, rules).
- Commit messages: short summary line, then what and why.

## Releasing

Bump `version` in `package.json`, add a `CHANGELOG.md` section (`## [x.y.z] - YYYY-MM-DD`), then push a `vX.Y.Z` tag, **or** push to the `release` branch (the workflow creates the tag from `package.json`). Apps aren't code-signed; the release notes explain the warnings.
