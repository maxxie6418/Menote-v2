const root = document.documentElement;
const app = document.getElementById('app');
const panelStack = document.getElementById('panelStack');

/* Memo 卡片的互动行与内联面板：评论线程与引述就地展开，不弹窗、不切页。
   评论面板覆盖「新增 / 回复 / 编辑 / 删除 / 排序 / 空态」，引述面板覆盖「快照 + 理由 + 可见性」，
   面板结构从首条明文 Memo 克隆给其余卡片，保证每张卡片都有同一套入口。 */
function clampTextarea(el, max) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, max) + 'px';
}

function initMemoCard(card) {
  const bar = card.querySelector('.memo-social');
  const thread = card.querySelector('[data-memo-inline="comments"]');
  const quote = card.querySelector('[data-memo-inline="quote"]');
  if (!bar || !thread || !quote) return;

  const list = thread.querySelector('.mt-list');
  const empty = thread.querySelector('.mt-empty');
  const total = thread.querySelector('[data-comment-total]');
  const badge = bar.querySelector('[data-comment-badge]');
  const form = thread.querySelector('[data-mt-form]');
  const input = thread.querySelector('.mt-input');
  const counter = thread.querySelector('.mt-counter b');
  const send = thread.querySelector('.mt-send');
  const chip = thread.querySelector('.mt-reply-chip');
  const chipName = chip ? chip.querySelector('b') : null;
  const panels = { comments: thread, quote: quote };
  let replyTarget = null;

  function syncCount() {
    const n = thread.querySelectorAll('.mt-comment').length;
    if (total) total.textContent = String(n);
    if (badge) {
      badge.textContent = String(n);
      badge.hidden = n === 0;
    }
    if (empty) empty.hidden = n > 0;
  }
  function setExpanded(name, open) {
    bar.querySelector('[data-memo-panel="' + name + '"]')?.setAttribute('aria-expanded', String(open));
  }
  function closePanel(panel) {
    if (!panel) return;
    panel.hidden = true;
    setExpanded(panel.dataset.memoInline, false);
  }
  function clearReply() {
    replyTarget = null;
    if (chip) chip.hidden = true;
  }
  syncCount();

  bar.querySelectorAll('[data-memo-panel]').forEach(button => {
    button.addEventListener('click', () => {
      const panel = panels[button.dataset.memoPanel];
      if (!panel) return;
      const opening = panel.hidden;
      Object.values(panels).forEach(closePanel);
      if (!opening) return;
      panel.hidden = false;
      setExpanded(panel.dataset.memoInline, true);
      panel.querySelector('textarea')?.focus({ preventScroll: true });
    });
  });

  bar.querySelector('[data-memo-favorite]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const saved = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(saved));
    button.setAttribute('aria-label', saved ? '取消收藏' : '收藏');
  });

  card.querySelectorAll('[data-memo-cancel]').forEach(button => {
    button.addEventListener('click', () => {
      closePanel(button.closest('[data-memo-inline]'));
    });
  });

  /* 评论：删除 / 回复 / 编辑（点「保存」提交，Esc 放弃） */
  function startEdit(item, button) {
    const text = item.querySelector('.mt-text');
    if (!text) return;
    const editor = document.createElement('textarea');
    editor.className = 'mt-edit';
    editor.rows = 2;
    editor.value = text.textContent;
    text.replaceWith(editor);
    clampTextarea(editor, 160);
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    button.dataset.mode = 'save';
    button.textContent = '保存';
    editor.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      editor.replaceWith(text);
      button.dataset.mode = '';
      button.textContent = '编辑';
    });
  }

  function commitEdit(item, button) {
    const editor = item.querySelector('.mt-edit');
    if (!editor) return;
    const paragraph = document.createElement('p');
    paragraph.className = 'mt-text';
    paragraph.textContent = editor.value.trim() || '（已清空）';
    editor.replaceWith(paragraph);
    button.dataset.mode = '';
    button.textContent = '编辑';
    const meta = item.querySelector('.mt-meta');
    if (meta) {
      /* 需求口径：编辑要标注更新时间，不只是「已编辑」 */
      const stamp = new Date().toTimeString().slice(0, 5);
      let flag = meta.querySelector('.mt-flag');
      if (!flag) {
        flag = document.createElement('span');
        flag.className = 'mt-flag';
        meta.insertBefore(flag, meta.querySelector('.mt-acts'));
      }
      flag.textContent = '已编辑 ' + stamp;
    }
  }

  list?.addEventListener('click', event => {
    const button = event.target.closest('button');
    const item = button?.closest('.mt-comment');
    if (!item) return;
    if (button.hasAttribute('data-mt-delete')) {
      item.remove();
      if (replyTarget === item) clearReply();
      syncCount();
      return;
    }
    if (button.hasAttribute('data-mt-reply')) {
      replyTarget = item;
      if (chip && chipName) {
        chipName.textContent = item.querySelector('.mt-meta b')?.textContent.trim() || '这条评论';
        chip.hidden = false;
      }
      input?.focus();
      return;
    }
    if (button.hasAttribute('data-mt-edit')) {
      if (button.dataset.mode === 'save') commitEdit(item, button);
      else startEdit(item, button);
    }
  });

  /* 评论支持一层回复：回复挂到目标评论下的 .mt-replies，不再继续嵌套 */
  function appendComment() {
    const value = input.value.trim();
    if (!value) return;
    const item = document.createElement('li');
    item.className = 'mt-comment';
    item.innerHTML =
      '<span class="mt-av" data-tone="acc" aria-hidden="true">林</span>' +
      '<div class="mt-main"><div class="mt-meta"><b>林一</b><time>刚刚</time>' +
      '<span class="mt-acts"><button type="button" data-mt-reply>回复</button>' +
      '<button type="button" data-mt-edit>编辑</button>' +
      '<button type="button" data-mt-delete>删除</button></span></div>' +
      '<p class="mt-text"></p></div>';
    item.querySelector('.mt-text').textContent = value;
    let host = list;
    if (replyTarget) {
      const main = replyTarget.querySelector(':scope > .mt-main');
      let replies = main?.querySelector(':scope > .mt-replies');
      if (!replies && main) {
        replies = document.createElement('ol');
        replies.className = 'mt-replies';
        main.append(replies);
      }
      host = replies || list;
    }
    host.append(item);
    input.value = '';
    if (counter) counter.textContent = '0';
    if (send) send.disabled = true;
    clampTextarea(input, 104);
    clearReply();
    syncCount();
    item.scrollIntoView({ block: 'nearest' });
  }

  input?.addEventListener('input', () => {
    clampTextarea(input, 104);
    const length = input.value.trim().length;
    if (counter) counter.textContent = String(length);
    if (send) send.disabled = length === 0;
  });
  input?.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      appendComment();
    }
  });
  form?.addEventListener('submit', event => {
    event.preventDefault();
    appendComment();
  });
  thread.querySelector('[data-mt-reply-cancel]')?.addEventListener('click', clearReply);

  thread.querySelector('[data-mt-sort]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const descending = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(descending));
    const label = button.querySelector('[data-sort-label]');
    if (label) label.textContent = descending ? '按位置' : '按时间';
    [...list.children].reverse().forEach(node => list.append(node));
  });

  /* 引述：原文快照固定，发布后在时间轴顶部生成引述卡片 */
  const quoteInput = quote.querySelector('.mq-input');
  const quoteCounter = quote.querySelector('.mq-counter b');
  quoteInput?.addEventListener('input', () => {
    if (quoteCounter) quoteCounter.textContent = String(quoteInput.value.length);
  });
  quote.querySelectorAll('[data-mq-vis]').forEach(button => {
    button.addEventListener('click', () => {
      quote.querySelectorAll('[data-mq-vis]').forEach(item => item.classList.toggle('is-on', item === button));
    });
  });

  function publishQuote() {
    const feed = document.querySelector('.feed');
    if (!feed) return;
    const reason = quoteInput.value.trim();
    const source = card.querySelector('.memo-text')?.textContent.trim() || '';
    const time = card.querySelector('.memo-time')?.textContent.trim() || '';
    const article = document.createElement('article');
    article.className = 'memo memo--quoted';
    const head = document.createElement('div');
    head.className = 'memo-hd';
    head.innerHTML = '<span class="memo-time">刚刚</span><span class="tag tag--moss">引述</span>';
    article.append(head);
    if (reason) {
      const text = document.createElement('p');
      text.className = 'memo-text';
      text.textContent = reason;
      article.append(text);
    }
    const snapshot = document.createElement('blockquote');
    snapshot.className = 'memo-quote-snap';
    snapshot.textContent = source;
    const origin = document.createElement('small');
    origin.textContent = '引自 ' + time + ' · 原文快照已固定';
    snapshot.append(origin);
    article.append(snapshot);
    /* 插到「今天」分组之下，保持时间轴按天分组的次序，而不是压到分组头上 */
    const dayDivider = feed.querySelector('.feed-day');
    if (dayDivider) dayDivider.after(article);
    else feed.prepend(article);
    quoteInput.value = '';
    if (quoteCounter) quoteCounter.textContent = '0';
    closePanel(quote);
    article.scrollIntoView({ block: 'nearest' });
  }
  quote.querySelector('.memo-inline-publish')?.addEventListener('click', publishQuote);
  quote.querySelector('[data-mq-draft]')?.addEventListener('click', () => closePanel(quote));
  quoteInput?.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      publishQuote();
    }
  });
}

