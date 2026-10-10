import { loadData, getData } from './core/data.js';
import { getRoom, currentCode, setCurrent } from './core/store.js';
import { esc, toast } from './core/util.js';

import home from './views/home.js';
import room, { resetSeat } from './views/room.js';
import plans, { invalidate } from './views/plans.js';
import confirm, { resetTab } from './views/confirm.js';
import result from './views/result.js';

const STEPS = [
  ['#/', '首页'], ['room', '拼单房间'], ['plans', '方案比较'], ['confirm', '编辑确认'], ['result', '下单清单']
];

const app = document.getElementById('app');
const strip = document.getElementById('noticeStrip');
const chip = document.getElementById('dataChip');
const backBtn = document.getElementById('backBtn');
const tbTitle = document.getElementById('tbTitle');
const brand = document.querySelector('.brand');
const progress = document.getElementById('progress');

/* 窄屏判定：底部主操作条只在窄屏出现，与 CSS 的 900px 断点保持一致 */
const isNarrow = () => window.matchMedia('(max-width:900px)').matches;

function renderSteps(activeKey) {
  const el = document.getElementById('steps');
  const idx = STEPS.findIndex((s) => s[0] === activeKey || (s[1] && activeKey === s[1]));
  el.innerHTML = STEPS.map((s, i) => {
    const cls = i === idx ? 'step active' : (idx >= 0 && i < idx ? 'step done' : 'step');
    return `<span class="${cls}">${i + 1}. ${s[1]}</span>`;
  }).join('');

  // 手机端：顶栏只显示当前标题 + 细进度条，把纵向空间让给内容
  const cur = STEPS[Math.max(0, idx)];
  const onHome = idx <= 0;
  brand.hidden = !onHome;
  tbTitle.hidden = onHome;
  tbTitle.textContent = onHome ? '' : cur[1];
  progress.hidden = onHome;
  document.getElementById('progressFill').style.width = `${((idx + 1) / STEPS.length) * 100}%`;
  document.getElementById('progressTxt').textContent = `${idx + 1}/${STEPS.length}`;

  // 返回键：非首页时显示，按步骤回退一步（首页之外的第一步回首页）
  backBtn.hidden = onHome;
  backBtn.onclick = () => {
    const prev = STEPS[Math.max(0, idx - 1)];
    if (prev[0] === '#/') location.hash = '#/';
    else location.hash = `#/${prev[0]}/${currentCode() || ''}`;
  };
}

function renderChip() {
  const d = getData();
  if (!d.snapshot) {
    chip.querySelector('.dc-full').textContent = '数据不可用';
    chip.querySelector('.dc-short').textContent = '数据不可用';
    chip.className = 'data-chip warn';
    chip.title = d.error || '';
    return;
  }
  const n = (d.degraded || []).length;
  const cnt = d.snapshot.meta.counts.items;
  chip.querySelector('.dc-full').textContent = `菜单 ${d.snapshot.meta.sourceFetchedAt}｜${cnt} 件商品${n ? `｜${n} 项降级` : ''}`;
  chip.querySelector('.dc-short').textContent = `${cnt} 件${n ? ` · ${n} 降级` : ''}`;
  chip.className = `data-chip${n ? ' warn' : ''}`;
  chip.title = (d.degraded || []).map((x) => `${x.module}：${x.reason}`).join('\n');
}

/* ---------- 通用分段控件 ----------
   容器内 .seg-item[data-seg] 与 [data-pane] 一一对应：
   手机端一次只显示一个面板，桌面端由 CSS 全部展开。 */
function setupToggles(scope = document) {
  scope.querySelectorAll('[data-toggle]').forEach((wrap) => {
    const items = [...wrap.querySelectorAll('.seg-item')];
    const panes = [...wrap.querySelectorAll('[data-pane]')];
    if (!items.length) return;
    const preferred = wrap.dataset.toggleOn;
    const apply = (key) => {
      items.forEach((i) => i.classList.toggle('on', i.dataset.seg === key));
      panes.forEach((p) => p.classList.toggle('on', p.dataset.pane === key));
      syncActionBar(); // 底部主操作跟随当前可见面板
    };
    items.forEach((i) => { i.onclick = () => apply(i.dataset.seg); });
    const initial = (preferred && items.some((i) => i.dataset.seg === preferred) && preferred)
      || (items.find((i) => i.classList.contains('on')) || items[0]).dataset.seg;
    apply(initial);
  });
}

