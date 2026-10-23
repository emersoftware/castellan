import ts from "typescript";

export interface Source { path: string; abs: string; pkg: string; text: string; ast: ts.SourceFile }
// `key` names the finding without its line, so it survives edits; acknowledged.ts refers to findings by it.
interface Finding { file: string; line: number; score: number; message: string; key: string; sites?: { file: string; line: number }[] }
export interface Check { id: string; flag: string; chapter: number; hint: string; run(sources: Source[]): Finding[] }

type Fn = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression;
interface NamedFn { name: string; fn: Fn; exported: boolean; at: ts.Node }

const lineOf = (s: Source, node: ts.Node) => s.ast.getLineAndCharacterOfPosition(node.getStart(s.ast)).line + 1;
const finding = (s: Source, node: ts.Node, score: number, message: string, key: string): Finding => ({ file: s.path, line: lineOf(s, node), score, message, key });

// The function or class around a node, or "(module)".
function ownerName(node: ts.Node): string {
  for (let p = node.parent; p && !ts.isSourceFile(p); p = p.parent) {
    if ((ts.isFunctionLike(p) || ts.isClassLike(p)) && (p as ts.NamedDeclaration).name) return (p as ts.NamedDeclaration).name!.getText();
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && p.initializer && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) return p.name.text;
  }
  return "(module)";
}

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

const hasFlag = (node: ts.Node, flag: ts.ModifierFlags) => (ts.getCombinedModifierFlags(node as ts.Declaration) & flag) !== 0;
const isPublic = (member: ts.ClassElement) =>
  !hasFlag(member, ts.ModifierFlags.Private | ts.ModifierFlags.Protected) && !(member.name && ts.isPrivateIdentifier(member.name));

function unwrap(expr: ts.Expression | undefined): ts.Expression | undefined {
  while (expr && (ts.isParenthesizedExpression(expr) || ts.isAwaitExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression(expr)))
    expr = expr.expression;
  return expr;
}

// Named functions, class methods and module-level function consts. Inline callbacks are left out on purpose.
function namedFunctions(ast: ts.SourceFile): NamedFn[] {
  const listed = new Set<string>();
  for (const stmt of ast.statements)
    if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause))
      for (const el of stmt.exportClause.elements) listed.add((el.propertyName ?? el.name).text);
  const exported = (node: ts.Node, name: string) => hasFlag(node, ts.ModifierFlags.Export) || listed.has(name);

  const out: NamedFn[] = [];
  walk(ast, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body)
      out.push({ name: node.name.text, fn: node, exported: exported(node, node.name.text), at: node.name });
    else if (ts.isMethodDeclaration(node) && node.body && ts.isClassLike(node.parent)) {
      const cls = node.parent;
      out.push({ name: node.name.getText(ast), fn: node, exported: isPublic(node) && !!cls.name && exported(cls, cls.name.text), at: node.name });
    } else if (ts.isVariableStatement(node) && ts.isSourceFile(node.parent))
      for (const decl of node.declarationList.declarations)
        if (ts.isIdentifier(decl.name) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)))
          out.push({ name: decl.name.text, fn: decl.initializer, exported: exported(node, decl.name.text), at: decl.name });
  });
  return out;
}

const codeLines = (text: string) => text.split("\n").filter((line) => !/^\s*($|\/\/|\/?\*)/.test(line)).length;

const passThrough: Check = {
  id: "pass-through",
  flag: "Pass-Through Method",
  chapter: 7,
  hint: "Only forwards its arguments. Merge it with the callee or give it real work.",
  run: (sources) =>
    sources.flatMap((s) =>
      namedFunctions(s.ast).flatMap(({ name, fn, exported, at }) => {
        const body = fn.body!;
        const only = ts.isBlock(body) ? (body.statements.length === 1 ? body.statements[0] : undefined) : undefined;
        const call = unwrap(!ts.isBlock(body) ? body : only && (ts.isReturnStatement(only) || ts.isExpressionStatement(only)) ? only.expression : undefined);
        if (!call || !ts.isCallExpression(call) || call.expression.kind === ts.SyntaxKind.SuperKeyword) return [];
        if (ts.isPropertyAccessExpression(call.expression) && call.expression.expression.kind === ts.SyntaxKind.SuperKeyword) return [];
        let ownsLiteral = false;
        walk(call.expression, (n) => (ownsLiteral ||= ts.isLiteralExpression(n)));
        if (ownsLiteral) return [];
        const params = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""));
        const args = call.arguments.map((a) => unwrap(ts.isSpreadElement(a) ? a.expression : a)).map((a) => (a && ts.isIdentifier(a) ? a.text : "?"));
        if (!params.length || params.includes("") || params.length !== args.length || [...params].sort().join() !== [...args].sort().join()) return [];
        const callee = call.expression.getText(s.ast).replace(/\s+/g, " ").slice(0, 60);
        return [finding(s, at, exported ? 2 : 1, `${name}(${params.join(", ")}) → ${callee}(${args.join(", ")})`, `${s.path}#${name}`)];
      }),
    ),
};

