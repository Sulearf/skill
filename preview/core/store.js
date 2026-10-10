import { uid, roomCode } from './util.js';
import { stores } from './data.js';

const KEY = 'mcd_pindan_rooms_v1';
const CUR = 'mcd_pindan_current_v1';

export const MAIN_PREFS = [
  { v: 'any', t: '随便' }, { v: 'beef', t: '牛肉' }, { v: 'chicken', t: '鸡肉' },
  { v: 'fish', t: '鱼/虾' }, { v: 'pork', t: '猪肉' }, { v: 'veg', t: '不吃肉' }
];
export const TASTES = [
  { v: 'any', t: '随便' }, { v: 'light', t: '清淡' }, { v: 'spicy', t: '香辣' }, { v: 'rich', t: '浓郁' }
];
export const DRINKS = [
  { v: 'any', t: '随便' }, { v: 'cola', t: '可乐' }, { v: 'diet', t: '无糖可乐' },
  { v: 'sprite', t: '雪碧' }, { v: 'juice', t: '果汁' }, { v: 'tea', t: '茶' },
  { v: 'coffee', t: '咖啡' }, { v: 'milk', t: '牛奶' }, { v: 'none', t: '不要饮料' }
];
export const APPETITES = [{ v: 'small', t: '小' }, { v: 'mid', t: '中' }, { v: 'big', t: '大' }];
export const AVOIDS = [
  { v: 'beef', t: '牛肉' }, { v: 'pork', t: '猪肉/培根' }, { v: 'chicken', t: '鸡肉' },
  { v: 'seafood', t: '鱼虾海鲜' }, { v: 'dairy', t: '乳制品' }, { v: 'egg', t: '鸡蛋' },
  { v: 'gluten', t: '麸质/小麦' }, { v: 'spicy', t: '辛辣' }, { v: 'caffeine', t: '咖啡因' },
  { v: 'onion', t: '洋葱/葱' }, { v: 'pickle', t: '酸黄瓜' }, { v: 'nuts', t: '花生坚果' }
];
export const PICKUP_MODES = [
  { v: '1', t: '到店自提', beType: 1 },
  { v: '5', t: '得来速车道取餐', beType: 5 },
  { v: '2', t: '麦乐送到家', beType: 2 }
];

function blankMember(idx) {
  return {
    id: uid('m'),
    seat: idx + 1,
    name: '',
    budget: 35,
    mainPref: 'any',
    taste: 'any',
    drinkPref: 'any',
    appetite: 'mid',
    avoid: [],
    fixed: [],
    note: '',
    filled: false
  };
}

export function createRoom(patch = {}) {
  const list = stores();
  const def = list[0] || null;
  const people = patch.people || 3;
  const room = {
    code: roomCode(),
    createdAt: new Date().toISOString(),
    hostName: patch.hostName || '发起人',
    people,
    storeCode: patch.storeCode || (def ? def.storeCode : ''),
    storeName: patch.storeName || (def ? def.storeName : ''),
    pickup: patch.pickup || '1',
    budgetTotal: patch.budgetTotal || people * 35,
    deadline: patch.deadline || '',
    allowShare: patch.allowShare !== undefined ? patch.allowShare : true,
    members: Array.from({ length: people }, (_, i) => blankMember(i)),
    chosenPlan: null,
    edits: { locked: {}, removed: {}, added: {} },
    aa: { mode: 'own', custom: {} }
  };
  // 发起人默认占第一个席位
  room.members[0].name = room.hostName;
  return room;
}

export function ensureMembers(room) {
  while (room.members.length < room.people) room.members.push(blankMember(room.members.length));
  if (room.members.length > room.people) room.members.length = room.people;
  room.members.forEach((m, i) => { m.seat = i + 1; });
  return room;
}

/* ---------------- 持久化 ---------------- */
function allRooms() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function saveAll(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* 忽略配额错误 */ }
}
export function saveRoom(room) {
  const map = allRooms();
  map[room.code] = room;
  saveAll(map);
  localStorage.setItem(CUR, room.code);
}
export function getRoom(code) { return allRooms()[code] || null; }
export function listRooms() { return Object.values(allRooms()); }
export function currentCode() { return localStorage.getItem(CUR) || ''; }
export function setCurrent(code) { localStorage.setItem(CUR, code); }

export function inviteLink(room, seat = null) {
  const base = `${location.origin}${location.pathname}`;
  const tail = seat ? `#/join/${room.code}/${seat}` : `#/room/${room.code}`;
  return base + tail;
}

/** 参与者问卷校验：选“随便”时必须至少确认预算与忌口 */
export function validateMember(m) {
  const errs = {};
  if (!m.name || !m.name.trim()) errs.name = '请填写昵称';
  if (!m.budget || Number(m.budget) <= 0) errs.budget = '请填写预算';
  const isLazy = ['any'].includes(m.mainPref) && ['any'].includes(m.taste) && ['any'].includes(m.drinkPref);
  if (isLazy && !m.avoidAcknowledged) errs.avoid = '选了「随便」，请至少确认忌口（无忌口请勾选“无忌口”）';
  if (isLazy && (!m.budget || Number(m.budget) <= 0)) errs.budget = '选了「随便」，预算必填';
  return errs;
}
