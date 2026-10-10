/**
 * 拼单推荐引擎
 * 评分模型：偏好满足35% + 预算符合25% + 饱腹匹配15% + 优惠程度15% + 共享合理10% − 冲突惩罚
 * 忌口硬冲突 → 方案直接淘汰
 */
import { clamp, allocate } from './util.js';

export const APPETITE_KCAL = { small: 550, mid: 800, big: 1100 };
export const AVOID_LABEL = {
  beef: '牛肉', pork: '猪肉/培根', chicken: '鸡肉', seafood: '鱼虾海鲜', fish: '鱼', shrimp: '虾',
  dairy: '乳制品', egg: '鸡蛋', gluten: '麸质/小麦', spicy: '辛辣', caffeine: '咖啡因',
  onion: '洋葱/葱', pickle: '酸黄瓜', nuts: '花生坚果'
};

const STRATEGIES = [
  { id: 'cheap', title: '最省钱', sub: '把人均压到最低，优先吃套餐与促销价', w: { cheap: .45, cost: .20, pref: .12, full: .08, disc: .15, struct: .00 } },
  { id: 'balanced', title: '最均衡', sub: '人人有主食+饮料，人均价差最小', w: { cost: .25, pref: .35, full: .20, disc: .10, struct: .10 } },
  { id: 'satisfy', title: '最满足', sub: '最大程度贴合每个人的偏好与食量', w: { cost: .25, pref: .40, full: .18, disc: .17, struct: .00 } }
];

/* ---------------- 基础工具 ---------------- */
function poolsOf(snap) {
  const real = snap.realItems.filter((i) => i.available);
  return {
    main: real.filter((i) => i.kind === 'main'),
    side: real.filter((i) => i.kind === 'side'),
    drink: real.filter((i) => i.kind === 'drink'),
    dessert: real.filter((i) => i.kind === 'dessert'),
    combo: real.filter((i) => i.kind === 'combo'),
    platter: real.filter((i) => i.kind === 'platter')
  };
}

function conflictsOf(diet = [], removable = [], avoid = []) {
  const hits = (diet || []).filter((t) => avoid.includes(t));
  const soft = hits.filter((t) => (removable || []).includes(t));
  const hard = hits.filter((t) => !(removable || []).includes(t));
  return { hard, soft };
}

function comboEntry(snap, combo, choiceCodes = {}) {
  const map = snap.itemMap;
  let delta = 0;
  const components = [];
  if (combo.rounds && combo.rounds.length) {
    for (const r of combo.rounds) {
      const want = choiceCodes[r.id];
      const ch = r.choices.find((c) => c.code === want) || r.choices.find((c) => c.isDefault === 1) || r.choices[0];
      if (!ch) continue;
      delta += Math.round((Number(ch.diff) || 0) * 100);
      const comp = map.get(ch.code) || { code: ch.code, name: ch.name, kind: r.kind, kcal: 0, diet: [], removable: [] };
      components.push({ code: comp.code, name: comp.name, kind: r.kind || comp.kind, kcal: comp.kcal || 0, diet: comp.diet || [], removable: comp.removable || [] });
    }
  }
  const diet = [...new Set(components.flatMap((c) => c.diet))];
  const removable = [...new Set(components.flatMap((c) => c.removable))];
  const kcal = components.length ? components.reduce((a, c) => a + (c.kcal || 0), 0) : combo.kcal;
  return {
    code: combo.code, name: combo.name, image: combo.image, kind: 'combo',
    priceCents: combo.price + delta, origCents: Math.max(combo.origPrice, combo.price + delta),
    kcal: kcal || combo.kcal, diet: diet.length ? diet : combo.diet, removable,
    components, isCombo: true,
    slots: components.length ? null : comboSlots(combo.name)
  };
}

function slotsOf(e) {
  if (e.kind === 'combo') {
    if (e.components && e.components.length) {
      return {
        main: e.components.some((c) => c.kind === 'main'),
        side: e.components.some((c) => c.kind === 'side'),
        drink: e.components.some((c) => c.kind === 'drink')
      };
    }
    return e.slots || comboSlots(e.name || '');
  }
  return { main: e.kind === 'main', side: e.kind === 'side', drink: e.kind === 'drink' };
}

