#!/usr/bin/env node
/**
 * build-design.mjs —— 把 wiki/ 下的正式视觉稿汇总进 wiki/design.html
 *
 * 背景：design.html 是设计主稿，但移动端（mobile.html）、资源状态页
 * （monitor.html / monitor-desktop.html）、原子清单（atomic.html）各成一篇，
 * 负责人要在 design.html 一处看全。本脚本做三件事：
 *
 *   1. 把 design.html 自身的 <style> 抽到 wiki/assets/base.css，
 *      并把主稿内容包进 .src--main 作用域（样式不再外溢到汇总区）。
 *   2. 把四篇源稿的 <style> 抽出、按各自分区作用域化，写到
 *      wiki/assets/{mobile,monitor,monitor-desktop,atomic}.css。
 *   3. 把四篇源稿的正文抽成片段，生成 design.html 末尾的汇总区
 *      （AGG:START / AGG:END 标记之间），可反复重跑覆盖。
 *
 * 跑法：node draft/build-design.mjs
 * 幂等：重复执行不会重复插入汇总区。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIKI = path.join(ROOT, 'wiki');
const ASSETS = path.join(WIKI, 'assets');

const AGG_START = '<!-- AGG:START -->';
const AGG_END = '<!-- AGG:END -->';

/* ============================================================
   一、CSS 解析（够用即可：只处理规则 / @media / @supports）
   ============================================================ */

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseCss(css) {
  const s = stripComments(css);
  let i = 0;
  const nodes = [];
  const CONDITIONAL = new Set(['media', 'supports', 'container', 'layer', 'document']);

  function readBlock() {
    // 调用时 s[i] === '{'，返回花括号内部原文
    let depth = 0;
    const st = i;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '"' || ch === "'") {
        const q = ch;
        i++;
        while (i < s.length && s[i] !== q) {
          if (s[i] === '\\') i++;
          i++;
        }
        i++;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const body = s.slice(st + 1, i);
          i++;
          return body;
        }
      }
      i++;
    }
    return s.slice(st + 1);
  }

  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;

    if (s[i] === '@') {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z-]/.test(s[j])) j++;
      const name = s.slice(i + 1, j).toLowerCase();
      let k = j;
      let quote = null;
      while (k < s.length) {
        const ch = s[k];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === '(') {
          let depth = 0;
          while (k < s.length) {
            if (s[k] === '(') depth++;
            else if (s[k] === ')') {
              depth--;
              if (depth === 0) {
                k++;
                break;
              }
            }
            k++;
          }
          continue;
        } else if (ch === '{' || ch === ';') {
          break;
        }
        k++;
      }
      const prelude = s.slice(j, k).trim();
      if (s[k] === '{') {
        i = k;
        const body = readBlock();
        if (CONDITIONAL.has(name)) nodes.push({ type: 'at', name, prelude, nodes: parseCss(body) });
        else nodes.push({ type: 'at', name, prelude, raw: body });
      } else {
        i = k + 1;
        nodes.push({ type: 'at', name, prelude, raw: null });
      }
      continue;
    }

    // 普通规则
    let k = i;
    let quote = null;
    while (k < s.length) {
      const ch = s[k];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '{') {
        break;
      }
      k++;
    }
    const sel = s.slice(i, k).trim();
    i = k;
    const body = readBlock();
    nodes.push({ type: 'rule', sel, body });
  }
  return nodes;
}

function serialize(nodes) {
  return nodes
    .map((n) => {
      if (n.type === 'rule') return `${n.sel}{${n.body}}`;
      const head = `@${n.name}${n.prelude ? ' ' + n.prelude : ''}`;
      if (n.nodes) return `${head}{${serialize(n.nodes)}}`;
      if (n.raw !== null && n.raw !== undefined) return `${head}{${n.raw}}`;
      return `${head};`;
    })
    .join('\n');
}

/* ============================================================
   二、作用域化
   ============================================================ */

