import { isClipTemplateV1, type ClipTemplateV1 } from "@menote/shared";
import type * as ts from "typescript";

const EDGE_EVER_REPOSITORY = "tianma-if/edgeever";
const READER_PATH = "apps/extension/src/article-clip.ts";
const PLATFORM_PATH = "apps/extension/src/platform-clip.ts";
const EDGE_EVER_LICENSE = "AGPL-3.0";

export interface EdgeEverAdapterCandidate {
  platform: string;
  hosts: string[];
  paths: string[];
  template: ClipTemplateV1 | null;
  unsupported: string[];
}

export interface EdgeEverAdapterCatalog {
  repository: string;
  branch: string;
  commit: string;
  adapters: EdgeEverAdapterCandidate[];
}

interface MenuEntry {
  platform: string;
  patterns: Array<string | null>;
}

interface Assignments {
  titleNode: string[];
  body: string[];
  authorNode: string[];
  timeNode: string[];
}

function normalizeRepository(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
  if (normalized === "edgeever" || normalized === EDGE_EVER_REPOSITORY) return EDGE_EVER_REPOSITORY;
  if (normalized === `https://github.com/${EDGE_EVER_REPOSITORY}`) return EDGE_EVER_REPOSITORY;
  throw new Error("unsupported_repository");
}

async function readSourceFile(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`github_http_${response.status}`);
  const source = await response.text();
  if (source.length > 512 * 1024) throw new Error("source_too_large");
  return source;
}

