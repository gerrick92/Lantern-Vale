import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { expect, it } from "vitest";
import ts from "typescript";

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    return entry.isDirectory()
      ? sources(file)
      : /\.(tsx?|js)$/.test(file)
        ? [file]
        : [];
  });
}
const files = [
  "apps/web/src",
  "game/rules",
  "game/plugins",
  "supabase/functions",
].flatMap(sources);
const configPath = resolve("apps/web/tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  resolve("apps/web"),
).options;
const graph = new Map(
  files.map((file) => {
    const ast = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const imports: string[] = [];
    function visit(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
        (ts.isExportDeclaration(node) && !node.isTypeOnly)
      ) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
          imports.push(node.moduleSpecifier.text);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        imports.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(ast);
    const dependencies = imports.flatMap((name) => {
      const resolvedImport = ts.resolveModuleName(
        name,
        file,
        options,
        ts.sys,
      ).resolvedModule;
      return resolvedImport &&
        files.includes(resolve(resolvedImport.resolvedFileName))
        ? [resolve(resolvedImport.resolvedFileName)]
        : [];
    });
    const client = ast.statements.some(
      (node) =>
        ts.isExpressionStatement(node) &&
        ts.isStringLiteral(node.expression) &&
        node.expression.text === "use client",
    );
    return [file, { imports, dependencies, client }] as const;
  }),
);
const label = (file: string) => relative(".", file).replaceAll("\\", "/");

it("keeps server-only implementations out of every local client import path", () => {
  const visit = (file: string, chain: string[], seen: Set<string>) => {
    if (seen.has(file)) return;
    seen.add(file);
    const node = graph.get(file)!;
    expect(
      node.imports.includes("server-only") ||
        label(file).startsWith("apps/web/src/server/") ||
        label(file).startsWith("supabase/functions/"),
      [...chain, label(file)].join(" → "),
    ).toBe(false);
    node.dependencies.forEach((next) =>
      visit(next, [...chain, label(file)], seen),
    );
  };
  for (const [file, node] of graph) if (node.client) visit(file, [], new Set());
});

it("keeps shared game rules independent of the web application and MZ presentation", () => {
  for (const [file, node] of graph) {
    if (!label(file).startsWith("game/rules/")) continue;
    expect(
      node.imports.filter((name) => !name.startsWith(".") && name !== "zod"),
      label(file),
    ).toEqual([]);
    expect(
      node.dependencies.every((dependency) =>
        label(dependency).startsWith("game/rules/"),
      ),
      label(file),
    ).toBe(true);
  }
});

it("has no local runtime import cycles", () => {
  const done = new Set<string>();
  function visit(file: string, stack: string[]) {
    if (done.has(file)) return;
    expect(stack.includes(file), [...stack, file].map(label).join(" → ")).toBe(
      false,
    );
    graph
      .get(file)!
      .dependencies.forEach((next) => visit(next, [...stack, file]));
    done.add(file);
  }
  files.forEach((file) => visit(file, []));
});