function renderStrip() {
  const d = getData();
  const extra = (d.degraded || []).filter((x) => x.module.startsWith('数据接口'));
  if (d.source === 'file' || extra.length) {
    strip.hidden = false;
    strip.innerHTML = `<b>降级提示：</b>菜单接口不可达，当前使用本地快照文件；价格与可售状态可能不是最新，下单前请二次确认。`;
  } else {
    strip.hidden = true;
  }
}

/* ---------- 移动端底部固定操作条 ----------
   任何带 data-ab 的元素都会被提升为底部主操作按钮（手机端才显示），
   页面内的原按钮同时隐藏，避免重复。data-ab-note 用于显示左侧摘要。 */
/**
 * 挑出"当前语境下"的主操作：
 * 优先取当前可见面板（[data-pane].on）内的按钮，其次取不在任何面板里的按钮。
 * 这样方案页切换分段时，底部按钮会跟着换成当前这套方案的动作。
 */
function pickActionEl() {
  const all = [...app.querySelectorAll('[data-ab]')];
  if (!all.length) return null;
  return all.find((el) => {
    const pane = el.closest('[data-pane]');
    return pane && pane.classList.contains('on');
  }) || all.find((el) => !el.closest('[data-pane]')) || all[0];
}

function syncActionBar() {
  const bar = document.getElementById('actionBar');
  const btn = document.getElementById('abBtn');
  const note = document.getElementById('abNote');
  const el = pickActionEl();
  const show = !!el && isNarrow();
  document.body.classList.toggle('has-actionbar', show);
  bar.hidden = !show;
  if (!show) return;
  btn.textContent = (el.textContent || '继续').trim();
  btn.disabled = el.disabled === true;
  note.textContent = el.dataset.abNote || '';
  btn.onclick = () => { if (!el.disabled) el.click(); };
}
function setupActionBar() {
  syncActionBar();
}

/** 每次渲染后的统一收尾：装载分段控件 + 同步底部操作条 */
function afterRender() {
  setupToggles(app);
  setupActionBar();
}
window.addEventListener('resize', syncActionBar);
window.addEventListener('orientationchange', syncActionBar);

const ctx = { snap: null, room: null, params: {}, rerender };

let prevName = '';
let pendingSeat = 0;

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, a, b] = h.split('/');
  return { name: name || '', a, b };
}

function rerender() { route(); }

function route() {
  const { name, a, b } = parseHash();
  const d = getData();

  if (name === 'join') {
    const r = getRoom(a);
    if (r) {
      setCurrent(r.code);
      pendingSeat = Math.max(0, Number(b || 1) - 1);
      location.hash = `#/room/${r.code}`;
    }
    else { location.hash = '#/'; toast('本机没有这个房间'); }
    return;
  }

  if (!name) {
    ctx.room = null;
    renderSteps('#/');
    app.innerHTML = home.render(ctx);
    home.mount(ctx);
    afterRender();
    return;
  }

  const code = a || currentCode();
  const r = code ? getRoom(code) : null;
  if (!r) {
    renderSteps('#/');
    app.innerHTML = `<div class="card"><h2 class="card-title">找不到房间 ${esc(code || '')}</h2>
      <p class="card-sub">MVP 只在当前浏览器保存房间数据。</p>
      <a class="btn" href="#/">回首页发起拼单</a></div>`;
    afterRender();
    return;
  }
  setCurrent(r.code);
  ctx.snap = d.snapshot;
  ctx.room = r;
  ctx.params = { b };

  const views = { room, plans, confirm, result };
  const view = views[name];
  if (!view) { location.hash = '#/'; return; }
  // 只有从别的页面进入时才重置位置，页内重渲染保持当前席位/标签
  if (name === 'room' && prevName !== 'room') resetSeat(pendingSeat);
  if (name === 'confirm' && prevName !== 'confirm') resetTab(0);
  if (name === 'plans' && prevName !== 'plans') invalidate();
  pendingSeat = 0;
  prevName = name;

  renderSteps(name);
  app.innerHTML = view.render(ctx);
  view.mount(ctx);
  afterRender();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

(async function boot() {
  const d = await loadData();
  if (d.snapshot) ctx.snap = d.snapshot;
  renderChip();
  renderStrip();
  route();
  window.addEventListener('hashchange', route);
})();