const firstMemoCard = document.querySelector('#memo-top');
if (firstMemoCard) {
  const actionTemplate = firstMemoCard.querySelector('.memo-social');
  const commentTemplate = firstMemoCard.querySelector('[data-memo-inline="comments"]');
  const quoteTemplate = firstMemoCard.querySelector('[data-memo-inline="quote"]');
  document.querySelectorAll('.memo:not(#memo-top)').forEach(card => {
    if (card.querySelector('.lock') || card.querySelector('.memo-social')) return;
    card.append(actionTemplate.cloneNode(true));
    const comments = commentTemplate.cloneNode(true);
    const quote = quoteTemplate.cloneNode(true);
    /* 克隆只带走结构，不带走首条的示例评论 —— 每条 Memo 的评论各自独立 */
    comments.querySelectorAll('.mt-comment').forEach(node => node.remove());
    comments.hidden = true;
    quote.hidden = true;
    card.append(comments, quote);
  });
}
document.querySelectorAll('.memo').forEach(initMemoCard);

/* Memo 时间轴/图册、工作栏筛选和 Todo 交互示意。 */
const memoTimeline = document.querySelector('.feed');
const memoGallery = document.querySelector('.memo-gallery');
document.querySelectorAll('[data-memo-view]').forEach(button => button.addEventListener('click', () => {
  const gallery = button.dataset.memoView === 'gallery';
  document.querySelectorAll('[data-memo-view]').forEach(item => item.classList.toggle('is-on', item === button));
  memoTimeline.hidden = gallery;
  memoGallery.hidden = !gallery;
  document.querySelector('.memo-todo-panel').hidden = gallery;
  document.querySelector('.memo-body').classList.toggle('is-gallery', gallery);
}));
document.querySelectorAll('[data-gallery-jump]').forEach(button => button.addEventListener('click', () => {
  const target = document.getElementById(button.dataset.galleryJump);
  if (!target) return;
  document.querySelector('[data-memo-view="timeline"]').click();
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}));
const heatmap = document.getElementById('memoHeatmap');
if (heatmap) {
  for (let index = 0; index < 84; index += 1) {
    const cell = document.createElement('i');
    const level = (index * 7 + Math.floor(index / 4)) % 6;
    if (level > 1) cell.dataset.level = Math.min(4, level - 1);
    heatmap.append(cell);
  }
}
document.querySelectorAll('.memo-range-options button, .memo-filter-tags button').forEach(button => button.addEventListener('click', () => {
  button.parentElement.querySelectorAll('button').forEach(item => item.classList.toggle('is-on', item === button));
}));
document.querySelector('[data-memo-wander]')?.addEventListener('click', () => {
  const cards = [...document.querySelectorAll('.feed > .memo')].filter(card => !card.querySelector('.lock'));
  const picked = cards[Math.floor(Math.random() * cards.length)];
  picked?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  picked?.classList.add('memo-wander-hit');
  window.setTimeout(() => picked?.classList.remove('memo-wander-hit'), 1200);
});
document.querySelector('[data-todo-toggle]')?.addEventListener('click', () => {
  document.querySelector('.memo-todo-panel').classList.toggle('is-collapsed');
});
document.querySelector('[data-todo-mobile-toggle]')?.addEventListener('click', () => {
  document.querySelector('.memo-todo-panel').classList.toggle('is-mobile-open');
});
document.querySelectorAll('.memo-todo-group').forEach(button => button.addEventListener('click', () => {
  const expanded = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(expanded));
  button.parentElement.querySelectorAll('label').forEach(label => { label.hidden = !expanded; });
}));
document.querySelectorAll('[data-columns-toggle]').forEach(button => button.addEventListener('click', () => {
  const menu = document.querySelector('[data-columns-menu]');
  menu.hidden = !menu.hidden;
  button.setAttribute('aria-expanded', String(!menu.hidden));
}));
/* 表格：勾选即选中。复选框与行高亮（.is-sel）是同一个状态，
   分开维护会出现「打了勾却没高亮」的错位，也会让首列的选中/未选中看起来不一致。 */