const ROOT_TOKEN = /(^|[\s>+~])(html|body|:root)(?=[.#:[\s>+~]|$)/g;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把选择器挂到分区作用域下。
 *   :root / html / body  → 作用域类本身（令牌与根样式落在分区容器上）
 *   其它选择器           → 作用域类前缀 + 空格
 */
function scopeSelector(sel, scope) {
  let s = sel.replace(ROOT_TOKEN, (m, p) => p + scope);
  const esc = escapeRe(scope);
  let prev;
  do {
    prev = s;
    s = s.replace(new RegExp(`${esc}\\s*[>+~]?\\s*${esc}`, 'g'), scope);
  } while (s !== prev);
  if (!s.includes(scope)) s = `${scope} ${s}`;
  return s;
}

function scopeNodes(nodes, scope, keepGlobal) {
  return nodes.map((n) => {
    if (n.type === 'rule') {
      if (keepGlobal && keepGlobal(n.sel)) return n;
      return { type: 'rule', sel: scopeSelector(n.sel, scope), body: n.body };
    }
    if (n.nodes) return { type: 'at', name: n.name, prelude: n.prelude, nodes: scopeNodes(n.nodes, scope, keepGlobal) };
    return n;
  });
}

function scopeCss(css, scope, keepGlobal) {
  return serialize(scopeNodes(parseCss(css), scope, keepGlobal));
}

/* 主稿的全局例外：页面级规则不能被分区作用域吃掉 */
const BASE_KEEP_GLOBAL = (sel) =>
  /pagenav/.test(sel) ||
  /scrollbar/.test(sel) ||
  sel === 'body' ||
  sel === 'html' ||
  sel === '*' ||
  sel === ':root';

/* ============================================================
   三、抽文档
   ============================================================ */

function read(file) {
  return fs.readFileSync(path.join(WIKI, file), 'utf8');
}

function extractStyle(html) {
  const m = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  return m ? m[1] : '';
}

function extractBody(html) {
  const start = html.indexOf('<body');
  const from = html.indexOf('>', start) + 1;
  const end = html.lastIndexOf('</body>');
  return html.slice(from, end);
}

function stripScripts(markup) {
  return markup.replace(/<script[\s\S]*?<\/script>/g, '');
}

/* ============================================================
   四、汇总区
   ============================================================ */

/**
 * 每一篇源稿 → 一个汇总屏。scope 是该屏的 CSS 作用域类。
 */
const SOURCES = [
  {
    file: 'mobile.html',
    scope: '.src--mobile',
    css: 'mobile.css',
    n: '14',
    title: '移动端设计',
    desc: '来源 wiki/mobile.html（v0.1）· 10 屏 + 规则速查',
    note:
      '<b>为什么在这里</b>：移动端与桌面端是同一套令牌下的两套栅格，' +
      '拆成两篇容易让两端各自漂移。此处保留原文字段与规则表，' +
      '源文件仍是该主题的权威稿（<a href="mobile.html">wiki/mobile.html</a>）。',
    transform: (m) => m,
  },
  {
    file: 'monitor.html',
    scope: '.src--monitor',
    css: 'monitor.css',
    n: '15',
    title: '资源状态页 · 移动端',
    desc: '来源 wiki/monitor.html（方案 v0.1）· 3 屏 + 接口核对表',
    note:
      '<b>口径</b>：配额拿不到、成本每日更新，所以这页是「用量 + 估算 + 滞后声明」，' +
      '不是实时仪表盘。原稿的接口核对表一并保留（' +
      '<a href="monitor.html">wiki/monitor.html</a>）。',
    transform: (m) => m,
  },
  {
    file: 'monitor-desktop.html',
    scope: '.src--monitor-desktop',
    css: 'monitor-desktop.css',
    n: '16',
    title: '资源状态页 · 桌面端',
    desc: '来源 wiki/monitor-desktop.html（v0.1）· 1360×792 单屏',
    note:
      '<b>同一套信息，横向展开</b>：四张卡一行、趋势与明细并排、设置条沉底；' +
      '数据口径与移动版完全一致（<a href="monitor-desktop.html">wiki/monitor-desktop.html</a>）。',
    transform: (m) => m,
  },
  {
    file: 'atomic.html',
    scope: '.src--atomic',
    css: 'atomic.css',
    n: '17',
    title: '原子设计清单',
    desc: '来源 wiki/atomic.html（v2）· Tokens → Atoms → Molecules → Organisms → Templates → Pages',
    note:
      '<b>控件都是真渲染</b>：原子层直接用令牌拼出来，不是示意图；' +
      '归属判定一节回答「新组件往哪放」。原稿见 <a href="atomic.html">wiki/atomic.html</a>。',
    transform: (m) => m.replace(/<main class="board">/g, '<div class="board">').replace(/<\/main>/g, '</div>'),
  },
  {
    /* 剪藏扩展是独立仓（Menote-clients/browser-extension），视觉稿在 todo/ 下，
       不在 wiki/ —— 本轮作为第 18 屏并入，源稿仍是权威稿。
       id 前缀：源稿的 s1–s5 / i-* 会和主稿的 s0–s13 / 图标 sprite 撞名。 */
    file: '../todo/20261101-TP3-浏览器剪藏插件/20261102-TP3-弹窗界面设计稿.html',
    scope: '.src--clip',
    css: 'clip.css',
    n: '18',
    id: 'clip',
    title: '剪藏扩展 · 浏览器插件弹窗',
    desc: '来源 todo/20261101-TP3-浏览器剪藏插件/20261102-TP3-弹窗界面设计稿.html（v0.1.17）· 5 屏',
    note:
      '<b>为什么在这里</b>：剪藏扩展是独立仓（<code>Menote-clients/browser-extension</code>），' +
      '有自己的深浅令牌与 360×560 弹窗规格，不并进主稿的令牌体系。' +
      '此处保留原视觉稿五屏（主界面／设置页／独立预览页／工具栏角标／交互与状态），' +
      '站点规则折叠区是原生 <code>&lt;details&gt;</code>，可直接展开。' +
      '原稿见 <a href="../todo/20261101-TP3-浏览器剪藏插件/20261102-TP3-弹窗界面设计稿.html">todo/…/20261102-TP3-弹窗界面设计稿.html</a>。',
    /* 源稿用 :root[data-theme] 切换令牌：映射成作用域类，汇总区的「深色令牌」按钮直接驱动 */
    cssPre: (css) =>
      css
        .replace(/:root\[data-theme="dark"\]/g, ':root.s-dark')
        .replace(/:root\[data-theme="light"\]/g, ':root')
        /* 页面级装饰：顶部光晕是 fixed，进了分区会盖住整屏 */
        .replace(/body::before\s*\{[^}]*\}/g, '')
        /* 顶部条是 sticky，进了分区会顶在视口上、压在预览导航下面 */
        .replace(/position:\s*sticky/g, 'position:static'),
    idPrefix: 'c',
    transform: (m) =>
      m
        /* 源稿自己的亮暗切换按钮由汇总区的统一控制条接手 */
        .replace(/<button class="theme-btn"[\s\S]*?<\/button>/, '')
        .replace(/<span id="themeLabel">[\s\S]*?<\/span>/, ''),
  },
];

/* 源稿里的深浅色 / 结构标注按钮：改成 data-act，由汇总脚本统一接管 */
function normalizeControls(markup) {
  return markup
    .replace(/id="theme"/g, 'data-act="dark"')
    .replace(/id="struct"/g, 'data-act="struct"');
}

/* 源稿里的 id 会和主稿撞名（s1–s5、i-* 等）：统一加前缀，同时改掉页内引用 */
function prefixIds(markup, prefix) {
  if (!prefix) return markup;
  return markup
    .replace(/\bid="([^"]+)"/g, (m, id) => `id="${prefix}${id}"`)
    .replace(/\bhref="#([^"]+)"/g, (m, id) => `href="#${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (m, id) => `url(#${prefix}${id})`);
}

