import { generatePlans } from '../core/engine.js';
import { saveRoom } from '../core/store.js';
import { esc, money, yuan, pct, toast, thumb } from '../core/util.js';

const cache = { key: '', data: null };

function compute(ctx) {
  const key = `${ctx.room.code}|${JSON.stringify(ctx.room.edits)}|${ctx.room.allowShare}|${ctx.room.budgetTotal}`;
  if (cache.key === key && cache.data) return cache.data;
  const data = generatePlans(ctx.snap, ctx.room, ctx.room.edits || {});
  cache.key = key; cache.data = data;
  return data;
}
export function invalidate() { cache.key = ''; cache.data = null; }

const LABEL = { cheap: '方案 A', balanced: '方案 B', satisfy: '方案 C' };

function bar(k, v, cls = '') {
  return `<div class="score-line"><span class="k">${k}</span><span class="bar"><i class="${cls}" style="width:${Math.round(Math.max(0, v) * 100)}%"></i></span><span class="v">${pct(v)}</span></div>`;
}

function memberBlock(pm) {
  return `
  <div class="member-block">
    <div class="mh">
      <span class="nm">${esc(pm.name)}</span>
      <span class="tag">${Math.round(pm.totalKcal)} kcal</span>
      <span class="cost ${pm.overCents > 0 ? 'over' : ''}">${money(pm.payCents)}${pm.overCents > 0 ? ` <span class="tag red">超${money(pm.overCents)}</span>` : ''}</span>
    </div>
    ${pm.items.map((it) => `
      <div class="item-line">
        ${thumb(it.image)}
        <span class="nm">${esc(it.name)}${it.isCombo && it.components.length ? `<span class="tag" style="margin-left:4px">${esc(it.components.map((c) => c.name).join('+'))}</span>` : ''}</span>
        <span class="pr">${money(it.priceCents)}</span>
      </div>`).join('')}
    ${pm.shareCents ? `<div class="item-line" style="color:var(--amber)"><span class="nm">共享分摊</span><span class="pr">${money(pm.shareCents)}</span></div>` : ''}
  </div>`;
}

