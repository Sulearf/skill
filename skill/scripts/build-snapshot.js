/**
 * 把 MCP 原始数据加工成前端可直接消费的快照。
 * 运行: node tools/build-snapshot.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');

const read = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));

const menu = read('menu.json');
const stores = read('stores.json');
const nutrition = read('nutrition.json');
const coupons = read('coupons.json');
const details = read('details.json');

const toCents = (v) => Math.round(parseFloat(String(v).replace(/[^\d.]/g, '') || '0') * 100);

/* ---------------- 营养热量索引 ---------------- */
const norm = (s) => String(s)
  .replace(/[（）()]/g, '')
  .replace(/\s+/g, '')
  .replace(/™/g, '')
  .replace(/[“”"']/g, '')
  .replace(/·/g, '');

const kcalByName = new Map();
for (const [name, kcal] of nutrition.foods) kcalByName.set(norm(name), kcal);

const KCAL_ALIAS = {
  '4810': '中薯条', '1401': '麦乐鸡5块', '1700': '麦辣鸡翅-2块', '520445': '薄皮焦香V翅',
  '521156': '那么大鸡排', '9900005432': '麦麦脆汁鸡-带骨里脊', '4437': '小杯玉米杯',
  '6102': '苹果片', '3755': '纯牛奶盒装', '6362': '100%苹果汁', '515837': '圆筒冰淇淋',
  '9900008752': '香芋派', '9900008745': '朱古力新地', '9900008754': '奥利奥麦旋风',
  '521917': '奥利奥麦旋风', '521950': '奥利奥麦旋风', '521836': '奥利奥麦旋风',
  '521951': '圆筒冰淇淋', '521907': '香芋派', '521922': '香芋派',
  '9900008751': '可乐中杯', '3010': '雪碧中杯', '515280': '阳光柠檬红茶中杯',
  '515520': '中杯怡泉+C', '2430': '美汁源黄金橙橙', '6352': '麦旋酷阳光橙',
  '3505': '锡兰红茶', '520689': '大杯鲜萃咖啡', '507411': '冰美式中杯',
  '507409': '冰奶铁中杯', '510479': '冰燕麦奶铁中杯', '514851': '咖啡阿芙佳朵',
  '507394': '冰牛奶中杯', '510488': '冰燕麦奶中杯', '9900016082': '脆薯饼',
  '521901': '脆脆薯条', '9900016078': '麦麦脆汁鸡-琵琶腿', '9900016079': '麦麦趣鸡球',
  '9900016077': '麦麦脆汁鸡-琵琶腿', '9900006332': '绝代双翅', '521316': '双层吉士汉堡',
  '9900008746': '板烧鸡腿堡', '9900008747': '吉士汉堡包', '521952': '麦辣鸡腿汉堡',
  '521953': '麦辣鸡腿汉堡', '521986': '麦麦趣鸡球'
};

const BURGER_KCAL = ['培根安格斯厚牛堡', '芝士安格斯厚牛堡', '不素之霸双层牛堡', '培根蔬萃双层牛堡',
  '双层深海鳕鱼堡', '板烧鸡腿堡', '麦辣鸡腿汉堡', '巨无霸', '麦香鱼', '麦香鸡', '双层吉士汉堡',
  '吉士汉堡包', '酥酥多笋卷', '儿童鱼排堡', '麦乐鸡5块'];

function lookupKcal(code, name) {
  const alias = KCAL_ALIAS[code];
  if (alias && kcalByName.has(norm(alias))) return { kcal: kcalByName.get(norm(alias)), est: false };
  const n = norm(name);
  if (kcalByName.has(n)) return { kcal: kcalByName.get(n), est: false };
  // 名称包含某营养条目（取最长匹配）
  let best = null;
  for (const [fn, kcal] of kcalByName) {
    if (fn.length > 1 && (n.includes(fn) || fn.includes(n)) && (!best || fn.length > best.fn.length)) best = { fn, kcal };
  }
  if (best) return { kcal: best.kcal, est: false };
  return { kcal: 0, est: true };
}

/* ---------------- 分类规则 ---------------- */
const MAIN_CODES = new Set(['1100', '1106', '1120', '1440', '1406', '1450', '1600', '4648',
  '521316', '521816', '521952', '521953', '9900003586', '9900008746', '9900008747', '511781', '511782']);
const PLATTER_CODES = new Set(['9900016076', '9900006332', '9900015730', '9900004066',
  '9900005321', '9900015729', '9900016055']);
const OTHER_CODES = new Set(['521954', '521914', '521770', '506189', '521966', '521797']);
const DRINK_CODES = new Set(['520689', '3505', '9900003538']);
const COMBO_RE = /套餐|件套|随心选|乐园餐|随心配|双人餐|大堡口福/;
const DESSERT_RE = /麦旋风|新地|圆筒|派$|冰淇淋|雪冰/;

function classify(code, name, category) {
  if (PLATTER_CODES.has(code)) return 'platter';   // 多人拼盘优先于套餐判定
  if (OTHER_CODES.has(code)) return 'other';
  if (details.combos && details.combos[code]) return 'combo';
  if (category === '饮品' || category === '麦咖啡' || DRINK_CODES.has(code)) return 'drink';
  if (DESSERT_RE.test(name) && !/薯|条/.test(name)) return 'dessert';
  if (COMBO_RE.test(name)) return 'combo';
  if (MAIN_CODES.has(code) || /堡|卷|麦满分/.test(name)) return 'main';
  return 'side';
}

/* ---------------- 忌口 / 过敏原标签（由名称推断） ---------------- */
const TAG_RULES = [
  ['beef', /牛|安格斯|巨无霸|不素之霸|吉士汉堡包|双层吉士|高达吉士/],
  ['pork', /猪柳|培根|火腿|香肠|图林根|烟肉/],
  ['chicken', /鸡|板烧|麦乐鸡|脆汁鸡|鸡排|鸡柳|V翅|鸡翅/],
  ['fish', /鱼|鳕/],
  ['shrimp', /虾/],
  ['seafood', /鱼|鳕|虾|鱿/],
  ['dairy', /奶|芝士|吉士|奶酪|奶油|冰淇淋|麦旋风|新地|雪冰|奶铁|阿芙佳朵|黄油|乳|朱古力|巧克力/],
  ['egg', /蛋|麦满分/],
  ['gluten', /堡|包|卷|薯条|派|麦满分|饼|油条|粥|汉堡/],
  ['spicy', /辣|川香|辣椒|辛香|灰焰|龙焰|孜然|椒盐/],
  ['onion', /洋葱|葱不求人/],
  ['pickle', /酸黄瓜/],
  ['caffeine', /咖啡|美式|奶铁|阿芙佳朵|玛奇朵|可乐|雪碧|怡泉|红茶|抹茶/],
  ['nuts', /花生|坚果|杏仁|腰果|芝麻/]
];

function inferTags(code, name, kind) {
  const tags = new Set();
  for (const [tag, re] of TAG_RULES) if (re.test(name)) tags.add(tag);
  if (kind === 'main') tags.add('gluten');   // 面包胚
  if (kind === 'combo') {
    // 套餐继承主食名称里的蛋白来源
    for (const [tag, re] of TAG_RULES) if (re.test(name)) tags.add(tag);
  }
  if (code === '521914' || code === '521954') tags.clear(); // 周边商品不含食材
  return [...tags];
}

/* ---------------- 组合套餐组成 ---------------- */
const CHOICES_REF = details.sharedRounds;
function resolveRounds(raw) {
  return raw.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    maxQuantity: r.maxQuantity || 1,
    choices: (r.choicesRef ? CHOICES_REF[r.choicesRef] : r.choices).map((c) => ({
      code: c.code,
      name: c.name,
      diff: c.diff,
      isDefault: c.isDefault || 0,
      removable: (details.removable && details.removable[c.code]) || []
    }))
  }));
}