function nodeString(tsApi: typeof ts, node: ts.Node | undefined): string | null {
  return node && (tsApi.isStringLiteral(node) || tsApi.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}

function propertyName(tsApi: typeof ts, source: ts.SourceFile, name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (tsApi.isIdentifier(name) || tsApi.isStringLiteral(name)) return name.text;
  return name.getText(source).replaceAll('"', "").replaceAll("'", "");
}

function property(tsApi: typeof ts, source: ts.SourceFile, object: ts.Expression | undefined, name: string): ts.Expression | undefined {
  if (!object || !tsApi.isObjectLiteralExpression(object)) return undefined;
  const entry = object.properties.find((item) => tsApi.isPropertyAssignment(item) && propertyName(tsApi, source, item.name) === name);
  return entry && tsApi.isPropertyAssignment(entry) ? entry.initializer : undefined;
}

function unwrap(tsApi: typeof ts, node: ts.Expression | undefined): ts.Expression | undefined {
  while (node && (tsApi.isAsExpression(node) || tsApi.isSatisfiesExpression(node) || tsApi.isParenthesizedExpression(node))) node = node.expression;
  return node;
}

function readMenus(tsApi: typeof ts, source: ts.SourceFile): MenuEntry[] {
  let result: MenuEntry[] = [];
  function visit(node: ts.Node) {
    const initial = tsApi.isVariableDeclaration(node) ? unwrap(tsApi, node.initializer) : undefined;
    if (tsApi.isVariableDeclaration(node) && node.name.getText(source) === "PLATFORM_MENUS" && initial && tsApi.isArrayLiteralExpression(initial)) {
      result = initial.elements.flatMap((entry) => {
        if (!tsApi.isObjectLiteralExpression(entry)) return [];
        const id = nodeString(tsApi, property(tsApi, source, entry, "id"));
        if (!id?.startsWith("save-")) return [];
        const patterns = unwrap(tsApi, property(tsApi, source, entry, "patterns"));
        return [{
          platform: id.slice("save-".length),
          patterns: patterns && tsApi.isArrayLiteralExpression(patterns)
            ? patterns.elements.map((pattern) => nodeString(tsApi, pattern))
            : [],
        }];
      });
    }
    tsApi.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

function branchPlatform(tsApi: typeof ts, source: ts.SourceFile, condition: ts.Expression): string | null {
  if (!tsApi.isBinaryExpression(condition) || condition.operatorToken.kind !== tsApi.SyntaxKind.EqualsEqualsEqualsToken) return null;
  const right = nodeString(tsApi, condition.right);
  if (condition.left.getText(source) === "target.platform" && right) return right;
  if (right === "target.platform" && tsApi.isPropertyAccessExpression(condition.left)) return condition.left.name.text;
  return null;
}

function branchFor(tsApi: typeof ts, source: ts.SourceFile, node: ts.Node, wanted: string): ts.Statement | null {
  if (tsApi.isIfStatement(node)) {
    if (branchPlatform(tsApi, source, node.expression) === wanted) return node.thenStatement;
    if (node.elseStatement) {
      const nested = branchFor(tsApi, source, node.elseStatement, wanted);
      if (nested) return nested;
      if (!tsApi.isIfStatement(node.elseStatement)) return node.elseStatement;
    }
  }
  if (tsApi.isBlock(node)) {
    for (const statement of node.statements) {
      const found = branchFor(tsApi, source, statement, wanted);
      if (found) return found;
    }
  }
  return null;
}

function selectorsIn(tsApi: typeof ts, source: ts.SourceFile, node: ts.Node | undefined): string[] {
  const selectors: string[] = [];
  function visit(current: ts.Node) {
    if (tsApi.isCallExpression(current) && tsApi.isPropertyAccessExpression(current.expression) &&
        current.expression.name.text === "querySelector" && current.arguments.length > 0) {
      const value = nodeString(tsApi, current.arguments[0]);
      if (value && !selectors.includes(value)) selectors.push(value);
    }
    tsApi.forEachChild(current, visit);
  }
  if (node) visit(node);
  return selectors;
}

function readAssignments(tsApi: typeof ts, source: ts.SourceFile, node: ts.Node): Assignments {
  const found: Assignments = { titleNode: [], body: [], authorNode: [], timeNode: [] };
  function visit(current: ts.Node) {
    if (tsApi.isBinaryExpression(current) && current.operatorToken.kind === tsApi.SyntaxKind.EqualsToken &&
        tsApi.isIdentifier(current.left) && current.left.text in found) {
      found[current.left.text as keyof Assignments].push(...selectorsIn(tsApi, source, current.right));
    }
    if (tsApi.isVariableDeclaration(current) && tsApi.isIdentifier(current.name) && current.name.text in found && current.initializer) {
      found[current.name.text as keyof Assignments].push(...selectorsIn(tsApi, source, current.initializer));
    }
    tsApi.forEachChild(current, visit);
  }
  visit(node);
  return {
    titleNode: [...new Set(found.titleNode)],
    body: [...new Set(found.body)],
    authorNode: [...new Set(found.authorNode)],
    timeNode: [...new Set(found.timeNode)],
  };
}

function readUrlPatterns(patterns: Array<string | null>): { hosts: string[]; paths: string[]; unsupported: string[] } {
  const hosts = new Map<string, Set<string>>();
  const unsupported: string[] = [];
  for (const pattern of patterns) {
    if (!pattern) { unsupported.push("适配器 URL 规则不是静态字符串。"); continue; }
    const match = /^https:\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?$/.exec(pattern);
    if (!match || match[1].includes("*") || (match[3] && match[3] !== "*")) {
      unsupported.push(`无法用 host/path 安全表达：${pattern}`);
      continue;
    }
    const host = match[1].toLowerCase();
    const path = match[2] || "/";
    const validHost = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(host);
    if (!validHost || /[{}()+\\]/.test(path)) {
      unsupported.push(`host/path 含不支持的匹配语法：${pattern}`);
      continue;
    }
    if (!hosts.has(host)) hosts.set(host, new Set());
    hosts.get(host)!.add(path);
  }
  const pathSets = [...hosts.values()].map((set) => JSON.stringify([...set].sort()));
  if (new Set(pathSets).size > 1) unsupported.push("同一适配器的 host/path 组合无法表达为不扩大匹配范围的模板。");
  return { hosts: [...hosts.keys()], paths: [...hosts.values()][0] ? [...[...hosts.values()][0]].sort() : [], unsupported };
}

function convertAdapter(tsApi: typeof ts, menu: MenuEntry, reader: ts.SourceFile, commit: string): EdgeEverAdapterCandidate {
  const unsupported: string[] = [];
  const match = readUrlPatterns(menu.patterns);
  unsupported.push(...match.unsupported);

  let readArticle: ts.Expression | undefined;
  function locate(node: ts.Node) {
    if (tsApi.isVariableDeclaration(node) && node.name.getText(reader) === "readArticle" && node.initializer) readArticle = node.initializer;
    tsApi.forEachChild(node, locate);
  }
  locate(reader);
  const readerFn = readArticle && tsApi.isArrowFunction(readArticle) && tsApi.isBlock(readArticle.body) ? readArticle.body : null;
  const siteBranch = readerFn ? branchFor(tsApi, reader, readerFn, menu.platform) : null;
  if (!siteBranch) unsupported.push("该网站使用 EdgeEver 专用代码适配，未在公共 article reader 中找到可转译分支。");

  const assignments = siteBranch ? readAssignments(tsApi, reader, siteBranch) : { titleNode: [], body: [], authorNode: [], timeNode: [] };
  const takeSingle = (name: keyof Assignments, required: boolean) => {
    const values = assignments[name];
    if (values.length !== 1) {
      if (required || values.length > 1) unsupported.push(`${name}：需要单一静态 querySelector，实际找到 ${values.length} 个${values.length ? `（${values.join("、")}）` : ""}。`);
      return "";
    }
    return values[0]!;
  };
  const titleSelector = takeSingle("titleNode", true);
  const contentSelector = takeSingle("body", true);
  const authorSelector = takeSingle("authorNode", false);
  const timeSelector = takeSingle("timeNode", false);
  if (!match.hosts.length || !match.paths.length) unsupported.push("适配器 URL 匹配范围为空。");

  const template: ClipTemplateV1 = {
    schemaVersion: 1,
    id: `edgeever-${menu.platform}-${commit.slice(0, 8)}`,
    name: `EdgeEver ${menu.platform}`,
    enabled: false,
    match: { hosts: match.hosts, paths: match.paths },
    selectors: {
      title: { selector: titleSelector, value: "text" },
      content: { selector: contentSelector, value: "html" },
      ...(authorSelector ? { author: { selector: authorSelector, value: "text" as const } } : {}),
      ...(timeSelector ? { publishedAt: { selector: timeSelector, value: "text" as const } } : {}),
    },
    exclude: [],
    source: { kind: "edgeever", repository: EDGE_EVER_REPOSITORY, commit, path: READER_PATH, license: EDGE_EVER_LICENSE },
  };

  if (!isClipTemplateV1(template)) unsupported.push("生成结果未通过 Menote ClipTemplateV1 安全校验。");
  if (siteBranch) unsupported.push("读取身份校验、动态分支、正文清理与元数据规范化未转译；启用前请对照源代码和页面样本检查。");
  const convertible = unsupported.length === (siteBranch ? 1 : 0) && isClipTemplateV1(template);
  return {
    platform: menu.platform,
    hosts: match.hosts,
    paths: match.paths,
    template: convertible ? template : null,
    unsupported,
  };
}

export async function discoverEdgeEverAdapters(repositoryInput: string): Promise<EdgeEverAdapterCatalog> {
  const repository = normalizeRepository(repositoryInput);
  const revisionResponse = await fetch("/api/edgeever/revision", { cache: "no-store" });
  const revision = await revisionResponse.json().catch(() => ({})) as { repository?: string; branch?: string; commit?: string };
  if (!revisionResponse.ok) throw new Error("edgeever_revision_unavailable");
  const branch = revision.branch;
  const commit = revision.commit;
  if (revision.repository !== repository || !branch || !commit || !/^[a-f0-9]{40}$/i.test(commit)) throw new Error("github_commit_invalid");

  const rawBase = `https://raw.githubusercontent.com/${repository}/${commit}`;
  const [platformText, readerText] = await Promise.all([
    readSourceFile(`${rawBase}/${PLATFORM_PATH}`),
    readSourceFile(`${rawBase}/${READER_PATH}`),
  ]);
  const tsApi = await import("typescript");
  const platformSource = tsApi.createSourceFile(PLATFORM_PATH, platformText, tsApi.ScriptTarget.Latest, true, tsApi.ScriptKind.TS);
  const readerSource = tsApi.createSourceFile(READER_PATH, readerText, tsApi.ScriptTarget.Latest, true, tsApi.ScriptKind.TS);
  const menus = readMenus(tsApi, platformSource);
  if (!menus.length) throw new Error("edgeever_adapters_not_found");

  return {
    repository,
    branch,
    commit,
    adapters: menus.map((menu) => convertAdapter(tsApi, menu, readerSource, commit)),
  };
}
