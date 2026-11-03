#!/usr/bin/env node
/**
 * build-notion-theme.mjs —— 由主稿 wiki/design.html 生成 Notion 风格主题视觉稿
 *
 * 背景：Notion 风格主题要的是「同一套界面换成另一层令牌」。若另画一套，细节必然
 * 比主稿薄，且主稿一改就漂移。本脚本改用「套皮」：直接取主稿 00–13 屏的结构与
 * 内容（桌面端主稿的全部细节），再叠一层 Notion 令牌皮肤
 * （todo/20261103-TP10-Notion风格主题/20261103-TP10-Notion风格主题-皮肤层.css）。
 *
 * 做三件事：
 *   1. 从 wiki/design.html 里截出 <main class="board">…</main>（00–13 屏）。
 *   2. 外面包上 TP10 自己的稿头、开关条与追加屏（令牌对照 / 落地路径）。
 *   3. 写出 todo/20261103-TP10-Notion风格主题/20261103-TP10-Notion风格主题设计稿.html。
 *
 * 不并入主稿的外部源稿区（14–18 屏：移动端 / 资源状态页 / 原子清单 / 剪藏弹窗）——
 * 它们各有自己的令牌体系，Notion 主题本轮只覆盖桌面端，另出。
 *
 * 跑法：node draft/build-notion-theme.mjs
 * 幂等：可反复重跑覆盖输出；主稿改了，重跑即可同步。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'wiki', 'design.html');
const OUT_DIR = path.join(ROOT, 'todo', '20261103-TP10-Notion风格主题');
const OUT = path.join(OUT_DIR, '20261103-TP10-Notion风格主题设计稿.html');

const html = fs.readFileSync(SRC, 'utf8');

/* ---------- 1 · 截取主稿 00–13 屏 ---------- */
const mainStart = html.indexOf('<main class="board">');
const mainEnd = html.indexOf('</main>', mainStart);
if (mainStart < 0 || mainEnd < 0) {
  console.error('× 未能定位主稿 <main class="board">，请检查 wiki/design.html 结构');
  process.exit(1);
}
const screens = html.slice(mainStart, mainEnd + '</main>'.length);
const screenCount = (screens.match(/<section class="screen"/g) || []).length;

/* ---------- 1b · 截取主稿的屏生成脚本 ----------
   主稿的屏不是静态 HTML：<div class="shell" data-screen="…"> 是空壳，实际内容由
   design.html 末尾那段脚本（builders + 交互层 + 页面导航）现场生成。只搬 HTML 会得到
   一堆空屏，所以必须把这段脚本一起带走。 */
const scriptBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[0]);
const builderBlock = scriptBlocks.find((s) => s.includes('data-screen') && s.includes('builders'));
if (!builderBlock) {
  console.error('× 未能定位主稿的屏生成脚本，请检查 wiki/design.html 结构');
  process.exit(1);
}

/* ---------- 2 · TP10 自己的稿头与追加屏 ---------- */
const HEAD = `
  <header class="board-head">
    <div class="kicker">Menote V2 · TP10 · Notion 风格主题视觉稿 · 2026-11-03</div>
    <h1>Notion 风格主题 · 候选视觉稿</h1>
    <p>这套稿子不是另画的。主稿 <code>wiki/design.html</code> 的 00–13 屏（桌面端全部细节：组件状态、滚动条、空状态、网格、锁定态、Memo 渲染样式）原样搬过来，只把令牌换成一套 Notion 的中性灰阶——因此每一屏的细节都和主稿一致，主稿改了重跑脚本就同步。</p>
    <p><b>怎么用</b>：右上角 <b>配色</b> 切 <b>Menote 橙</b> / <b>Notion</b>，同一批屏立刻换肤；<b>稿面</b> 切浅色 / 深色，只影响你读这份稿子的环境，不动屏内的浅深两版。</p>
    <p><b>覆盖</b>：主稿 00–13 全部 14 屏（桌面端）。主稿文末的外部源稿区（14–18：移动端、资源状态页、原子清单、剪藏扩展弹窗）各有自己的令牌体系，本轮不并入，移动端需另出一版。</p>
    <p><b>边界</b>：本稿<b>不改</b>任何定稿文件。<code>DESIGN.md</code> §1.3 现有表述「不复制 Notion 的中性色」与本稿方向相反，已在第 15 屏与任务包文档中登记，等你裁定后再决定是否改稿。</p>
    <p><b>一处读法提醒</b>：00–13 屏的说明文字是<b>主稿原文</b>，写的是橙主题口径（圆角 10、按钮深字、橙下划线等）。Notion 主题下这些数值会变，逐条对照见<b>第 14 屏下半（14b）「文案口径对照」</b>——画面以本页为准，说明文字以对照表为准。</p>
  </header>
`;

