# User guide

How to use every part of Air Riders Stat Tracker. For what the app is and how to install it, see the [README](../README.md).

- [Getting started](#getting-started)
- [Your data](#your-data)
- [Air Ride and Top Ride](#air-ride-and-top-ride)
- [City Trial](#city-trial)
- [Amiibo, baselines and proficiency](#amiibo-baselines-and-proficiency)
- [The numbers, explained](#the-numbers-explained)

## Getting started

1. **Pick a mode** with the switch at the top right: *Air Ride*, *Top Ride* or *City Trial*. Each mode has its own pages and its own data. *Amiibo* and *Data* are shared by all three.
2. **Add your amiibo** on the **Amiibo** page: pick the rider (for Kirby, the color, which sets its special), then enter its in-game name and personality. For the Sword Kirby figure, pick its Kirby color and tick *Sword Kirby figure*: it races exactly like a Kirby amiibo.
3. **Set up a save file** on the **Data** page (recommended): *Choose save file…*, then pick somewhere like `Documents/air-riders-data.json`. Every change is written there automatically.
4. **Log races** (Air Ride / Top Ride) or **matches** (City Trial). The overview pages fill in as data arrives, and say what unlocks each section.

## Your data

- **Save file (recommended):** on the **Data** page, *Choose save file…*. Every change is written to it about a second later; the header shows **Saved** when it's working. After restarting the browser, click **Resume saving** in the header once. Works in Chrome and Edge, and in the desktop app.
- **If the app's data is ever lost:** *Open a save file…* restores everything from that file and carries on saving to it.
- **Backups:** *Download backup* makes a one-off JSON file whenever you like. *Restore from a backup* fully checks a file before changing anything, and the replace is all-or-nothing.
- **Moving between the browser and the desktop app:** they store data separately. Download a backup in one and restore it in the other (or point both at the same save file).
- **Check my data** looks for broken links and results filed under the wrong mode.
- **Erase everything** downloads a backup first, then restores the starting roster and stages.
- **Game version:** every result is stamped with the game version it was played on. When the game updates, change it on the Data page; Rankings and Best picks can then show one version or all.

## Air Ride and Top Ride

### Formats

A **format** is a ruleset. Results only ever compare within one format, and a format's rules lock once it has races (use *Duplicate* for variations).

Each mode starts with:

- **Default rules:** the game's defaults.
  - **Air Ride:** Normal tempo, 2–6 riders, Laps, default laps, retirement off, assists off, enemies on.
  - **Top Ride:** Normal tempo, 2–8 riders, default laps (4, except Mountain and Nova at 2), items Normal, item restrictions Normal, features All, anti-reverse On, boost assist Weak.
- **Solo amiibo — All Courses / All Stages (IGT):** the solo world-record category. One amiibo plus one required level 1 Kirby (pink) CPU on Warp Star at maximum handicap; every course once, in any order; times summed; no glitches; video required.
  - **Air Ride:** boost and special assist off, enemies on.
  - **Top Ride:** items Off, features Limited, anti-reverse On, boost assist Off.

### Logging races

**Log race:** pick format, course, amiibo and machine, type the time (`01:25.72`, `1:25.72` or `012572`) and press Enter. The setup stays, so the next race is just another time and Enter.

- **Places:** in multi-racer formats, set *Riders in this race* (CPUs included) and each racer's place.
- **Retired:** tick it for a racer that dropped out. It only appears in formats where retiring is possible.
- **Counts in records** is on by default. Untick it for a race you want to keep but not trust; it stays in its session and in Races, but rankings, records and Sum of Best ignore it.

**Races** lists everything: filter, edit, delete, search notes, and see each race's session and game version.

### Sessions

A **session** is a named batch of races in one format: a test, a practice night, tournament prep. *Start a session*, then log races on **Log race**. The session stays selected until you pick another or finish it.

The session page shows that batch's own stats, grouped by amiibo + machine and broken down by course:

- **How sure:** the smallest gap this many races can reliably spot, and how many races a 0.50 s gap needs.
- **Drift:** first half vs second half of the series (6+ races).
- **Vs records:** this session against your other races with the same amiibo, course and machine.
- **Course best:** the best in your records there, and whether this session beat it.

**Compare** (on a session page, or *Sessions → Compare sessions*) lines up any number of amiibo + machine pairs from any sessions in one format, with a table per course and plain conclusions:

- who's fastest, and whether each gap is real or could be luck;
- who'd win a single race (odds for each);
- who's most consistent, and the best single race.

### Rankings

Characters, machines, combos, your amiibo and courses, each ranked by **adjusted pace** within one format, with the course and partner held equal (see [the numbers](#the-numbers-explained)).

- **Kirby** is one row; click it to open its four colors. A Sword Kirby figure counts as the Kirby color it's set to.
- **Columns:** Pace (% and seconds per course), a bar from the average line (green right = faster, red left = slower), Races, Spread and Confidence.
- **Click any column heading** to sort; click again to flip.
- **Details** adds the full-run time, Simple pace (plain average), what's been tried, disasters, and strongest/weakest course. With one course selected, it shows each row's best and worst time there.
- **Filters:** course, legendaries, latest amiibo versions, game version, and amiibo scope (trained / baseline / both).
- **Extra views:**
  - **Stages:** every course's best, worst, noise and best combo.
  - **Coverage:** race counts per course × character or machine.
  - **Head to head:** wins–losses when two of your racers shared a race. Multi-racer formats only.

Click a **course** or **machine** for its own page.

### Best picks, runs and records

- **Best picks** (record format):
  - the best combo on every course (settled / likely / needs data);
  - a run planner for full-run formats;
  - a *test next* list of races that could change a pick.
- **Runs:** *Start a run* of a full-run format with one amiibo, then log each course. It tracks remaining courses, running IGT, your PB course by course and Sum of Best. A glitch forfeits the run and drops its times from stats.
- **Sum of Best:** the fastest possible run from your best counted time on each course. It's shown two ways: mixing amiibo (for fun), and each amiibo's own legal Sum of Best.
- **Overview:**
  - current leaders;
  - course records, Sum of Best and PB;
  - *What we've learned* (plain-English findings);
  - recent sessions, and how complete the data is;
  - the world-record rules, folded away.
- **Notes** on every course, character and machine page. **Copy summary** makes a short plain-text summary for Discord.

## City Trial

City Trial isn't a race, so it's measured differently, and nothing in it mixes with the race modes.

### Logging a match

**Log match:** pick the stadium, tap the amiibo that played, and set their places. Ties share a place: 1st, 1st, 3rd. That's all a match needs. Everything else is optional:

- **More (per amiibo):** stat total, or all 9 stats (Boost, Top Speed, Offense, Defense, Turn, Glide, Charge, Weight, HP), which add up for you; machine at the end; machine figure it was scanned in with; KOs; score in the stadium's units (time, points/damage, or yards); Gigantes driver.
- **Fill places from scores** works out places from the scores using the stadium's own rule (fastest time, most points, longest distance, most damage for bosses). It only fills places when every rider in that stadium is logged with a score.
- **Riders in the match** counts everyone, including riders you don't log. Matches with more than 8 riders can log the **second stadium** too.
- **Field events** (with places for Dustup Derby and Short Race) and **field changes** (cosmetic ones marked with a dot; at most 2 floating islands).
- **Counts in records**, **Tiebreaker** (in formats with sets) and notes.

The session you're logging into stays selected, shown in the gold bar at the top, and the side panel lists its matches (and set standings).

### Overview and Rankings

- **Overview:** per amiibo matches, wins, average place, **Finish score**, stat totals, points, KOs and usual machine, plus views *By stadium type* and *Head to head*.
- **Rankings:** amiibo ranked by Finish score, each with:
  - a likely range and a rank bracket;
  - Win, Top 3 and Bottom half rates (the bad-match rate);
  - average stats and a confidence badge.

  *Placed* shows "1 of 2" when an amiibo has matches logged without a place.
- **Do stats win matches?:** how often the top stat collector won, made top 3, or finished in the bottom half, upsets, and each amiibo's record as top collector. Needs stat totals for two or more amiibo in the same match.
- **Best and worst stadium types** for each amiibo.

### Sessions and tournament sets

A City Trial session is a night of testing ("all six amiibo, no CPUs, again and again") or one tournament set. In a format with **sets**, the session page:

- adds up points by place;
- greys out stadium types already played in the set;
- flags a tie at the advance line;
- uses a match ticked *Tiebreaker* to settle the tie, without adding points.

### Records

Two record books, kept apart like the game's *Personal best* screen:

- **Trial:** stadium results at the end of a City Trial match, after collecting stats.
- **Stadium:** stadiums played straight from the Stadium menu, kept separately for each number of riders, so a solo boss time never competes with a 4-rider one. Log these with *Log a Stadium-menu run*.

### Formats

Tempo, minutes, stadium vote, legendaries, field events, field change, active stadiums (ban single stadiums or whole types), points by place, and sets (rounds, how many advance, type bans, tiebreaker length). Rules lock once a format has matches. Two formats come built in:

- **Default rules:** the game's defaults.
- **4-player FFA sets:** points 8/6/4/2, top 2 advance, a stadium type is banned once played, 3-minute tiebreaker, Kirby Melee banned.

## Amiibo, baselines and proficiency

- **Versions:** if a retrain changes an amiibo's personality, *Edit* it and leave "start a new version" ticked, so old and new results stay separate.
- **Baseline (Balanced) amiibo:** tick *Baseline amiibo* for a figure left on the default AI. On a trained amiibo's stat page, *Vs baseline* compares it with the baseline of the same character, only where both raced the same course on the same machine. Baselines are left out of rankings unless you include them.
- **Machine proficiency:** each amiibo card says "Maxed on all machines" unless you change it. *Change* opens 0–100 for each of the 7 machine figures an amiibo can be scanned with.
- **Amiibo stat page:** click an amiibo's name for its races, records held, pace, consistency, Sum of Best, a course-by-course table, recent form and what it hasn't raced yet.

## The numbers, explained

| Number | What it is |
|---|---|
| **Pace** | % faster (−) or slower (+) than typical, with the course and partner taken out |
| **Median** | the middle result: what a normal race looks like |
| **Average (±)** | the mean, plus how far the true mean could be off |
| **Spread** | how far a typical race lands from the average (consistency) |
| **Disasters** | races more than 5% slower than the median |
| **Finish score** | City Trial: share of the other riders in the stadium an amiibo finished ahead of; ties count half |
| **Rank (1–3)** | after re-running the ranking on a few hundred reshuffled versions of your data, it landed between 1st and 3rd in most of them |
| **Confidence** | *Solid*: the rank held almost every time · *Could move*: it swaps with neighbours · *Few races/matches*: treat as a hint |

**Why median and average both?** The median ignores one terrible race; the average doesn't. A great median with a poor average means "quick when clean, but crashes a lot".

**How many races are enough?** For a setup whose spread is about ±1 s, two setups can be reliably told apart once the gap is about 1.8 s with 5 races each, 1.3 s with 10, 0.9 s with 20, and 0.6 s with 40. The app works this out for you and shows how many more races a comparison needs.