function syncRowSelection(markUndo = false) {
  document.querySelectorAll('.grow').forEach(row => {
    const box = row.querySelector('.row-select');
    row.classList.toggle('is-sel', Boolean(box?.checked));
  });
  const count = document.querySelectorAll('.row-select:checked').length;
  const bar = document.querySelector('.db-bulkbar');
  if (bar) {
    bar.querySelector('b').textContent = String(count);
    bar.hidden = count === 0;
  }
  const undo = document.querySelector('[data-table-undo]');
  if (undo && markUndo) undo.disabled = false;
}
syncRowSelection();
document.querySelectorAll('.row-select').forEach(input => input.addEventListener('change', () => syncRowSelection(true)));
document.querySelector('.db-bulkbar .bulk-clear')?.addEventListener('click', () => {
  document.querySelectorAll('.row-select').forEach(box => { box.checked = false; });
  syncRowSelection(true);
});
document.querySelector('[data-table-undo]')?.addEventListener('click', event => {
  /* 演示：把选择恢复成批量操作之前的 1、2 行 */
  document.querySelectorAll('.grow').forEach((row, index) => {
    const box = row.querySelector('.row-select');
    if (box) box.checked = index < 2;
  });
  syncRowSelection();
  event.currentTarget.disabled = true;
});
/* 表格行详情：行号区悬停后出现专用入口；抽屉覆盖表格，不改变表格宽度。 */
const dbBody = document.querySelector('.db-body');
const peek = document.querySelector('.peek');
let peekTrigger = null;
function closePeek() {
  dbBody?.classList.remove('has-peek');
  peek?.setAttribute('aria-hidden', 'true');
  peekTrigger?.focus({ preventScroll: true });
}
function openPeek(row, trigger) {
  if (!dbBody || !peek) return;
  peekTrigger = trigger;
  const title = row.querySelector('.c-name .tt')?.textContent.trim();
  const id = row.querySelector('.c-name .rid')?.textContent.trim();
  if (title) peek.querySelector('.peek-title').textContent = title;
  if (id) peek.querySelector('.peek-id').textContent = id + ' · 创建于 11-01 · 更新于 4 分钟前';
  dbBody.classList.add('has-peek');
  peek.setAttribute('aria-hidden', 'false');
  peek.querySelector('[data-peek-close]')?.focus({ preventScroll: true });
}
document.querySelectorAll('.grow').forEach((row, index) => {
  const cell = row.querySelector('.c-num');
  if (!cell) return;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'row-detail-trigger';
  trigger.textContent = '↗';
  trigger.title = '查看记录详情';
  trigger.setAttribute('aria-label', '查看第 ' + (index + 1) + ' 行记录详情');
  trigger.addEventListener('click', event => {
    event.stopPropagation();
    openPeek(row, trigger);
  });
  cell.append(trigger);
});
document.querySelector('[data-peek-close]')?.addEventListener('click', closePeek);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && dbBody?.classList.contains('has-peek')) closePeek();
});
document.querySelector('[data-table-edit-demo]')?.addEventListener('click', event => {
  const button = event.currentTarget;
  const row = document.querySelector('.grow:has(.cell-edit)');
  if (!row) return;
  const active = row.classList.toggle('table-edit-demo');
  button.setAttribute('aria-pressed', String(active));
  button.textContent = active ? '关闭编辑示例' : '编辑态示例';
});
/* 设置管理中心：切换已实现分类的视觉页面；表单为演示数据，不写入真实设置。 */
function showSettingsPage(id) {
  document.querySelectorAll('[data-settings-page]').forEach(button => button.classList.toggle('is-on', button.dataset.settingsPage === id));
  document.querySelectorAll('[data-settings-content]').forEach(page => page.classList.toggle('is-on', page.dataset.settingsContent === id));
}
document.querySelectorAll('[data-settings-page]').forEach(button => button.addEventListener('click', () => showSettingsPage(button.dataset.settingsPage)));
document.querySelectorAll('[data-settings-go]').forEach(button => button.addEventListener('click', () => showSettingsPage(button.dataset.settingsGo)));
/* 表格筛选/排序面板可开合，示意真实 UI 的控制入口。 */
for (const [toggle, panel] of [['[data-table-filter-toggle]','[data-table-filter-panel]'],['[data-table-sort-toggle]','[data-table-sort-panel]']]) {
  const button = document.querySelector(toggle), content = document.querySelector(panel);
  button?.addEventListener('click', () => { content.hidden = !content.hidden; button.setAttribute('aria-expanded', String(!content.hidden)); });
}