const shallowModule: Check = {
  id: "shallow-module",
  flag: "Shallow Module",
  chapter: 4,
  hint: "Large interface for little code. Merge with its callers or hide more behind fewer functions.",
  run: (sources) =>
    sources.flatMap((s) => {
      const fns = namedFunctions(s.ast).filter((f) => f.exported);
      const classes = s.ast.statements.filter((st) => ts.isClassDeclaration(st) && hasFlag(st, ts.ModifierFlags.Export)).length;
      const surface = classes + fns.reduce((sum, f) => sum + 1 + f.fn.parameters.length, 0);
      const lines = codeLines(s.text);
      const depth = lines / surface;
      if (fns.length < 4 || surface < 10 || depth >= 5) return [];
      return [finding(s, s.ast.statements[0] ?? s.ast, 1 / depth, `${fns.length} exported functions, ${surface} interface elements, ${lines} code lines (depth ${depth.toFixed(1)})`, s.path)];
    }),
};

const VAGUE = new Set(
  "data info item items obj thing things stuff tmp temp val value values result results res ret arr list foo bar misc helper helpers util utils manager handler handle flag flags".split(" "),
);

function isPropertyName(id: ts.Identifier) {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p)) return (ts.isPropertyAccessExpression(p) ? p.name : p.right) === id;
  return (ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isJsxAttribute(p)) && p.name === id;
}

function scopeOf(node: ts.Node): ts.Node {
  let scope = node.parent;
  while (!ts.isSourceFile(scope) && !ts.isBlock(scope) && !ts.isFunctionLike(scope) && !ts.isCaseClause(scope) && !ts.isForStatement(scope) && !ts.isForOfStatement(scope) && !ts.isForInStatement(scope))
    scope = scope.parent;
  return scope;
}

const vagueName: Check = {
  id: "vague-name",
  flag: "Vague Name",
  chapter: 14,
  hint: "Generic name read far from its declaration. Name what it holds.",
  run: (sources) =>
    sources.flatMap((s) => {
      const out: Finding[] = [];
      walk(s.ast, (node) => {
        if (!ts.isIdentifier(node) || !VAGUE.has(node.text.toLowerCase())) return;
        const p = node.parent;
        const declared = (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p)) && p.name === node;
        if (!declared) return;
        const scope = ts.isParameter(p) ? p.parent : scopeOf(p);
        let last = lineOf(s, node);
        walk(scope, (use) => {
          if (ts.isIdentifier(use) && use.text === node.text && !isPropertyName(use)) last = Math.max(last, lineOf(s, use));
        });
        const span = last - lineOf(s, node);
        if (span >= 15) out.push(finding(s, node, span, `"${node.text}" ${ts.isSourceFile(scope) ? "is module-level, read up to" : "is used"} ${span} lines ${ts.isSourceFile(scope) ? "away" : "after its declaration"}`, `${s.path}#${ownerName(node)}.${node.text}`));
      });
      return out;
    }),
};

// Optional fields of an options bag: an inline type, or a same-file type named like one. Entities with optional fields don't count.
function optionalFields(s: Source, param: ts.ParameterDeclaration): number {
  const type = param.type;
  if (!type) return 0;
  let members: ts.NodeArray<ts.TypeElement> | undefined;
  if (ts.isTypeLiteralNode(type)) members = type.members;
  else if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && /(options|opts|config|settings|props|params)$/i.test(`${type.typeName.text} ${param.name.getText(s.ast)}`)) {
    const name = type.typeName.text;
    for (const st of s.ast.statements) {
      if (ts.isInterfaceDeclaration(st) && st.name.text === name) members = st.members;
      if (ts.isTypeAliasDeclaration(st) && st.name.text === name && ts.isTypeLiteralNode(st.type)) members = st.type.members;
    }
  }
  return members?.filter((m) => m.questionToken).length ?? 0;
}

