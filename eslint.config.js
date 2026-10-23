// ESLint covers what tsc and Knip do not: the plain JavaScript scripts, and a few project rules.
// A justified exception is `// eslint-disable-next-line <rule> -- <reason>`.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Type checks belong to the caller's types; errors are the only classes inspected at runtime. */
const instanceofOnlyErrors = {
  selector: "BinaryExpression[operator='instanceof'][right.name!=/Error$/]",
  message: "Branch on a discriminated union, not on a class; instanceof is only for errors.",
};
const DETERMINISM = "The simulation must replay identically: use the match clock and the seeded random generator.";

export default defineConfig([
  globalIgnores([
    "**/node_modules/", "**/dist/", "**/*.tmp.*", ".agents/", ".claude/", ".wrangler/", "work/", "research_notes/",
    "assets/raw/", "assets/sounds/", "assets/music/", "assets/animations/**/*frames*/", "assets/animations/**/attempt-*/",
    "assets/animations/**/rejected-*/", "assets/animations/downloads/", "connectors/*/evidence/", "packages/web/public/",
    "cloudflare/worker-configuration.d.ts",
    // Codex owns this connector.
    "connectors/autonomous/",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // tsc's noUnusedLocals and noUnusedParameters check TypeScript.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      "no-restricted-syntax": ["error", instanceofOnlyErrors],
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    rules: { "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }] },
  },
  {
    // Tests inspect scenes and fake constructors by class.
    files: ["**/test/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-this-alias": "off", "no-restricted-syntax": "off" },
  },
  {
    files: ["packages/{engine,bots,shared}/src/**"],
    rules: {
      "no-restricted-properties": ["error",
        ...[["Date", "now"], ["Math", "random"], ["performance", "now"], ["crypto", "randomUUID"], ["crypto", "getRandomValues"]]
          .map(([object, property]) => ({ object, property, message: DETERMINISM }))],
      "no-restricted-globals": ["error",
        ...["setTimeout", "setInterval", "setImmediate", "fetch"].map((name) => ({ name, message: DETERMINISM }))],
      "no-restricted-syntax": ["error", instanceofOnlyErrors,
        { selector: "NewExpression[callee.name='Date'][arguments.length=0], CallExpression[callee.name='Date']", message: DETERMINISM }],
    },
  },
  {
    files: ["packages/{engine,bots}/src/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["node:*"], message: DETERMINISM }] }] },
  },
]);