/* 把各视图自带的面板收归统一面板栈 —— 侧栏两形态的前提 */
document.querySelectorAll('.mode').forEach(modeEl => {
  const panel = modeEl.querySelector('.panel');
  if (!panel) return;
  panel.dataset.panel = modeEl.dataset.mode;
  panelStack.appendChild(panel);
});

/* 侧栏形态两档：rail（书脊 56）/ bar（工具栏 248）；笔记清单在两档下都常驻 */
let railTimer = null;
function syncPanel() {
  panelStack.classList.toggle('is-off', !panelStack.querySelector('.panel.is-on'));
}
function setRail(v) {
  app.dataset.rail = v;
  const railToggle = document.getElementById('railToggle');
  if (railToggle) {
    const expanded = v !== 'rail';
    railToggle.setAttribute('aria-expanded', String(expanded));
    railToggle.setAttribute('aria-label', expanded ? '折叠侧栏' : '展开侧栏');
    railToggle.title = expanded ? '折叠侧栏' : '展开侧栏';
  }
  document.querySelectorAll('[data-rail-opt]').forEach(el => {
    el.classList.toggle('is-on', el.dataset.railOpt === v);
  });
  const navBtn = document.getElementById('btn-rail');
  if (navBtn) navBtn.classList.toggle('is-on', v === 'rail');
  /* 侧栏宽度有 180ms 过渡：先按当前宽度算一次，过渡结束再按真实宽度校正 */
  balanceNote();
  clearTimeout(railTimer);
  railTimer = setTimeout(balanceNote, 240);
}
document.querySelector('.rail')?.addEventListener('transitionend', e => {
  if (e.propertyName === 'width') balanceNote();
});
app.dataset.rail = 'bar';
app.dataset.props = 'side';
app.dataset.dock = 'top';
document.getElementById('btnProps').addEventListener('click', function () {
  app.dataset.props = app.dataset.props === 'top' ? 'side' : 'top';
  this.classList.toggle('is-on', app.dataset.props === 'top');
});
document.getElementById('btnDock').addEventListener('click', function () {
  app.dataset.dock = app.dataset.dock === 'bottom' ? 'top' : 'bottom';
  this.classList.toggle('is-on', app.dataset.dock === 'bottom');
});
document.getElementById('railToggle').addEventListener('click', () => {
  setRail(app.dataset.rail === 'bar' ? 'rail' : 'bar');
});
document.getElementById('btn-rail').addEventListener('click', () => {
  setRail(app.dataset.rail === 'bar' ? 'rail' : 'bar');
});

