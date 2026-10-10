/** 引擎冒烟测试：不依赖浏览器，直接跑推荐/分账/风险检查 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePlans } from '../web/core/engine.js';
import { computeAA, normalizeCustom } from '../web/core/split.js';
import { checkPlan } from '../web/core/risk.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'snapshot.json'), 'utf8'));
snap.itemMap = new Map(snap.items.map((i) => [i.code, i]));
snap.realItems = snap.items.filter((i) => !i.virtual);

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) fail++; };

const room = {
  code: 'SMOKE', people: 3, pickup: '1', allowShare: true, budgetTotal: 120,
  storeCode: snap.meta.sourceStore.code, storeName: snap.meta.sourceStore.name, deadline: '',
  members: [
    { id: 'm1', seat: 1, name: '小明', budget: 35, mainPref: 'chicken', taste: 'any', drinkPref: 'cola', appetite: 'mid', avoid: [], fixed: [], filled: true },
    { id: 'm2', seat: 2, name: '小红', budget: 25, mainPref: 'any', taste: 'light', drinkPref: 'any', appetite: 'small', avoid: ['beef', 'spicy'], fixed: [], filled: true },
    { id: 'm3', seat: 3, name: '大壮', budget: 60, mainPref: 'beef', taste: 'rich', drinkPref: 'coffee', appetite: 'big', avoid: ['seafood'], fixed: [], filled: true }
  ]
};

console.log('\n[1] 三方案生成');
const { plans, rejected } = generatePlans(snap, room, { locked: {}, removed: {}, added: {} });
ok(plans.length === 3, `生成 ${plans.length} 套方案`);
ok(rejected.length === 0, `无受限成员（rejected=${rejected.length}）`);
for (const p of plans) {
  console.log(`  · ${p.title}: 总价 ¥${(p.totalCents / 100).toFixed(2)}，人均 ¥${(p.perHeadCents / 100).toFixed(2)}，得分 ${(p.score * 100).toFixed(1)}，淘汰=${p.eliminated}`);
  console.log(`    明细 ${JSON.stringify(Object.fromEntries(Object.entries(p.breakdown).map(([k, v]) => [k, +v.toFixed(3)])))}`);
}
ok(plans.every((p) => !p.eliminated), '没有方案被忌口硬冲突淘汰');
ok(plans.every((p) => p.totalCents > 0), '每套方案都有金额');
ok(new Set(plans.map((p) => p.signature)).size === 3, '三套方案互不相同');

console.log('\n[2] 忌口硬过滤');
for (const p of plans) {
  for (const pm of p.perMember) {
    const m = room.members.find((x) => x.id === pm.memberId);
    for (const it of pm.items) {
      const hard = it.diet.filter((t) => m.avoid.includes(t) && !it.removable.includes(t));
      if (hard.length) { ok(false, `${pm.name} 的 ${it.name} 命中忌口 ${hard}`); }
    }
  }
}
ok(true, '所有分配商品均未命中成员忌口');

console.log('\n[3] 金额守恒');
for (const p of plans) {
  const sumOwn = p.perMember.reduce((a, x) => a + x.costCents, 0);
  const sumShared = p.shared.reduce((a, s) => a + s.priceCents * s.qty, 0);
  ok(sumOwn + sumShared === p.totalCents, `${p.title}: 个人 ${sumOwn} + 共享 ${sumShared} === 总额 ${p.totalCents}`);
  const sumPay = p.perMember.reduce((a, x) => a + x.payCents, 0);
  ok(sumPay === p.totalCents, `${p.title}: 各人应付合计 ${sumPay} === 总额 ${p.totalCents}`);
}

console.log('\n[4] AA 分账三种模式');
const plan = plans.find((p) => p.id === 'balanced') || plans[0];
for (const mode of ['own', 'even', 'custom']) {
  const aa = computeAA(plan, room, mode, {});
  ok(aa.sumCents === plan.totalCents, `${mode}: 个人合计 ${aa.sumCents} === 订单总额 ${plan.totalCents}（balanced=${aa.balanced}）`);
  console.log(`     ${mode}: ${aa.rows.map((r) => `${r.name} ¥${(r.payCents / 100).toFixed(2)}`).join(' / ')}`);
}
const cus = { m1: 1000, m2: 2000, m3: 3000 };
const aaCustom = computeAA(plan, room, 'custom', cus);
const fixedCustom = normalizeCustom(aaCustom);
const aa2 = computeAA(plan, room, 'custom', fixedCustom);
ok(aa2.sumCents === plan.totalCents, `custom 摊平后合计 ${aa2.sumCents} === 总额 ${plan.totalCents}`);

console.log('\n[5] 风险检查');
const risks = checkPlan(snap, room, plan);
ok(Array.isArray(risks), `返回 ${risks.length} 条风险`);
risks.forEach((r) => console.log(`     [${r.level}] ${r.title}`));
ok(risks.some((r) => r.level === 'info'), '包含过敏/特调类提示信息');

console.log('\n[6] 锁定 + 移除后重算');
const lockedCode = plan.perMember[0].items[0].code;
const r2 = generatePlans(snap, room, { locked: { m1: [lockedCode] }, removed: {}, added: {} });
const p2 = r2.plans.find((p) => p.id === 'balanced') || r2.plans[0];
ok(p2.perMember[0].items.some((i) => i.code === lockedCode), `锁定商品 ${lockedCode} 仍在新方案中`);
const removedCode = plan.perMember[2].items[0].code;
const r3 = generatePlans(snap, room, { locked: {}, removed: { m3: [removedCode] }, added: {} });
const p3 = r3.plans.find((p) => p.id === 'balanced') || r3.plans[0];
ok(!p3.perMember[2].items.some((i) => i.code === removedCode), `移除商品 ${removedCode} 未再出现`);

console.log('\n[7] 极端场景：重度忌口');
const room2 = JSON.parse(JSON.stringify(room));
room2.members[0].avoid = ['chicken', 'beef', 'seafood', 'pork', 'dairy', 'egg', 'gluten'];
const r4 = generatePlans(snap, room2, { locked: {}, removed: {}, added: {} });
console.log(`     方案数 ${r4.plans.length}，受限 ${r4.rejected.length}`);
ok(r4.plans.length > 0, '重度忌口下仍能产出方案或明确淘汰原因');

console.log('\n[8] 售罄 → 阻断 + 替换建议');
const target = plan.perMember[0].items[0].code;
snap.itemMap.get(target).available = false;
const risks2 = checkPlan(snap, room2, plan);
const block = risks2.find((r) => r.level === 'block');
ok(!!block, `售罄后产生阻断项：${block ? block.title : '无'}`);
ok(!!(block?.fix?.alternatives || []).length, `给出 ${(block?.fix?.alternatives || []).length} 个同类替换建议：${(block?.fix?.alternatives || []).map((a) => a.name).join('、')}`);
snap.itemMap.get(target).available = true;

console.log(fail === 0 ? '\n全部通过 ✅' : `\n失败 ${fail} 项 ❌`);
process.exit(fail === 0 ? 0 : 1);
