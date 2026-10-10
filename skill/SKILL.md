---
name: mcd-pindan  
description: 麦当劳多人拼单决策辅助工具（McGroup）。覆盖「收集需求 → 自动搭配 → 优惠优化 → AA 分账 → 下单清单」全流程，基于麦当劳 MCP（mcd-mcp）拉取的门店、菜单、商品详情、价格与可售状态快照，生成最省钱/最均衡/最满足三套可比方案，做忌口硬冲突与预算风险检查，并提供三种 AA 分账模式与两类可一键复制的下单清单。当用户提到「麦当劳拼单」「多人一起点麦当劳」「拼单不纠结」「AA 分账」「团餐点单方案比较」「三套方案选一个」，或需要把 mcd-mcp 的菜单/门店数据变成一个可交互的拼单决策页面时使用。本 Skill 只做决策辅助，不代替用户登录、支付或下单。  
agent_created: true
---

# 麦当劳 · 多人拼单不纠结（McGroup）

## 概述

把「一群人一起点麦当劳」这件反复拉扯的事，压缩成一条可执行的链路：发起人建房间 → 每人填预算/偏好/忌口 → 引擎生成三套可比较方案 → 确认前风险检查 → AA 分账 → 输出可直接照着下单的清单。

数据来自麦当劳 MCP（`mcd-mcp`）的**构建期快照**：运行时不调用任何麦当劳接口，因此天然满足「不代替用户登录、支付、下单」的产品原则。

## 何时使用

- 用户要给一群人（2–10 人）点麦当劳，需要有人负责决定「点什么、谁付多少」。
- 用户要求比较多套点单方案，或要求按预算/偏好/忌口自动挑品。
- 用户提到 AA 分账、按人拆清单、拼单邀请链接。
- 用户提供 `mcd-mcp` 的菜单/门店数据，或要求把这类数据做成可交互页面。
- 需要修改拼单评分口径、忌口规则、AA 分账算法或新增页面时。

## 快速开始

```bash
cd mcd-pindan
npm start                 # 等价于 node scripts/server.js，零依赖，无需 npm install
# 打开 http://localhost:5173（会 302 到 /web/，入口页相对路径才能正确解析）
```

自检与数据重算：

```bash
npm test                  # 引擎冒烟测试（8 组断言，覆盖评分/淘汰/分账/售罄替换）
npm run build             # 用 data/raw/*.json 重新生成 data/snapshot.json
npm run verify            # build + test 串联
```

## 目录结构

```
mcd-pindan/                    Skill 根目录
├── SKILL.md                   入口文件：元信息 + 使用说明（本文件）
├── README.md                  安装、加载、调用步骤
├── package.json               依赖与环境声明（零第三方依赖，Node >= 18）
├── scripts/                   可执行脚本（确定性、可重复运行）
│   ├── server.js              本地服务：页面 + /api/snapshot + /api/health
│   ├── build-snapshot.js      data/raw/ 原始响应 → data/snapshot.json
│   └── smoke.mjs              引擎自检（8 组断言）
├── web/                       业务逻辑（原生 ES Module，无构建步骤）
│   ├── index.html             页面骨架（含 viewport / 底部操作条容器）
│   ├── app.js                 路由、渲染编排、移动端底部操作条
│   ├── core/                  引擎与领域逻辑
│   │   ├── engine.js          推荐引擎：候选生成 + 三策略打分 + 方案构建
│   │   ├── risk.js            确认前风险检查 + 售罄替换建议
│   │   ├── split.js           AA 分账（各付各的 / 完全平摊 / 自定义）
│   │   ├── store.js           房间模型、问卷校验、localStorage 持久化
│   │   ├── data.js            数据加载与三层降级
│   │   └── util.js            金额/转义/复制/最大余额法分摊
│   └── views/                 5 个页面：home / room / plans / confirm / result
├── assets/                    资源（不载入上下文，供产物使用）
│   ├── styles.css             样式表：移动优先（基础=手机），桌面增强走 min-width 断点
│   └── screenshots/           桌面端与手机端各页面截图
├── data/                      数据
│   ├── raw/                   MCP 原始响应（menu/stores/nutrition/coupons/details）
│   └── snapshot.json          加工后的运行时快照
└── references/                详细文档，按需加载
    ├── architecture.md        模块职责、数据流、路由与页面契约
    ├── scoring-model.md       评分模型、淘汰规则、风险项、分账算法口径
    ├── mcp-integration.md     MCP 能力清单、调用参数、降级项、重新取数流程
    └── data-schema.md         snapshot.json 字段与 room 对象结构
```