const EXTRA = `
  <section class="screen" id="tp14">
    <div class="screen-head"><span class="n">14</span><h2>令牌对照</h2><span class="desc">Notion 主题 vs 现有橙主题 · 变量名完全相同，只换值</span></div>
    <div class="tbl">
      <table class="cmp">
        <thead><tr><th>角色</th><th>令牌</th><th>Notion 浅</th><th>Notion 深</th><th>橙主题浅</th><th>差在哪</th></tr></thead>
        <tbody>
          <tr><td>纸面</td><td class="mono">--app-surface</td><td class="mono">#FFFFFF</td><td class="mono">#191919</td><td class="mono">#FFFFFF</td><td>深色从冷灰改暖灰</td></tr>
          <tr><td>侧栏底</td><td class="mono">--app-bg-side</td><td class="mono">#F7F7F5</td><td class="mono">#202020</td><td class="mono">#F1F1EE</td><td>更浅更灰，差靠体感不靠色差</td></tr>
          <tr><td>选中</td><td class="mono">--app-selected</td><td class="mono">#EDEBE9</td><td class="mono">#2C2C2C</td><td class="mono">#FEF6EE</td><td>淡橙底 → 中性灰底</td></tr>
          <tr><td>悬停</td><td class="mono">--app-hover</td><td class="mono">#F1F1EF</td><td class="mono">#2C2C2C</td><td class="mono">#F6F6F4</td><td>同上</td></tr>
          <tr><td>结构线</td><td class="mono">--app-border</td><td class="mono">#E9E8E5</td><td class="mono">#383838</td><td class="mono">#E6E6E3</td><td>冷灰 → 暖灰</td></tr>
          <tr><td>前景</td><td class="mono">--app-fg</td><td class="mono">#37352F</td><td class="mono">#E9E9E7</td><td class="mono">#1A1A18</td><td>冷黑 → 暖黑</td></tr>
          <tr><td>次级文字</td><td class="mono">--app-fg-muted</td><td class="mono">#6B6A65</td><td class="mono">#B4B3AE</td><td class="mono">#4E504D</td><td>5.45:1 / 7.99:1</td></tr>
          <tr><td>辅助文字</td><td class="mono">--app-fg-subtle</td><td class="mono">#86857F</td><td class="mono">#9D9C99</td><td class="mono">#6C6F6B</td><td>4.03:1 / 5.99:1</td></tr>
          <tr><td>元信息</td><td class="mono">--app-fg-faint</td><td class="mono">#86857F</td><td class="mono">#9D9C99</td><td class="mono">#74776F</td><td>与辅助同值（见下方说明）</td></tr>
          <tr><td>强调</td><td class="mono">--app-accent</td><td class="mono">#2383E2</td><td class="mono">#529CCA</td><td class="mono">#F6821F</td><td>橙 → 蓝（主操作）</td></tr>
          <tr><td>品牌</td><td class="mono">--app-brand</td><td class="mono">#F6821F</td><td class="mono">#F6821F</td><td class="mono">—</td><td>新增令牌，仅 logo 使用</td></tr>
          <tr><td>链接</td><td class="mono">--app-link</td><td class="mono">#1B6FD1</td><td class="mono">#529CCA</td><td class="mono">#0051C3</td><td>Notion 原蓝作正文仅 4.19:1，故压深</td></tr>
          <tr><td>强调浅底</td><td class="mono">--app-accent-subtle</td><td class="mono">#E7F3F8</td><td class="mono">#1E3A4A</td><td class="mono">#FEF2E7</td><td>浅橙 → 浅蓝</td></tr>
          <tr><td>圆角</td><td class="mono">--app-radius-*</td><td class="mono">4 / 6 / 8 / 12</td><td class="mono">同左</td><td class="mono">10 / 14 / 16 / 20</td><td>Notion 控件更方</td></tr>
          <tr><td>版心</td><td class="mono">--app-doc-measure</td><td class="mono">46rem</td><td class="mono">同左</td><td class="mono">42rem</td><td>16px 字号下每行约 46 个汉字</td></tr>
        </tbody>
      </table>
    </div>
    <div class="mn-ledger">
      <div class="it"><div class="chip" style="background:#FFFFFF"></div><div class="tx"><span class="n">纸面</span><span class="v">#FFFFFF</span></div></div>
      <div class="it"><div class="chip" style="background:#F7F7F5"></div><div class="tx"><span class="n">侧栏底</span><span class="v">#F7F7F5</span></div></div>
      <div class="it"><div class="chip" style="background:#EDEBE9"></div><div class="tx"><span class="n">选中</span><span class="v">#EDEBE9</span></div></div>
      <div class="it"><div class="chip" style="background:#37352F"></div><div class="tx"><span class="n">前景</span><span class="v">#37352F</span></div></div>
      <div class="it"><div class="chip" style="background:#6B6A65"></div><div class="tx"><span class="n">次级</span><span class="v">#6B6A65</span></div></div>
      <div class="it"><div class="chip" style="background:#86857F"></div><div class="tx"><span class="n">辅助</span><span class="v">#86857F</span></div></div>
      <div class="it"><div class="chip" style="background:#E9E8E5"></div><div class="tx"><span class="n">结构线</span><span class="v">#E9E8E5</span></div></div>
      <div class="it"><div class="chip" style="background:#2383E2"></div><div class="tx"><span class="n">强调蓝</span><span class="v">#2383E2</span></div></div>
      <div class="it"><div class="chip" style="background:#F6821F"></div><div class="tx"><span class="n">品牌橙</span><span class="v">#F6821F</span></div></div>
    </div>
    <div class="notes">
      <div><b>变量名一个都没改</b>：这是本稿最重要的结论。落地时只需在 <span class="mono">tokens.css</span> 增加 <span class="mono">[data-theme="notion-light"]</span> 与 <span class="mono">[data-theme="notion-dark"]</span> 两个作用域，组件代码零改动。</div>
      <div><b>文字档位从四档减到三档</b>：暖灰上排不出四档且全部 ≥ AA（<span class="mono">DESIGN.md</span> §2.4 已断过这个上限）。<span class="mono">--app-fg-faint</span> 与 <span class="mono">--app-fg-subtle</span> 同值，token 名保留兼容现有组件。</div>
      <div><b>新增令牌只有一个</b>：<span class="mono">--app-brand</span>，承载品牌橙。现状里 brand 与 accent 同色，拆开后「品牌色」与「主操作色」才解耦。</div>
      <div><b>Notion 原蓝不作正文色</b>：<span class="mono">#2383E2</span> 在白底上作正文只有 4.19:1，达不到 AA；链接取 <span class="mono">#1B6FD1</span>（4.96:1），主按钮底取 <span class="mono">#1F6FEB</span>（白字 4.65:1）。</div>
    </div>

    <div class="screen-head" style="margin-top:34px"><span class="n">14b</span><h2>文案口径对照</h2><span class="desc">00–13 屏的说明文字是主稿原文（橙主题口径）· 以下逐条给出 Notion 主题下的对应值</span></div>
    <div class="tbl">
      <table class="cmp">
        <thead><tr><th>屏</th><th>主稿原文（橙主题口径）</th><th>Notion 主题口径</th></tr></thead>
        <tbody>
          <tr><td>00</td><td>文字标签 + 底部 2px <b>橙</b>下划线</td><td>形状不变，2px <b>蓝</b>下划线（<span class="mono">--app-accent</span>）</td></tr>
          <tr><td>00</td><td>全屏唯一<b>橙色</b>实心块（新建笔记）</td><td>全屏唯一<b>蓝色</b>实心块；品牌橙退到 logo（<span class="mono">--app-brand</span>）</td></tr>
          <tr><td>00</td><td>选中是<b>淡橙底</b>浮起，不带色条</td><td>选中是<b>中性灰底</b> <span class="mono">#EDEBE9</span> 浮起；「不带色条」这条不变</td></tr>
          <tr><td>00</td><td>类型标签 + <b>36px</b> 无衬线标题</td><td><b>38px / 700</b>（Notion 的页面标题是主角）</td></tr>
          <tr><td>00</td><td>主入口加<b>橙</b>点</td><td>加<b>蓝</b>点</td></tr>
          <tr><td>01</td><td>视图切换改成文字标签 + <b>橙</b>下划线</td><td>换<b>蓝</b>下划线</td></tr>
          <tr><td>01</td><td>清单是白底，<b>淡橙底</b>才看得见</td><td>清单是白底，<b>中性灰底</b> <span class="mono">#EDEBE9</span> 看得见</td></tr>
          <tr><td>01</td><td>计数只给收件箱上<b>橙</b></td><td>只给收件箱上<b>蓝</b>（强调色的职责不变，只是换色）</td></tr>
          <tr><td>11</td><td>高度 32 / <b>圆角 10</b> / 主色按钮用<b>深字</b>（7.2:1）</td><td>高度 32 / <b>圆角 4</b> / 蓝底<b>白字</b>（4.65:1）</td></tr>
          <tr><td>11</td><td>焦点环 3px <b>橙</b> 14%</td><td>焦点环 3px <b>蓝</b> 35%（机制同源，换色）</td></tr>
          <tr><td>11</td><td>状态胶囊 / 标签胶囊 999 圆角</td><td>不变</td></tr>
          <tr><td>13</td><td>滑块 6px，对纸面 <b>1.88:1</b>（深色）</td><td>暖灰纸面：常态 <b>1.94:1</b>、悬停 <b>3.05:1</b>（深色）；浅色常态 1.75:1 / 悬停 3.33:1</td></tr>
          <tr><td>13</td><td>不与<b>橙色</b>争</td><td>不与<b>强调色</b>争（滚动条只用中性灰）</td></tr>
          <tr><td>稿面</td><td>正文 15px / 1.88（主稿稿面口径）</td><td>正文 <b>16px / 1.58</b>，正文色取前景色</td></tr>
        </tbody>
      </table>
    </div>
    <div class="notes">
      <div><b>为什么留着主稿原文</b>：改稿就改坏了——主稿是权威稿，Notion 主题只是并列候选。这里保留原文并给出对照，读的时候以画面为准。</div>
      <div><b>落地时这些文案要跟着改</b>：若 Notion 主题定为正式主题，<span class="mono">DESIGN.md</span> 与主稿中这些数值表述需要同步修订，否则文档与实现会互相矛盾。</div>
    </div>
  </section>

  <section class="screen" id="tp15">
    <div class="screen-head"><span class="n">15</span><h2>落地路径</h2><span class="desc">若裁定采纳，四步从零组件改动到可选主题</span></div>
    <div class="mn-paths">
      <div class="mn-path">
        <div class="step">第 1 步 · 令牌层</div>
        <div class="how"><code>tokens.css</code> 新增 <code>[data-theme="notion-light"]</code> / <code>[data-theme="notion-dark"]</code> 两个作用域，只写 <code>--app-*</code> 取值</div>
        <div class="cost">零组件改动</div>
      </div>
      <div class="mn-path">
        <div class="step">第 2 步 · 排版层</div>
        <div class="how">正文与标题字号行高改走 <code>--md-*</code>（设置·样式已支持改写），组件字号沿用 <code>--app-size-*</code></div>
        <div class="cost">仅正文渲染</div>
      </div>
      <div class="mn-path">
        <div class="step">第 3 步 · 组件层</div>
        <div class="how">按钮去材质、圆角档位调整、状态色成色改蓝；视图切换已是文字页签（主稿现状），无需改结构</div>
        <div class="cost">逐组件过一遍</div>
      </div>
      <div class="mn-path">
        <div class="step">第 4 步 · 入口层</div>
        <div class="how">设置·外观 增加「主题」一档：Menote 橙 / Notion，写入 <code>data-theme</code>，与现有深浅切换并存</div>
        <div class="cost">账户菜单 + 设置页</div>
      </div>
    </div>
    <div class="callout">
      <b>待你裁定（三条）</b>：①<code>DESIGN.md</code> §1.3 写着「不复制 Notion 的中性色」，本稿方向与之相反——是否改稿？②主操作色在 Notion 主题下换成蓝、品牌橙退到 logo，是否接受？③本主题把「四种选中必须区分」（§4.2）收敛成两种（区域选中统一灰底，控件族靠阴影与下划线），是否同步修订该节？
    </div>
    <div class="notes">
      <div><b>本轮不动任何定稿文件</b>：<span class="mono">DESIGN.md</span>、需求说明书、主文档与 <span class="mono">src/</span> 下的实现都未改动，只出稿与登记。</div>
      <div><b>移动端未覆盖</b>：主稿文末的外部源稿区（14–18 屏）本轮不并入，各有自己的令牌体系；移动端需单独出一版。</div>
      <div><b>对比度为手算</b>：按 sRGB 相对亮度公式核算，实现阶段需用取色器复核一遍深浅两版。</div>
    </div>
  </section>
`;

