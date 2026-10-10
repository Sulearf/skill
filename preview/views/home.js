import { dataUpdatedText, getData, stores, applySoldOut, realItems } from '../core/data.js';
import { createRoom, saveRoom, listRooms, getRoom, inviteLink } from '../core/store.js';
import { esc, fmtTime, money, toast } from '../core/util.js';

const FLOW = [
  ['01', '收集需求', '发起人设人数/门店/预算/取餐方式，参与者填预算、偏好、忌口'],
  ['02', '自动搭配', '按预算档位与忌口过滤，生成每人候选搭配'],
  ['03', '优惠优化', '优先套餐与促销价，参与共享小食分摊'],
  ['04', 'AA 分账', '三种分账模式，余款最大余额法抹平到分'],
  ['05', '生成清单', '商品汇总 + 人员归属两类清单，一键复制']
];

const NOT_DO = [
  '不自动登录麦当劳账号', '不自动支付', '不未经确认自动下单',
  '不叠加会员权益', '不提供营养/医疗建议', '不做跨品牌比价'
];

export default {
  render(ctx) {
    const d = getData();
    const snap = d.snapshot;
    const rooms = listRooms().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5);

    if (!snap) {
      return `
        <div class="card">
          <h2 class="card-title">菜单数据加载失败</h2>
          <p class="card-sub">${esc(d.error || '未知错误')}</p>
          <button class="btn primary" id="retryBtn">重新加载</button>
        </div>`;
    }

    const m = snap.meta;
    const degraded = d.degraded || [];   // loadData 已把快照自带的降级项合并进来

    return `
    <section class="card hero">
      <h1>多人拼单，不再纠结</h1>
      <p>收集每个人的预算、偏好与忌口 → 自动生成三套可比较方案 → 检查风险 → AA 分账 → 复制下单清单。全程只做决策辅助，下单仍由你在麦当劳 App 完成。</p>
      <div class="hero-actions">
        <button class="btn primary" id="createBtn" data-ab data-ab-note="菜单 ${esc(m.counts.items)} 件 · 更新于 ${esc(m.sourceFetchedAt)}">发起拼单</button>
        <div class="join-row">
          <input type="text" id="joinCode" class="join-input" placeholder="输入房间码，如 A3F9K" maxlength="6" inputmode="text" autocomplete="off" />
          <button class="btn" id="joinBtn">加入</button>
        </div>
      </div>
      <div class="flow">
        ${FLOW.map(([n, t, dd]) => `<div class="flow-item"><div class="n">${n}</div><div class="t">${t}</div><div class="d">${dd}</div></div>`).join('')}
      </div>
    </section>

    <div class="grid g-home">
      <div class="g-col">
        <section class="card">
          <h2 class="card-title">数据源与更新时间</h2>
          <p class="card-sub">${esc(dataUpdatedText())}｜快照生成于 ${esc(fmtTime(m.generatedAt))}｜取数门店 ${esc(m.sourceStore.name)}（${esc(m.sourceStore.code)}）</p>
          <div class="stat-grid">
            <div class="stat"><b>${m.counts.stores}</b><span>可点餐门店</span></div>
            <div class="stat"><b>${m.counts.items}</b><span>在售商品</span></div>
            <div class="stat"><b>${m.counts.combos}</b><span>套餐</span></div>
            <div class="stat"><b>${m.counts.coupons}</b><span>可领取券</span></div>
          </div>
          <div class="hr"></div>
          <div style="font-size:12.5px;font-weight:700;margin-bottom:6px">降级与口径说明</div>
          ${degraded.map((x) => `
            <div class="risk warn" style="margin-bottom:6px">
              <div class="rt">${esc(x.module)}</div>
              <div class="rd">${esc(x.reason)}<br><b>影响：</b>${esc(x.impact)}</div>
            </div>`).join('') || '<div class="empty">无降级项</div>'}
          ${d.source === 'file' ? '<div class="risk info"><div class="rt">正在使用本地快照文件</div><div class="rd">接口不可达时会自动降级，价格与可售状态可能不是最新。</div></div>' : ''}
          <div class="hr"></div>
          <div style="font-size:12.5px;font-weight:700;margin-bottom:6px">可售状态（演示用）</div>
          <div class="row">
            <button class="btn small" id="demoSoldOut">标记 1 件商品售罄</button>
            <button class="btn small" id="demoRestore">恢复全部可售</button>
            <span class="hint">当前售罄 <b id="soldOutNum">${(d.snapshot.soldOut || []).length}</b> 件 —— 售罄商品会在确认页触发阻断提示并给出同类替换建议</span>
          </div>
        </section>

        ${rooms.length ? `
        <section class="card">
          <h2 class="card-title">本地最近房间</h2>
          <p class="card-sub">数据存在本机浏览器 localStorage，换设备不会同步。</p>
          ${rooms.map((r) => `
            <div class="seat" style="cursor:default">
              <div class="avatar">${esc((r.hostName || 'M')[0])}</div>
              <div class="body">
                <div class="nm">${esc(r.hostName || '发起人')} 的拼单 · ${r.people} 人 · ${esc(r.storeName || '未选门店')}</div>
                <div class="st">房间码 ${esc(r.code)} · ${esc(fmtTime(r.createdAt))}</div>
              </div>
              <a class="btn small" href="#/room/${r.code}">进入</a>
            </div>`).join('')}
        </section>` : ''}
      </div>

      <div class="g-col">
        <section class="card">
          <h2 class="card-title">这个工具不做什么</h2>
          <div class="chips" style="margin-top:8px">
            ${NOT_DO.map((x) => `<span class="tag red">${x}</span>`).join('')}
          </div>
          <div class="hr"></div>
          <div style="font-size:12.5px;color:var(--muted)">
            价格与优惠按当前菜单快照估算；<b>下单前请在麦当劳 App/小程序内二次确认价格与可售状态</b>。
            涉及过敏，请以麦当劳官方说明与门店确认为准。
          </div>
        </section>

        <section class="card">
          <h2 class="card-title">可点餐门店（示例）</h2>
          <p class="card-sub">共 ${stores().length} 家，来自深圳科技园 / 上海陆家嘴 / 北京中关村的位置搜索</p>
          <div style="max-height:260px;overflow:auto">
            ${stores().slice(0, 12).map((s) => `
              <div class="kv"><span class="k">${esc(s.storeName)}</span><span class="v">${esc(s.scene)}</span></div>`).join('')}
          </div>
        </section>
      </div>
    </div>`;
  },

  mount(ctx) {
    const retry = document.getElementById('retryBtn');
    if (retry) retry.onclick = () => location.reload();

    const create = document.getElementById('createBtn');
    if (create) create.onclick = () => {
      const room = createRoom({ people: 3 });
      saveRoom(room);
      location.hash = `#/room/${room.code}`;
    };
    const soldOutBtn = document.getElementById('demoSoldOut');
    if (soldOutBtn) soldOutBtn.onclick = () => {
      const cur = getData().snapshot.soldOut || [];
      const pool = realItems().filter((i) => !cur.includes(i.code) && i.kind !== 'other');
      if (!pool.length) { toast('已全部售罄'); return; }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      applySoldOut([...cur, pick.code]);
      toast(`已把「${pick.name}」标记为售罄`);
      ctx.rerender();
    };
    const restoreBtn = document.getElementById('demoRestore');
    if (restoreBtn) restoreBtn.onclick = () => { applySoldOut([]); toast('已恢复全部可售'); ctx.rerender(); };

    const join = document.getElementById('joinBtn');
    const codeInput = document.getElementById('joinCode');
    if (join && codeInput) {
      const go = () => {
        const code = (codeInput.value || '').trim().toUpperCase();
        if (!code) { toast('请输入房间码'); return; }
        if (!getRoom(code)) { toast('本机没有这个房间（MVP 未做跨设备同步）'); return; }
        location.hash = `#/room/${code}`;
      };
      join.onclick = go;
      codeInput.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    }
  }
};
