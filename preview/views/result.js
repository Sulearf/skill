import { generatePlans } from '../core/engine.js';
import { checkPlan } from '../core/risk.js';
import { computeAA, AA_MODES } from '../core/split.js';
import { saveRoom } from '../core/store.js';
import { esc, money, yuan, copyText, fmtTime, thumb } from '../core/util.js';

function currentPlan(ctx) {
  const { plans } = generatePlans(ctx.snap, ctx.room, ctx.room.edits || {});
  return plans.find((p) => p.id === ctx.room.chosenPlan) || plans[0];
}

function summaryText(plan, room, snap) {
  const agg = new Map();
  const push = (it, qty) => {
    const k = it.code;
    const cur = agg.get(k) || { name: it.name, qty: 0, price: it.priceCents, total: 0, kcal: it.kcal || 0 };
    cur.qty += qty; cur.total += it.priceCents * qty;
    agg.set(k, cur);
  };
  plan.perMember.forEach((p) => p.items.forEach((i) => push(i, i.qty || 1)));
  plan.shared.forEach((s) => push(s, s.qty || 1));

  const lines = [];
  lines.push(`麦当劳拼单清单 · 房间 ${room.code}`);
  lines.push(`门店：${room.storeName || '未指定'}（${room.storeCode || '-'}）`);
  lines.push(`取餐：${(AA_MODES, ['到店自提', '得来速车道取餐', '麦乐送到家'][['1', '5', '2'].indexOf(String(room.pickup))] || '到店自提')}`);
  lines.push(`人数：${room.members.length} 人 · 生成时间：${fmtTime(new Date().toISOString())}`);
  lines.push('');
  lines.push('【商品汇总】');
  let idx = 0;
  for (const v of agg.values()) {
    idx += 1;
    lines.push(`${idx}. ${v.name} ×${v.qty}　¥${yuan(v.price * v.qty)}${v.kcal ? `　${v.kcal * v.qty} kcal` : ''}`);
  }
  lines.push('');
  lines.push(`合计 ${plan.perMember.reduce((a, p) => a + p.items.length, 0) + plan.shared.length} 项 / 原价 ¥${yuan(plan.origTotal)} / 应付 ¥${yuan(plan.totalCents)} / 省 ¥${yuan(plan.savedCents)}`);
  lines.push('');
  lines.push('⚠️ 下单前请在麦当劳 App/小程序内二次确认价格与可售状态，本清单为估算结果。');
  return lines.join('\n');
}

function ownerText(plan, room, aa) {
  const lines = [];
  lines.push(`麦当劳拼单 · 人员归属清单 · 房间 ${room.code} · ${fmtTime(new Date().toISOString())}`);
  lines.push('');
  plan.perMember.forEach((p) => {
    lines.push(`■ ${p.name}（预算 ¥${yuan(p.budgetCents)}，应付 ¥${yuan(aa.rows.find((r) => r.memberId === p.memberId)?.payCents || p.payCents)}）`);
    p.items.forEach((i) => {
      const comps = i.isCombo && i.components.length ? `（${i.components.map((c) => c.name).join(' + ')}）` : '';
      const adj = i.adjusted?.length ? `　[特调去掉：${i.adjusted.join('、')}]` : '';
      lines.push(`　· ${i.name} ×${i.qty || 1}　¥${yuan(i.priceCents)}${comps}${adj}`);
    });
    if (p.shareCents) lines.push(`　· 共享分摊　¥${yuan(p.shareCents)}`);
    const m = room.members.find((x) => x.id === p.memberId);
    if (m?.note) lines.push(`　备注：${m.note}`);
    lines.push('');
  });
  if (plan.shared.length) {
    lines.push(`■ 共享小食（${plan.perMember.length} 人平分，每人 ¥${yuan(plan.shareAlloc[0] || 0)}）`);
    plan.shared.forEach((s) => lines.push(`　· ${s.name} ×${s.qty}　¥${yuan(s.priceCents)}`));
    lines.push('');
  }
  lines.push(`订单总额 ¥${yuan(plan.totalCents)}｜人均 ¥${yuan(plan.perHeadCents)}｜AA 方式：${(AA_MODES.find((m) => m.v === aa.mode) || {}).t}`);
  lines.push('⚠️ 本清单只用于人工下单参照，不代表已下单。');
  return lines.join('\n');
}