function comboVariants(snap, combo, member, opts = {}) {
  const out = [{}];
  if (!combo.rounds || !combo.rounds.length) return out;
  const removedSet = new Set((opts?.removed?.[member.id] || []).map(String));
  const usable = (r) => r.choices.filter((c) => !removedSet.has(c.code));
  // 偏好版：按主食/饮料偏好挑选子项
  const pref = {};
  for (const r of combo.rounds) {
    const pool = usable(r);
    if (!pool.length) return [];             // 该轮所有子项都被移除 → 整个套餐不可用
    if (r.kind === 'drink' && member.drinkPref && member.drinkPref !== 'any' && member.drinkPref !== 'none') {
      const best = pool.filter((c) => drinkHit({ name: c.name, diet: [] }, member.drinkPref) === 1)
        .sort((a, b) => a.diff - b.diff)[0];
      if (best) pref[r.id] = best.code;
    }
    if (r.kind === 'main' && member.mainPref && member.mainPref !== 'any') {
      const best = pool.filter((c) => {
        const it = snap.itemMap.get(c.code);
        return it && mainHit(it, member.mainPref) === 1;
      }).sort((a, b) => a.diff - b.diff)[0];
      if (best) pref[r.id] = best.code;
    }
    if (!pref[r.id]) {
      const d = pool.find((c) => c.isDefault === 1) || pool[0];
      pref[r.id] = d.code;
    }
  }
  if (Object.keys(pref).length) out.push(pref);
  // 省钱版：全选差价最低
  const cheap = {};
  for (const r of combo.rounds) {
    const pool = usable(r);
    if (!pool.length) return [];
    cheap[r.id] = [...pool].sort((a, b) => a.diff - b.diff)[0].code;
  }
  out.push(cheap);
  // 默认版也要跳过被移除的子项
  const def = {};
  for (const r of combo.rounds) {
    const pool = usable(r);
    if (!pool.length) return [];
    def[r.id] = (pool.find((c) => c.isDefault === 1) || pool[0]).code;
  }
  out[0] = def;
  return out;
}

/** 没有组成数据的套餐：从名称推断包含哪些槽位 */
function comboSlots(name) {
  if (/饮品/.test(name)) return { main: false, side: false, drink: true };
  if (/汉堡小食/.test(name)) return { main: true, side: true, drink: false };
  return { main: true, side: true, drink: true };
}

/* ---------------- 偏好命中 ---------------- */
function mainHit(item, pref) {
  if (!pref || pref === 'any') return 1;
  const d = item.diet || [];
  if (pref === 'beef') return d.includes('beef') ? 1 : 0;
  if (pref === 'chicken') return d.includes('chicken') ? 1 : 0;
  if (pref === 'fish') return (d.includes('fish') || d.includes('seafood')) ? 1 : 0;
  if (pref === 'pork') return d.includes('pork') ? 1 : 0;
  if (pref === 'veg') return (!d.includes('beef') && !d.includes('chicken') && !d.includes('fish') && !d.includes('pork') && !d.includes('seafood')) ? 1 : 0;
  return 0;
}
function tasteHit(item, taste) {
  if (!taste || taste === 'any') return 1;
  const d = item.diet || [];
  if (taste === 'light') return d.includes('spicy') ? 0 : 1;
  if (taste === 'spicy') return d.includes('spicy') ? 1 : 0;
  if (taste === 'rich') return (d.includes('dairy') || d.includes('beef')) ? 1 : 0;
  return 1;
}
const DRINK_RULES = [
  ['diet', /无糖/],
  ['coffee', /咖啡|美式|奶铁|阿芙佳朵|玛奇朵/],
  ['milk', /牛奶|燕麦奶（?盒?）?$|燕麦奶$/],
  ['tea', /红茶|茶/],
  ['juice', /汁|橙|柠|苹果/],
  ['sprite', /雪碧|怡泉/],
  ['cola', /可乐/]
];
function drinkHit(item, pref) {
  if (!pref || pref === 'any') return 1;
  const n = item.name || '';
  if (pref === 'none') return 0;
  for (const [key, re] of DRINK_RULES) if (key === pref && re.test(n)) return 1;
  return 0;
}
function costFit(costCents, budgetCents) {
  const b = Math.max(budgetCents, 1000);
  const d = costCents - b;
  if (d <= 0) return clamp(1 - Math.abs(d) / b);
  return clamp(1 - 2.2 * (d / b));        // 超预算重罚：超出 45% 即归零
}
function fullnessScore(kcal, appetite) {
  const target = APPETITE_KCAL[appetite] || APPETITE_KCAL.mid;
  if (!kcal) return 0.5;
  return clamp(1 - Math.abs(kcal - target) / target);
}

