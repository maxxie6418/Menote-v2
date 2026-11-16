import { test } from "node:test";
import assert from "node:assert/strict";
import { appendTags, extractTags, removeTagFromText, renameTagInText, setTagsInText, toggleTagInText } from "../src/memoTags.ts";

test("标签从正文解析：行首与行内都算，去重保序", () => {
  assert.deepEqual(extractTags("#工作 一条待办"), ["工作"]);
  assert.deepEqual(extractTags("随手记 #生活 #碎碎念 结束"), ["生活", "碎碎念"]);
  assert.deepEqual(extractTags("#工作 #工作 #生活"), ["工作", "生活"]);
});

test("Markdown 标题与 URL 锚点不算标签", () => {
  assert.deepEqual(extractTags("# 标题"), []);
  assert.deepEqual(extractTags("见 https://example.com/page#anchor"), []);
  assert.deepEqual(extractTags("邮箱 a@b.com"), []);
});

test("标签名尾部标点不计入标签", () => {
  assert.deepEqual(extractTags("今天很开心#生活。"), ["生活"]);
  assert.deepEqual(extractTags("收尾 #工作,"), ["工作"]);
});

test("补标签：正文已有的不重复，缺的补到末尾", () => {
  assert.equal(appendTags("正文 #工作", ["工作"]), "正文 #工作");
  assert.equal(appendTags("正文", ["工作", "生活"]), "正文\n\n#工作 #生活");
  assert.equal(appendTags("", ["工作"]), "#工作");
});

test("标签快捷切换：已写入则移除，未写入则追加", () => {
  assert.equal(toggleTagInText("随手记", "工作"), "随手记 #工作");
  assert.equal(toggleTagInText("随手记 #工作", "工作"), "随手记");
  assert.equal(toggleTagInText("#工作", "工作"), "");
});

test("标签改名只动正文里的那一个标签，不误伤相近标签", () => {
  assert.equal(renameTagInText("甲 #工作 乙 #工作坊", "工作", "事务"), "甲 #事务 乙 #工作坊");
  assert.equal(renameTagInText("甲 #工作。", "工作", "事务"), "甲 #事务。");
});

test("移除标签不留多余空格", () => {
  assert.equal(removeTagFromText("随手记 #工作", "工作"), "随手记");
  assert.equal(removeTagFromText("甲 #工作 乙", "工作"), "甲 乙");
  assert.equal(removeTagFromText("随手记", "工作"), "随手记");
});

test("整组替换标签：先清掉原有标签，再按新标签补到末尾", () => {
  assert.equal(setTagsInText("随手记 #工作", ["生活"]), "随手记\n\n#生活");
  assert.equal(setTagsInText("随手记", ["生活", "工作"]), "随手记\n\n#生活 #工作");
});