function buildAggregate() {
  const chunks = [];
  for (const src of SOURCES) {
    const html = read(src.file);
    const rawCss = extractStyle(html);
    const css = scopeCss(src.cssPre ? src.cssPre(rawCss) : rawCss, src.scope);
    fs.writeFileSync(path.join(ASSETS, src.css), css.trim() + '\n', 'utf8');

    let body = stripScripts(extractBody(html)).trim();
    body = normalizeControls(src.transform(body));
    body = prefixIds(body, src.idPrefix);

    /* 源稿没自带切换按钮、且源稿确实定义了深色令牌集的（剪藏稿），由汇总区补一条统一控制条 */
    const hasDarkTokens = css.includes(`${src.scope}.s-dark`);
    const controls =
      body.includes('data-act="dark"') || !hasDarkTokens
        ? ''
        : [
            '  <div class="agg-controls">',
            '    <button class="ctrl" data-act="dark" aria-pressed="false"><span class="led"></span>深色令牌</button>',
            '  </div>',
          ].join('\n');

    const sid = src.id || src.file.replace('.html', '');
    chunks.push(
      [
        `<section class="screen agg ${src.scope.slice(1)}" id="agg-${sid}">`,
        `  <div class="screen-head"><span class="n">${src.n}</span><h2>${src.title}</h2><span class="desc">${src.desc}</span></div>`,
        `  <div class="agg-note">${src.note}</div>`,
        controls,
        `  <div class="agg-body">`,
        body,
        `  </div>`,
        `</section>`,
      ].join('\n')
    );
  }

  const toc = [
    '<div class="agg-toc">',
    '  <div class="kicker">Menote V2 · 视觉稿汇总</div>',
    '  <h2>外部视觉稿汇总区</h2>',
    `  <p>下面 ${SOURCES.length} 屏是各主题正式稿的最终版，内容与源文件一致，由 <code>draft/build-design.mjs</code> 从源稿同步生成——改内容请改源稿后重跑脚本，不要直接改这里。</p>`,
    '  <p>各主题源稿仍是该主题的权威稿：移动端 <a href="mobile.html">mobile.html</a>、资源状态页 <a href="monitor.html">monitor.html</a> / <a href="monitor-desktop.html">monitor-desktop.html</a>、原子清单 <a href="atomic.html">atomic.html</a>、剪藏扩展 <a href="../todo/20261101-TP3-浏览器剪藏插件/20261102-TP3-弹窗界面设计稿.html">TP3 弹窗界面设计稿</a>；令牌与交互不变式仍以 <a href="../DESIGN.md">DESIGN.md</a> 为准。</p>',
    '  <div class="agg-list">',
    ...SOURCES.map(
      (s) => `    <a href="#agg-${s.id || s.file.replace('.html', '')}"><b>${s.n}</b>${s.title}<span>${s.file.replace('../todo/20261101-TP3-浏览器剪藏插件/', 'todo/…/')}</span></a>`
    ),
    '  </div>',
    '</div>',
  ].join('\n');

  return [toc, ...chunks].join('\n\n');
}