/* 视图切换 */
function setMode(mode) {
  document.querySelectorAll('.mode').forEach(el => {
    el.classList.toggle('is-on', el.dataset.mode === mode);
  });
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.classList.toggle('is-on', el.dataset.nav === mode);
  });
  document.querySelectorAll('.ins-tab').forEach(el => {
    el.classList.toggle('is-on', el.dataset.mode === mode);
  });
  document.querySelectorAll('.panel-stack > .panel').forEach(el => {
    el.classList.toggle('is-on', el.dataset.panel === mode);
  });
  syncPanel();
  balanceNote();
  if (mode === 'home') {
    const inp = document.getElementById('homeInput');
    if (inp) requestAnimationFrame(() => inp.focus({ preventScroll: true }));
  }
}
document.querySelectorAll('[data-goto]').forEach(el => {
  el.addEventListener('click', () => setMode(el.dataset.goto));
});
document.querySelectorAll('[data-nav], .ins-tab').forEach(el => {
  el.addEventListener('click', () => setMode(el.dataset.nav || el.dataset.mode));
});

/* 明暗 */
function toggleTheme() {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
}
document.getElementById('btn-theme').addEventListener('click', toggleTheme);

/* 8pt 网格 */
document.getElementById('btn-grid').addEventListener('click', function () {
  document.body.classList.toggle('show-grid');
  this.classList.toggle('is-on');
});

/* 表格：点行身也能勾选；复选框 / 拖动柄 / 详情入口 / 编辑框各自处理自己的点击 */
document.querySelectorAll('.grow').forEach(row => {
  row.addEventListener('click', event => {
    if (event.target.closest('input, button, .cell-edit, .grip')) return;
    const box = row.querySelector('.row-select');
    if (!box) return;
    box.checked = !box.checked;
    syncRowSelection();
  });
});

/* 键盘：1–5 切视图，T 切明暗 */
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea')) return;
  const map = { '1': 'home', '2': 'memo', '3': 'note', '4': 'table', '5': 'spec' };
  if (map[e.key]) setMode(map[e.key]);
  if (e.key === 't' || e.key === 'T') toggleTheme();
});

/* 主页：投递槽只回执，不回显 */
const homeInput = document.getElementById('homeInput');
const homeToast = document.getElementById('homeToast');
let toastTimer = null;

