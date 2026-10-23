// @ts-check

/** Animation sources generated before a unit's rename keep the folder name they were generated under. */
const GENERATED_AS = /** @type {Record<string, string>} */ ({ archer: 'ranger', tower: 'turret' });

/** @param {string} art A kind or piece of art: its folder under assets/animations holds what was generated for it. */
export const artFolder = (art) => GENERATED_AS[art] ?? art;
