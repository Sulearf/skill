# 麦当劳 MCP 集成与数据刷新

## 为什么是「构建期取数 + 运行时读快照」

`mcd-mcp` 的工具只能由 Agent 在会话中调用，浏览器页面无法直接访问。因此本 Skill 采用：

1. **构建期**：Agent 调用 `mcd-mcp`，把原始响应落到 `data/raw/*.json`；
2. **加工**：`node scripts/build-snapshot.js` 生成 `data/snapshot.json`；
3. **运行期**：页面只读 `/api/snapshot`（失败降级到 `/data/snapshot.json`）。

副产物是**架构上不可能**在运行时登录账号、下单或支付，天然满足产品红线。

## 已使用的 MCP 能力

| 工具 | 关键参数 | 产出 | 落盘文件 |
|---|---|---|---|
| `query-nearby-stores` | `beType`(1 到店 / 5 得来速 / 2 外送)、`searchType`(2 按位置搜索)、`city`、`keyword` | 门店列表（含地址、营业时间、场景、距离） | `data/raw/stores.json` |
| `query-meals` | `storeCode`、`orderType`、`beType` | 该门店在售商品：现价/原价/促销标签/图片/分类 | `data/raw/menu.json` |
| `query-meal-detail` | `storeCode`、`orderType`、`beType`、`code` | 套餐轮次组成 + 可特调项（去洋葱粒、去酸黄瓜、去切块生菜…） | `data/raw/details.json` |
| `list-nutrition-foods` | — | 营养/热量基表，用于饱腹匹配 | `data/raw/nutrition.json` |
| `available-coupons` | — | 麦麦省可领取券清单（仅展示，不承诺可用） | `data/raw/coupons.json` |
| `calculate-price` | `storeCode`、`orderType`、`beType`、`items[{productCode, quantity}]` | 校验价格计算口径 | 不落盘，仅核对 |
| `now-time-info` | — | 取数时间戳（写入 `meta.sourceFetchedAt`） | — |

当前快照规模：**20 家门店 / 113 件在售商品（其中 41 个套餐、25 个虚拟组成项）/ 6 张可领取券**，取数门店 `1420762`（麦当劳深圳同方信息港餐厅）。

## 无法获取的能力与降级口径

以下三项已写入 `data/snapshot.json` 的 `meta.degraded`，并会在首页与顶部提示条显式展示：

1. **团餐满减/满折（`query-promotions`）**
   仅在企业团餐场景（`beType=6`）可用且需要配送地址；当前账号无地址。降级为「菜单原价 / 现价差额」估算优惠力度。
2. **卡包券可用性（`query-my-coupons` / `query-store-coupons`）**
   券能否用于当前门店与订单需实时校验，因此只展示可领取券清单，不承诺抵扣金额。
3. **官方过敏原字段**
   MCP 未提供。`diet` 忌口标签由商品名称推断，页面必须提示「以麦当劳官方说明与门店确认为准」。

`delivery-query-addresses` 返回空（当前账号无收藏地址），因此无法走「按配送地址查门店」的路径。

## 刷新数据的步骤

1. 用 `mcd-mcp` 工具重新取数，原始响应覆盖写入 `data/raw/` 下同名文件：
   - `stores.json` ← `query-nearby-stores` 的结果数组
   - `menu.json` ← `query-meals`（建议含 `beType=1` 与 `beType=5` 两个场景）
   - `details.json` ← 多个 `query-meal-detail` 结果，结构为 `{ combos: { <code>: { rounds: [...] } } }`
   - `nutrition.json` ← `list-nutrition-foods`
   - `coupons.json` ← `available-coupons`
2. 运行 `npm run build`，它会重新完成：品类归类 → 热量索引匹配 → 套餐组成展开（生成 `virtual` 虚拟项）→ 忌口/可特调标签推断 → 降级声明写入。
3. 运行 `npm test` 确认 8 组断言仍然全绿。
4. 刷新页面；顶部数据时间与首页「数据源与更新时间」会自动更新。

`build-snapshot.js` 的关键约定：

- 价格统一转成**分**（整数）存储，字段名 `price` / `origPrice`。
- 套餐热量按组成累加（主食 + 薯条 + 麦乐鸡 + 饮料），**不要**用名称子串匹配单品，否则「巨无霸四件套」会被算成单品热量。
- 套餐缺组成数据时，用名称相似度兜底判断，避免误判为「缺主食」。
- `kind` 取值：`main` / `side` / `drink` / `dessert` / `combo` / `platter` / `other`。
- `virtual: true` 表示该条是套餐内部组成项，不参与单独售卖与候选池。
