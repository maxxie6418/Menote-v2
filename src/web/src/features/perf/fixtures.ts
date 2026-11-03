/**
 * 性能基线语料（FR-EDT-10 / TP4 · W0）。
 *
 * 确定性生成：同一参数永远得到同一篇文档，便于跨版本对比键入延迟与渲染耗时。
 * 刻意混入段落、标题、列表、表格、代码块、引用与图片引用，覆盖常见块型。
 */

const SENTENCES = [
  "本地优先意味着内容先落在本地，再由同步链路补齐远端副本。",
  "编辑器只负责编辑会话，持久层的真相始终是标准 Markdown。",
  "往返安全的底线是：认不出来的语法原样保存，绝不静默改写。",
  "样式与内容解耦，主题切换不应该牵动任何一处业务逻辑。",
  "附件按内容寻址存放，正文里只留相对引用与哈希。",
  "同步是增量的，冲突要留下可裁决的副本而不是悄悄覆盖。",
  "长文档的压力主要来自整篇序列化与整篇重渲染两处。",
  "诊断模式只在需要时打开，生产路径不该为测量付出代价。",
];

function paragraph(index: number): string {
  const count = 2 + (index % 3);
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) parts.push(SENTENCES[(index + i) % SENTENCES.length]!);
  return parts.join("");
}

function table(index: number): string {
  return [
    `| 指标 ${index} | 基线 | 目标 |`,
    "| --- | --- | --- |",
    `| 键入延迟 | 0 ms | < 16 ms |`,
    `| 首屏渲染 | 0 ms | < 200 ms |`,
    `| 长任务 | 0 次 | 0 次 |`,
  ].join("\n");
}

/**
 * 生成基线语料。
 * @param blocks 目标块数（一个块 = 一个段落级元素），默认 1200。
 */
export function buildBaselineFixture(blocks = 1200): string {
  const parts: string[] = [];
  for (let i = 0; i < blocks; i += 1) {
    const kind = i % 8;
    if (kind === 0) parts.push(`## 第 ${Math.floor(i / 8) + 1} 节`);
    else if (kind === 1) parts.push(`- 要点 ${i}\n- 要点 ${i + 1}\n- 要点 ${i + 2}`);
    else if (kind === 2) parts.push(`> 引用：${SENTENCES[i % SENTENCES.length]}`);
    else if (kind === 3) parts.push("```ts\nconst value = 1;\nconsole.log(value);\n```");
    else if (kind === 4) parts.push(table(i));
    else if (kind === 5) parts.push(`![示意图 ${i}](attachments/${"a".repeat(64)}--image-${i}.png)`);
    else parts.push(paragraph(i));
    parts.push("");
  }
  return parts.join("\n");
}