export default {
  render(ctx) {
    const { plans, rejected } = compute(ctx);
    const room = ctx.room;

    if (!plans.length) {
      return `<div class="card"><h2 class="card-title">没有可行的方案</h2><p class="card-sub">${esc((rejected[0] || {}).reason || '请放宽忌口或提高预算后重试')}</p><a class="btn" href="#/room/${room.code}">回到房间</a></div>`;
    }

    return `
    <div class="row" style="margin-bottom:12px">
      <h2 class="card-title" style="margin:0">三套方案横向比较</h2>
      <div class="spacer"></div>
      <a class="btn ghost small" href="#/room/${room.code}">改需求</a>
      <a class="btn ghost small" href="#/">回首页</a>
    </div>

    ${rejected.length ? `<div class="risk warn"><div class="rt">有 ${rejected.length} 位成员的可选搭配受限</div><div class="rd">${rejected.map((r) => esc(`${r.memberName}：${r.reason}`)).join('<br>')}</div></div>` : ''}

    <div data-toggle="plan" data-toggle-on="${esc(plans.some((p) => p.id === room.chosenPlan) ? room.chosenPlan : (plans.find((p) => !p.eliminated) || plans[0]).id)}">
      <div class="seg seg-3">
        ${plans.map((p) => `<span class="seg-item" data-seg="${p.id}">${esc(p.title)}${p.eliminated ? ' ⚠' : ''}</span>`).join('')}
      </div>

      <div class="plan-grid">
      ${plans.map((p) => {
        const b = p.breakdown;
        const selected = room.chosenPlan === p.id;
        return `
        <div class="plan-card ${selected ? 'selected' : ''} ${p.eliminated ? 'eliminated' : ''}" data-pane="${p.id}">
          <div class="plan-head">
            <div class="label">${LABEL[p.id] || ''} · ${p.eliminated ? '已淘汰' : '可用'}</div>
            <h3>${p.title}</h3>
            <div class="why">${esc(p.sub)}</div>
            <div class="price-big">${money(p.totalCents)}<small>共 ${room.members.length} 人 · 人均 ${money(p.perHeadCents)}</small></div>
            <div class="row" style="margin-top:6px">
              <span class="tag green">较原价省 ${money(p.savedCents)}</span>
              ${p.shared.length ? `<span class="tag gold">共享 ${p.shared.length} 项</span>` : ''}
              ${p.eliminated ? '<span class="tag red">忌口硬冲突</span>' : ''}
            </div>
          </div>

          <div class="plan-body">
            ${bar('偏好满足', b.pref)}
            ${bar('预算符合', b.budget)}
            ${bar('饱腹匹配', b.full, 'g')}
            ${bar('优惠程度', b.discount, 'y')}
            ${bar('共享合理', b.share)}
            <div class="total-score">
              <span style="font-size:12px;color:var(--muted)">综合得分${p.eliminated ? '（淘汰）' : ''}</span>
              <b>${(p.score * 100).toFixed(1)}</b>
            </div>
            ${b.penalty > 0 ? `<div class="over-list">冲突惩罚 −${(b.penalty * 100).toFixed(1)}（缺主食 ${Math.round(b.noMain * 100)}% · 缺饮料 ${Math.round(b.noDrink * 100)}% · 超预算 ${Math.round(b.over * 100)}%）</div>` : ''}
            <div class="hr"></div>
            <div style="font-size:12px;font-weight:700;margin-bottom:4px">推荐理由</div>
            <ul class="reason-list">
              ${p.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}
            </ul>
            ${p.eliminated ? `<div class="risk block" style="margin-top:8px"><div class="rt">淘汰原因</div><div class="rd">${p.hardConflicts.map((h) => esc(`${h.memberName}：${h.itemName} 含 ${h.tags.join('、')}`)).join('<br>')}</div></div>` : ''}
          </div>

          ${p.perMember.map(memberBlock).join('')}

          ${p.shared.length ? `
          <div class="shared-block">
            <div class="sh">🍟 共享小食（${room.members.length} 人平分）</div>
            ${p.shared.map((s) => `<div class="item-line">${thumb(s.image)}<span class="nm">${esc(s.name)} ×${s.qty}</span><span class="pr">${money(s.priceCents)}</span></div>`).join('')}
            <div class="alloc">每人分摊 ${money(p.shareAlloc[0] || 0)} · 约 ${Math.round(p.shared.reduce((a, s) => a + s.kcal, 0) / room.members.length)} kcal</div>
          </div>` : `<div class="shared-block"><div class="sh" style="color:#7a5a00">未安排共享小食</div><div class="alloc">${room.allowShare ? '当前预算/忌口条件下没有合适的拼盘' : '房间设置为各点各的'}</div></div>`}

          <div class="plan-foot">
            <button class="btn ${selected ? '' : 'primary'} block" data-choose="${p.id}" ${p.eliminated ? 'disabled' : ''}
              ${selected ? '' : `data-ab data-ab-note="${p.title} · 共 ${money(p.totalCents)} · 人均 ${money(p.perHeadCents)}"`}>
              ${selected ? '✓ 已选择此方案' : `选择「${p.title}」`}
            </button>
            ${selected ? `<a class="btn small" id="confirmLink" href="#/confirm/${room.code}" data-ab data-ab-note="已选「${p.title}」· 共 ${money(p.totalCents)} · 人均 ${money(p.perHeadCents)}">去确认 ›</a>` : ''}
          </div>
        </div>`;
      }).join('')}
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div style="font-size:12.5px;color:var(--muted)">
        <b>评分口径：</b>偏好满足 35% + 预算符合 25% + 饱腹匹配 15% + 优惠程度 15% + 共享合理 10% − 冲突惩罚（缺主食 0.15 / 缺饮料 0.10 / 超预算 0.20，按人数占比加权）。
        忌口硬冲突方案直接淘汰，不参与选择。
      </div>
    </div>`;
  },

  mount(ctx) {
    document.querySelectorAll('[data-choose]').forEach((el) => {
      el.onclick = () => {
        ctx.room.chosenPlan = el.dataset.choose;
        ctx.room.edits = { locked: {}, removed: {}, added: {} };
        saveRoom(ctx.room);
        toast('已选择方案，进入确认页可继续调整');
        location.hash = `#/confirm/${ctx.room.code}`;
      };
    });
  }
};
