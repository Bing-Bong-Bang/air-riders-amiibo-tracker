# Changelog

All notable changes are listed here. Versions follow [semantic versioning](https://semver.org).

## [Unreleased]

### Changed
- **Sword Kirby is no longer a separate character.** The released figure races exactly like a Kirby amiibo (it just adds a hat), so it's now a *Sword Kirby figure* checkbox on Kirby amiibo. Anything already logged as Sword Kirby moves to pink Kirby with the box ticked; older backups are converted the same way when restored.

## [0.1.0] - 2026-11-08

The first public release.

### Air Ride and Top Ride
- Fast race logging, races list with notes search, sessions with their own stats, and side-by-side comparisons with plain-English conclusions.
- Rankings for characters, machines, combos, amiibo and courses by adjusted pace, with likely ranges, rank brackets and confidence; coverage map and head to head.
- Best picks per course, full-run planner and *test next* list.
- Full runs with PBs and Sum of Best; course, machine and amiibo stat pages; notes and *Copy summary*.
- Formats with locked rules, including the game's default rules and the solo world-record categories for both modes. Top Ride supports up to 8 riders.
- Baseline (Balanced) amiibo comparisons and game-version stamping.

### City Trial
- Match logging with places (ties supported), stat totals or full stat breakdowns, end machine, scanned-in machine, KOs, stadium scores, field events and field changes.
- *Fill places from scores* using each stadium's own winning rule.
- Rankings by Finish score with win, top-3 and bottom-half rates, and "Do stats win matches?" findings.
- Separate Trial and Stadium-menu record books; Stadium-menu runs split by rider count.
- Tournament sets with points, stadium-type bans and tiebreakers.

### Everything else
- Machine proficiency per amiibo.
- Auto-save to a file, checked JSON backup and restore.
- Desktop apps for Windows, macOS and Linux, plus a single-file HTML version.
