/**
 * 确认前风险检查：忌口冲突 / 预算超出 / 缺主食 / 缺饮料 / 共享不足 / 售罄 / 过敏原提示
 */
import { AVOID_LABEL } from './engine.js';
import { money } from './util.js';

const ALLERGEN_TAGS = ['seafood', 'fish', 'shrimp', 'dairy', 'egg', 'gluten', 'nuts'];

function hardConflicts(diet = [], removable = [], avoid = []) {
  const hits = diet.filter((t) => avoid.includes(t));
  return {
    hard: hits.filter((t) => !(removable || []).includes(t)),
    soft: hits.filter((t) => (removable || []).includes(t))
  };
}

/** 售罄 / 不可用商品的自动替换建议 */
export function suggestReplacement(snap, item, avoid = [], limit = 3) {
  const pool = snap.realItems.filter((i) => i.available && i.code !== item.code
    && (i.kind === item.kind || (item.kind === 'combo' && i.isCombo)));
  const scored = pool.map((i) => {
    const c = hardConflicts(i.diet || [], i.removable || [], avoid);
    const priceGap = Math.abs(i.price - item.price) / Math.max(item.price, 1);
    const kcalGap = Math.abs((i.kcal || 0) - (item.kcal || 0)) / Math.max(item.kcal || 1, 1);
    return {
      item: i,
      conflict: c.hard.length,
      score: (c.hard.length ? -100 : 0) - priceGap * 2 - kcalGap
    };
  }).filter((x) => x.conflict === 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.item);
}

export function checkPlan(snap, room, plan) {
  const risks = [];
  if (!plan) return risks;

  let hasAllergenHint = false;
  const members = room.members;

  // 1) 售罄 / 不可售
  const allCodes = [...plan.perMember.flatMap((p) => p.items), ...plan.shared];
  for (const it of allCodes) {
    const src = snap.itemMap.get(it.code);
    if (src && src.available === false) {
      const who = plan.perMember.find((p) => p.items.some((i) => i.code === it.code));
      const avoid = (members.find((m) => m.id === who?.memberId)?.avoid) || [];
      risks.push({
        level: 'block',
        title: `「${it.name}」当前不可售/已售罄`,
        detail: `${who ? who.name + ' 的搭配' : '共享项'}受到影響，需要替换后才能下单。`,
        fix: { type: 'replace', memberId: who?.memberId, code: it.code, alternatives: suggestReplacement(snap, src, avoid) }
      });
    }
  }

  // 2) 忌口硬冲突 + 可特调化解
  for (const pm of plan.perMember) {
    const m = members.find((x) => x.id === pm.memberId);
    if (!m) continue;
    const avoid = m.avoid || [];
    for (const it of pm.items) {
      const c = hardConflicts(it.diet, it.removable, avoid);
      if (c.hard.length) {
        risks.push({
          level: 'block',
          title: `${pm.name}：${it.name} 与忌口冲突（${c.hard.map((t) => AVOID_LABEL[t] || t).join('、')}）`,
          detail: '该商品无法通过特调规避，必须从搭配中移除或替换。',
          fix: { type: 'replace', memberId: pm.memberId, code: it.code, alternatives: suggestReplacement(snap, snap.itemMap.get(it.code) || it, avoid) }
        });
      } else if (c.soft.length) {
        risks.push({
          level: 'info',
          title: `${pm.name}：${it.name} 已通过特调去掉 ${c.soft.map((t) => AVOID_LABEL[t] || t).join('、')}`,
          detail: '下单时需要在商品特调选项中手动取消该项，请与门店确认可执行。'
        });
      }
    }
  }

  // 3) 超个人预算
  for (const pm of plan.perMember) {
    if (pm.overCents > 0) {
      risks.push({
        level: 'warn',
        title: `${pm.name} 超出个人预算 ${money(pm.overCents)}`,
        detail: `预算 ${money(pm.budgetCents)}，实际应付 ${money(pm.payCents)}（含共享分摊 ${money(pm.shareCents || 0)}）。`
      });
    }
  }

  // 4) 缺主食 / 缺饮料
  for (const pm of plan.perMember) {
    const m = members.find((x) => x.id === pm.memberId);
    if (!pm.hasMain) {
      risks.push({ level: 'warn', title: `${pm.name} 的搭配里没有主食`, detail: '可在确认页为其添加汉堡/卷类主食。' });
    }
    if (!pm.hasDrink && m?.drinkPref !== 'none') {
      risks.push({ level: 'warn', title: `${pm.name} 的搭配里没有饮料`, detail: '可在确认页为其添加饮品，或将饮料偏好改为「不要饮料」。' });
    }
  }

  // 5) 共享小食数量不足
  if (room.allowShare) {
    const servings = plan.shared.reduce((a, s) => a + s.qty * (s.kind === 'platter' ? 4 : 1), 0);
    if (servings < plan.perMember.length) {
      risks.push({
        level: 'warn',
        title: `共享小食份量不足：${servings} 份 / ${plan.perMember.length} 人`,
        detail: '可关闭「允许共享小食」改为各点各的，或在确认页手动添加拼盘。'
      });
    }
  } else if (plan.shared.length) {
    risks.push({ level: 'warn', title: '房间设置为不允许共享，但方案里存在共享商品', detail: 'AA 分账时建议改为「完全平摊」或移除共享商品。' });
  }

  // 6) 房间总预算
  const totalBudget = Number(room.budgetTotal || 0) * 100;
  if (totalBudget > 0 && plan.totalCents > totalBudget) {
    risks.push({
      level: 'warn',
      title: `订单总额 ${money(plan.totalCents)} 超出房间总预算 ${money(totalBudget)}`,
      detail: `超出 ${money(plan.totalCents - totalBudget)}，可换用「最省钱」方案或调低个别成员预算。`
    });
  }

  // 7) 截止时间
  if (room.deadline) {
    const t = new Date(room.deadline).getTime();
    if (!Number.isNaN(t) && t < Date.now()) {
      risks.push({ level: 'warn', title: '拼单截止时间已过', detail: '建议延长截止时间或重新发起。' });
    }
  }

  // 8) 过敏原提示
  for (const pm of plan.perMember) {
    const m = members.find((x) => x.id === pm.memberId);
    const avoid = (m?.avoid || []).filter((t) => ALLERGEN_TAGS.includes(t));
    if (avoid.length && !hasAllergenHint) {
      hasAllergenHint = true;
      risks.push({
        level: 'info',
        title: '过敏相关提示',
        detail: `本房间的忌口包含 ${avoid.map((t) => AVOID_LABEL[t] || t).join('、')}。商品的过敏原标签由名称推断，不保证完整；涉及过敏请以麦当劳官方说明与门店确认为准。`
      });
    }
  }

  return risks;
}