export default {
  render(ctx) {
    const plan = currentPlan(ctx);
    if (!plan) return `<div class="card"><h2 class="card-title">没有方案</h2><a class="btn" href="#/plans/${ctx.room.code}">返回</a></div>`;
    const room = ctx.room;
    const aa = computeAA(plan, room, room.aa?.mode || 'own', room.aa?.custom || {});
    const risks = checkPlan(ctx.snap, room, plan);
    const blocks = risks.filter((r) => r.level === 'block').length;

    const agg = new Map();
    const push = (it) => {
      const cur = agg.get(it.code) || { name: it.name, qty: 0, price: it.priceCents, kcal: it.kcal || 0, image: it.image };
      cur.qty += 1; agg.set(it.code, cur);
    };
    plan.perMember.forEach((p) => p.items.forEach(push));
    plan.shared.forEach(push);

    return `
    <div class="row" style="margin-bottom:12px">
      <h2 class="card-title" style="margin:0">下单清单</h2>
      <div class="spacer"></div>
      <a class="btn ghost small" href="#/confirm/${room.code}">继续调整</a>
      <a class="btn ghost small" href="#/">回首页</a>
    </div>

    <div class="risk warn">
      <div class="rt">⚠️ 下单前二次确认</div>
      <div class="rd">
        以下价格与可售状态来自菜单快照（${esc(ctx.snap.meta.sourceFetchedAt)}），<b>可能已经变化</b>。
        请按清单在麦当劳 App/小程序内逐项核对价格、券可用性与售罄状态后再下单。本工具不会替你登录、支付或下单。
      </div>
    </div>
    ${blocks ? `<div class="risk block"><div class="rt">⛔ 仍有 ${blocks} 项阻断风险未处理</div><div class="rd">建议回到确认页处理后再照单下单。</div></div>` : ''}

    <div data-toggle="list">
      <div class="seg">
        <span class="seg-item on" data-seg="s">① 商品汇总</span>
        <span class="seg-item" data-seg="o">② 人员归属</span>
      </div>

    <div class="grid g-two">
      <section class="card" data-pane="s">
        <div class="row">
          <h3 class="card-title" style="margin:0">① 商品汇总清单</h3>
          <div class="spacer"></div>
          <button class="btn small" id="copySummary" data-ab data-ab-note="订单总额 ${money(plan.totalCents)} · 人均 ${money(plan.perHeadCents)}">一键复制</button>
        </div>
        <p class="card-sub">按商品聚合，适合在 App 里逐项加购</p>
        ${[...agg.values()].map((v) => `
          <div class="summary-line">
            ${thumb(v.image, 'width:30px;height:30px;border-radius:8px;object-fit:cover')}
            <span class="nm">${esc(v.name)} <span class="tag">×${v.qty}</span></span>
            <span class="pr">${money(v.price * v.qty)}</span>
          </div>`).join('')}
        <div class="hr"></div>
        <div class="kv"><span class="k">原价合计</span><span class="v">${money(plan.origTotal)}</span></div>
        <div class="kv"><span class="k">优惠节省</span><span class="v" style="color:var(--green)">−${money(plan.savedCents)}</span></div>
        <div class="kv"><span class="k">订单总额</span><span class="v" style="font-size:16px">${money(plan.totalCents)}</span></div>
        <div class="kv"><span class="k">人均</span><span class="v">${money(plan.perHeadCents)}</span></div>
      </section>

      <section class="card" data-pane="o">
        <div class="row">
          <h3 class="card-title" style="margin:0">② 人员归属清单</h3>
          <div class="spacer"></div>
          <button class="btn small" id="copyOwner" data-ab data-ab-note="按人拆分 · 共 ${plan.perMember.length} 人 · 订单总额 ${money(plan.totalCents)}">一键复制</button>
        </div>
        <p class="card-sub">按人拆分，适合分工取餐与 AA 收款</p>
        ${plan.perMember.map((p) => {
          const row = aa.rows.find((r) => r.memberId === p.memberId);
          const m = room.members.find((x) => x.id === p.memberId);
          return `
          <div style="border-bottom:1px dashed var(--line);padding-bottom:8px;margin-bottom:8px">
            <div class="row" style="justify-content:space-between">
              <b>${esc(p.name)}</b>
              <span>${money(row?.payCents || p.payCents)}${p.overCents > 0 ? ` <span class="tag red">超预算 ${money(p.overCents)}</span>` : ''}</span>
            </div>
            ${p.items.map((i) => `
              <div class="summary-line">
                <span class="nm">${esc(i.name)}${i.isCombo && i.components.length ? `<br><span class="tag">${esc(i.components.map((c) => c.name).join(' + '))}</span>` : ''}${i.adjusted?.length ? `<br><span class="tag blue">特调去掉：${esc(i.adjusted.join('、'))}</span>` : ''}</span>
                <span class="pr">${money(i.priceCents)}</span>
              </div>`).join('')}
            ${p.shareCents ? `<div class="summary-line" style="color:var(--amber)"><span class="nm">共享分摊</span><span class="pr">${money(p.shareCents)}</span></div>` : ''}
            ${m?.note ? `<div class="hint" style="font-size:11.5px;color:var(--faint)">备注：${esc(m.note)}</div>` : ''}
          </div>`;
        }).join('')}
        ${plan.shared.length ? `
          <div style="background:var(--gold-soft);border-radius:10px;padding:10px">
            <b style="font-size:13px">共享小食（${plan.perMember.length} 人平分 · 每人 ${money(plan.shareAlloc[0] || 0)}）</b>
            ${plan.shared.map((s) => `<div class="summary-line"><span class="nm">${esc(s.name)} ×${s.qty}</span><span class="pr">${money(s.priceCents)}</span></div>`).join('')}
          </div>` : ''}
        <div class="hr"></div>
        <div class="table-wrap">
        <table class="aa-table">
          <thead><tr><th>成员</th><th class="num">自己商品</th><th class="num">共享/调整</th><th class="num">应付</th></tr></thead>
          <tbody>${aa.rows.map((r) => `<tr><td data-l="成员">${esc(r.name)}</td><td class="num" data-l="自己商品">${money(r.ownCents)}</td><td class="num" data-l="共享/调整">${r.shareCents >= 0 ? money(r.shareCents) : '−' + money(-r.shareCents)}</td><td class="num" data-l="应付"><b>${money(r.payCents)}</b></td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3" data-l="合计（${(AA_MODES.find((m) => m.v === aa.mode) || {}).t}）">合计（${(AA_MODES.find((m) => m.v === aa.mode) || {}).t}）</td><td class="num ${aa.balanced ? 'balanced-ok' : 'balanced-bad'}" data-l="校验">${money(aa.sumCents)}${aa.balanced ? ' ✓' : ''}</td></tr></tfoot>
        </table>
        </div>
      </section>
    </div>
    </div>

    <section class="card">
      <h3 class="card-title">清单原文</h3>
      <p class="card-sub">可直接粘贴到群聊</p>
      <div class="tabs">
        <span class="tab on" data-t="s">商品汇总</span>
        <span class="tab" data-t="o">人员归属</span>
      </div>
      <div class="list-box" id="textBox">${esc(summaryText(plan, room, ctx.snap))}</div>
    </section>`;
  },

  mount(ctx) {
    const plan = currentPlan(ctx);
    const room = ctx.room;
    const aa = computeAA(plan, room, room.aa?.mode || 'own', room.aa?.custom || {});
    document.getElementById('copySummary').onclick = () => copyText(summaryText(plan, room, ctx.snap));
    document.getElementById('copyOwner').onclick = () => copyText(ownerText(plan, room, aa));
    document.querySelectorAll('[data-t]').forEach((el) => {
      el.onclick = () => {
        document.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === el));
        document.getElementById('textBox').textContent =
          el.dataset.t === 's' ? summaryText(plan, room, ctx.snap) : ownerText(plan, room, aa);
      };
    });
  }
};