/* ---------------- 候选生成 ---------------- */
function toEntry(it) {
  return {
    code: it.code, name: it.name, image: it.image, kind: it.kind,
    priceCents: it.price, origCents: Math.max(it.origPrice || it.price, it.price),
    kcal: it.kcal || 0, diet: it.diet || [], removable: it.removable || [],
    components: [], isCombo: !!it.isCombo,
    slots: it.isCombo && !(it.rounds || []).length ? comboSlots(it.name) : null
  };
}

function makeCandidate(entries, member) {
  const cost = entries.reduce((a, e) => a + e.priceCents, 0);
  const orig = entries.reduce((a, e) => a + e.origCents, 0);
  const kcal = entries.reduce((a, e) => a + (e.kcal || 0), 0);
  const diet = [...new Set(entries.flatMap((e) => e.diet))];
  const removable = [...new Set(entries.flatMap((e) => e.removable))];
  const mainE = entries.find((e) => slotsOf(e).main);
  const drinkE = entries.find((e) => slotsOf(e).drink);
  const sideE = entries.find((e) => slotsOf(e).side);

  // 套餐的主食命中取组成里的主食；无组成数据的套餐按名称给中间分
  let mainScore = 0;
  if (mainE) {
    if (mainE.kind === 'combo' && mainE.components && mainE.components.length) {
      const comps = mainE.components.filter((c) => c.kind === 'main');
      mainScore = comps.length ? Math.max(...comps.map((c) => mainHit(c, member.mainPref))) : 0.5;
    } else if (mainE.kind === 'combo') {
      const it = { name: mainE.name, diet: mainE.diet };
      mainScore = member.mainPref === 'any' ? 1 : (mainHit(it, member.mainPref) === 1 ? 1 : 0.5);
    } else mainScore = mainHit(mainE, member.mainPref);
  } else if (member.mainPref === 'veg' && sideE) mainScore = mainHit(sideE, 'veg');
  let drinkScore = 0;
  if (drinkE) {
    if (drinkE.kind === 'combo' && drinkE.components && drinkE.components.length) {
      const comps = drinkE.components.filter((c) => c.kind === 'drink');
      drinkScore = comps.length ? Math.max(...comps.map((c) => drinkHit(c, member.drinkPref))) : 0.5;
    } else if (drinkE.kind === 'combo') {
      drinkScore = member.drinkPref === 'any' || member.drinkPref === 'none' ? 0.5 : 0.5;
    } else drinkScore = drinkHit(drinkE, member.drinkPref);
  } else drinkScore = member.drinkPref === 'none' ? 1 : 0;

  const tasteScore = Math.max(...entries.map((e) => tasteHit(e, member.taste)), 0);
  const fixedWanted = (member.fixed || []).map(String);
  const fixedOk = fixedWanted.length ? (fixedWanted.every((c) => entries.some((e) => String(e.code) === c)) ? 1 : 0) : 1;

  return {
    entries, costCents: cost, origCents: orig, kcal, diet, removable,
    hasMain: !!mainE, hasDrink: !!drinkE, hasSide: !!sideE,
    pref: { main: mainScore, taste: tasteScore, drink: drinkScore, fixed: fixedOk },
    prefTotal: (mainScore + tasteScore + drinkScore + fixedOk) / 4,
    costFit: costFit(cost, Number(member.budget || 35) * 100),
    cheapness: clamp(1 - cost / Math.max(Number(member.budget || 35) * 120, 2000)),
    fullness: fullnessScore(kcal, member.appetite),
    discount: clamp((orig - cost) / Math.max(orig, 1) / 0.35),
    rawDiscount: (orig - cost) / Math.max(orig, 1),
    sig: entries.map((e) => e.code).sort().join('|')
  };
}