function saveMemo() {
  if (!homeInput) return;
  if (!homeInput.value.trim()) { homeInput.focus({ preventScroll: true }); return; }
  homeInput.value = '';
  homeToast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => homeToast.classList.remove('is-on'), 3200);
  homeInput.focus({ preventScroll: true });
}

if (homeInput) {
  document.getElementById('homeSave').addEventListener('click', saveMemo);
  homeInput.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveMemo(); }
  });
  homeInput.addEventListener('input', () => homeToast.classList.remove('is-on'));
}


/* 折叠态提示文案 + 清单悬停操作 */
document.querySelectorAll('.sb-quick button, .sb-queue button').forEach(b => {
  const t = b.querySelector('span:not(.cnt)');
  if (t && t.textContent.trim()) b.dataset.tip = t.textContent.trim();
});
document.querySelectorAll('.lst-item').forEach(el => {
  el.insertAdjacentHTML('beforeend',
    '<span class="lst-acts">' +
      '<span title="收藏"><svg class="i" viewBox="0 0 24 24"><path d="M12 4.2l2.3 4.9 5.2.7-3.8 3.7.9 5.3-4.6-2.6-4.6 2.6.9-5.3L4.5 9.8l5.2-.7z"/></svg></span>' +
      '<span title="移到回收站"><svg class="i" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13"/></svg></span>' +
    '</span>');
});

document.querySelectorAll('[data-pop]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const pop = document.getElementById(btn.dataset.pop);
    if (!pop) return;
    const on = pop.classList.contains('is-on');
    document.querySelectorAll('.theme-pop').forEach(p => p.classList.remove('is-on'));
    if (!on) pop.classList.add('is-on');
  });
});
document.addEventListener('click', () => {
  document.querySelectorAll('.theme-pop').forEach(p => p.classList.remove('is-on'));
});

const cf = document.getElementById('confirmDelete');
document.getElementById('btnTrash')?.addEventListener('click', () => cf.classList.add('is-on'));
document.getElementById('cfCancel')?.addEventListener('click', () => cf.classList.remove('is-on'));
document.getElementById('cfOk')?.addEventListener('click', () => cf.classList.remove('is-on'));
cf?.addEventListener('click', e => { if (e.target === cf) cf.classList.remove('is-on'); });

const hhToggle = document.getElementById('hhToggle');
if (hhToggle) {
  hhToggle.addEventListener('click', function () {
    const open = document.getElementById('homeHist').classList.toggle('is-open');
    this.textContent = open ? '隐藏' : '显示';
  });
}

/* 深链：?v=note&theme=dark&rail=rail */
const params = new URLSearchParams(location.search);
const initMode = ['home', 'memo', 'note', 'table', 'spec'].includes(params.get('v'))
  ? params.get('v') : 'home';
setMode(initMode);
if (['light', 'dark'].includes(params.get('theme'))) root.dataset.theme = params.get('theme');
if (['rail', 'bar'].includes(params.get('rail'))) setRail(params.get('rail'));
if (params.get('props')) app.dataset.props = params.get('props');
if (params.get('confirm') === '1') cf.classList.add('is-on');
if (params.get('dock')) app.dataset.dock = params.get('dock');
if (params.get('hist') === '1') {
  const h = document.getElementById('homeHist');
  const b = document.getElementById('hhToggle');
  if (h && b) { h.classList.add('is-open'); b.textContent = '隐藏'; }
}
if (params.get('scroll') === 'end') {
  requestAnimationFrame(() => {
    const sv = document.querySelector('.mode.is-on .spec-view');
    if (sv) sv.scrollTop = sv.scrollHeight;
  });
}

/* 外观设置弹层 */
const modal = document.getElementById('appearanceModal');
const settingsBtn = document.getElementById('sbSettings');
function closeModal() { modal.classList.remove('is-on'); }
if (settingsBtn) settingsBtn.addEventListener('click', () => { modal.classList.add('is-on'); showSettingsPage('appearance'); });
document.getElementById('modalClose')?.addEventListener('click', closeModal);
document.getElementById('modalDone')?.addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* 编辑器“更多”菜单：编辑/预览仍是仅有的常驻模式 */
const moreActions = document.getElementById('moreActions');
const moreMenu = document.getElementById('moreMenu');
function setMoreMenu(open, restoreFocus = true) {
  if (!moreActions || !moreMenu) return;
  moreMenu.hidden = !open;
  moreActions.setAttribute('aria-expanded', String(open));
  if (open) moreMenu.querySelector('[role="menuitem"]')?.focus();
  else if (restoreFocus) moreActions.focus({ preventScroll: true });
}
moreActions?.addEventListener('click', () => setMoreMenu(moreMenu.hidden));
moreMenu?.addEventListener('keydown', e => {
  const items = [...moreMenu.querySelectorAll('[role="menuitem"]')];
  const current = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); setMoreMenu(false); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    items[(current + delta + items.length) % items.length]?.focus();
  }
});
document.addEventListener('click', e => {
  if (!moreMenu?.hidden && !e.target.closest('#moreMenu, #moreActions')) setMoreMenu(false, false);
});
moreMenu?.querySelectorAll('[role="menuitem"]').forEach(item => item.addEventListener('click', () => setMoreMenu(false)));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && moreMenu && !moreMenu.hidden) setMoreMenu(false);
});

