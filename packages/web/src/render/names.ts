/** Display legacy replay kinds using current unit/building names. */
export function displayKind(kind: string): string {
  return kind === "agent" ? "king" : kind === "nexus" ? "castle" : kind === "ranger" ? "archer" : kind === "turret" ? "tower" : kind;
}

/** Labels from recorded orders/research; never rewrite a player's chat or code. */
export function displayGameText(text: string): string {
  return text.replace(/\b(ranger|turret|capital)(?=\b|_)/g, word => word === "capital" ? "mineral" : displayKind(word));
}