function candidatesFor(snap, pools, member, opts) {
  const avoid = member.avoid || [];
  const locked = (opts.locked?.[member.id] || []).map(String);
  const removed = new Set((opts.removed?.[member.id] || []).map(String));
  const added = (opts.added?.[member.id] || []).map(String);
  const budget = Number(member.budget || 35) * 100;

  const forced = [];
  for (const code of [...new Set([...(member.fixed || []).map(String), ...locked, ...added])]) {
    if (removed.has(code)) continue;
    const it = snap.itemMap.get(code);
    if (!it || !it.available) continue;
    forced.push(it.isCombo ? comboEntry(snap, it, {}) : toEntry(it));
  }
  const forcedCost = forced.reduce((a, e) => a + e.priceCents, 0);
  const rest = budget - forcedCost;

  const okFor = (diet, removable) => conflictsOf(diet, removable || [], avoid).hard.length === 0;
  const out = [];

  // 被移除的单品，若套餐名称与其高度相似（套餐未给出子项编码时），同样排除
  const removedNames = [...removed].map((c) => snap.itemMap.get(c)).filter(Boolean).map((i) => i.name);
  const lcs = (a, b) => {
    let best = 0;
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
    return best;
  };
  const blockedByName = (name) => removedNames.some((rn) => lcs(rn, name) >= 4);

  // ---- 套餐候选 ----
  for (const c of pools.combo) {
    if (removed.has(c.code)) continue;
    if (blockedByName(c.name)) continue;
    for (const v of comboVariants(snap, c, member, opts)) {
      const e = comboEntry(snap, c, v);
      if (!okFor(e.diet, e.removable)) continue;
      if (e.priceCents > rest * 1.35 + 2000) continue;
      out.push(makeCandidate([...forced, e], member));
    }
  }

  // ---- 单点候选 ----
  const mainPool = member.mainPref === 'veg'
    ? pools.side.filter((i) => mainHit(i, 'veg') === 1)
    : pools.main;
  const rankBy = (arr, fn) => [...arr].sort((a, b) => fn(b) - fn(a));
  const usablePool = (arr) => arr.filter((i) => !removed.has(i.code) && okFor(i.diet, i.removable));
  const mains = rankBy(usablePool(mainPool),
    (i) => mainHit(i, member.mainPref) * 2 + tasteHit(i, member.taste) - Math.abs(i.price - rest) / 4000).slice(0, 4);
  const drinks = member.drinkPref === 'none' ? [null]
    : rankBy(usablePool(pools.drink),
      (i) => drinkHit(i, member.drinkPref) * 2 - Math.abs(i.price - 1000) / 4000).slice(0, 3);
  const sides = rankBy(usablePool(pools.side),
    (i) => tasteHit(i, member.taste) - Math.abs(i.price - 1300) / 4000).slice(0, 3);
  const desserts = rankBy(usablePool(pools.dessert),
    (i) => -Math.abs(i.price - 1200) / 4000).slice(0, 2);

  // 已被锁定/指定的主食或套餐存在时，不再叠加第二个主食
  const hasForcedMain = forced.some((e) => e.kind === 'combo' || e.kind === 'main');
  const mainOptions = hasForcedMain ? [null] : mains;
  const mainForDessert = hasForcedMain ? [null] : mains.slice(0, 2);

  const skeleton = [];
  for (const mn of mainOptions) for (const dk of drinks) {
    skeleton.push([mn, dk, null]);
    if (rest >= 2500) for (const sd of sides) skeleton.push([mn, dk, sd]);
  }
  // 高预算/大食量：加小食+甜品
  if (rest >= 4000 || member.appetite === 'big') {
    for (const mn of mainForDessert) for (const dk of drinks.slice(0, 2)) for (const sd of sides.slice(0, 2)) for (const ds of desserts) {
      skeleton.push([mn, dk, sd, ds]);
    }
  }
  for (const sk of skeleton) {
    const es = sk.filter(Boolean).map(toEntry);
    if (!es.length) continue;
    const cand = makeCandidate([...forced, ...es], member);
    if (cand.costCents > (budget + forcedCost) * 1.35 + 3000) continue;
    out.push(cand);
  }

  // ---- 只有固定商品时也要出方案 ----
  if (!out.length && forced.length) out.push(makeCandidate(forced, member));

  // 去重 + 截断
  const seen = new Set();
  return out.filter((c) => (seen.has(c.sig) ? false : (seen.add(c.sig), true))).slice(0, 60);
}

