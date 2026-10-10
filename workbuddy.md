# 2026-10-09

## 麦当劳「多人拼单不纠结」轻量工具（MVP）

目录：`mcd-pindan/`（静态前端 + 本地 Node 服务，端口 5173）

### 技术选型

- 纯静态 ES modules 前端 + `server.js`（node:http 静态服务 + `/api/snapshot`），无第三方依赖。
- MCP 只能在构建期调用，因此用 `tools/build-snapshot.js` 把 MCP 原始响应加工成 `data/snapshot.json`；运行时不请求麦当劳接口（也符合"不代替用户登录/下单"原则）。
- 数据层做三级降级：`/api/snapshot` → `data/snapshot.json` → 明确报错，降级原因透出到 UI。

### MCP 取数（mcd-mcp）

- `query-nearby-stores`（深圳科技园/上海陆家嘴/北京中关村，到店自提 + 得来速）→ 20 家门店
- `query-meals`（门店 1420762）→ 113 件商品，含现价/原价/促销标签/图片
- `query-meal-detail` → 套餐轮次组成 + 可特调项（去洋葱粒、去酸黄瓜、去生菜）
- `list-nutrition-foods` → 160 条热量 → 饱腹匹配
- `available-coupons` → 麦麦省可领取券
- **降级项**：`query-promotions` 仅团餐 beType=6 可用且需配送地址（无地址，已降级）；券可用性需实时校验；MCP 无官方过敏原字段 → 忌口标签由名称推断。

### 关键实现要点（踩过的坑）

1. `costFit` 原本"贴近预算即高分"，导致"最省钱"反而最贵 → 给省钱策略单独加 `cheapness`（越低越好）项。
2. 套餐热量不能用名称子串匹配单品（巨无霸四件套 → 513 kcal），必须按组成累加；饱腹目标调整为 小550/中800/大1100。
3. 共享拼盘预算判断 `budgetLeft > 0 && ...` 写反，预算已超支时仍会加拼盘。
4. 移除商品需同时过滤：单点池、套餐子项选择、以及"套餐名与被移除单品高度相似"的模糊套餐（用最长公共子串 ≥4）。
5. 为保证三方案不同而强制每人换候选，会把均衡方案推到高价 → 改为只在整案签名重复时才对个别成员微调。
6. `package.json` 设 `"type":"module"` 后 `tools/build-snapshot.js` 的 CJS 写法会挂，需改成 ESM。
7. 分类顺序：PLATTER_CODES 要排在 `details.combos` 之前，否则 BFF 拼盘被判成 combo。

### 验证

- `node tools/smoke.mjs`：8 组断言全通过（三方案/忌口过滤/金额守恒/AA 三模式余额守恒/风险检查/锁定重算/重度忌口/售罄替换）。
- agent-browser 跑通首页→房间→方案→确认→结果全链路；注意 agent-browser 的 `click` 命令对 JS 绑定的 onclick 有时不派发，改用 `eval "el.click()"` 驱动。

---

# 2026-10-10

## mcd-pindan 移动端自适应 + Skill 化改造（收尾）

### 移动端自适应（主场景手机）

- 断点：980 / 900 / 820 / 720 / 380；顶栏改两行（品牌+数据条 / 横向滑动步骤条）并 sticky。
- 新增底部固定操作条容器 `#actionBar`（`app.js` 统一按路由 setBar），含 `#abBtn` / `#abNote`，`body.has-actionbar` 预留底部内边距。
- 席位列表手机端改横向滑动卡片；`.plan-card` 三卡堆叠单列；表格包 `.table-wrap` 横向滚动。
- 安全区：`env(safe-area-inset-*)`；输入框 16px 防 iOS 聚焦缩放；触控目标 ≥44px。
- 坑：`≤900px` 只重置了 `grid-template-columns` 但没重置 `grid-column`，导致表单仍占第 2 列、左栏被挤成竖条。解法：媒体查询里 `.room-grid{grid-template-columns:1fr}` + `.room-grid > div{grid-column:auto}`。

### Skill 化重组（当前最终结构）

```
mcd-pindan/
├── SKILL.md / README.md / package.json / .gitignore
├── scripts/   server.js · build-snapshot.js · smoke.mjs
├── web/       index.html · app.js · core/(engine|risk|split|store|data|util).js · views/(home|room|plans|confirm|result).js
├── assets/    styles.css · screenshots/
├── data/      raw/ · snapshot.json
└── references/ architecture · scoring-model · mcp-integration · data-schema
```

