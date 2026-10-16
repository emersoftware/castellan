import { currentKind, type RecordedKind, type Ruleset } from "@aoa/shared";

/** Compare historical samples under current names without rewriting their scripts. */
export const currentUpgrade = (id: string): string => id.replace(/^[a-z]+(?=_)/, currentKind);

/** Keep the identifiers a recorded VM knows while applying candidate stats. */
export function candidateForRecordedNames(candidate: Ruleset, recorded: Ruleset): Pick<Ruleset, "kinds" | "upgrades"> {
  const kindNames = new Map<string, RecordedKind>((Object.keys(recorded.kinds) as RecordedKind[]).map(kind => [currentKind(kind), kind]));
  const upgradeNames = new Map(Object.keys(recorded.upgrades).map(id => [currentUpgrade(id), id]));
  const kind = <K extends string>(id: K) => kindNames.get(currentKind(id)) ?? id;
  const upgrade = (id: string) => upgradeNames.get(currentUpgrade(id)) ?? id;
  return {
    kinds: { ...recorded.kinds, ...Object.fromEntries(Object.entries(candidate.kinds).map(([id, spec]) => [kind(id), {
      ...spec,
      ...(spec.builds ? { builds: spec.builds.map(kind) } : {}),
      ...(spec.trains ? { trains: spec.trains.map(kind) } : {}),
      ...(spec.requires ? { requires: upgrade(spec.requires) } : {}),
    }])) },
    upgrades: { ...recorded.upgrades, ...Object.fromEntries(Object.entries(candidate.upgrades).map(([id, spec]) => [upgrade(id), { ...spec, kind: kind(spec.kind) }])) },
  };
}