/* ---------------- 方案装配 ---------------- */
function scoreByStrategy(c, s) {
  const w = s.w;
  const struct = (c.hasMain ? .5 : 0) + (c.hasDrink || false ? .5 : 0);
  return (c.prefTotal * (w.pref || 0)) + (c.costFit * (w.cost || 0)) + (c.fullness * (w.full || 0))
    + (c.discount * (w.disc || 0)) + (struct * (w.struct || 0)) + (c.cheapness * (w.cheap || 0));
}

function pickShared(snap, pools, room, members, personalCost, strategy) {
  if (!room.allowShare || members.length < 2) return [];
  const unionAvoid = [...new Set(members.flatMap((m) => m.avoid || []))];
  // 未设总预算时不限；已设则共享拼盘不能把总额顶穿
  const totalBudget = Number(room.budgetTotal || 0) * 100;
  const budgetLeft = totalBudget > 0 ? totalBudget - personalCost : Infinity;
  const cands = pools.platter.filter((p) => conflictsOf(p.diet, p.removable || [], unionAvoid).hard.length === 0);
  if (!cands.length) return [];
  const n = members.length;
  const want = n >= 5 ? 2 : 1;
  const sorted = [...cands].sort((a, b) => {
    const ka = a.kcal / n, kb = b.kcal / n;
    const fitA = clamp(1 - Math.abs(ka - 220) / 400), fitB = clamp(1 - Math.abs(kb - 220) / 400);
    const priceA = strategy.id === 'cheap' ? -a.price : Math.abs(a.price - n * 1000);
    const priceB = strategy.id === 'cheap' ? -b.price : Math.abs(b.price - n * 1000);
    return (fitB + clamp(b.rawDiscount ? (b.origPrice - b.price) / b.origPrice / .35 : 0) - priceB / 5000)
      - (fitA + clamp(a.rawDiscount ? (a.origPrice - a.price) / a.origPrice / .35 : 0) - priceA / 5000);
  });
  const picked = [];
  let cost = 0;
  for (const p of sorted) {
    if (picked.length >= want) break;
    if (cost + p.price > budgetLeft) continue;
    picked.push(p);
    cost += p.price;
  }
  return picked.map((p) => ({
    code: p.code, name: p.name, image: p.image, kind: 'platter',
    priceCents: p.price, origCents: Math.max(p.origPrice, p.price), kcal: p.kcal || 0,
    diet: p.diet || [], removable: p.removable || [], qty: 1, shared: true
  }));
}