const configParam: Check = {
  id: "config-param",
  flag: "Configuration Parameter / Overexposure",
  chapter: 8,
  hint: "The caller picks the behavior. Can the function decide it itself, or split into two functions?",
  run: (sources) =>
    sources.flatMap((s) =>
      namedFunctions(s.ast).flatMap(({ name, fn, at }) => {
        if (/^set[A-Z]/.test(name) && fn.parameters.length === 1) return [];
        const booleans = fn.parameters.filter(
          (p) => p.type?.kind === ts.SyntaxKind.BooleanKeyword || p.initializer?.kind === ts.SyntaxKind.TrueKeyword || p.initializer?.kind === ts.SyntaxKind.FalseKeyword,
        );
        const optional = Math.max(0, ...fn.parameters.map((p) => optionalFields(s, p)));
        const parts = [
          ...(booleans.length ? [`boolean ${booleans.map((p) => p.name.getText(s.ast)).join(", ")}`] : []),
          ...(optional >= 5 ? [`${optional} optional options`] : []),
        ];
        return parts.length ? [finding(s, at, booleans.length * 3 + (optional >= 5 ? optional : 0), `${name}: ${parts.join("; ")}`, `${s.path}#${name}`)] : [];
      }),
    ),
};

function escapingThrows(fn: Fn): ts.ThrowStatement[] {
  const out: ts.ThrowStatement[] = [];
  const visit = (node: ts.Node, guarded: boolean) => {
    if (node !== fn && ts.isFunctionLike(node)) return;
    if (ts.isThrowStatement(node) && !guarded) out.push(node);
    if (ts.isTryStatement(node) && node.catchClause) {
      visit(node.tryBlock, true);
      visit(node.catchClause, guarded);
      if (node.finallyBlock) visit(node.finallyBlock, guarded);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, guarded));
  };
  visit(fn, false);
  return out;
}

const exceptions: Check = {
  id: "exceptions",
  flag: "Exceptions in the interface",
  chapter: 10,
  hint: "Every throw is interface the caller must handle. Define the error away, mask it below, or aggregate it above.",
  run: (sources) =>
    sources.flatMap((s) => {
      const throwing = namedFunctions(s.ast)
        .filter((f) => f.exported)
        .map((f) => ({ ...f, throws: escapingThrows(f.fn) }))
        .filter((f) => f.throws.length);
      const total = throwing.reduce((sum, f) => sum + f.throws.length, 0);
      if (total < 2) return [];
      const names = throwing.map((f) => f.name);
      return [finding(s, throwing[0].throws[0], total, `${total} throws in ${names.length} exported functions (${names.slice(0, 4).join(", ")}${names.length > 4 ? ", …" : ""})`, s.path)];
    }),
};

function leadingCommentLines(s: Source, node: ts.Node): number {
  return (ts.getLeadingCommentRanges(s.text, node.getFullStart()) ?? []).reduce((sum, r) => sum + s.text.slice(r.pos, r.end).split("\n").length, 0);
}

const hardToDescribe: Check = {
  id: "hard-to-describe",
  flag: "Hard to Describe",
  chapter: 15,
  hint: "Needs a long comment to be used. The interface or the split is probably wrong.",
  run: (sources) =>
    sources.flatMap((s) => {
      const out: Finding[] = [];
      const exportedTop = s.ast.statements.filter((st) => hasFlag(st, ts.ModifierFlags.Export));
      const members = exportedTop.flatMap((st): ts.Node[] =>
        ts.isClassDeclaration(st) ? st.members.filter(isPublic) : ts.isInterfaceDeclaration(st) ? [...st.members] : [],
      );
      for (const node of [...exportedTop, ...members]) {
        const lines = leadingCommentLines(s, node);
        const named = ts.isVariableStatement(node) ? node.declarationList.declarations[0] : (node as ts.NamedDeclaration);
        const label = named.name?.getText(s.ast) ?? ts.SyntaxKind[node.kind];
        if (lines >= 8) out.push(finding(s, node, lines, `${label}: ${lines}-line interface comment`, `${s.path}#${label}`));
      }
      return out;
    }),
};

const STOP = new Set("the a an and or to of in on at for with from by is are be been this that it its if else then we our so as into all any each not no".split(" "));
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
const words = (text: string) =>
  text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);

// Echoed operations: "set x" over an assignment, "return y" over a return.
function codeWords(line: string): Set<string> {
  const out = new Set(words(line));
  if (/[^=!<>]=[^=>]/.test(line)) for (const w of ["set", "assign", "updat", "stor"]) out.add(w);
  if (/\+\+|\+=/.test(line)) for (const w of ["increment", "add", "bump"]) out.add(w);
  if (/\bnew\b/.test(line)) for (const w of ["creat", "make"]) out.add(w);
  if (/\bif\b/.test(line)) out.add("check");
  return out;
}

