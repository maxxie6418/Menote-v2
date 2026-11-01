import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sourceRoot = path.join(root, "src");
const whitelist = new Set(["README.md", "AGENTS.md", "DESIGN.md", "package.json", "pnpm-workspace.yaml", "wrangler.jsonc", "pnpm-lock.yaml", ".gitignore", "wiki", "archive", "draft", "todo", "src"]);
// These are local tool metadata or generated artifacts, not repository deliverables.
// Their presence is reported and is not evidence that the physical whitelist passed.
const localArtifacts = new Set([".git", ".workbuddy", ".wrangler", ".zcode", "node_modules", "dist", ".dev.vars"]);
const ignoredDirectories = new Set(["node_modules", "dist", ".wrangler"]);

async function filesUnder(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) output.push(...await filesUnder(path.join(directory, entry.name)));
    else if (entry.isFile()) output.push(path.join(directory, entry.name));
  }
  return output;
}
const files = await filesUnder(sourceRoot);
const relative = (file) => path.relative(root, file).split(path.sep).join("/");
const source = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
  file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function visit(node, fn) { fn(node); ts.forEachChild(node, (child) => visit(child, fn)); }

test("project root entries and source file sizes follow the baseline", async (t) => {
  const entries = await readdir(root);
  const extras = entries.filter((entry) => !whitelist.has(entry) && !localArtifacts.has(entry));
  assert.deepEqual(extras, [], `Unexpected root entries: ${extras.join(", ")}`);
  const artifacts = entries.filter((entry) => localArtifacts.has(entry) && entry !== ".git");
  if (artifacts.length) t.diagnostic(`Local generated/ignored entries outside whitelist, physical check remains open: ${artifacts.join(", ")}`);
  if (entries.includes(".git")) {
    for (const artifact of artifacts) {
      const ignored = spawnSync("git", ["check-ignore", "-q", "--", artifact], { cwd: root });
      assert.equal(ignored.status, 0, `${artifact} is not ignored or is tracked`);
    }
  }
  for (const file of files.filter((f) => /\.(?:tsx?|mjs|css|sql|json|html)$/.test(f))) {
    const lines = (await readFile(file, "utf8")).split(/\r?\n/).length;
    assert.ok(lines <= 1000, `${relative(file)} has ${lines} lines`);
  }
  const entry = await readFile(path.join(sourceRoot, "worker/src/index.ts"), "utf8");
  assert.ok(entry.split(/\r?\n/).length <= 200, "Worker entry exceeds 200 lines");
});

test("UI uses services and features import other features through public entries", async () => {
  const webRoot = path.join(sourceRoot, "web/src");
  const featureRoot = path.join(webRoot, "features");
  const uiFiles = files.filter((file) => file.startsWith(webRoot + path.sep) && /\.tsx?$/.test(file) &&
    !["services", "db", "lib", "stores"].includes(path.relative(webRoot, file).split(path.sep)[0]));
  const findings = [];
  for (const file of uiFiles) {
    const tree = source(file, await readFile(file, "utf8"));
    const current = path.relative(featureRoot, file).split(path.sep);
    const currentFeature = !current[0].startsWith("..") ? current[0] : null;
    visit(tree, (node) => {
      if (ts.isIdentifier(node) && ["indexedDB", "localStorage", "sessionStorage", "fetch", "crypto"].includes(node.text)) findings.push(`${relative(file)}: UI references ${node.text}`);
      if (ts.isJsxAttribute(node) && node.name.getText(tree) === "style") findings.push(`${relative(file)}: inline style`);
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
      const specifier = node.moduleSpecifier.text;
      if (!specifier.startsWith(".")) return;
      const target = path.resolve(path.dirname(file), specifier);
      if (target === path.join(webRoot, "db") || target.startsWith(path.join(webRoot, "db") + path.sep)) findings.push(`${relative(file)}: UI imports db`);
      if (currentFeature && target.startsWith(featureRoot + path.sep)) {
        const parts = path.relative(featureRoot, target).split(path.sep);
        if (parts[0] !== currentFeature && !(parts.length === 1 || (parts.length === 2 && /^index(?:\.tsx?)?$/.test(parts[1])))) findings.push(`${relative(file)}: deep feature import ${specifier}`);
      }
    });
  }
  assert.deepEqual(findings, []);
});

test("Worker SQL stays in db and style values stay in tokens", async () => {
  const findings = [];
  for (const file of files) {
    const rel = relative(file);
    if (rel.startsWith("src/worker/src/") && !rel.startsWith("src/worker/src/db/") && /\.tsx?$/.test(rel) && !rel.endsWith(".d.ts")) {
      const tree = source(file, await readFile(file, "utf8"));
      visit(tree, (node) => {
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) && /\b(?:SELECT\s+[\s\S]*?\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(node.text)) findings.push(`${rel}: SQL outside db`);
      });
    }
    if (rel.startsWith("src/web/src/") && rel.endsWith(".css") && rel !== "src/web/src/styles/tokens.css") {
      const text = await readFile(file, "utf8");
      if (/(?:^|[^\w-])(?:#[\da-fA-F]{3,8}\b|\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%))/m.test(text)) findings.push(`${rel}: literal style value outside tokens`);
    }
  }
  assert.deepEqual(findings, []);
});
