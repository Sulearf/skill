# 麦当劳 · 多人拼单不纠结（McGroup）

一个 **WorkBuddy Skill 项目**：用真实麦当劳门店 / 菜单 / 价格 / 可售状态快照，把「一群人点麦当劳」变成可比较、可检查、可分摊的流程 ——  
**收集需求 → 自动搭配 → 优惠优化 → AA 分账 → 生成下单清单**。

> **产品原则：只辅助决策。** 不自动登录、不自动支付、未经确认不自动下单；不叠加会员权益、不给营养/医疗建议、不做跨品牌比价。  
> 下单前请在麦当劳 App / 小程序内二次确认价格与可售状态。

- Skill 入口与元信息：[`SKILL.md`](./SKILL.md)
- 详细文档：[`references/`](./references)（架构 / 评分模型 / MCP 集成 / 数据结构）

---

## 一、环境要求

| 项       | 要求                                                                              |
| ------- | ------------------------------------------------------------------------------- |
| Node.js | **≥ 18**（用到全局 `fetch`、`node:` 前缀导入、ES Module）                                   |
| 包管理器    | 不需要                                                                             |
| 第三方依赖   | **零**。服务端只用 `node:http` / `node:fs` / `node:path`；浏览器端为原生 ES Module             |
| MCP     | `mcd-mcp`（**仅构建期需要**，用于刷新 `data/raw/`；运行时不需要）                                   |
| 浏览器     | 支持 ES Module 与 `display:contents` 的现代浏览器（Chrome / Edge / Safari / Firefox 近年版本） |

## 二、安装

无需安装依赖，克隆 / 拷贝目录即可：

```bash
cd mcd-pindan
node -v            # 确认 >= 18
```

> 若项目已发布到 Skill 市场，也可直接在 WorkBuddy 中安装该 Skill（用户级默认落在 `~/.workbuddy/skills/mcd-pindan/`）。

## 三、加载与启动

作为 Skill 被 Agent 加载：把本目录放到 `~/.workbuddy/skills/mcd-pindan/`（用户级，所有项目可用）或 `<项目>/.workbuddy/skills/mcd-pindan/`（项目级，与团队共享），Agent 命中描述后会自动读取 `SKILL.md`。

本地启动（人工预览或验证）：

```bash
npm start                       # 等价于 node scripts/server.js
# 打开 http://localhost:5173   （会 302 到 /web/，入口页相对路径才能正确解析）
PORT=8080 npm start             # 换端口
```

> 入口地址必须带 `/web/` 前缀（`http://localhost:5173/web/`）。直接用文件系统打开 `web/index.html` 会因 `file://` 下的模块跨目录限制而失败，请始终通过 `npm start` 访问。

启动后可自查：

```bash
curl http://localhost:5173/api/health      # {"ok":true,...}
curl http://localhost:5173/api/snapshot    # 运行时数据源
```

其它脚本：

```bash
npm test         # 引擎冒烟测试：8 组断言（评分 / 淘汰 / 分账 / 售罄替换）
npm run build    # 由 data/raw/*.json 重新生成 data/snapshot.json
npm run verify   # build + test 串联（改完引擎或数据后跑这个）
```

## 四、调用示例

### 1. 面向用户（页面流程）

| 步骤   | 路由                   | 做什么                                               |
| ---- | -------------------- | ------------------------------------------------- |
| 首页   | `#/`                 | 发起拼单 / 输入房间码加入；查看数据更新时间与降级说明                      |
| 拼单房间 | `#/room/:code`       | 设置人数、门店、取餐方式、总预算、截止时间、是否共享；每人填预算 / 偏好 / 忌口；生成邀请链接 |
| 方案比较 | `#/plans/:code`      | 三卡横向比较：最省钱 / 最均衡 / 最满足（总价、人均、评分拆解、推荐理由、超预算项）      |
| 编辑确认 | `#/confirm/:code`    | 按人查看与锁定 / 替换 / 移除 / 新增商品，重新计算；风险检查 + AA 分账 + 总额确认 |
| 下单清单 | `#/result/:code`     | 「商品汇总」与「人员归属」两类清单，各自一键复制                          |
| 席位直达 | `#/join/:code/:seat` | 邀请链接可直接把参与者送到指定席位                                 |

### 2. 面向 Agent / 二次开发（模块调用）

```js
import fs from 'node:fs';
import { generatePlans } from './web/core/engine.js';
import { checkPlan, suggestReplacement } from './web/core/risk.js';
import { computeAA, AA_MODES } from './web/core/split.js';

// 1) 载入快照并派生运行期索引
const snap = JSON.parse(fs.readFileSync('data/snapshot.json', 'utf8'));
snap.itemMap = new Map(snap.items.map((i) => [i.code, i]));
snap.realItems = snap.items.filter((i) => !i.virtual);

// 2) 构造房间（结构与校验规则见 references/data-schema.md）
const room = {
  code: 'DEMO1', people: 3, budgetTotal: 105, allowShare: true,
  storeCode: '1420762', storeName: '麦当劳深圳同方信息港餐厅', pickup: '1',
  chosenPlan: 'balanced', edits: { locked: {}, removed: {}, added: {} },
  members: [
    { id: 'a', seat: 1, name: '甲', budget: 35, mainPref: 'beef', taste: 'spicy', drinkPref: 'cola', appetite: 'mid', avoid: ['pickle'], fixed: [], note: '', filled: true },
    { id: 'b', seat: 2, name: '乙', budget: 30, mainPref: 'any', taste: 'any', drinkPref: 'any', appetite: 'small', avoid: [], fixed: [], note: '', filled: true },
    { id: 'c', seat: 3, name: '丙', budget: 55, mainPref: 'chicken', taste: 'light', drinkPref: 'tea', appetite: 'big', avoid: ['beef'], fixed: [], note: '', filled: true }
  ]
};

// 3) 生成三套方案（含淘汰标记与推荐理由）
const { plans, rejected } = generatePlans(snap, room, room.edits);
plans.forEach((p) => console.log(p.id, p.title, p.totalCents / 100, p.score.toFixed(3), p.eliminated ? '淘汰' : ''));

// 4) 风险检查 + 分账（个人金额合计恒等于订单总额）
const plan = plans.find((p) => p.id === room.chosenPlan);
console.log(checkPlan(snap, room, plan).map((r) => `${r.level}: ${r.title}`));
console.log(computeAA(plan, room, 'own', {}));
```

