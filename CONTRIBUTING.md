# Contributing

Thanks for helping! Bug reports, missing game data (stadiums, field events, rule settings, course details) and ideas for better stats are all welcome as issues. For code changes, open a pull request.

## Setup

You need **Node.js 20.19 or newer** (22 LTS recommended; `.nvmrc` pins it for nvm users).

```bash
npm install
npm run dev
```

Before opening a pull request, make sure this passes:

```bash
npm run typecheck
npm run build:single
```

CI runs the same checks on every push.

## Code layout

```
src/
  domain/
    schema.ts          Data model, stats, leaderboard model, recommendations (no UI)
    cityTrial.ts       City Trial: stadiums, machines, field events, stats, rankings
    coreData.ts        Shared filters and observation building
    insights.ts        Plain-English findings
  db/
    database.ts        IndexedDB layer: stores, indexes, all-or-nothing writes, change events
    seed.ts            First-run roster, stages and formats; upgrades for older data
    validation.ts      Zod schemas for every record
    integrity.ts       Cross-record checks for races (references, mode isolation, rules)
    ctIntegrity.ts     The same for City Trial
    repo.ts, ctRepo.ts Saving records (validated inside the write)
    backup.ts          JSON export / import
  lib/
    fileSave.ts        Auto-save to a file (File System Access API)
    router.tsx         Hash router
  hooks/               useLiveQuery (re-reads on change), useReference
  components/          Layout and shared UI
  pages/               One file per page; pages/city/ for City Trial
electron/main.cjs      Desktop app shell (sandboxed window, no Node access)
scripts/               build-single.mjs packs the build into one HTML file
.github/workflows/     CI and the tag-triggered release
```

## Rules the code enforces

- **Modes never mix.** Every format, stage, race, session and City Trial record belongs to one mode. Import and integrity checks reject anything that crosses over.
- **Formats never mix.** Stats are always within one format, and a format's rules lock once it has results.
- **Times** are whole milliseconds in hundredths (`01:25.72` = 85720), shown the way the game shows them.
- **Database changes** go through the numbered migration list in `db/database.ts`. Data upgrades for existing users go in `ensureSeeded` (`db/seed.ts`). Older backup files must keep importing: new fields are optional or default to empty.
- **Every save is validated** (Zod schema plus integrity checks) inside the same write transaction, so bad data never lands.

## Style

- TypeScript strict mode; no `any` unless unavoidable.
- UI text is plain English, short and specific: say what a number means, not how it's computed.
- In comparisons, prefer `Number(x) < y` to `(x as number) < y`. Some formatters strip the brackets, and `x as number < y` doesn't parse.
