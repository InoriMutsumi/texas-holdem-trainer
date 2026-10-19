/* 性格对打赛：五个 AI 座位难度统一「熟练(normal)」，只改性格，看风格参数是否真的跑通
   用法：node style-bench.js [轮数] [每轮手数]
   口径：每手结束按「净盈亏 ÷ 大盲」记 BB，起点在扣盲注之前取，每手重置 100BB。
   座位 0 是跟注站陪练（不参与统计），统计只看 1–5 号 AI 座位。
   每轮性格轮转，保证七种性格样本尽量均匀。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const DIR = path.resolve(__dirname, '..');
const html = fs.readFileSync(DIR + '/index.html', 'utf8');
const gtoSrc = fs.readFileSync(DIR + '/gto-data.js', 'utf8');
const ROUNDS = parseInt(process.argv[2] || '7', 10);
const HANDS = parseInt(process.argv[3] || '200', 10);
const LEVEL = 'normal';
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

const STYLE_KEYS = Object.keys(dbg().AI_STYLES);
const NAME = {};
STYLE_KEYS.forEach(k => NAME[k] = dbg().AI_STYLES[k].name);

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const stat = {};
STYLE_KEYS.forEach(k => stat[k] = { bb: 0, hands: 0, vpip: 0, pfr: 0, mindHands: 0 });
let seatStyle = {};
let handStart = null;
let handIdx = 0;
let drift = 0;

const origNext = sandbox.PokerEngine.nextHand;
sandbox.PokerEngine.nextHand = function (g) {
  if (handStart) {
    for (let s = 1; s < g.players.length; s++) {
      const st = seatStyle[s];
      if (!st) continue;
      stat[st].bb += (g.players[s].chips - handStart[s]) / g.bigBlind;
      stat[st].hands++;
    }
    let tot = 0;
    for (let s = 0; s < g.players.length; s++) tot += g.players[s].chips;
    drift += tot - g.players.length * STACK;
    handIdx++;
  }
  for (let s = 0; s < g.players.length; s++) g.players[s].chips = STACK;
  handStart = g.players.map(p => p.chips);
  const r = origNext.apply(this, arguments);
  return r;
};

// 座位 0 当「跟注站」陪练：能跟就跟、能过就过，只有打得太重才弃
function playAsHuman() {
  const box = elements['actionButtons'];
  if (!box) return false;
  const btns = box.children.filter(c => c.tagName === 'button');
  if (!btns.length) return false;
  const pick = t => btns.filter(x => (x.textContent || '').indexOf(t) >= 0)[0];
  const g = dbg().game;
  const me = g.players[0];
  const toCall = Math.max(0, (g.streetCurrentBet || 0) - (me.bet || 0));
  let b;
  if (toCall > 0) {
    if (toCall > me.chips * 0.35 && Math.random() < 0.45) b = pick('弃牌');
    else b = pick('跟注') || pick('全下') || pick('过牌');
  } else {
    b = pick('过牌') || pick('跟注');
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
  // 难度全部锁 normal，只让性格变化
  const pool = [];
  for (let s = 1; s < n; s++) { d.levels[s] = LEVEL; }
  const rotated = STYLE_KEYS.slice(rd % STYLE_KEYS.length).concat(STYLE_KEYS.slice(0, rd % STYLE_KEYS.length));
  const pick5 = rotated.slice(0, n - 1);
  shuffle(pick5);
  seatStyle = {};
  for (let s = 1; s < n; s++) { seatStyle[s] = pick5[s - 1]; d.styles[s] = pick5[s - 1]; }
  d.resetMind();

  for (let s = 0; s < n; s++) g0.players[s].chips = STACK;
  handStart = g0.players.map(p => p.chips);
  const base = handIdx;
  let guard = 0;
  while (handIdx - base < HANDS && guard++ < HANDS * 60) {
    if (!playAsHuman()) break;
  }
  // 收这一轮的心智统计
  const m = dbg().AI_MIND;
  for (let s = 1; s < n; s++) {
    const st = seatStyle[s];
    const mm = m[s];
    if (st && mm && mm.hands > 0) {
      stat[st].vpip += mm.vpipHands;
      stat[st].pfr += mm.pfrHands;
      stat[st].mindHands += mm.hands;
    }
  }
  roundInfo.push('第' + (rd + 1) + '轮：' + pick5.map(k => NAME[k]).join(' / ') + '  完成 ' + (handIdx - base) + ' 手');
}

console.log('===== 性格对打赛（难度统一「熟练」，' + ROUNDS + ' 轮 × ' + HANDS + ' 手）=====');
roundInfo.forEach(x => console.log('  ' + x));
console.log('');
console.log('性格'.padEnd(10) + '样本手数'.padEnd(12) + '累计盈亏(BB)'.padEnd(16) + 'BB/100'.padEnd(10) + 'VPIP'.padEnd(9) + 'PFR');
STYLE_KEYS.forEach(k => {
  const s = stat[k];
  const per100 = s.hands ? s.bb / s.hands * 100 : 0;
  const vpip = s.mindHands ? (s.vpip / s.mindHands * 100).toFixed(1) + '%' : '-';
  const pfr = s.mindHands ? (s.pfr / s.mindHands * 100).toFixed(1) + '%' : '-';
  console.log(NAME[k].padEnd(10) + String(s.hands).padEnd(12) +
    s.bb.toFixed(1).padEnd(16) + per100.toFixed(2).padEnd(10) + vpip.padEnd(9) + pfr);
});
console.log('');
console.log('（BB/100 = 每 100 手平均赢多少个大盲；VPIP/PFR 来自平台自身的心智统计）');
console.log('筹码漂移：累计 ' + drift + ' 筹码（0 表示统计口径没有漏钱）');