const commentRepeatsCode: Check = {
  id: "comment-repeats-code",
  flag: "Comment Repeats Code",
  chapter: 13,
  hint: "The comment says what the next line already says. Delete it or explain what the code can't (why, units, invariants).",
  run: (sources) =>
    sources.flatMap((s) => {
      const lines = s.text.split("\n");
      const out: Finding[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (!/^\s*\/\/(?!\/)/.test(lines[i]) || /^\s*\/\//.test(lines[i - 1] ?? "") || /^\s*\/\//.test(lines[i + 1] ?? "")) continue;
        const said = words(lines[i].replace(/^\s*\/\//, ""));
        const code = lines[i + 1] ?? "";
        if (said.length < 2 || said.length > 8 || !code.trim()) continue;
        const known = codeWords(code);
        if (said.filter((w) => known.has(w)).length >= said.length * 0.75)
          out.push({ file: s.path, line: i + 1, score: said.length, message: `"${lines[i].trim()}" over \`${code.trim().slice(0, 60)}\``, key: `${s.path}#${lines[i].trim()}` });
      }
      return out;
    }),
};

const NESTING = new Set([ts.SyntaxKind.IfStatement, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement, ts.SyntaxKind.SwitchStatement, ts.SyntaxKind.TryStatement]);

function chainLength(expr: ts.Expression): number {
  const inner = unwrap(expr);
  return inner && ts.isConditionalExpression(inner) ? 1 + chainLength(inner.whenFalse) : 0;
}

const nonobvious: Check = {
  id: "nonobvious",
  flag: "Nonobvious Code",
  chapter: 18,
  hint: "Deep nesting or tangled ternaries. Remove special cases, return early, or extract a well-named subtask.",
  run: (sources) =>
    sources.flatMap((s) => {
      const out: Finding[] = [];
      const visit = (node: ts.Node, depth: number, fn: { node: ts.Node; max: number }) => {
        if (ts.isFunctionLike(node) && node !== fn.node) {
          const inner = { node, max: 0 };
          ts.forEachChild(node, (child) => visit(child, 0, inner));
          if (inner.max >= 5) {
            const name = (node as ts.NamedDeclaration).name?.getText(s.ast) ?? "anonymous function";
            out.push(finding(s, node, inner.max, `${name}: nesting depth ${inner.max}`, `${s.path}#${name}`));
          }
          return;
        }
        if (ts.isConditionalExpression(node)) {
          let parent = node.parent;
          while (ts.isParenthesizedExpression(parent)) parent = parent.parent;
          const isLink = ts.isConditionalExpression(parent) && unwrap(parent.whenFalse) === node;
          const nestedInside = [node.condition, node.whenTrue].some((e) => chainLength(e) > 0);
          const chain = chainLength(node);
          const problem = nestedInside ? "ternary nested in a condition or true branch" : !isLink && chain >= 4 ? `chain of ${chain} ternaries` : undefined;
          if (problem && !out.some((f) => f.line === lineOf(s, node)))
            out.push(finding(s, node, Math.max(chain, 4), problem, `${s.path}#${ownerName(node)}: ${node.getText(s.ast).replace(/\s+/g, " ").slice(0, 60)}`));
        }
        const elseIf = ts.isIfStatement(node) && ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
        const next = NESTING.has(node.kind) && !elseIf ? depth + 1 : depth;
        fn.max = Math.max(fn.max, next);
        ts.forEachChild(node, (child) => visit(child, next, fn));
      };
      visit(s.ast, 0, { node: s.ast, max: 0 });
      return out;
    }),
};

const NOT_A_DECISION = /^(utf-?8|string|number|object|function|boolean|undefined|bigint|symbol|get|post|put|delete|patch|content-type|application\/json|text\/\w+|pipe|inherit|ignore|exit|close|data|drain|error|message|end|open|exec|hex|base64|sha\d+|md5|SIG[A-Z]+|E[A-Z]{3,})$/i;

function isDecisionLiteral(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral): boolean {
  const text = node.text;
  if (text.length < 3 || /\s/.test(text) || NOT_A_DECISION.test(text) || /^[#\d.-]|px$|%$|^(rgba?|hsla?|var)\(/.test(text)) return false;
  for (let p: ts.Node = node.parent; !ts.isSourceFile(p); p = p.parent) {
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isJsxAttribute(p) || ts.isExternalModuleReference(p)) return false;
    if (ts.isCallExpression(p) && (p.expression.kind === ts.SyntaxKind.ImportKeyword || p.expression.getText() === "require")) return false;
  }
  const p = node.parent;
  return !((ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === node);
}

const COMPARISONS = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);

// A literal the compiler validates where it stands (a union member, a `keyof`, a typed field) has one owner: the type.
function compilerChecked(checker: ts.TypeChecker, node: ts.Expression): boolean {
  const literals = (t: ts.Type | undefined) => {
    const parts = t ? (t.isUnion() ? t.types : [t]) : [];
    return parts.some((x) => x.isStringLiteral()) && !parts.some((x) => x.flags & (ts.TypeFlags.String | ts.TypeFlags.Any | ts.TypeFlags.Unknown));
  };
  let p = node.parent;
  while (ts.isParenthesizedExpression(p)) p = p.parent;
  if (ts.isBinaryExpression(p) && COMPARISONS.has(p.operatorToken.kind)) return literals(checker.getTypeAtLocation(p.left === node ? p.right : p.left));
  if (ts.isCaseClause(p)) return literals(checker.getTypeAtLocation(p.parent.parent.expression));
  return literals(checker.getContextualType(node));
}

const leakage: Check = {
  id: "leakage",
  flag: "Information Leakage",
  chapter: 5,
  hint: "The same literal (a design decision) lives in several packages. Give it one owner: export it, or type it so the compiler checks every use.",
  run: (sources) => {
    const program = ts.createProgram(sources.map((s) => s.abs), {
      allowJs: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022,
      strict: true, skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true, resolveJsonModule: true, esModuleInterop: true, types: ["node"],
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    });
    const checker = program.getTypeChecker();
    const seen = new Map<string, { pkgs: Set<string>; sites: { s: Source; node: ts.Node }[] }>();
    for (const source of sources) {
      const s = { ...source, ast: program.getSourceFile(source.abs) ?? source.ast };
      // Plain JS is type-checked only when it opts in with `// @ts-check` (tsconfig.scripts.json, run by `pnpm typecheck`).
      const checked = !/\.m?js$/.test(s.path) || /^(#!.*\n)?\s*\/\/ @ts-check/.test(s.text);
      walk(s.ast, (node) => {
        if (!(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) || !isDecisionLiteral(node) || (checked && compilerChecked(checker, node))) return;
        const entry = seen.get(node.text) ?? { pkgs: new Set(), sites: [] };
        entry.pkgs.add(s.pkg);
        entry.sites.push({ s, node });
        seen.set(node.text, entry);
      });
    }
    return [...seen]
      .filter(([, e]) => e.pkgs.size >= 2)
      .map(([text, e]) => ({
        ...finding(e.sites[0].s, e.sites[0].node, e.pkgs.size * 100 + e.sites.length, `"${text}" in ${[...e.pkgs].join(", ")} (${e.sites.length} sites)`, `${JSON.stringify(text)} @ ${[...e.pkgs].sort().join(",")}`),
        sites: e.sites.map(({ s, node }) => ({ file: s.path, line: lineOf(s, node) })),
      }));
  },
};

// A public setter that only stores its argument: the field is private in name only.
function trivialSetter(member: ts.ClassElement): boolean {
  const setter = ts.isSetAccessor(member) || (ts.isMethodDeclaration(member) && /^set[A-Z]/.test(member.name.getText()) && member.parameters.length === 1);
  const body = setter && (member as ts.SetAccessorDeclaration | ts.MethodDeclaration).body?.statements;
  if (!body || body.length !== 1) return false;
  const [only] = body;
  return (
    ts.isExpressionStatement(only) &&
    ts.isBinaryExpression(only.expression) &&
    only.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(only.expression.left) &&
    only.expression.left.expression.kind === ts.SyntaxKind.ThisKeyword
  );
}

const setter: Check = {
  id: "setter",
  flag: "Setter (private without hiding)",
  chapter: 19,
  hint: "Callers write the field directly. Move the logic that decides the value inside the class.",
  run: (sources) =>
    sources.flatMap((s) => {
      const out: Finding[] = [];
      walk(s.ast, (node) => {
        if (ts.isClassLike(node))
          for (const member of node.members.filter((m) => isPublic(m) && trivialSetter(m)))
            out.push(finding(s, member, 1, `${node.name?.text ?? "class"}.${member.name?.getText(s.ast)}`, `${s.path}#${node.name?.text ?? "class"}.${member.name?.getText(s.ast)}`));
      });
      return out;
    }),
};

export const checks: Check[] = [shallowModule, passThrough, leakage, configParam, exceptions, hardToDescribe, vagueName, commentRepeatsCode, nonobvious, setter];