/* ============================================================
   五、主稿改造
   ============================================================ */

const LINK_BLOCK = [
  '<link rel="stylesheet" href="assets/base.css">',
  '<link rel="stylesheet" href="assets/mobile.css">',
  '<link rel="stylesheet" href="assets/monitor.css">',
  '<link rel="stylesheet" href="assets/monitor-desktop.css">',
  '<link rel="stylesheet" href="assets/atomic.css">',
  '<link rel="stylesheet" href="assets/clip.css">',
  '<link rel="stylesheet" href="assets/agg.css">',
].join('\n  ');

function migrateBase(html) {
  // 1. <style> → assets/base.css
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  if (styleMatch) {
    const scoped = scopeCss(styleMatch[1], '.src--main', BASE_KEEP_GLOBAL);
    fs.writeFileSync(path.join(ASSETS, 'base.css'), scoped.trim() + '\n', 'utf8');
    html = html.replace(styleMatch[0], LINK_BLOCK);
  } else {
    // 已有外链：按固定顺序重排（agg.css 必须最后，压住源稿样式）
    const linkRe = /(?:[ \t]*<link rel="stylesheet" href="assets\/[a-z-]+\.css">\r?\n?)+/g;
    if (linkRe.test(html)) {
      html = html.replace(linkRe, LINK_BLOCK + '\n');
    } else if (!html.includes('assets/base.css')) {
      html = html.replace(/<title>[\s\S]*?<\/title>/, (m) => `${m}\n  ${LINK_BLOCK}`);
    }
  }

  // 2. 主稿内容包进 .src--main
  if (!html.includes('class="src src--main"')) {
    const from = html.indexOf('<header class="board-head">');
    const to = html.indexOf('</main>');
    if (from !== -1 && to !== -1) {
      const head = html.slice(0, from);
      const body = html.slice(from, to + '</main>'.length);
      const tail = html.slice(to + '</main>'.length);
      html = `${head}<div class="src src--main">\n${body}\n</div>${tail}`;
    }
  }

  // 3. 浮动导航只收顶层屏：源稿内部也有 .screen（figure），必须排除
  html = html.replace(
    "document.querySelectorAll('.screen')",
    "document.querySelectorAll('section.screen')"
  );
  return html;
}

