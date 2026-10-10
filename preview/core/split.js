/**
 * AA 分账：各付各的 / 完全平摊 / 自定义分摊
 * 全程以「分」为单位运算，用最大余额法处理不可整除的余数，确保个人金额合计 === 订单总额。
 */
import { allocate } from './util.js';

export const AA_MODES = [
  { v: 'own', t: '各付各的', d: '各自商品自己付，共享小食按人数平分' },
  { v: 'even', t: '完全平摊', d: '订单总额除以人数，余数逐分分配' },
  { v: 'custom', t: '自定义分摊', d: '手动指定每人金额，合计必须与订单总额一致' }
];

export function computeAA(plan, room, mode = 'own', custom = {}) {
  const rows = plan.perMember.map((p) => ({
    memberId: p.memberId,
    name: p.name,
    seat: p.seat,
    ownCents: p.costCents,
    shareCents: p.shareCents || 0,
    payCents: 0
  }));
  const totalCents = plan.totalCents;
  const n = rows.length || 1;

  if (mode === 'own') {
    // 共享部分按人数最大余额法分配，保证 sum(share) === sharedCost
    const sharedCost = plan.shared.reduce((a, s) => a + s.priceCents * s.qty, 0);
    const parts = allocate(sharedCost, new Array(n).fill(1));
    rows.forEach((r, i) => {
      r.shareCents = parts[i] || 0;
      r.payCents = r.ownCents + r.shareCents;
    });
  } else if (mode === 'even') {
    const parts = allocate(totalCents, new Array(n).fill(1));
    rows.forEach((r, i) => {
      r.payCents = parts[i] || 0;
      r.shareCents = Math.max(0, r.payCents - r.ownCents);
    });
  } else {
    const parts = allocate(totalCents, new Array(n).fill(1));
    rows.forEach((r, i) => {
      const c = Number(custom[r.memberId]);
      r.payCents = Number.isFinite(c) && c >= 0 ? Math.round(c) : parts[i] || 0;
      r.shareCents = r.payCents - r.ownCents;
    });
  }

  const sumCents = rows.reduce((a, r) => a + r.payCents, 0);
  return {
    mode,
    rows,
    totalCents,
    sumCents,
    diffCents: sumCents - totalCents,
    balanced: sumCents === totalCents
  };
}

/** 自定义模式下把差额按当前金额比例摊平 */
export function normalizeCustom(aa) {
  const weights = aa.rows.map((r) => Math.max(r.payCents, 0));
  const parts = allocate(aa.totalCents, weights);
  const custom = {};
  aa.rows.forEach((r, i) => { custom[r.memberId] = parts[i]; });
  return custom;
}
