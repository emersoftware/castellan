import { expect, it } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { highlightJs } from "../src/highlight";

it("colours keywords, self, calls, properties, strings, numbers and comments without changing the text", () => {
  const code = "// hi\nconst e = self.nearestEnemy();\nif (e && e.hp < 30) self.attack(e); else log('x');";
  const nodes = highlightJs(code);
  const text = nodes.map((n) => (isValidElement(n) ? (n as ReactElement<{ children: string }>).props.children : n)).join("");
  expect(text).toBe(code);
  const cls = (word: string) => (nodes.find((n) => isValidElement(n) && (n as ReactElement<{ children: string }>).props.children === word) as ReactElement<{ className: string }> | undefined)?.props.className;
  expect([cls("// hi"), cls("const"), cls("self"), cls("nearestEnemy"), cls("hp"), cls("30"), cls("'x'"), cls("if")])
    .toEqual(["tk-com", "tk-kw", "tk-self", "tk-fn", "tk-prop", "tk-num", "tk-str", "tk-kw"]);
});