/* 规格页的完成态样例：状态反馈与恢复入口可逐个检查 */
const stateCopy = {
  saved: ['本地已保存', '内容已写入此设备。云端同步状态独立显示，不用“已同步”替代本地保存反馈。', '保存状态与同步状态分开呈现；离线时仍可继续编辑。', '本地已保存', ''],
  offline: ['离线，等待同步', '内容已保存在此设备；网络恢复后会继续同步。', '显示最后一次同步时间；本地内容可继续编辑与查看。', '等待同步', ''],
  'sync-error': ['同步失败', '本地副本安全保留。检查网络或稍后重试，不阻断继续编辑。', '失败原因可读，重试入口明确；不把本地成功显示成云端成功。', '同步失败', '重试同步'],
  unsaved: ['有未保存更改', '当前修改尚未写入本地；保存中不锁住键入，失败时保留编辑内容。', '离开页面前提供保存 / 留在页面选择，不静默丢弃更改。', '未保存', '立即保存'],
  locked: ['加密空间已锁定', '正文、属性值、摘要与附件预览均隐藏。标题仅在该条目的可见性规则允许时显示。', '锁定时不写入明文恢复副本；解锁后才恢复内容显示。', '已锁定', '解锁'],
  loading: ['正在读取本地内容', '使用稳定占位形状，避免正文、属性和清单加载时跳动。', '空数据与加载中使用不同状态，避免短暂空屏被误认为没有内容。', '加载中', ''],
  empty: ['这里还没有内容', '可以新建笔记，或从收件箱整理已有内容。', '空清单提供一个主要动作；保留导航和筛选入口。', '空清单', '新建笔记'],
  'no-results': ['没有匹配项', '尝试缩短关键词或清除筛选条件；当前数据仍完整保留。', '搜索结果为空与清单本身为空分开表达。', '无搜索结果', '清除筛选'],
  'load-error': ['暂时无法读取内容', '已保留本地数据；可以重试，或查看同步与本地存储状态。', '错误说明具体范围，不用空态文案掩盖读取失败。', '读取失败', '重试读取'],
  recovery: ['发现未完成的本地恢复副本', '副本时间：今天 20:18。恢复后会进入正常保存链路，原文不会被静默覆盖。', '用户可恢复或丢弃；加密内容的恢复副本始终以密文保存。', '待恢复', '恢复草稿']
};
document.querySelectorAll('[data-state-choice]').forEach(button => {
  button.addEventListener('click', () => {
    const key = button.dataset.stateChoice;
    const [title, description, foot, signal, action] = stateCopy[key];
    const lab = document.querySelector('.state-lab');
    const actionButton = document.getElementById('stateAction');
    lab.dataset.state = key;
    document.querySelectorAll('[data-state-choice]').forEach(item => {
      const active = item === button;
      item.classList.toggle('is-on', active);
      item.setAttribute('aria-pressed', String(active));
    });
    document.getElementById('stateTitle').textContent = title;
    document.getElementById('stateDescription').textContent = description;
    document.getElementById('stateFoot').textContent = foot;
    document.querySelector('#stateSignal span').textContent = signal;
    actionButton.textContent = action;
    actionButton.hidden = !action;
  });
});
document.getElementById('stateAction')?.addEventListener('click', e => {
  const state = document.querySelector('.state-lab').dataset.state;
  if (state === 'sync-error' || state === 'offline') document.querySelector('[data-state-choice="saved"]').click();
  else if (state === 'load-error') document.querySelector('[data-state-choice="loading"]').click();
  else if (state === 'recovery') document.querySelector('[data-state-choice="saved"]').click();
  else e.currentTarget.textContent = state === 'locked' ? '等待解锁' : '已完成';
});