function buildPlan(snap, room, strategy, picks, rejected, opts = {}) {
  const members = room.members;
  const n = members.length || 1;
  const perMember = picks.map(({ member, cand }) => ({
    memberId: member.id,
    name: member.name || `席位${member.seat}`,
    seat: member.seat,
    items: cand.entries.map((e) => ({
      code: e.code, name: e.name, image: e.image, kind: e.kind,
      priceCents: e.priceCents, origCents: e.origCents, kcal: e.kcal || 0,
      diet: e.diet || [], removable: e.removable || [], components: e.components || [],
      qty: 1, shared: false, isCombo: e.isCombo
    })),
    costCents: cand.costCents,
    kcal: cand.kcal,
    budgetCents: Number(member.budget || 0) * 100,
    pref: cand.pref,
    satisfaction: cand.prefTotal,
    fullness: cand.fullness,
    hasMain: cand.hasMain,
    hasDrink: cand.hasDrink
  }));

  // 硬冲突复查（淘汰）
  const hardHits = [];
  perMember.forEach((pm) => {
    const m = members.find((x) => x.id === pm.memberId);
    pm.items.forEach((it) => {
      const c = conflictsOf(it.diet, it.removable, m.avoid || []);
      if (c.hard.length) hardHits.push({ memberId: m.id, memberName: pm.name, itemName: it.name, tags: c.hard.map((t) => AVOID_LABEL[t] || t) });
      if (c.soft.length) { it.adjusted = c.soft.map((t) => AVOID_LABEL[t] || t); }
    });
  });

  const personalCost = perMember.reduce((a, p) => a + p.costCents, 0);
  const shared = pickShared(snap, poolsOf(snap), room, members, personalCost, strategy);
  // 手动添加的共享拼盘
  for (const code of (opts.sharedAdded || [])) {
    if (shared.some((s) => s.code === code)) continue;
    const it = snap.itemMap.get(code);
    if (!it) continue;
    shared.push({
      code: it.code, name: it.name, image: it.image, kind: it.kind,
      priceCents: it.price, origCents: Math.max(it.origPrice || it.price, it.price),
      kcal: it.kcal || 0, diet: it.diet || [], removable: it.removable || [], qty: 1, shared: true
    });
  }
  const sharedCost = shared.reduce((a, s) => a + s.priceCents * s.qty, 0);
  const sharedKcal = shared.reduce((a, s) => a + s.kcal * s.qty, 0);
  const shareAlloc = allocate(sharedCost, new Array(n).fill(1));
  const kcalAlloc = Math.round(sharedKcal / n);

  const totalCents = personalCost + sharedCost;
  const origTotal = perMember.reduce((a, p) => a + p.items.reduce((x, i) => x + i.origCents * i.qty, 0), 0)
    + shared.reduce((a, s) => a + s.origCents * s.qty, 0);

  perMember.forEach((pm, i) => {
    pm.shareCents = shareAlloc[i] || 0;
    pm.shareKcal = kcalAlloc;
    pm.payCents = pm.costCents + pm.shareCents;
    pm.totalKcal = pm.kcal + kcalAlloc;
    pm.overCents = Math.max(0, pm.payCents - pm.budgetCents);
  });

  // ---- 五项评分 ----
  const avg = (f) => perMember.reduce((a, p) => a + f(p), 0) / n;
  const pref = avg((p) => p.satisfaction);
  const budget = avg((p) => costFit(p.payCents, p.budgetCents));
  const full = avg((p) => fullnessScore(p.totalKcal, (members.find((m) => m.id === p.memberId) || {}).appetite));
  const discount = clamp((origTotal - totalCents) / Math.max(origTotal, 1) / 0.35);
  const shareServings = shared.reduce((a, s) => a + s.qty * (s.kind === 'platter' ? 4 : 1), 0);
  const share = room.allowShare
    ? (shared.length ? clamp(0.5 + 0.5 * Math.min(1, shareServings / n)) : 0.25)
    : (shared.length ? 0.4 : 1);
  const noMain = perMember.filter((p) => !p.hasMain).length / n;
  const noDrink = perMember.filter((p) => !p.hasDrink && (members.find((m) => m.id === p.memberId)?.drinkPref !== 'none')).length / n;
  const over = perMember.filter((p) => p.overCents > 0).length / n;
  const budgetTotal = Number(room.budgetTotal || 0) * 100;
  const totalOver = budgetTotal > 0 && totalCents > budgetTotal ? (totalCents - budgetTotal) / budgetTotal : 0;
  const penalty = 0.15 * noMain + 0.10 * noDrink + 0.20 * over + 0.25 * clamp(totalOver / 0.5);

  const score = 0.35 * pref + 0.25 * budget + 0.15 * full + 0.15 * discount + 0.10 * share - penalty;

  return {
    id: strategy.id,
    title: strategy.title,
    sub: strategy.sub,
    perMember,
    shared,
    shareAlloc,
    totalCents,
    origTotal,
    savedCents: Math.max(0, origTotal - totalCents),
    perHeadCents: Math.round(totalCents / n),
    score,
    breakdown: { pref, budget, full, discount, share, penalty, noMain, noDrink, over },
    hardConflicts: hardHits,
    eliminated: hardHits.length > 0,
    overBudget: perMember.filter((p) => p.overCents > 0).map((p) => ({ memberId: p.memberId, name: p.name, overCents: p.overCents })),
    reasons: [],
    signature: perMember.map((p) => p.items.map((i) => i.code).sort().join('+')).join('/') + '#' + shared.map((s) => s.code).join('+')
  };
}

