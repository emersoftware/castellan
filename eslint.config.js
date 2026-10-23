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
/** A returned tuple says what each element is. */
const labeledTupleReturns = {
  selector: ":function > TSTypeAnnotation > TSTupleType > :not(TSNamedTupleMember)",
  message: "Label the elements of a returned tuple ([x: number, y: number]) or return an object.",
};
const DETERMINISM = "The simulation must replay identically: use the match clock and the seeded random generator.";
/** Libraries and the server take configuration as options; the process entry point reads the environment. */
const processEnv = { object: "process", property: "env", message: "Read the environment in the process entry point and pass options." };

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
      "no-restricted-syntax": ["error", instanceofOnlyErrors, labeledTupleReturns],
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
          .map(([object, property]) => ({ object, property, message: DETERMINISM })), processEnv],
      "no-restricted-globals": ["error",
        ...["setTimeout", "setInterval", "setImmediate", "fetch"].map((name) => ({ name, message: DETERMINISM }))],
      "no-restricted-syntax": ["error", instanceofOnlyErrors, labeledTupleReturns,
        { selector: "NewExpression[callee.name='Date'][arguments.length=0], CallExpression[callee.name='Date']", message: DETERMINISM }],
    },
  },
  {
    files: ["packages/{sandbox,server}/src/**"],
    ignores: ["packages/server/src/main.ts"],
    rules: { "no-restricted-properties": ["error", processEnv] },
  },
  {
    files: ["packages/{engine,bots}/src/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["node:*"], message: DETERMINISM }] }],
      // A number with a meaning gets a name; one the players see belongs in the ruleset.
      "@typescript-eslint/no-magic-numbers": ["error", { ignore: [-1, 0, 1, 2], enforceConst: true, ignoreArrayIndexes: true,
        ignoreEnums: true, ignoreNumericLiteralTypes: true, ignoreReadonlyClassProperties: true, ignoreTypeIndexes: true }],
    },
  },
]);
