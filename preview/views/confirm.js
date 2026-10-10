import { generatePlans } from '../core/engine.js';
import { checkPlan, suggestReplacement } from '../core/risk.js';
import { computeAA, AA_MODES, normalizeCustom } from '../core/split.js';
import { saveRoom } from '../core/store.js';
import { realItems } from '../core/data.js';
import { esc, money, yuan, toast, copyText, thumb } from '../core/util.js';

let tab = 0; // 0..n-1 成员，n = 共享
export function resetTab(i = 0) { tab = i; }

function entryOf(snap, code) {
  const it = snap.itemMap.get(code);
  if (!it) return null;
  return {
    code: it.code, name: it.name, image: it.image, kind: it.kind,
    priceCents: it.price, origCents: Math.max(it.origPrice || it.price, it.price),
    kcal: it.kcal || 0, diet: it.diet || [], removable: it.removable || [],
    components: [], isCombo: !!it.isCombo, qty: 1
  };
}

export default {
  render(ctx) {
    const { snap, room } = ctx;
    const edits = room.edits || { locked: {}, removed: {}, added: {} };
    const { plans } = generatePlans(snap, room, edits);
    const plan = plans.find((p) => p.id === room.chosenPlan) || plans[0];
    if (!plan) return `<div class="card"><h2 class="card-title">没有可用的方案</h2><a class="btn" href="#/plans/${room.code}">返回方案页</a></div>`;

    const risks = checkPlan(snap, room, plan);
    const aa = computeAA(plan, room, room.aa?.mode || 'own', room.aa?.custom || {});
    const members = room.members;
    const isSharedTab = tab >= members.length;
    const cur = isSharedTab ? null : plan.perMember[tab];
    const curMember = isSharedTab ? null : members[tab];

    const items = realItems();
    const altOptions = (it, avoid) => suggestReplacement(snap, snap.itemMap.get(it.code) || it, avoid, 6);

    return `
    <div class="row" style="margin-bottom:12px">
      <h2 class="card-title" style="margin:0">编辑与确认</h2>
      <div class="spacer"></div>
      <a class="btn ghost small" href="#/plans/${room.code}">换方案</a>
      <a class="btn ghost small" href="#/room/${room.code}">改需求</a>
    </div>

    <div class="grid g-confirm">
      <div class="g-col">
        <div class="card">
          <div class="tabs">
            ${members.map((m, i) => `<span class="tab ${i === tab ? 'on' : ''}" data-tab="${i}">${esc(m.name || '席位' + m.seat)} ${money(plan.perMember[i]?.payCents || 0)}</span>`).join('')}
            <span class="tab ${isSharedTab ? 'on' : ''}" data-tab="${members.length}">共享 ${plan.shared.length}</span>
          </div>

          ${isSharedTab ? `
            <div class="card-sub">共享小食由 ${members.length} 人平摊。共享项必须所有人都能吃，否则会触发冲突检查。</div>
            ${plan.shared.length ? plan.shared.map((s) => `
              <div class="item-line" style="padding:8px 0">
                ${thumb(s.image, 'width:34px;height:34px')}
                <span class="nm"><b>${esc(s.name)}</b> ×${s.qty}<br><span class="tag">${s.kcal} kcal</span></span>
                <span class="pr">${money(s.priceCents)}</span>
              </div>`).join('') : '<div class="empty">本方案没有共享小食</div>'}
            <div class="hr"></div>
            <div class="row">
              <input type="text" id="addSharedInput" list="menuList2" placeholder="添加共享拼盘，如：BFF四宫格小食盘" style="flex:1" />
              <datalist id="menuList2">
                ${items.filter((i) => i.shareable).map((i) => `<option value="${esc(i.name)}">${esc(i.name)} ¥${yuan(i.price)}</option>`).join('')}
              </datalist>
              <button class="btn small" id="addShared">添加共享</button>
            </div>
          ` : `
            <div class="row" style="justify-content:space-between;margin-bottom:8px">
              <div>
                <b>${esc(curMember.name || '席位' + curMember.seat)}</b>
                <span class="tag">${Math.round(cur.totalKcal)} kcal</span>
                <span class="tag">预算 ${money(cur.budgetCents)}</span>
              </div>
              <b class="${cur.overCents > 0 ? '' : ''}" style="color:${cur.overCents > 0 ? 'var(--red)' : 'var(--text)'}">应付 ${money(cur.payCents)}</b>
            </div>

            ${cur.items.map((it) => {
              const locked = (edits.locked[curMember.id] || []).includes(it.code);
              return `
              <div class="item-line" style="padding:8px 0;border-bottom:1px solid var(--line)">
                ${thumb(it.image, 'width:36px;height:36px')}
                <span class="nm">
                  <b>${esc(it.name)}</b>
                  ${it.isCombo && it.components.length ? `<br><span class="tag">${esc(it.components.map((c) => c.name).join(' + '))}</span>` : ''}
                  ${it.adjusted?.length ? `<br><span class="tag blue">特调去掉：${esc(it.adjusted.join('、'))}</span>` : ''}
                  <br><span class="tag">${it.kcal} kcal</span> <span class="tag">${esc(it.kind)}</span>
                </span>
                <span class="pr">${money(it.priceCents)}</span>
                <span class="item-act">
                  <button class="lock-btn ${locked ? 'on' : ''}" data-lock="${esc(it.code)}" data-mid="${curMember.id}">${locked ? '🔒 已锁定' : '锁定'}</button>
                  <select class="replace-sel" data-code="${esc(it.code)}" data-mid="${curMember.id}" style="width:120px;padding:4px 6px;font-size:12px">
                    <option value="">替换为…</option>
                    ${altOptions(it, curMember.avoid || []).map((a) => `<option value="${esc(a.code)}">${esc(a.name)} ¥${yuan(a.price)}</option>`).join('')}
                  </select>
                  <button class="lock-btn" data-rm="${esc(it.code)}" data-mid="${curMember.id}">移除</button>
                </span>
              </div>`;
            }).join('')}

            <div class="row" style="margin-top:10px">
              <input type="text" id="addItemInput" list="menuList" placeholder="给 ${esc(curMember.name || 'TA')} 添加商品…" style="flex:1" />
              <datalist id="menuList">
                ${items.map((i) => `<option value="${esc(i.name)}">${esc(i.name)} ¥${yuan(i.price)}</option>`).join('')}
              </datalist>
              <button class="btn small" id="addItem">添加</button>
            </div>
            <div class="hint" style="font-size:11.5px;color:var(--faint);margin-top:6px">
              锁定后点「重新计算」，被锁商品会保留，其余部分由引擎补齐；移除的商品不会再被推荐回来。
            </div>
          `}

          <div class="row" style="margin-top:12px">
            <button class="btn primary" id="recalc">按当前锁定重新计算</button>
            <button class="btn" id="resetEdits">撤销全部改动</button>
          </div>
        </div>
      </div>

      <div class="g-col">
        <div class="card">
          <h3 class="card-title">确认前风险检查</h3>
          <p class="card-sub">共 ${risks.length} 条 · 阻断 ${risks.filter((r) => r.level === 'block').length} / 警告 ${risks.filter((r) => r.level === 'warn').length} / 提示 ${risks.filter((r) => r.level === 'info').length}</p>
          ${risks.length ? risks.map((r) => `
            <div class="risk ${r.level}">
              <div class="rt">${r.level === 'block' ? '⛔' : r.level === 'warn' ? '⚠️' : 'ℹ️'} ${esc(r.title)}</div>
              <div class="rd">${esc(r.detail)}</div>
              ${r.fix?.alternatives?.length ? `<div class="alt-row">${r.fix.alternatives.map((a) => `<button class="btn small" data-fix="${esc(r.fix.code)}" data-to="${esc(a.code)}" data-mid="${esc(r.fix.memberId || '')}">换成 ${esc(a.name)} ¥${yuan(a.price)}</button>`).join('')}</div>` : ''}
            </div>`).join('') : '<div class="empty">未发现风险</div>'}
        </div>

        <div class="card">
          <h3 class="card-title">AA 分账</h3>
          <div class="chips" data-group="aaMode" style="margin-bottom:10px">
            ${AA_MODES.map((m) => `<span class="chip ${(room.aa?.mode || 'own') === m.v ? 'on' : ''}" data-v="${m.v}" title="${esc(m.d)}">${m.t}</span>`).join('')}
          </div>
          <div class="hint" style="font-size:11.5px;color:var(--faint);margin-bottom:8px">${esc((AA_MODES.find((m) => m.v === (room.aa?.mode || 'own')) || {}).d || '')}</div>
          <div class="table-wrap">
          <table class="aa-table">
            <thead><tr><th>成员</th><th class="num">自己商品</th><th class="num">共享/调整</th><th class="num">应付</th></tr></thead>
            <tbody>
              ${aa.rows.map((r, i) => `
                <tr>
                  <td data-l="成员">${esc(r.name)}</td>
                  <td class="num" data-l="自己商品">${money(r.ownCents)}</td>
                  <td class="num" data-l="共享/调整">${r.shareCents >= 0 ? money(r.shareCents) : '−' + money(-r.shareCents)}</td>
                  <td class="num" data-l="应付">${(room.aa?.mode || 'own') === 'custom'
                    ? `<input type="number" step="0.01" min="0" value="${yuan(r.payCents)}" data-cus="${r.memberId}" />`
                    : `<b>${money(r.payCents)}</b>`}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td data-l="合计">合计</td>
                <td class="num" data-l="自己商品">${money(plan.totalCents - plan.shared.reduce((a, s) => a + s.priceCents, 0))}</td>
                <td class="num" data-l="共享">${money(plan.shared.reduce((a, s) => a + s.priceCents, 0))}</td>
                <td class="num" data-l="订单总额">${money(plan.totalCents)}</td>
              </tr>
              <tr><td colspan="3" data-l="个人金额合计">个人金额合计</td><td class="num ${aa.balanced ? 'balanced-ok' : 'balanced-bad'}" data-l="校验">${money(aa.sumCents)}${aa.balanced ? ' ✓ 与订单总额一致' : `（差 ${money(aa.diffCents)}）`}</td></tr>
            </tfoot>
          </table>
          </div>
          ${!aa.balanced ? '<div class="row" style="margin-top:8px"><button class="btn small" id="balanceBtn">一键摊平差额</button><span class="hint">按当前金额比例重新分配，保证合计等于订单总额</span></div>' : ''}
        </div>

        <div class="card">
          <div class="kv"><span class="k">订单总额</span><span class="v">${money(plan.totalCents)}</span></div>
          <div class="kv"><span class="k">原价合计</span><span class="v">${money(plan.origTotal)}</span></div>
          <div class="kv"><span class="k">优惠节省</span><span class="v" style="color:var(--green)">−${money(plan.savedCents)}</span></div>
          <div class="kv"><span class="k">人均</span><span class="v">${money(plan.perHeadCents)}</span></div>
          <div class="row" style="margin-top:12px">
            <button class="btn primary block" id="toResult" data-ab data-ab-note="订单总额 ${money(plan.totalCents)} · 人均 ${money(plan.perHeadCents)}">生成下单清单 ›</button>
          </div>
          ${risks.some((r) => r.level === 'block') ? '<div class="risk block" style="margin-top:8px"><div class="rd">存在阻断项，建议先处理后再生成清单。</div></div>' : ''}
        </div>
      </div>
    </div>`;
  },

  mount(ctx) {
    const { snap, room } = ctx;
    const edits = room.edits || { locked: {}, removed: {}, added: {} };
    const rerender = () => ctx.rerender();
    const persist = () => { room.edits = edits; saveRoom(room); };
    const push = (bucket, mid, code) => {
      edits[bucket][mid] = edits[bucket][mid] || [];
      if (!edits[bucket][mid].includes(code)) edits[bucket][mid].push(code);
    };
    const drop = (bucket, mid, code) => {
      edits[bucket][mid] = (edits[bucket][mid] || []).filter((c) => c !== code);
    };

    document.querySelectorAll('[data-tab]').forEach((el) => {
      el.onclick = () => { tab = Number(el.dataset.tab); rerender(); };
    });

    // 锁定
    document.querySelectorAll('[data-lock]').forEach((el) => {
      el.onclick = () => {
        const mid = el.dataset.mid, code = el.dataset.lock;
        const on = (edits.locked[mid] || []).includes(code);
        on ? drop('locked', mid, code) : push('locked', mid, code);
        persist(); rerender();
      };
    });
    // 移除
    document.querySelectorAll('[data-rm]').forEach((el) => {
      el.onclick = () => {
        const mid = el.dataset.mid, code = el.dataset.rm;
        push('removed', mid, code);
        drop('locked', mid, code);
        edits.added[mid] = (edits.added[mid] || []).filter((c) => c !== code);
        persist(); rerender(); toast('已移除，点「重新计算」让引擎补齐');
      };
    });
    // 替换
    document.querySelectorAll('.replace-sel').forEach((el) => {
      el.onchange = () => {
        const mid = el.dataset.mid, from = el.dataset.code, to = el.value;
        if (!to) return;
        push('removed', mid, from);
        drop('locked', mid, from);
        push('added', mid, to);
        push('locked', mid, to);
        persist(); rerender(); toast('已替换');
      };
    });

    // 添加商品
    const addItem = document.getElementById('addItem');
    if (addItem) addItem.onclick = () => {
      const name = (document.getElementById('addItemInput').value || '').trim();
      const it = realItems().find((i) => i.name === name);
      const mid = room.members[tab].id;
      if (!it) { toast('请从列表中选择商品'); return; }
      push('added', mid, it.code); push('locked', mid, it.code);
      persist(); rerender();
    };
    const addShared = document.getElementById('addShared');
    if (addShared) addShared.onclick = () => {
      const name = (document.getElementById('addSharedInput').value || '').trim();
      const it = realItems().find((i) => i.name === name);
      if (!it) { toast('请从列表中选择拼盘'); return; }
      edits.sharedAdded = edits.sharedAdded || [];
      if (!edits.sharedAdded.includes(it.code)) edits.sharedAdded.push(it.code);
      persist(); rerender();
    };

    // 风险项一键修复
    document.querySelectorAll('[data-fix]').forEach((el) => {
      el.onclick = () => {
        const from = el.dataset.fix, to = el.dataset.to, mid = el.dataset.mid;
        if (mid) { push('removed', mid, from); push('added', mid, to); push('locked', mid, to); }
        persist(); rerender(); toast('已替换冲突商品');
      };
    });

    // 重新计算 / 撤销
    document.getElementById('recalc').onclick = () => { persist(); rerender(); toast('已按锁定项重新计算'); };
    document.getElementById('resetEdits').onclick = () => {
      room.edits = { locked: {}, removed: {}, added: {}, sharedAdded: [] };
      saveRoom(room); rerender(); toast('已撤销全部改动');
    };

    // AA
    document.querySelectorAll('[data-group="aaMode"] .chip').forEach((el) => {
      el.onclick = () => {
        room.aa = room.aa || { mode: 'own', custom: {} };
        room.aa.mode = el.dataset.v;
        if (el.dataset.v === 'custom' && !Object.keys(room.aa.custom || {}).length) {
          const { plans } = generatePlans(snap, room, room.edits || {});
          const plan = plans.find((p) => p.id === room.chosenPlan) || plans[0];
          if (plan) room.aa.custom = normalizeCustom(computeAA(plan, room, 'own', {}));
        }
        saveRoom(room); rerender();
      };
    });
    document.querySelectorAll('[data-cus]').forEach((el) => {
      el.onchange = () => {
        room.aa = room.aa || { mode: 'own', custom: {} };
        room.aa.custom = room.aa.custom || {};
        room.aa.custom[el.dataset.cus] = Math.round(Number(el.value || 0) * 100);
        saveRoom(room); rerender();
      };
    });
    const balanceBtn = document.getElementById('balanceBtn');
    if (balanceBtn) balanceBtn.onclick = () => {
      const { plans } = generatePlans(snap, room, room.edits || {});
      const plan = plans.find((p) => p.id === room.chosenPlan) || plans[0];
      const aa = computeAA(plan, room, 'custom', room.aa?.custom || {});
      room.aa.custom = normalizeCustom(aa);
      saveRoom(room); rerender(); toast('已摊平，合计与订单总额一致');
    };

    document.getElementById('toResult').onclick = () => {
      persist();
      location.hash = `#/result/${room.code}`;
    };
  }
};