## 使用流程

1. **建房间**（`web/views/home.js` + `web/views/room.js`）  
   设置用餐人数、门店、取餐方式、总预算、截止时间、是否允许共享小食，生成房间码与邀请链接（`#/join/:code/:seat` 可直达指定席位）。
2. **收集需求**（房间页席位表单）  
   每人填预算、主食偏好、口味、饮料、食量、忌口、指定商品与备注。全部选「随便」时必须至少确认预算与忌口，否则无法保存。
3. **生成三套方案**（`web/core/engine.js`）  
   输出最省钱 / 最均衡 / 最满足三套方案，每套含总价、人均价、每人商品、共享分配、偏好满足度、超预算项与推荐理由。
4. **编辑与确认**（`web/views/confirm.js`）  
   按人查看商品，可锁定 / 替换 / 移除 / 新增，锁定后重新计算；同页做风险检查、AA 分账与总额确认。
5. **生成下单清单**（`web/views/result.js`）  
   输出「商品汇总」与「人员归属」两类清单，各自一键复制。

详细评分口径见 `references/scoring-model.md`，模块与数据流见 `references/architecture.md`。

## 硬性约束

- **只辅助决策**：绝不代替用户登录麦当劳账号、支付或下单。所有金额为按菜单快照的估算，清单页与页脚都必须保留「下单前请在麦当劳 App/小程序内二次确认价格与可售状态」提示。
- **忌口硬冲突方案直接淘汰**，不允许被选中；可去除配料（特调）的冲突降级为软冲突并给出处理说明。
- **过敏原提示**：MCP 未提供官方过敏原字段，忌口标签由商品名称推断，必须提示「以麦当劳官方说明与门店确认为准」。
- **金额精算**：全程以「分」为单位运算，AA 分账用最大余额法抹平余数，必须保证「个人金额合计 === 订单总额」。
- **降级必须可见**：数据接口失败、团餐满减不可用、卡包券可用性未校验等降级项，要在首页与顶部提示条显式展示，并给出数据更新时间。
- 首版不做：自动登录、自动支付、未确认自动下单、会员权益叠加、营养/医疗建议、跨品牌比价。

## 常见修改任务

| 任务            | 位置                                                         |
| ------------- | ---------------------------------------------------------- |
| 调整三套方案的策略权重   | `web/core/engine.js` 顶部 `STRATEGIES`                       |
| 调整饱腹匹配的目标热量   | `web/core/engine.js` 的 `APPETITE_KCAL`                     |
| 调整忌口标签或选项     | `web/core/store.js` 的 `AVOIDS` / `MAIN_PREFS` / `DRINKS` 等 |
| 增删风险检查项       | `web/core/risk.js` 的 `checkPlan`                           |
| 改 AA 分账算法     | `web/core/split.js` 的 `computeAA`                          |
| 换/加门店、重算商品与热量 | `data/raw/*.json` 后执行 `npm run build`                      |
| 新增页面          | `web/views/*.js` + `web/app.js` 的 `STEPS` 与路由表             |
| 调整断点或移动端样式    | `assets/styles.css`（基础样式即手机；桌面增强全在文末 `@media(min-width:640/900/1000)`） |
| 改顶部导航 / 进度 / 返回键 | `web/app.js` 的 `renderSteps()`                              |
| 加一组「手机端分段切换」   | 视图里包一层 `<div data-toggle="x">`，内含 `.seg-item[data-seg]` 与对应的 `[data-pane]`；`web/app.js` 的 `setupToggles()` 自动接管 |
| 让按钮上底部操作条      | 给按钮加 `data-ab`，可选 `data-ab-note` 写左侧摘要                      |

## 资源说明

- `scripts/`：可直接执行，无需读入上下文。改动引擎后务必跑 `npm test`。
- `references/`：需要细节时再读，避免一次性占用上下文。
- `assets/`：样式表与截图，供最终产物或预览使用。