function reasonsFor(plan, room, allPlans) {
  const r = [];
  const n = plan.perMember.length;
  const others = allPlans.filter((p) => p.id !== plan.id && !p.eliminated);
  if (plan.id === 'cheap') {
    const best = others.length ? Math.min(...others.map((p) => p.totalCents)) : null;
    r.push(`人均 ¥${(plan.perHeadCents / 100).toFixed(2)}，全场最低`);
    if (best) r.push(`比其它方案省 ¥${((best - plan.totalCents) / 100).toFixed(2)}`);
    r.push(`较原价省 ¥${(plan.savedCents / 100).toFixed(2)}（${Math.round((plan.savedCents / Math.max(plan.origTotal, 1)) * 100)}%）`);
  }
  if (plan.id === 'balanced') {
    const costs = plan.perMember.map((p) => p.payCents);
    const spread = (Math.max(...costs) - Math.min(...costs)) / 100;
    r.push(`每人都有主食+饮料，人均价差 ¥${spread.toFixed(2)}`);
    r.push(`热量分布最均匀，人均约 ${Math.round(plan.perMember.reduce((a, p) => a + p.totalKcal, 0) / n)} kcal`);
  }
  if (plan.id === 'satisfy') {
    r.push(`偏好命中 ${Math.round(plan.breakdown.pref * 100)}%，三套方案里最高`);
    const bigs = plan.perMember.filter((p) => p.totalKcal >= 800).length;
    r.push(`${bigs} 人热量达 800 kcal 以上，大食量成员吃得饱`);
  }
  if (plan.shared.length) r.push(`共享 ${plan.shared.map((s) => s.name).join('、')}，${n} 人平分`);
  if (plan.overBudget.length) r.push(`${plan.overBudget.length} 人超出个人预算，可在确认页锁定替换`);
  return r;
}

/* ---------------- 对外入口 ---------------- */
export function generatePlans(snap, room, overrides = {}) {
  const pools = poolsOf(snap);
  const members = room.members;
  const opts = {
    locked: overrides.locked || {},
    removed: overrides.removed || {},
    added: overrides.added || {},
    sharedAdded: overrides.sharedAdded || []
  };
  const rejected = [];

  const candByMember = new Map();
  for (const m of members) {
    const cands = candidatesFor(snap, pools, m, opts);
    candByMember.set(m.id, cands);
    if (!cands.length) {
      rejected.push({ memberId: m.id, memberName: m.name || `席位${m.seat}`, reason: '在当前忌口/预算条件下没有任何可售搭配' });
    }
  }

  // 每位成员按策略打分排序，取最优；只有在整案完全重复时，才对个别成员做微调
  const sorted = new Map();
  for (const m of members) {
    const byStrategy = {};
    for (const s of STRATEGIES) {
      byStrategy[s.id] = [...(candByMember.get(m.id) || [])].sort((a, b) => scoreByStrategy(b, s) - scoreByStrategy(a, s));
    }
    sorted.set(m.id, byStrategy);
  }

  const plans = [];
  const usedPlanSig = new Set();
  for (const s of STRATEGIES) {
    let plan = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const picks = [];
      for (let mi = 0; mi < members.length; mi++) {
        const m = members[mi];
        const list = sorted.get(m.id)[s.id] || [];
        if (!list.length) continue;
        // 第 k 次尝试时，给第 (k-1) 位成员换用次优候选，用来拉开方案差异
        const rank = attempt > 0 && (attempt - 1) % members.length === mi ? Math.min(attempt, list.length - 1) : 0;
        picks.push({ member: m, cand: list[rank] });
      }
      if (!picks.length) break;
      const p = buildPlan(snap, room, s, picks, rejected, opts);
      if (!usedPlanSig.has(p.signature) || attempt === 7) { plan = p; break; }
      plan = p;
    }
    if (!plan) continue;
    usedPlanSig.add(plan.signature);
    plans.push(plan);
  }
  plans.forEach((p) => { p.reasons = reasonsFor(p, room, plans); });
  return { plans, rejected };
}

/** 编辑确认页：锁定/删除后重新计算，返回同 id 的新方案 */
export function recompute(snap, room, planId, overrides) {
  const { plans, rejected } = generatePlans(snap, room, overrides);
  const plan = plans.find((p) => p.id === planId) || plans[0] || null;
  return { plan, plans, rejected };
}
