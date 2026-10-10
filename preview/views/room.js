import { realItems, stores } from '../core/data.js';
import {
  MAIN_PREFS, TASTES, DRINKS, APPETITES, AVOIDS, PICKUP_MODES,
  saveRoom, ensureMembers, inviteLink, validateMember
} from '../core/store.js';
import { esc, money, toast, copyText, yuan } from '../core/util.js';

let activeSeat = 0;
let errors = {};
export function resetSeat(i = 0) { activeSeat = i; errors = {}; }

const chipGroup = (opts, cur, name, cls = '') => `
  <div class="chips" data-group="${name}">
    ${opts.map((o) => `<span class="chip ${String(cur) === String(o.v) ? 'on' : ''} ${cls}" data-v="${esc(o.v)}">${esc(o.t)}</span>`).join('')}
  </div>`;

export default {
  render(ctx) {
    const room = ctx.room;
    const members = room.members;
    const m = members[activeSeat] || members[0];
    const filled = members.filter((x) => x.filled).length;
    const items = realItems();
    const picks = (m.fixed || []).map((c) => items.find((i) => i.code === c)).filter(Boolean);

    return `
    <div class="row" style="margin-bottom:12px">
      <h2 class="card-title" style="margin:0">拼单房间 <span class="code-badge">${esc(room.code)}</span></h2>
      <div class="spacer"></div>
      <a class="btn ghost small" href="#/">返回首页</a>
    </div>

    <div class="room-grid">
      <div class="col-a">
        <section class="card room-seats">
          <h3 class="card-title">席位进度</h3>
          <div class="row" style="justify-content:space-between">
            <span class="seat-progress">已填写 <b id="filledNum">${filled}</b> / ${members.length}</span>
            <span class="seat-progress">个人预算合计 ¥<b id="budgetSum">${yuan(members.reduce((a, x) => a + (Number(x.budget) || 0), 0) * 100)}</b></span>
          </div>
          <div class="seat-list">
            ${members.map((mm, i) => `
              <div class="seat ${i === activeSeat ? 'active' : ''} ${mm.filled ? 'filled' : ''}" data-seat="${i}">
                <div class="avatar">${esc((mm.name || String(mm.seat))[0])}</div>
                <div class="body">
                  <div class="nm">${esc(mm.name || `席位 ${mm.seat}`)}</div>
                  <div class="st">${mm.filled ? `预算 ¥${yuan(Number(mm.budget || 0) * 100)} · 已填` : '待填写'}</div>
                </div>
                ${mm.filled ? '<span class="tag green">已填</span>' : '<span class="tag">待填</span>'}
              </div>`).join('')}
          </div>
          <button class="btn primary block" id="genBtn" data-ab data-ab-note="已填写 ${filled}/${members.length} 人" ${filled < members.length ? 'disabled' : ''}>
            ${filled < members.length ? `还有 ${members.length - filled} 人未填写` : '生成三套方案'}
          </button>
        </section>

        <section class="card room-settings">
          <details class="fold">
            <summary>
              房间设置
              <span class="sum-sub">${room.people} 人 · ${esc((stores().find((s) => s.storeCode === room.storeCode) || {}).storeName || '未选门店')} · ${esc((PICKUP_MODES.find((p) => String(p.v) === String(room.pickup)) || {}).t || '到店自提')}${room.budgetTotal ? ` · 预算 ¥${yuan(room.budgetTotal * 100)}` : ''}</span>
            </summary>
            <div class="fold-body">
          <p class="card-sub" style="margin:0 0 12px">发起人填写，所有人共享</p>

          <div class="field">
            <label>用餐人数</label>
            <input type="number" id="people" min="2" max="10" value="${room.people}" />
            <span class="hint">2–10 人，改动后会自动增减席位</span>
          </div>

          <div class="field">
            <label>门店</label>
            <select id="storeSel">
              ${stores().map((s) => `<option value="${esc(s.storeCode)}" ${s.storeCode === room.storeCode ? 'selected' : ''}>${esc(s.storeName)}（${esc(s.scene)}）</option>`).join('')}
            </select>
            <span class="hint">${esc((stores().find((s) => s.storeCode === room.storeCode) || {}).address || '')}</span>
          </div>

          <div class="field">
            <label>取餐方式</label>
            <select id="pickup">
              ${PICKUP_MODES.map((p) => `<option value="${p.v}" ${String(room.pickup) === p.v ? 'selected' : ''}>${p.t}</option>`).join('')}
            </select>
          </div>

          <div class="field">
            <label>总预算（元，可留 0 表示不限）</label>
            <input type="number" id="budgetTotal" min="0" step="5" value="${room.budgetTotal}" />
          </div>

          <div class="field">
            <label>截止时间</label>
            <input type="datetime-local" id="deadline" value="${room.deadline || ''}" />
          </div>

          <div class="field">
            <label>是否允许共享小食</label>
            <div class="chips" data-group="allowShare">
              <span class="chip ${room.allowShare ? 'on' : ''}" data-v="1">允许共享（拼盘按人数平分）</span>
              <span class="chip ${!room.allowShare ? 'on' : ''}" data-v="0">各点各的</span>
            </div>
          </div>
            </div>
          </details>
        </section>

        <section class="card room-invite">
          <details class="fold">
            <summary>
              邀请
              <span class="sum-sub">房间码 ${esc(room.code)} · 点击复制链接</span>
            </summary>
            <div class="fold-body">
          <p class="card-sub" style="margin:0 0 12px">MVP 未做跨设备同步，链接与房间码保存在本机浏览器</p>
          <div class="invite-box" id="inviteText">${esc(inviteLink(room))}</div>
          <div class="row" style="margin-top:10px">
            <button class="btn small" id="copyLink">复制邀请链接</button>
            <button class="btn small" id="copyCode">复制房间码</button>
            <button class="btn small" id="copySeatLink">复制「席位${m ? m.seat : ''}」专属链接</button>
          </div>
            </div>
          </details>
        </section>

      </div>

      <div class="col-b">
        <section class="card room-form">
          <h3 class="card-title">${esc(m ? `席位 ${m.seat}` : '席位')} · 填写需求</h3>
          <p class="card-sub">选「随便」时，预算与忌口是必填项——至少告诉我们这两件事</p>

          <div class="grid" style="grid-template-columns:1fr 1fr;gap:0 12px">
            <div class="field ${errors.name ? 'invalid' : ''}">
              <label>昵称</label>
              <input type="text" id="mName" value="${esc(m?.name || '')}" placeholder="小明" />
              ${errors.name ? `<span class="err">${esc(errors.name)}</span>` : ''}
            </div>
            <div class="field ${errors.budget ? 'invalid' : ''}">
              <label>个人预算（元）</label>
              <input type="number" id="mBudget" min="5" max="200" step="1" value="${m?.budget ?? 35}" />
              ${errors.budget ? `<span class="err">${esc(errors.budget)}</span>` : ''}
            </div>
          </div>

          <div class="field"><label>主食偏好</label>${chipGroup(MAIN_PREFS, m?.mainPref, 'mainPref')}</div>
          <div class="field"><label>口味</label>${chipGroup(TASTES, m?.taste, 'taste')}</div>
          <div class="field"><label>饮料</label>${chipGroup(DRINKS, m?.drinkPref, 'drinkPref')}</div>
          <div class="field"><label>食量</label>${chipGroup(APPETITES, m?.appetite, 'appetite')}</div>

          <div class="field ${errors.avoid ? 'invalid' : ''}">
            <label>忌口 / 过敏（可多选）</label>
            ${chipGroup(AVOIDS, [], 'avoid', 'danger')}
            <div class="row" style="margin-top:6px">
              <span class="chip ${m?.avoidAcknowledged ? 'on' : ''}" id="ackBtn">${m?.avoidAcknowledged ? '✓ 已确认忌口情况' : '确认忌口（无忌口也请点一下）'}</span>
              <span class="hint">当前：${(m?.avoid || []).length ? m.avoid.map((t) => esc((AVOIDS.find((a) => a.v === t) || {}).t || t)).join('、') : '未选择'}</span>
            </div>
            ${errors.avoid ? `<span class="err">${esc(errors.avoid)}</span>` : ''}
          </div>

          <div class="field">
            <label>指定商品（可不填，输入名称搜索）</label>
            <div class="row">
              <input type="text" id="fixedInput" list="menuList" placeholder="如：板烧鸡腿堡、麦辣鸡腿汉堡三件套" style="flex:1" />
              <datalist id="menuList">
                ${items.map((i) => `<option value="${esc(i.name)}">${esc(i.name)} ¥${yuan(i.price)}</option>`).join('')}
              </datalist>
              <button class="btn small" id="addFixed">添加</button>
            </div>
            <div class="chips" style="margin-top:6px">
              ${picks.length ? picks.map((p) => `<span class="chip on gold" data-rmfix="${esc(p.code)}">${esc(p.name)} ×</span>`).join('') : '<span class="hint">未指定</span>'}
            </div>
          </div>

          <div class="field">
            <label>备注</label>
            <textarea id="mNote" rows="2" placeholder="如：不要香菜、饮料要常温">${esc(m?.note || '')}</textarea>
          </div>

          <div class="row">
            <button class="btn primary" id="saveSeat">保存并填下一位</button>
            <button class="btn" id="saveOnly">仅保存</button>
            ${m?.filled ? '<span class="tag green">本席位已填写</span>' : ''}
          </div>
        </section>
      </div>
    </div>`;
  },

  mount(ctx) {
    const room = ctx.room;
    const members = room.members;
    const m = members[activeSeat];
    const rerender = () => ctx.rerender();
    const persist = () => saveRoom(room);

    // ---- 房间设置 ----
    const people = document.getElementById('people');
    people.onchange = () => {
      room.people = Math.max(2, Math.min(10, Number(people.value) || 2));
      ensureMembers(room);
      if (activeSeat >= room.people) activeSeat = room.people - 1;
      room.budgetTotal = room.people * 35;
      persist(); rerender();
    };
    const storeSel = document.getElementById('storeSel');
    storeSel.onchange = () => {
      const s = stores().find((x) => x.storeCode === storeSel.value);
      room.storeCode = s.storeCode; room.storeName = s.storeName;
      persist(); rerender();
    };
    const pickup = document.getElementById('pickup');
    pickup.onchange = () => { room.pickup = pickup.value; persist(); };
    const budgetTotal = document.getElementById('budgetTotal');
    budgetTotal.oninput = () => { room.budgetTotal = Number(budgetTotal.value) || 0; persist(); };
    const deadline = document.getElementById('deadline');
    deadline.onchange = () => { room.deadline = deadline.value; persist(); };

    document.querySelectorAll('[data-group="allowShare"] .chip').forEach((el) => {
      el.onclick = () => { room.allowShare = el.dataset.v === '1'; persist(); rerender(); };
    });

    // ---- 邀请 ----
    document.getElementById('copyLink').onclick = () => copyText(inviteLink(room));
    document.getElementById('copyCode').onclick = () => copyText(room.code);
    document.getElementById('copySeatLink').onclick = () => copyText(inviteLink(room, members[activeSeat].seat));

    // ---- 席位切换 ----
    document.querySelectorAll('.seat[data-seat]').forEach((el) => {
      el.onclick = () => { activeSeat = Number(el.dataset.seat); errors = {}; rerender(); };
    });

    // ---- 生成方案 ----
    const genBtn = document.getElementById('genBtn');
    if (genBtn) genBtn.onclick = () => {
      room.edits = { locked: {}, removed: {}, added: {} };
      room.chosenPlan = null;
      persist();
      location.hash = `#/plans/${room.code}`;
    };

    // ---- 问卷：文本类即时保存 ----
    const mName = document.getElementById('mName');
    mName.oninput = () => { m.name = mName.value; persist(); };
    const mBudget = document.getElementById('mBudget');
    mBudget.oninput = () => { m.budget = Number(mBudget.value) || 0; persist(); };
    const mNote = document.getElementById('mNote');
    mNote.oninput = () => { m.note = mNote.value; persist(); };

    // ---- 问卷：单选类 ----
    document.querySelectorAll('.chips[data-group]').forEach((g) => {
      const name = g.dataset.group;
      if (name === 'allowShare') return;
      g.querySelectorAll('.chip').forEach((el) => {
        el.onclick = () => {
          if (name === 'avoid') {
            const v = el.dataset.v;
            const cur = new Set(m.avoid || []);
            cur.has(v) ? cur.delete(v) : cur.add(v);
            m.avoid = [...cur];
            m.avoidAcknowledged = true;
          } else {
            m[name] = el.dataset.v;
          }
          persist(); rerender();
        };
        if (name === 'avoid') {
          el.classList.toggle('on', (m.avoid || []).includes(el.dataset.v));
        }
      });
    });

    const ackBtn = document.getElementById('ackBtn');
    ackBtn.onclick = () => { m.avoidAcknowledged = !m.avoidAcknowledged; persist(); rerender(); };

    // ---- 指定商品 ----
    const fixedInput = document.getElementById('fixedInput');
    const addFixed = () => {
      const name = (fixedInput.value || '').trim();
      if (!name) return;
      const it = realItems().find((i) => i.name === name);
      if (!it) { toast('没找到这个商品，请从下拉列表里选'); return; }
      const cur = new Set(m.fixed || []);
      cur.add(it.code);
      m.fixed = [...cur];
      fixedInput.value = '';
      persist(); rerender();
    };
    document.getElementById('addFixed').onclick = addFixed;
    fixedInput.onkeydown = (e) => { if (e.key === 'Enter') addFixed(); };
    document.querySelectorAll('[data-rmfix]').forEach((el) => {
      el.onclick = () => {
        m.fixed = (m.fixed || []).filter((c) => c !== el.dataset.rmfix);
        persist(); rerender();
      };
    });

    // ---- 保存 ----
    const doSave = (advance) => {
      m.name = document.getElementById('mName').value.trim();
      m.budget = Number(document.getElementById('mBudget').value) || 0;
      m.note = document.getElementById('mNote').value;
      errors = validateMember(m);
      if (Object.keys(errors).length) { persist(); rerender(); toast('还有必填项没确认'); return; }
      m.filled = true;
      persist();
      if (advance) {
        const next = members.findIndex((x, i) => i > activeSeat && !x.filled);
        if (next >= 0) activeSeat = next;
        else {
          const anyUnfilled = members.findIndex((x) => !x.filled);
          activeSeat = anyUnfilled >= 0 ? anyUnfilled : activeSeat;
        }
        errors = {};
      }
      rerender();
      toast(advance ? '已保存' : '本席位已保存');
    };
    document.getElementById('saveSeat').onclick = () => doSave(true);
    document.getElementById('saveOnly').onclick = () => doSave(false);
  }
};