function mergeAggregate(html) {
  const block = `${AGG_START}\n${buildAggregate()}\n${AGG_END}`;
  const start = html.indexOf(AGG_START);
  const end = html.indexOf(AGG_END);
  if (start !== -1 && end !== -1) {
    return html.slice(0, start) + block + html.slice(end + AGG_END.length);
  }
  // 汇总区放在主稿作用域（.src--main）之外：主稿样式不外溢，源稿样式也不外溢
  const mainEnd = html.indexOf('</main>');
  if (mainEnd === -1) throw new Error('design.html 里找不到 </main>，汇总区无法插入');
  const wrapperEnd = html.indexOf('</div>', mainEnd);
  const at = wrapperEnd === -1 ? mainEnd : wrapperEnd + '</div>'.length;
  return html.slice(0, at) + `\n\n${block}\n` + html.slice(at);
}

/* ============================================================
   六、汇总区的统一交互（深浅令牌 / 结构标注）
   ============================================================ */

const AGG_SCRIPT = `
<!-- 汇总区交互：深浅令牌 / 结构标注（作用于所在分区，不影响主稿） -->
<script>
(function(){
  document.querySelectorAll('.agg [data-act]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var host = btn.closest('.agg');
      var cls = btn.getAttribute('data-act') === 'dark' ? 's-dark' : 'struct';
      var on = host.classList.toggle(cls);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  });
})();
</script>`;

function appendAggScript(html) {
  if (html.includes('汇总区交互')) return html;
  const at = html.lastIndexOf('</body>');
  return html.slice(0, at) + AGG_SCRIPT + '\n' + html.slice(at);
}

/* ============================================================
   七、主入口
   ============================================================ */

function main() {
  fs.mkdirSync(ASSETS, { recursive: true });

  let html = read('design.html');
  html = migrateBase(html);
  html = mergeAggregate(html);
  html = appendAggScript(html);
  fs.writeFileSync(path.join(WIKI, 'design.html'), html, 'utf8');

  console.log('✓ wiki/design.html 已更新');
  for (const src of SOURCES) console.log(`✓ wiki/assets/${src.css}`);
  console.log('✓ wiki/assets/base.css');
}

main();