const TOGGLE = `
  <div class="mn-toggle" role="group" aria-label="主题切换">
    <span class="lbl">配色</span>
    <button type="button" data-skin="menote">Menote 橙</button>
    <button type="button" data-skin="notion">Notion</button>
    <span class="sep"></span>
    <span class="lbl">稿面</span>
    <button type="button" data-mode="light">浅</button>
    <button type="button" data-mode="dark">深</button>
  </div>
`;

const SCRIPT = `
  <script>
  (function () {
    var SKIN = 'mn.notion.skin', MODE = 'mn.notion.mode';
    var root = document.documentElement;
    var skin = 'notion', mode = 'light';
    try {
      skin = localStorage.getItem(SKIN) || skin;
      mode = localStorage.getItem(MODE) || mode;
    } catch (e) {}
    root.setAttribute('data-skin', skin);
    root.setAttribute('data-mode', mode);

    function sync(btn) {
      var k = btn.getAttribute('data-skin') ? 'skin' : 'mode';
      var v = btn.getAttribute('data-' + k);
      root.setAttribute('data-' + k, v);
      try { localStorage.setItem(k === 'skin' ? SKIN : MODE, v); } catch (e) {}
      var all = document.querySelectorAll('.mn-toggle button');
      for (var i = 0; i < all.length; i++) {
        var kk = all[i].getAttribute('data-skin') ? 'skin' : 'mode';
        all[i].classList.toggle('on', all[i].getAttribute('data-' + kk) === root.getAttribute('data-' + kk));
      }
    }
    var btns = document.querySelectorAll('.mn-toggle button');
    for (var i = 0; i < btns.length; i++) {
      (function (b) { b.addEventListener('click', function () { sync(b); }); })(btns[i]);
    }
    var all = btns;
    for (var j = 0; j < all.length; j++) {
      var kk = all[j].getAttribute('data-skin') ? 'skin' : 'mode';
      all[j].classList.toggle('on', all[j].getAttribute('data-' + kk) === root.getAttribute('data-' + kk));
    }
  })();
  </script>
`;

/* ---------- 3 · 组装输出 ---------- */
const out = `<!DOCTYPE html>
<html lang="zh-CN" data-skin="notion" data-mode="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Menote V2 · Notion 风格主题视觉稿</title>
<link rel="stylesheet" href="../../wiki/assets/base.css">
<link rel="stylesheet" href="20261103-TP10-Notion风格主题-皮肤层.css">
<script>
/* 首屏前落主题，避免闪一版默认色（与 src/web/index.html 引导脚本同思路） */
(function () {
  try {
    document.documentElement.setAttribute('data-skin', localStorage.getItem('mn.notion.skin') || 'notion');
    document.documentElement.setAttribute('data-mode', localStorage.getItem('mn.notion.mode') || 'light');
  } catch (e) {}
})();
</script>
</head>
<body>
${TOGGLE}
<div class="src src--main">
${HEAD}
${screens}
${EXTRA}
</div>
${builderBlock}
${SCRIPT}
</body>
</html>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, out, 'utf8');
console.log(`✓ 已生成 Notion 主题视觉稿：${path.relative(ROOT, OUT)}`);
console.log(`  取自主稿 ${screenCount} 屏（00–13），另加 TP10 追加屏 14 / 15`);