### 3. 刷新菜单数据（需要 `mcd-mcp`）

1. 用 Agent 调用 `mcd-mcp` 重新取数，覆盖写入 `data/raw/` 下同名文件；
2. `npm run build` → 重新生成 `data/snapshot.json`；
3. `npm test` → 确认断言全绿；
4. 刷新页面，顶部数据时间自动更新。

完整的工具清单、参数与降级口径见 [`references/mcp-integration.md`](./references/mcp-integration.md)。

## 五、目录结构

```
mcd-pindan/
├── SKILL.md                 Skill 入口：元信息（name/description）+ 使用说明
├── README.md                本文件：安装 / 加载 / 调用
├── package.json             依赖与环境声明（零依赖，Node >= 18）
├── .gitignore
├── scripts/                 可执行脚本
│   ├── server.js            本地服务：页面 + /api/snapshot + /api/health
│   ├── build-snapshot.js    data/raw/ → data/snapshot.json
│   └── smoke.mjs            引擎自检（8 组断言）
├── web/                     业务逻辑（原生 ES Module，无构建步骤）
│   ├── index.html
│   ├── app.js               路由 / 渲染编排 / 移动端底部操作条
│   ├── core/                engine · risk · split · store · data · util
│   └── views/               home · room · plans · confirm · result
├── assets/                  资源
│   ├── styles.css           移动端优先 + 桌面增强（980/900/820/720/380 断点）
│   └── screenshots/         桌面端与手机端各页面截图
├── data/
│   ├── raw/                 MCP 原始响应
│   └── snapshot.json        加工后的运行时快照
└── references/              architecture · scoring-model · mcp-integration · data-schema
```

## 六、功能与边界

**已实现（MVP）**：拼单房间与邀请链接 · 参与者问卷（选「随便」时强制确认预算与忌口）· 三套方案比较 · 五维评分 + 忌口硬冲突淘汰 · 确认前风险检查（售罄 / 忌口 / 超预算 / 缺主食 / 缺饮料 / 共享不足 / 过敏原提示）· 三种 AA 模式（分账合计恒等）· 两类一键复制清单 · 查询失败降级提示 · 数据更新时间显示 · 售罄自动替换建议 · 下单前价格二次确认提示。

**明确不做**：自动登录 · 自动支付 · 未经确认自动下单 · 会员权益叠加 · 营养或医疗建议 · 跨品牌比价。

**已知数据降级**（页面已显式标注）：团餐满减不可用（改用原价/现价差额估算优惠）· 卡包券可用性未校验 · 无官方过敏原字段（忌口标签由商品名推断，须以官方说明与门店确认为准）。

## 七、移动端（主战场）

样式表是**移动优先**的：`assets/styles.css` 里的基础样式就是手机样式，桌面只是文末 `@media(min-width:…)` 里的增强。

### App 式外壳

| 区域   | 行为                                                       |
| ---- | -------------------------------------------------------- |
| 顶部   | 单行 App Bar：返回键（非首页）+ 当前页标题 + 数据状态胶囊（窄屏只显示「113 件 · 3 降级」） |
| 顶部进度 | 手机端用细进度条 + `2/5` 代替步骤胶囊，把纵向空间让给内容；≥900px 反向切换            |
| 底部   | 固定主操作条，页面里带 `data-ab` 的按钮会被提升上来（原件自动隐藏），并跟随左侧实时摘要        |
| 切换   | 每次渲染有 220ms 淡入上滑；`prefers-reduced-motion` 下自动关闭          |

### 各页的手机端形态

- **首页**：主按钮全宽、流程卡横向 snap、统计 2×2。
- **房间页**：席位卡横向滑动；**房间设置 / 邀请折叠成摘要条**（`房间设置 3 人 · 门店 · 到店自提 · 预算 ¥105`），首屏留给「填需求」。
- **方案页**：三套方案改为**分段控件切换**，一次只看一套（横向堆叠要滚很久）；≥1000px 自动恢复三卡并排。
- **确认页**：AA 分账表格在手机上**变成每人一张卡**（字段名来自 `td[data-l]`），应付金额放大到 17px；≥900px 恢复为真正的表格。
- **结果页**：「商品汇总 / 人员归属」两类清单改为**分段切换**；≥900px 恢复并排。

### 触控与安全区

- 触控目标 ≥ 46px（`.btn` / `.chip` / `.tab` / 折叠标题）；输入框统一 16px，防 iOS 聚焦缩放；
- 顶/底/左/右均避让 `env(safe-area-inset-*)`；
- 实测 390×844 全流程无横向溢出，`window.__err` 为空。

断点：**640**（大屏手机，转 2 列统计、横向按钮行）→ **900**（平板，转双列、关底部条、恢复步骤胶囊与表格）→ **1000**（三卡方案并排）。

截图见 `assets/screenshots/`（`m1`–`m5` 为手机端，`1`–`5` 为桌面端）。