/* ---------------- 组装 ---------------- */
const categoryOf = new Map();
for (const cat of menu.categories) {
  for (const m of cat.meals) {
    const prev = categoryOf.get(m.code) || [];
    categoryOf.set(m.code, prev.concat(cat.name));
  }
}
const TAGS_OF = new Map();
for (const cat of menu.categories) for (const m of cat.meals) {
  TAGS_OF.set(m.code, (TAGS_OF.get(m.code) || []).concat(m.tags || []));
}

const items = [];
for (const [code, m] of Object.entries(menu.meals)) {
  const cats = categoryOf.get(code) || [];
  const primaryCat = cats[0] || '其他';
  const kind = classify(code, m.name, primaryCat);
  const isCombo = kind === 'combo';
  const rounds = details.combos[code] ? resolveRounds(details.combos[code].rounds) : null;

  const K = (n) => kcalByName.get(norm(n)) || 0;
  let kcal;
  let est = false;
  if (isCombo) {
    // 套餐按组成估算：主食 + 小食（四件套两件）+ 饮料
    const base = BURGER_KCAL.find((b) => norm(m.name).includes(norm(b)));
    let sum = base ? K(base) : Math.round(parseFloat(m.currentPrice) * 14);
    if (!base) est = true;
    if (/四件套|双人餐/.test(m.name)) sum += K('中薯条') + K('麦乐鸡5块');
    else if (/三件套|套餐|乐园餐|500大卡/.test(m.name)) sum += K('中薯条');
    else if (/随心选|随心配/.test(m.name)) sum += K('中薯条');
    sum += K('可乐中杯');
    kcal = sum;
  } else {
    const r = lookupKcal(code, m.name);
    kcal = r.kcal || Math.round(parseFloat(m.currentPrice) * 22);
    est = r.est || r.kcal === 0;
  }

  const removable = rounds
    ? [...new Set(rounds.flatMap((r) => r.choices.flatMap((c) => c.removable.map((x) => x.tag))))]
    : ((details.removable && details.removable[code]) || []).map((x) => x.tag);

  items.push({
    code,
    name: m.name,
    image: m.image,
    price: toCents(m.currentPrice),
    origPrice: toCents(m.originalPrice || m.currentPrice),
    discountType: m.discountType || null,
    canWithOrder: !!m.canWithOrder,
    category: primaryCat,
    categories: cats,
    tags: TAGS_OF.get(code) || [],
    kind,
    kcal,
    kcalEstimated: est,
    diet: inferTags(code, m.name, kind),
    removable: [...new Set(removable)],
    shareable: kind === 'platter' || /双人餐|拼|十翅|盘/.test(m.name),
    isCombo,
    rounds,
    available: true,
    virtual: false
  });
}

