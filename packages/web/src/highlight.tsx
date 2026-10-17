import type { ReactNode } from "react";

const KEYWORDS = new Set(["const", "let", "var", "if", "else", "return", "for", "while", "do", "of", "in", "function", "new",
  "break", "continue", "switch", "case", "default", "typeof", "true", "false", "null", "undefined", "this"]);
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+|.)/g;

/** The class of a TOKEN match in `code`, after the token `prev`: a member followed by `(` is a call. */
function tokenClass(m: RegExpExecArray, prev: string, code: string): string {
  const [text, comment, string, number, word] = m;
  if (comment) return "tk-com";
  if (string) return "tk-str";
  if (number) return "tk-num";
  if (!word) return "";
  if (KEYWORDS.has(word)) return "tk-kw";
  if (word === "self" || word === "view" || word === "game" || word === "rules") return "tk-self";
  if (prev !== ".") return "";
  return /^\s*\(/.test(code.slice(m.index + text.length)) ? "tk-fn" : "tk-prop";
}

/** Light JavaScript highlighting in the C64 palette, for unit scripts in the viewer. */
export function highlightJs(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let m: RegExpExecArray | null;
  let prev = "";
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code))) {
    const text = m[0];
    const cls = tokenClass(m, prev, code);
    out.push(cls ? <span key={m.index} className={cls}>{text}</span> : text);
    if (!/^\s+$/.test(text)) prev = text;
  }
  return out;
}
