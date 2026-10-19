/* 难度对打赛：五个 AI 座位统一「均衡」性格，只改难度，看三档谁真的更强
   用法：node bench.js [轮数] [每轮手数]
   口径：每手结束按「净盈亏 ÷ 大盲」记 BB，起点在扣盲注之前取，
        每手重置到 100BB（2000 筹码），杜绝补码和盲注带来的统计偏差。
   座位 0 是随机点击的陪练（不参与难度分配），统计只看 1–5 号 AI。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const DIR = path.resolve(__dirname, '..');
const html = fs.readFileSync(DIR + '/index.html', 'utf8');
const gtoSrc = fs.readFileSync(DIR + '/gto-data.js', 'utf8');
const ROUNDS = parseInt(process.argv[2] || '2', 10);
const HANDS = parseInt(process.argv[3] || '300', 10);
// 可选第四个参数指定参赛档位，例如 `node bench.js 4 400 normal,hard`。
// 三档混战时新手会一直送钱，把「熟练 vs 职业」的差距稀释掉，单挑两种难度信噪比更高。
const LEVELS = (process.argv[4] || 'easy,normal,hard').split(',');
const STACK = 2000;

function extract(id) {
  const re = new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>');
  const m = html.match(re);
  return m ? m[1] : null;
}
const engineSrc = extract('engine');
let uiSrc = extract('ui');
const marker = "'use strict';";
const at = uiSrc.indexOf(marker);
uiSrc = uiSrc.slice(0, at + marker.length) +
  '\n  window.__dbg = function () { return { game: game, styles: _seatStyle, AI_STYLES: AI_STYLES, AI_MIND: AI_MIND, levels: _seatLevel, decide: aiDecide, newGame: newGame, resetMind: resetMind }; };' +
  uiSrc.slice(at + marker.length);

function makeEl(tag) {
  const el = {
    tagName: tag, className: '', textContent: '', style: {}, disabled: false, value: '',
    children: [], _attrs: {}, _handlers: {}, _qcache: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelectorAll() { return []; },
    querySelector(sel) {
      const cls = String(sel).replace(/^\./, '');
      if (!this._qcache[cls]) { const c = makeEl('div'); c.className = cls; this.appendChild(c); this._qcache[cls] = c; }
      return this._qcache[cls];
    },
    removeChild(c) { this.children = this.children.filter(x => x !== c); },
    get onclick() { return this._handlers.click; }, set onclick(f) { this._handlers.click = f; },
    get onchange() { return this._handlers.change; }, set onchange(f) { this._handlers.change = f; },
    get oninput() { return this._handlers.input; }, set oninput(f) { this._handlers.input = f; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
  };
  let inner = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return inner; },
    set(v) { inner = v; if (v === '') { this.children = []; this._qcache = {}; } }
  });
  return el;
}
const elements = {};
function getEl(id) { if (!elements[id]) elements[id] = makeEl('div'); return elements[id]; }
const storage = {};
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  document: { getElementById: getEl, createElement: makeEl, querySelectorAll: () => [], addEventListener() {}, body: makeEl('body') },
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem(k, v) { storage[k] = String(v); }, removeItem(k) { delete storage[k]; }
  },
  location: { search: '', href: 'file:///index.html', pathname: '/index.html', hash: '' },
  navigator: { userAgent: 'node-sim', language: 'zh-CN' },
  setTimeout: (fn) => { fn(); return 0; }, clearTimeout: () => {},
  setInterval: () => 0, clearInterval: () => {},
  confirm: () => true, alert: () => {},
  addEventListener() {}, removeEventListener() {},
  requestAnimationFrame: (fn) => { fn(0); return 0; },
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  Date, Math, JSON
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(gtoSrc, sandbox);
vm.runInContext(engineSrc, sandbox);
storage['poker.save.v2'] = JSON.stringify({
  schemaVersion: 2, chips: 2000, hands: 0, rebuys: 0,
  settings: { table: 'six', aiLevel: 'normal', blinds: { sb: 10, bb: 20 }, buyIn: 2000, autoRebuy: false, messageEnabled: false, avatars: [] },
  stats: { vpip: 0, pfr: 0, won: 0, ev: 0 }
});
vm.runInContext(uiSrc, sandbox);
const dbg = sandbox.window.__dbg;

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const stat = {};
LEVELS.forEach(l => stat[l] = { bb: 0, hands: 0 });
let seatLevel = {};
let handStart = null;
let handIdx = 0;
let drift = 0;

const origNext = sandbox.PokerEngine.nextHand;
sandbox.PokerEngine.nextHand = function (g) {
  if (handStart) {
    for (let s = 1; s < g.players.length; s++) {
      const lv = seatLevel[s];
      if (!lv) continue;
      stat[lv].bb += (g.players[s].chips - handStart[s]) / g.bigBlind;
      stat[lv].hands++;
    }
    let tot = 0;
    for (let s = 0; s < g.players.length; s++) tot += g.players[s].chips;
    drift += tot - g.players.length * STACK;
    handIdx++;
  }
  // 每手重置到 100BB，起点必须在扣盲注之前记录
  for (let s = 0; s < g.players.length; s++) g.players[s].chips = STACK;
  handStart = g.players.map(p => p.chips);
  const r = origNext.apply(this, arguments);
  return r;
};

// 座位 0 当「普通玩家」陪练：小注跟、大注倾向弃、偶尔诈唬。
// 早先用的是纯跟注站，但跟注站从不弃牌，等于把「诈唬 / MDF / 范围追踪」三项能力全部废掉，
// 测出来最强的永远是「紧 + 价值下注」。真人会弃牌，陪练也必须会弃，测试才有意义。
function playAsHuman() {
  const box = elements['actionButtons'];
  if (!box) return false;
  const btns = box.children.filter(c => c.tagName === 'button');
  if (!btns.length) return false;
  const pick = t => btns.filter(x => (x.textContent || '').indexOf(t) >= 0)[0];
  const g = dbg().game;
  const me = g.players[0];
  const toCall = Math.max(0, (g.streetCurrentBet || 0) - (me.bet || 0));
  const pot = Math.max(g.pot || 1, 1);
  const ratio = toCall / pot;
  let b;
  if (toCall > 0) {
    if (me.chips <= toCall) b = pick('跟注') || pick('全下');
    else if (ratio > 0.85 && Math.random() < 0.72) b = pick('弃牌');
    else if (ratio > 0.45 && Math.random() < 0.42) b = pick('弃牌');
    else if (ratio > 0.20 && Math.random() < 0.16) b = pick('弃牌');
    else b = pick('跟注') || pick('全下') || pick('过牌');
  } else {
    // 有位置时偶尔主动下注，让 AI 也要面对「被诈唬」的局面
    if (Math.random() < 0.18) b = pick('加注') || pick('下注') || pick('过牌');
    else b = pick('过牌') || pick('跟注');
  }
  if (!b) b = btns[0];
  try { b.onclick(); } catch (e) { return false; }
  return true;
}

const roundInfo = [];
for (let rd = 0; rd < ROUNDS; rd++) {
  dbg().newGame();
  const g0 = dbg().game;
  const n = g0.players.length;
  g0.settings.autoRebuy = false;
  g0.settings.messageEnabled = false;

  const d = dbg();
  for (let s = 0; s < n; s++) d.styles[s] = 'balanced';   // 隔离风格变量，只看难度
  const pool = [];
  for (let s = 1; s < n; s++) pool.push(LEVELS[(s - 1) % LEVELS.length]);
  shuffle(pool);
  seatLevel = {};
  for (let s = 1; s < n; s++) { seatLevel[s] = pool[s - 1]; d.levels[s] = pool[s - 1]; }

  for (let s = 0; s < n; s++) g0.players[s].chips = STACK;
  handStart = g0.players.map(p => p.chips);
  const base = handIdx;
  let guard = 0;
  while (handIdx - base < HANDS && guard++ < HANDS * 60) {
    if (!playAsHuman()) break;
  }
  roundInfo.push('第' + (rd + 1) + '轮：' + pool.join(' / ') + '  完成 ' + (handIdx - base) + ' 手');
}

console.log('===== 难度对打赛（均衡性格，' + ROUNDS + ' 轮 × ' + HANDS + ' 手）=====');
roundInfo.forEach(x => console.log('  ' + x));
console.log('');
console.log('难度        样本手数    累计盈亏(BB)    BB/100');
LEVELS.forEach(l => {
  const s = stat[l];
  const per100 = s.hands ? s.bb / s.hands * 100 : 0;
  console.log(l.padEnd(12) + String(s.hands).padEnd(12) +
    s.bb.toFixed(1).padEnd(16) + per100.toFixed(2));
});
console.log('');
console.log('（BB/100 = 每 100 手平均赢多少个大盲；起点扣盲注前取，每手重置 100BB）');
console.log('筹码漂移：累计 ' + drift + ' 筹码（0 表示统计口径没有漏钱）');
