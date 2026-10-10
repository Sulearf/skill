# 数据结构说明

## 一、`data/snapshot.json`（运行时数据源）

顶层字段：`meta` / `stores` / `items` / `coupons` / `promotions` / `soldOut`。

### `meta`

```jsonc
{
  "generatedAt": "2026-10-09T13:28:27.081Z",   // 快照生成时间
  "sourceFetchedAt": "2026-10-09 20:20:11",    // MCP 取数时间（页面展示用）
  "sourceStore": { "code": "1420762", "name": "麦当劳深圳同方信息港餐厅" },
  "counts": { "stores": 20, "items": 113, "virtualComponents": 25, "combos": 41, "coupons": 6 },
  "degraded": [ { "module": "…", "reason": "…", "impact": "…" } ]
}
```

`degraded` 会在首页「降级与口径说明」与顶部提示条显式渲染——**降级必须可见**是硬性要求。

### `items[]`（商品）

```jsonc
{
  "code": "1100",                       // 商品码（套餐组成项为虚拟码）
  "name": "巨无霸",
  "image": "https://menu-img.mcd.cn/…",
  "price": 2550,                        // 现价，单位：分
  "origPrice": 2550,                    // 原价，单位：分
  "discountType": null,                 // 促销类型
  "canWithOrder": false,
  "category": "巨无霸牛鱼肉堡",
  "categories": ["巨无霸牛鱼肉堡"],
  "tags": ["单品", "100%纯牛肉"],
  "kind": "main",                       // main|side|drink|dessert|combo|platter|other
  "kcal": 513,
  "kcalEstimated": false,               // 热量是否为估算
  "diet": ["beef", "gluten"],           // 忌口标签（由名称推断）
  "removable": ["sauce", "dairy", "lettuce", "pickle", "onion"],  // 可特调去掉的标签
  "shareable": false,                   // 是否可作为共享拼盘
  "isCombo": false,
  "rounds": null,                       // 套餐轮次组成（isCombo 时非空）
  "available": true,                    // 可售状态（售罄由前端演示开关置 false）
  "virtual": false                      // true = 套餐内部组成项，不单独售卖
}
```

加载后由 `core/data.js` 派生出两个运行期字段（**不落盘**）：

- `snap.itemMap`：`Map<code, item>`
- `snap.realItems`：`items.filter(i => !i.virtual)`

### `stores[]`

```jsonc
{
  "storeCode": "1420762",
  "storeName": "麦当劳深圳同方信息港餐厅",
  "address": "科技园北区朗山路11号同方信息港E栋G层5号商铺",
  "city": "深圳",
  "scene": "到店自提",          // 到店自提 / 得来速车道取餐 / …
  "beType": 1,                  // 1 到店 · 5 得来速 · 2 外送
  "distance": 403,
  "businessStatus": true,
  "hours": "07:00-23:00",
  "reservation": true
}
```

### 其它

- `coupons[]`：`{ title, status, image }`，仅展示麦麦省可领取券。
- `promotions`：`{ available: false, note: "…" }`，团餐满减不可用的占位声明。
- `soldOut[]`：售罄商品码数组，供首页「可售状态（演示用）」开关写入。

## 二、`room` 对象（前端 localStorage）

存储键：`mcd_pindan_rooms_v1`（房间字典）、`mcd_pindan_current_v1`（当前房间码）。

```jsonc
{
  "code": "G0CMC",
  "createdAt": "2026-10-09T…Z",
  "hostName": "发起人",
  "people": 3,
  "storeCode": "1420762",
  "storeName": "麦当劳深圳同方信息港餐厅",
  "pickup": "1",                     // 1 到店 · 5 得来速 · 2 外送
  "budgetTotal": 105,                // 总预算（元，0 = 不限）
  "deadline": "",                    // datetime-local 字符串
  "allowShare": true,                // 是否允许共享小食
  "chosenPlan": "balanced",          // cheap | balanced | satisfy
  "edits": {                         // 确认页的编辑态
    "locked":  { "<memberId>": ["<code>"] },
    "removed": { "<memberId>": ["<code>"] },
    "added":   { "<memberId>": ["<code>"] },
    "sharedAdded": ["<code>"]
  },
  "aa": { "mode": "own", "custom": { "<memberId>": 1234 } },
  "members": [{
    "id": "m_xxxx", "seat": 1, "name": "小明",
    "budget": 35,                    // 个人预算（元）
    "mainPref": "any",               // any|beef|chicken|fish|pork|veg
    "taste": "any",                  // any|light|spicy|rich
    "drinkPref": "any",              // any|cola|diet|sprite|juice|tea|coffee|milk|none
    "appetite": "mid",               // small|mid|big
    "avoid": ["pickle"],             // 忌口多选
    "avoidAcknowledged": true,       // 必填确认位
    "fixed": ["1100"],               // 指定商品
    "note": "",
    "filled": false
  }]
}
```

**校验规则**（`store.js` 的 `validateMember`）：昵称必填、预算必填；当主食/口味/饮料**全为「随便」**时，必须显式确认忌口（`avoidAcknowledged`），否则不允许保存。

## 三、`plan` 对象（引擎输出）

```jsonc
{
  "id": "cheap",                       // cheap | balanced | satisfy
  "title": "最省钱", "sub": "…",
  "perMember": [{
    "memberId": "m_xxxx", "name": "甲", "seat": 1,
    "items": [ /* item 快照 + qty + adjusted[] */ ],
    "costCents": 3450, "kcal": 980, "totalKcal": 980,
    "budgetCents": 3500, "overCents": 0, "payCents": 3450,
    "shareCents": 530, "shareKcal": 0,
    "pref": 0.9, "satisfaction": 0.9, "fullness": 0.8,
    "hasMain": true, "hasDrink": true
  }],
  "shared": [ /* { name, image, priceCents, qty, kcal } */ ],
  "shareAlloc": [1767, 1767, 1766],    // 共享费用按人分配（分）
  "totalCents": 9080, "origTotal": 16400, "savedCents": 7320, "perHeadCents": 3027,
  "score": 0.853,
  "breakdown": { "pref": .83, "budget": .79, "full": .75, "disc": 1, "share": 1,
                 "penalty": 0, "noMain": 0, "noDrink": 0, "over": 0 },
  "hardConflicts": [],                 // 非空即淘汰
  "eliminated": false,
  "overBudget": [],
  "reasons": ["人均 ¥30.27，全场最低", "…"],
  "signature": "…"                     // 用于判断两套方案是否完全重复
}
```

`items` 内的单项在快照字段基础上增加：`qty`、`priceCents`、`origCents`、`adjusted[]`（特调去掉的标签中文名）、`components[]`（套餐组成）。

## 四、`computeAA` 输出

```jsonc
{
  "mode": "own",
  "rows": [{ "memberId": "…", "name": "甲", "seat": 1,
             "ownCents": 3450, "shareCents": 530, "payCents": 3980 }],
  "sumCents": 9080,
  "balanced": true,                    // sumCents === plan.totalCents
  "diffCents": 0
}
```
