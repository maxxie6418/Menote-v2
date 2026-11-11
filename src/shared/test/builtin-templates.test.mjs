import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const templatesDir = fileURLToPath(new URL("../../../todo/20261111-TP14-剪藏第三管线与四平台迁移/templates/", import.meta.url));
const source = await readFile(new URL("../src/types/clipTemplate.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { isClipTemplateV1 } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const files = (await readdir(templatesDir)).filter((name) => name.endsWith(".template.json")).sort();

test("A 档内置模板齐全且符合 ClipTemplateV1", () => {
  assert.ok(files.length >= 6, `期望至少 6 条内置模板，实际 ${files.length}`);
});

for (const file of files) {
  test(`内置模板 ${file} 校验通过且默认停用`, async () => {
    const template = JSON.parse(await readFile(path.join(templatesDir, file), "utf8"));
    assert.ok(isClipTemplateV1(template), `${file} 不符合 ClipTemplateV1`);
    assert.equal(template.enabled, false, `${file} 必须默认停用（人工审核后启用）`);
    assert.ok(template.source?.commit, `${file} 必须登记上游 commit`);
  });
}
