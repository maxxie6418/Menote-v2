const root = document.documentElement;
const app = document.getElementById('app');
const panelStack = document.getElementById('panelStack');

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