// 套餐子项（虚拟商品，仅用于组成展示 / 忌口展开）
const seen = new Set(items.map((i) => i.code));
function addVirtual(code, name, kind, kcal, diet = []) {
  if (seen.has(code)) return;
  seen.add(code);
  items.push({
    code, name, image: '', price: 0, origPrice: 0, discountType: null, canWithOrder: false,
    category: '套餐组成', categories: ['套餐组成'], tags: [], kind, kcal, kcalEstimated: false,
    diet, removable: [], shareable: false, isCombo: false, rounds: null, available: true, virtual: true
  });
}
const VIRTUAL_KCAL = { '3050': '可乐中杯', '3060': '雪碧中杯', '3071': '无糖可口可乐中杯', '3100': '可乐大杯', '3110': '雪碧大杯', '3111': '无糖可口可乐大杯', '515281': '阳光柠檬红茶中杯', '515282': '阳光柠檬红茶大杯', '515520': '中杯怡泉+C', '515521': '大杯怡泉+C', '520688': '大杯鲜萃咖啡', '3755': '纯牛奶盒装', '6362': '100%苹果汁', '3505': '锡兰红茶', '2430': '美汁源黄金橙橙', '521817': '美汁源黄金橙橙', '507411': '冰美式中杯', '507368': '热美式中杯', '507409': '冰奶铁中杯', '507328': '热奶铁中杯', '4810': '中薯条', '4820': '大薯条', '516020': '中薯条', '522012': '小薯条', '522013': '大薯条', '4437': '小杯玉米杯', '4438': '大杯玉米杯', '521983': '脆薯饼', '516013': '麦辣鸡翅-2块', '516014': '麦乐鸡5块', '521824': '麦麦趣鸡球', '516012': '麦麦脆汁鸡-琵琶腿', '521157': '那么大鸡排', '520450': '薄皮焦香V翅', '520312': '双层深海鳕鱼堡', '521901': '脆脆薯条' };
for (const [code, foodName] of Object.entries(VIRTUAL_KCAL)) {
  const names = { '3050': '可乐中杯', '3060': '雪碧中杯', '3071': '无糖可口可乐中杯', '3100': '可乐大杯', '3110': '雪碧大杯', '3111': '无糖可口可乐大杯', '515281': '阳光柠檬红茶中杯', '515282': '阳光柠檬红茶大杯', '515520': '中杯怡泉+C', '515521': '大杯怡泉+C', '520688': '大杯鲜萃咖啡', '3755': '纯牛奶', '6362': '100%苹果汁', '3505': '锡兰红茶', '2430': '【美汁源】“黄金橙橙”', '521817': '【美汁源】“多汁柠柠”', '507411': '麦咖啡™冰美式中杯', '507368': '麦咖啡™热美式中杯', '507409': '麦咖啡™冰奶铁中杯', '507328': '麦咖啡™热奶铁中杯', '4810': '中薯条', '4820': '大薯条', '516020': '中薯条', '522012': '小薯条', '522013': '大薯条', '4437': '小杯玉米杯', '4438': '大杯玉米杯', '521983': '5块心形薯饼+韩式辣椒黄油风味酱', '516013': '麦辣鸡翅-2块', '516014': '麦乐鸡-5块', '521824': '脆皮鸡柳3根', '516012': '麦麦脆汁鸡-琵琶腿', '521157': '那么大鸡排（椒盐风味）', '520450': '薄皮焦香V翅', '520312': '原味双层深海鳕鱼堡', '521901': '月下相思扭扭薯' };
  const kind = /可乐|雪碧|红茶|咖啡|牛奶|果汁|橙|柠|怡泉/.test(names[code]) ? 'drink' : 'side';
  const diet = inferTags(code, names[code], kind);
  addVirtual(code, names[code], kind, kcalByName.get(norm(foodName)) || 0, diet);
}

