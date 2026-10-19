/**
 * Environments from before the rename still export AOA_*: each AOA_X becomes
 * CASTELLAN_X unless CASTELLAN_X is already set. Child processes inherit the result.
 */
export function adoptLegacyEnv(env: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("AOA_")) continue;
    const current = `CASTELLAN_${name.slice(4)}`;
    if (env[current] === undefined) env[current] = value;
  }
}
