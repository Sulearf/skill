# 架构说明

## 运行形态

- **零构建**：浏览器端是原生 ES Module，直接 `import`，没有打包器、没有转译。
- **零依赖**：只有 `node:` 内置模块。`npm install` 不是必需步骤。
- **前后端一体**：`scripts/server.js` 既提供静态资源，也提供 `/api/snapshot`。

## 数据流

```
（构建期，由 Agent 调用 mcd-mcp）
  mcd-mcp 工具调用
        ↓  落盘
  data/raw/{menu,stores,nutrition,coupons,details}.json
        ↓  node scripts/build-snapshot.js
  data/snapshot.json              ← 分类、热量、忌口标签、套餐组成、降级声明
        ↓  GET /api/snapshot        （失败则降级读取 /data/snapshot.json）
  浏览器 core/data.js 的 state    ← source: api | file | failed，degraded[]
        ↓
  core/engine.js  generatePlans() ← 三套方案
        ↓
  core/risk.js    checkPlan()     ← 阻断/警告/提示
  core/split.js   computeAA()     ← 分账
        ↓
  views/*.js 渲染 → 一键复制的两类清单
```

**运行时绝不访问麦当劳接口**，这是「不代替用户登录/支付/下单」原则的技术保证。

## 前端模块职责

| 文件 | 职责 | 关键导出 |
|---|---|---|
| `web/app.js` | hash 路由、渲染编排、移动端底部操作条、顶部步骤条与数据时间 | — |
| `web/core/data.js` | 数据加载与三层降级，暴露降级原因 | `loadData` `getData` `realItems` `stores` `applySoldOut` |
| `web/core/store.js` | 房间模型、选项枚举、问卷校验、localStorage 持久化 | `createRoom` `saveRoom` `getRoom` `validateMember` `AVOIDS` `MAIN_PREFS` |
| `web/core/engine.js` | 候选生成、三策略打分、方案构建、推荐理由 | `generatePlans` `recompute` `APPETITE_KCAL` `AVOID_LABEL` |
| `web/core/risk.js` | 确认前风险检查、售罄/忌口替换建议 | `checkPlan` `suggestReplacement` |
| `web/core/split.js` | 三种 AA 模式与余数抹平 | `computeAA` `normalizeCustom` `AA_MODES` |
| `web/core/util.js` | 金额格式化、HTML 转义、剪贴板、最大余额法分摊 | `money` `esc` `copyText` `allocate` `clamp` |

## 路由与页面契约

Hash 路由：`#/`、`#/room/:code`、`#/plans/:code`、`#/confirm/:code`、`#/result/:code`，以及直达席位的 `#/join/:code/:seat`。

每个 view 导出 `{ render(ctx), mount(ctx) }`：

- `render(ctx)` 返回 HTML 字符串，`ctx = { snap, room, params, rerender }`。
- `mount(ctx)` 在 `innerHTML` 写入后绑定事件。**事件一律用 `onclick` / `onchange` 赋值**，不使用 `addEventListener`，因此重渲染不会累积监听器。
- 需要跨渲染保留的页内状态（当前席位、当前标签）放在模块级变量里，由 `resetSeat()` / `resetTab()` 在进入页面时重置。

## 移动端适配要点

- 移动优先：基础样式服务于小屏，`≤980 / ≤900 / ≤820 / ≤720 / ≤380` 逐档调整，`≤720` 为手机主战场。
- 布局重构不用 JS：`.room-grid` 在 `≤900px` 用 `display:contents` 拆掉两层包装，靠 `order` 把「席位进度 → 填写需求 → 房间设置 → 邀请」重排；**注意同时重置 `grid-column` / `grid-row`**，否则桌面端的显式定位会凭空生成第二列。
- 底部固定操作条：任何带 `data-ab` 的元素由 `app.js` 提升为底部主按钮（仅手机端），原按钮通过 `body.has-actionbar [data-ab]{display:none}` 隐藏；`data-ab-note` 作为左侧摘要。
- 触控目标 ≥ 44px（`--tap`），手机端输入框 `font-size:16px` 以避免 iOS 聚焦缩放。
- 安全区：`--safe-b/l/r` 取自 `env(safe-area-inset-*)`，顶栏、页面、操作条、页脚均已避让。
- 席位列表在手机端变为横向滑动卡片（`scroll-snap`），避免长列表把表单推下去。
