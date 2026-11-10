/* 预览辅助：把皮肤切换塞进底座右下角的检视条（不加额外浮层）。
   仅用于 draft 对照稿，不属于设计本身。
   ?skin=default|paper|neutral 指定初始皮肤，默认 neutral。 */
(() => {
  const KEYS = ['default', 'paper', 'neutral'];
  const LABEL = { default: '墨台', paper: '柔纸', neutral: '素灰' };
  const params = new URLSearchParams(location.search);
  const stored = (() => { try { return localStorage.getItem('menote.draft.skin'); } catch { return null; } })();
  const initial = KEYS.includes(params.get('skin')) ? params.get('skin')
    : KEYS.includes(stored) ? stored : 'neutral';

  const root = document.documentElement;
  root.dataset.skin = initial;

  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.querySelector('.inspector');
    if (!bar) return;

    const sep = document.createElement('div');
    sep.className = 'ins-sep';
    bar.appendChild(sep);

    KEYS.forEach((key) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ins-skin';
      btn.dataset.skinBtn = key;
      btn.title = '皮肤：' + LABEL[key];
      btn.innerHTML = '<i data-tone="' + key + '"></i>' + LABEL[key];
      bar.appendChild(btn);
    });

    const sync = () => bar.querySelectorAll('[data-skin-btn]').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.skinBtn === root.dataset.skin);
    });

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-skin-btn]');
      if (!btn) return;
      root.dataset.skin = btn.dataset.skinBtn;
      try { localStorage.setItem('menote.draft.skin', btn.dataset.skinBtn); } catch { /* 忽略 */ }
      sync();
    });

    sync();
  });
})();