- 原 `index.html`/`assets/app.js`/`assets/core`/`assets/views`/`server.js`/`tools/` 已迁入 `web/` 与 `scripts/`；`tools` 更名为 `scripts`。
- 入口页必须走 `/web/` 前缀：服务端 `GET /` 直接 302 到 `/web/`，否则相对路径 `app.js` 会解析成 `/app.js` 而 404 白屏。
- `quick_validate.py` 校验通过（"Skill is valid!"）；`npm test` 8 组断言全绿；手机端 390×844 全链路 0 报错、无横向溢出。

### 本轮修掉的真实缺陷

1. **白屏**：入口未带 `/web/` 前缀 → 加 302 重定向（原有 bug，非本轮引入）。
2. **缩略图空 src**：`<img src="">` 会回发当前页请求。新增 `util.thumb()`，无图时输出 `.thumb-ph` 占位 span，并在 `onerror` 中 `this.remove()`（原为 `visibility:hidden` 会留空位）。

---

# 2026-10-10（第二轮）移动优先重新设计

用户要求"重新设计规划，以移动端为主"。此前只是「桌面页面 + max-width 断点收敛」，移动体验是副产品。本轮把样式表整体反过来：**基础样式 = 手机，桌面只是 `@media(min-width:…)` 增强**。

### 断点（全部 min-width）

- 640：大屏手机，统计转 4 列、hero 按钮转横向行。
- 900：转双列（room/confirm/result）、关底部操作条、恢复步骤胶囊与 AA 真表格、结果页两类清单并排。
- 1000：三套方案并排（方案页分段控件到此才隐藏）。

### App 式外壳

- 顶栏改单行 App Bar：返回键（非首页）+ 当前页标题 + 数据胶囊。手机端用**细进度条 + "2/5"** 代替步骤胶囊，省下一整行纵向空间。
- 数据胶囊拆成 `.dc-full` / `.dc-short` 两个 span 由 CSS 切换，窄屏只显示「113 件 · 3 降级」。
- 每次渲染 220ms 淡入上滑；`prefers-reduced-motion` 下自动关闭。

### 各页手机形态

- **房间页**：房间设置 / 邀请折叠成 `<details class="fold">` 摘要条（`房间设置 3 人 · 门店 · 到店自提 · 预算 ¥105`），首屏留给"填需求"。
- **方案页**：三卡改**分段控件切换**（`最省钱/最均衡/最满足`），一次只看一套 —— 纵向堆叠要滚很久，这是手机最大痛点。
- **确认页**：AA 表格转**每人一张卡**，字段名用 `td::before{content:attr(data-l)}`（给 td 加 `data-l`），应付金额放大到 17px。
- **结果页**：两类清单改分段切换。

### 两个关键机制（可复用）

1. **通用分段切换** `setupToggles()`：容器加 `data-toggle`，内含 `.seg-item[data-seg]` 与 `[data-pane]`，自动配对；`[data-pane]:not(.on){display:none}` 管手机端，桌面由 `[data-pane]` 强制显示覆盖。
2. **底部操作条动态挑选** `pickActionEl()`：优先取当前可见面板 `[data-pane].on` 内的 `[data-ab]`，否则取不在任何面板里的。否则方案页三张卡都有 `data-ab` 时，底栏永远显示第一张卡的动作。切分段时必须调 `syncActionBar()` 重新同步。

### 踩坑

- `data-ab` 元素被 `body.has-actionbar [data-ab]{display:none}` 隐藏，所以**不能**用 `offsetParent/display` 判断是否可见，必须按其所在 pane 的 `.on` 判断。
- `SKILL.md` 的 YAML frontmatter 曾被写成 `\---`（转义残留）导致 `quick_validate.py` 报 "No YAML frontmatter found"；改回 `---` 后通过。改 SKILL.md 后务必重跑校验。
- agent-browser 的 `open` 命令偶发超时挂住，但浏览器进程实际已就绪；直接发新的 `eval` 即可，不要反复 `open`。`location.reload()` 后紧跟 eval 可能拿到 `about:blank`，需重新 open。

### 验证

- 手机 390×844 全流程 0 报错、无横向溢出；桌面 1280（steps flex / room 340+726 / 3 卡并排 / AA 真表格 / 两侧清单并排）与中间带 950（方案仍分段、结果已并排）均回归正常。
