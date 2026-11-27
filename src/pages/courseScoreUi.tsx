// The two "good for competition?" scores, as table cells (Rankings → Stages)
// and as a card on a course page.

import { BALANCE_PCT, MIN_RACES } from "../domain/courseScores";
import type { CourseScore, MachineBalance, SkillScore } from "../domain/courseScores";
import type { Reference } from "../hooks/useReference";
import { Badge, Card, CardHeader } from "../components/ui";

export const SKILL_HELP = `On the same machine, how often the better amiibo finishes ahead (amiibo with ${MIN_RACES}+ races). 50% is a coin flip; higher means the course rewards the better amiibo.`;
export const BALANCE_HELP = `Machines within ${BALANCE_PCT}% of the fastest one here, with the amiibo held equal. Needs at least one amiibo raced on two machines (${MIN_RACES}+ races each).`;

export function SkillCell({ skill }: { skill: SkillScore | null }) {
  if (!skill) return <span className="text-night-400">needs data</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular font-semibold">{Math.round(skill.winShare * 100)}%</span>
      {skill.verdict === "real" ? <Badge tone="ok">Real</Badge> : <Badge tone="neutral">Could be luck</Badge>}
    </span>
  );
}

export function BalanceCell({ balance, ref_ }: { balance: MachineBalance | null; ref_: Reference }) {
  if (!balance) return <span className="text-night-400">needs data</span>;
  const name = (id: string) => ref_.machineById.get(id)?.name ?? "?";
  const close = balance.machines.filter(m => m.gapPct <= BALANCE_PCT);
  return (
    <span>
      <span className="font-semibold tabular">{balance.competitive} of {balance.machines.length}</span>
      <span className="block text-xs text-night-400">{close.map(m => name(m.machine)).join(", ")}</span>
    </span>
  );
}

const pctText = (x: number) => `+${x.toFixed(1)}%`;

/** The course page's "good for competition?" card. */
export function CourseScoreCard({ score, ref_ }: { score: CourseScore; ref_: Reference }) {
  const { skill, balance } = score;
  const name = (id: string) => ref_.machineById.get(id)?.name ?? "?";
  const skillText = !skill
    ? `Not enough data yet: race at least two amiibo on the same machine here, ${MIN_RACES}+ races each.`
    : skill.verdict === "real"
      ? `The better amiibo finished ahead in ${Math.round(skill.winShare * 100)}% of match-ups on the same machine, and that's very likely real. This course rewards the better amiibo.`
      : `The better amiibo finished ahead in ${Math.round(skill.winShare * 100)}% of match-ups on the same machine, but that could still be luck. Either these amiibo are close, or the course is closer to a coin flip.`;
  return (
    <Card>
      <CardHeader title="Good for competition?" subtitle="Two checks: does the better amiibo win, and can more than one machine compete." />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-night-850 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-night-400">Better amiibo wins</h3>
            <SkillCell skill={skill} />
          </div>
          <p className="mt-2 text-sm text-night-300">{skillText}</p>
          {skill && <p className="mt-1 text-xs text-night-400">From {skill.pairs} pair{skill.pairs === 1 ? "" : "s"} of amiibo. Equal amiibo still score a bit above 50% with few races, so trust the Real / Could be luck label more than the number.</p>}
        </div>
        <div className="rounded-xl bg-night-850 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-night-400">Machines competitive</h3>
            {balance ? <span className="font-semibold tabular">{balance.competitive} of {balance.machines.length}</span> : <span className="text-night-400">needs data</span>}
          </div>
          {balance ? (
            <ul className="mt-2 space-y-1 text-sm">
              {balance.machines.map(m => (
                <li key={m.machine} className="flex justify-between gap-3">
                  <span className={m.gapPct <= BALANCE_PCT ? "text-night-100" : "text-night-400"}>{name(m.machine)}</span>
                  <span className="tabular text-night-300">{m.gapPct < 0.05 ? "fastest" : pctText(m.gapPct)} <span className="text-xs text-night-400">({m.races} races)</span></span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-night-300">Not enough data yet: race one amiibo on at least two machines here, {MIN_RACES}+ races each.</p>
          )}
          <p className="mt-2 text-xs text-night-400">A machine within {BALANCE_PCT}% of the fastest counts as competitive.</p>
        </div>
      </div>
    </Card>
  );
}
