const root = document.documentElement;
const app = document.getElementById('app');
const panelStack = document.getElementById('panelStack');

/* Memo 卡片的互动行和内联面板沿用同一结构，不让非加密卡片漏画入口。 */
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
    comments.hidden = true;
    quote.hidden = true;
    card.append(comments, quote);
  });
}
document.querySelectorAll('.memo-social').forEach(bar => {
  const card = bar.closest('.memo');
  bar.querySelectorAll('[data-memo-panel]').forEach(button => {
    button.addEventListener('click', () => {
      const target = button.dataset.memoPanel;
      const panel = card.querySelector('[data-memo-inline="' + target + '"]');
      if (!panel) return;
      const opening = panel.hidden;
      card.querySelectorAll('[data-memo-inline]').forEach(item => { item.hidden = true; });
      bar.querySelectorAll('[data-memo-panel]').forEach(item => item.setAttribute('aria-expanded', 'false'));
      panel.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
      if (opening) panel.querySelector('textarea')?.focus();
    });
  });
  bar.querySelector('[data-memo-favorite]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const saved = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(saved));
    button.setAttribute('aria-label', saved ? '取消收藏' : '收藏');
  });
  card.querySelector('[data-memo-cancel]')?.addEventListener('click', () => {
    const panel = card.querySelector('[data-memo-inline="quote"]');
    panel.hidden = true;
    bar.querySelector('[data-memo-panel="quote"]').setAttribute('aria-expanded', 'false');
  });
  card.querySelector('.memo-inline-compose button')?.addEventListener('click', () => {
    const input = card.querySelector('.memo-inline-compose textarea');
    if (!input.value.trim()) return;
    const row = document.createElement('div');
    row.className = 'memo-inline-comment';
    row.innerHTML = '<time>刚刚</time><span></span><button type="button">编辑</button>';
    row.querySelector('span').textContent = input.value.trim();
    card.querySelector('.memo-inline-compose').before(row);
    input.value = '';
  });
  card.querySelectorAll('.memo-inline-comment button').forEach(editButton => {
    editButton.addEventListener('click', () => {
      const row = editButton.closest('.memo-inline-comment');
      const copy = row.querySelector('span');
      const editor = document.createElement('textarea');
      editor.value = copy.textContent;
      editor.setAttribute('aria-label', '编辑评论');
      copy.replaceWith(editor);
      editButton.textContent = '保存';
      editButton.onclick = () => {
        const text = document.createElement('span');
        text.textContent = editor.value;
        editor.replaceWith(text);
        editButton.textContent = '编辑';
      };
    });
  });
  card.querySelector('.memo-inline-publish')?.addEventListener('click', () => {
    const input = card.querySelector('.memo-inline-quote textarea');
    if (!input.value.trim()) return;
    const quote = document.createElement('article');
    quote.className = 'memo memo--quoted';
    const text = document.createElement('p');
    text.className = 'memo-text';
    text.textContent = input.value.trim();
    const snapshot = document.createElement('blockquote');
    snapshot.className = 'memo-inline-published-snapshot';
    snapshot.textContent = card.querySelector('.memo-text')?.textContent || '来源原文快照';
    quote.append(text, snapshot);
    document.querySelector('.feed').prepend(quote);
    card.querySelector('[data-memo-cancel]').click();
  });
});

/* Memo 时间轴/图册、工作栏筛选和 Todo 交互示意。 */
const memoTimeline = document.querySelector('.feed');
const memoGallery = document.querySelector('.memo-gallery');
document.querySelectorAll('[data-memo-view]').forEach(button => button.addEventListener('click', () => {
  const gallery = button.dataset.memoView === 'gallery';
  document.querySelectorAll('[data-memo-view]').forEach(item => item.classList.toggle('is-on', item === button));
  memoTimeline.hidden = gallery;
  memoGallery.hidden = !gallery;
  document.querySelector('.memo-todo-panel').hidden = gallery;
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
document.querySelectorAll('.row-select').forEach(input => input.addEventListener('change', () => {
  const count = document.querySelectorAll('.row-select:checked').length;
  document.querySelector('.db-bulkbar b').textContent = String(count);
  document.querySelector('.db-bulkbar').hidden = count === 0;
}));
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
document.querySelectorAll('.settings-existing-features .mnav').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.settings-existing-features .mnav').forEach(item => item.classList.toggle('is-on', item === button));
  document.querySelector('.settings-feature-catalog').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}));

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

/* 表格：行选中 */
document.querySelectorAll('.grow').forEach(row => {
  row.addEventListener('click', e => {
    if (e.target.closest('.cell-edit')) return;
    document.querySelectorAll('.grow').forEach(r => r.classList.remove('is-sel'));
    row.classList.add('is-sel');
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
if (settingsBtn) settingsBtn.addEventListener('click', () => modal.classList.add('is-on'));
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalDone').addEventListener('click', closeModal);
document.getElementById('modalCancel').addEventListener('click', closeModal);
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
