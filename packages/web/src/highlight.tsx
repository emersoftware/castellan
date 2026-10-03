import type { ReactNode } from "react";

const KEYWORDS = new Set(["const", "let", "var", "if", "else", "return", "for", "while", "do", "of", "in", "function", "new",
  "break", "continue", "switch", "case", "default", "typeof", "true", "false", "null", "undefined", "this"]);
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+|.)/g;

/** Light JavaScript highlighting in the C64 palette, for unit scripts in the viewer. */
export function highlightJs(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let m: RegExpExecArray | null;
  let prev = "";
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code))) {
    const [text, comment, string, number, word] = m;
    const cls = comment ? "tk-com" : string ? "tk-str" : number ? "tk-num"
      : word ? (KEYWORDS.has(word) ? "tk-kw" : word === "self" || word === "view" || word === "rules" ? "tk-self"
        : prev === "." && /^\s*\(/.test(code.slice(TOKEN.lastIndex)) ? "tk-fn" : prev === "." ? "tk-prop" : "") : "";
    out.push(cls ? <span key={m.index} className={cls}>{text}</span> : text);
    if (!/^\s+$/.test(text)) prev = text;
  }
  return out;
}
