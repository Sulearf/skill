export const yuan = (cents) => (cents / 100).toFixed(2);
export const yuanN = (cents) => (cents / 100).toFixed(2).replace(/\.00$/, '');
export const money = (cents) => `¥${yuan(cents)}`;
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const pct = (v) => `${Math.round(v * 100)}%`;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** 商品缩略图：无图时不输出 <img>，避免空 src 触发对当前页的重复请求 */
export function thumb(src, style = '') {
  return src
    ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()" style="${style}" />`
    : `<span class="thumb-ph" style="${style}"></span>`;
}

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
export const roomCode = () => Math.random().toString(36).slice(2, 7).toUpperCase();

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2000);
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    toast('已复制到剪贴板');
    return true;
  } catch {
    toast('复制失败，请手动选择文本复制');
    return false;
  }
}

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 最大余额法：把 totalCents（整数分）按 weights 分配，保证合计 === totalCents */
export function allocate(totalCents, weights) {
  const n = weights.length;
  if (!n) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = new Array(n).fill(0);
  if (sum <= 0) {
    // 权重全为 0 时平均分配
    const base = Math.floor(totalCents / n);
    const rem = totalCents - base * n;
    for (let i = 0; i < n; i++) out[i] = base + (i < rem ? 1 : 0);
    return out;
  }
  const exact = weights.map((w) => (totalCents * w) / sum);
  const base = exact.map((v) => Math.floor(v));
  let rest = totalCents - base.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < rest; k++) base[order[k % n].i] += 1;
  return base;
}

export const sum = (arr, f = (x) => x) => arr.reduce((a, b) => a + f(b), 0);