document.querySelectorAll('[data-rail-opt]').forEach(el => {
  el.addEventListener('click', () => setRail(el.dataset.railOpt));
});
document.querySelectorAll('[data-preset]').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('is-on', x === el));
    const p = el.dataset.preset;
    setRail(p === 'organize' ? 'bar' : 'rail');
  });
});
if (params.get('modal') === '1') modal.classList.add('is-on');

/* 量测用：?debug=1 把关键宽度写进 title */
if (params.get('debug')) {
  const g = document.querySelector('.grid');
  const pp = document.querySelector('.paper');
  const ns = document.querySelector('.note-scroll');
  const dm = document.querySelector('.db-main');
  const rl = document.querySelector('.rail');
  const st = document.querySelector('#panelStack');
  document.title = ['vw=' + innerWidth, 'rail=' + (rl ? rl.clientWidth : 0), 'panel=' + (st ? st.clientWidth : 0), 'noteScroll=' + (ns ? ns.clientWidth : 0), 'paper=' + (pp ? pp.clientWidth : 0), 'paperL=' + (pp ? Math.round(pp.getBoundingClientRect().left) : 0), 'paperC=' + (pp ? Math.round(pp.getBoundingClientRect().left + pp.clientWidth/2) : 0), 'dbMain=' + (dm ? dm.clientWidth : 0), 'grid=' + (g ? g.clientWidth : 0)].join(' ');
}

/* 文档纸面视觉居中：把纸面中心对齐视口中心；
   room 封顶保证纸面不被压窄（窄屏无余量时补偿自动归零），
   并量出纸面与文档列的真实左右内距，供顶部工具条 / 底部浮动坞同轴使用 */
function balanceNote() {
  const root = document.documentElement;
  const ns = document.querySelector('.note-scroll');
  const paper = document.querySelector('.paper');
  const col = document.querySelector('.note-col');
  if (!ns || !paper || !col || !ns.clientWidth) {
    root.style.setProperty('--note-balance', '0px');
    root.style.setProperty('--note-pad-l', '34px');
    root.style.setProperty('--note-pad-r', '34px');
    return;
  }
  const box = ns.getBoundingClientRect();
  const want = box.left + ns.clientWidth / 2 - innerWidth / 2;   /* 纸面默认中心 → 视口中心 需要的右移量 */
  const cs = getComputedStyle(ns);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const paperW = Math.min(764, ns.clientWidth - padX);
  const room = Math.max(0, (ns.clientWidth - padX - paperW) / 2);
  const balance = Math.max(-room, Math.min(room, want));
  root.style.setProperty('--note-balance', Math.round(balance) + 'px');
  root.style.setProperty('--note-pad-l', Math.round(paper.getBoundingClientRect().left - col.getBoundingClientRect().left) + 'px');
  root.style.setProperty('--note-pad-r', Math.round(col.getBoundingClientRect().right - paper.getBoundingClientRect().right) + 'px');
}
balanceNote();
window.addEventListener('resize', balanceNote);

/* 下拉选择：替代原生 select —— 面板跟随令牌，支持点击外部 / Esc 关闭与方向键选择 */
function closeAllSelects(except) {
  document.querySelectorAll('[data-sel]').forEach(sel => {
    if (sel === except) return;
    sel.querySelector('.sel-menu').hidden = true;
    sel.querySelector('.sel-btn').setAttribute('aria-expanded', 'false');
  });
}
document.querySelectorAll('[data-sel]').forEach(sel => {
  const btn = sel.querySelector('.sel-btn');
  const menu = sel.querySelector('.sel-menu');
  const value = sel.querySelector('[data-sel-value]');
  const items = [...menu.querySelectorAll('li')];

  function close(restoreFocus) {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) btn.focus({ preventScroll: true });
  }
  function choose(item) {
    items.forEach(node => node.setAttribute('aria-selected', String(node === item)));
    value.textContent = item.textContent;
    close(true);
  }
  btn.addEventListener('click', event => {
    event.stopPropagation();
    const opening = menu.hidden;
    closeAllSelects(sel);
    menu.hidden = !opening;
    btn.setAttribute('aria-expanded', String(opening));
    if (opening) items.find(node => node.getAttribute('aria-selected') === 'true')?.focus({ preventScroll: true });
  });
  items.forEach(item => {
    item.tabIndex = -1;
    item.addEventListener('click', () => choose(item));
  });
  sel.addEventListener('keydown', event => {
    const current = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      if (current >= 0) { event.preventDefault(); choose(items[current]); }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (menu.hidden) { btn.click(); return; }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(current + delta + items.length) % items.length]?.focus({ preventScroll: true });
    }
  });
});
document.addEventListener('click', () => closeAllSelects(null));
