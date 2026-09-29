/** Display legacy replay kinds using current unit/building names. */
export function displayKind(kind: string): string {
  return kind === "agent" ? "king" : kind === "nexus" ? "castle" : kind;
}
