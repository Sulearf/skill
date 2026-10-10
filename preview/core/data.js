/**
 * 数据层：优先取服务端 /api/snapshot，失败逐层降级，并把降级原因暴露给 UI。
 */
const state = {
  snapshot: null,
  source: 'pending',      // api | file | failed
  degraded: [],
  error: null,
  loadedAt: null
};

const FALLBACK_HINT = '菜单数据不可用，请检查本地服务后刷新页面';

function normalize(snap) {
  if (!snap || !Array.isArray(snap.items)) throw new Error('快照结构异常');
  snap.itemMap = new Map(snap.items.map((i) => [i.code, i]));
  snap.realItems = snap.items.filter((i) => !i.virtual);
  return snap;
}

export async function loadData() {
  if (state.snapshot) return state;
  try {
    const res = await fetch('/api/snapshot', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.snapshot = normalize(await res.json());
    state.source = 'api';
  } catch (e1) {
    try {
      const res = await fetch('/data/snapshot.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.snapshot = normalize(await res.json());
      state.source = 'file';
      state.degraded.push({
        module: '数据接口 /api/snapshot',
        reason: `请求失败：${e1.message}`,
        impact: '已降级为读取本地快照文件 data/snapshot.json，价格与可售状态可能不是最新'
      });
    } catch (e2) {
      state.source = 'failed';
      state.error = `${FALLBACK_HINT}（${e2.message}）`;
    }
  }
  if (state.snapshot) {
    state.loadedAt = new Date();
    state.degraded = state.degraded.concat(state.snapshot.meta?.degraded || []);
  }
  return state;
}

export function getData() { return state; }

export function getItem(code) { return state.snapshot?.itemMap.get(String(code)) || null; }

export function realItems() { return state.snapshot?.realItems || []; }

export function stores() { return state.snapshot?.stores || []; }

export function dataUpdatedText() {
  if (!state.snapshot) return '数据未加载';
  const src = state.snapshot.meta?.sourceFetchedAt || '—';
  return `菜单数据 ${src}`;
}

export function applySoldOut(codes) {
  const snap = state.snapshot;
  if (!snap) return;
  const set = new Set(codes || []);
  for (const it of snap.items) it.available = !set.has(it.code);
  snap.soldOut = [...set];
}