/* ---------------- 门店 ---------------- */
const storeList = [];
for (const g of stores.groups) {
  for (const s of g.stores) {
    storeList.push({
      storeCode: s.storeCode,
      beCode: s.beCode || null,
      storeName: s.storeName,
      address: s.address,
      city: g.city,
      scene: g.scene,
      beType: g.beType,
      distance: s.distance,
      businessStatus: s.businessStatus,
      hours: `${s.businessStartTime}-${s.businessEndTime}`,
      reservation: !!s.reservation
    });
  }
}

const snapshot = {
  meta: {
    generatedAt: new Date().toISOString(),
    sourceFetchedAt: menu._fetchedAt,
    sourceStore: { code: menu.storeCode, name: menu.storeName },
    counts: {
      stores: storeList.length,
      items: items.filter((i) => !i.virtual).length,
      virtualComponents: items.filter((i) => i.virtual).length,
      combos: items.filter((i) => i.isCombo).length,
      coupons: coupons.coupons.length
    },
    degraded: [
      {
        module: '团餐满减/满折活动（query-promotions）',
        reason: '该能力仅在企业团餐（beType=6）场景可用，需要配送地址；当前账号无配送地址，已降级为「菜单原价/现价差额」估算优惠力度',
        impact: '优惠程度评分不使用门店满减规则，实际优惠以麦当劳 App 结算页为准'
      },
      {
        module: '用户卡包券可用性（query-my-coupons / query-store-coupons）',
        reason: '券是否可用于当前门店与订单需实时校验，本工具仅展示麦麦省可领取券清单',
        impact: '不承诺券可用性与抵扣金额'
      },
      {
        module: '餐品过敏原官方数据',
        reason: 'MCP 未提供官方过敏原字段，忌口标签由商品名称推断',
        impact: '仅供参考，过敏相关请以麦当劳官方说明与门店确认为准'
      }
    ]
  },
  stores: storeList,
  items,
  coupons: coupons.coupons,
  promotions: { available: false, note: '当前场景未获取到门店满减规则' },
  soldOut: []
};

fs.writeFileSync(path.join(ROOT, 'data', 'snapshot.json'), JSON.stringify(snapshot), 'utf8');
console.log(`snapshot.json 生成完毕：门店 ${snapshot.meta.counts.stores} / 商品 ${snapshot.meta.counts.items} / 套餐组成 ${snapshot.meta.counts.virtualComponents}`);
const kinds = {};
for (const i of items) if (!i.virtual) kinds[i.kind] = (kinds[i.kind] || 0) + 1;
console.log('分类统计:', kinds);
const noKcal = items.filter((i) => !i.virtual && i.kcalEstimated).map((i) => i.name);
console.log('热量为估算的商品数:', noKcal.length, noKcal.slice(0, 10));
