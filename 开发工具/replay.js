/* 实战复盘：跑 N 手 6 人桌，把指定手数的完整行动过程打印出来，用来读 AI 打得像不像人
   用法：node replay.js [总手数] [起始手] [打印手数] */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const DIR = path.resolve(__dirname, '..');
const html = fs.readFileSync(DIR + '/index.html', 'utf8');
const gtoSrc = fs.readFileSync(DIR + '/gto-data.js', 'utf8');
const MAX_HANDS = parseInt(process.argv[2] || '120', 10);
const FROM = parseInt(process.argv[3] || String(MAX_HANDS - 12), 10);
const COUNT = parseInt(process.argv[4] || '12', 10);

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
  '\n  window.__dbg = function () { return { game: game, styles: _seatStyle, AI_STYLES: AI_STYLES, gtoSpot: gtoSpot, AI_MIND: AI_MIND, tableRead: tableRead, levels: _seatLevel, decide: aiDecide, newGame: newGame, resetMind: resetMind }; };' +
  uiSrc.slice(at + marker.length);

function makeEl(tag) {
  const el = {
    tagName: tag, className: '', textContent: '', style: {}, disabled: false,
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
  settings: { table: 'six', aiLevel: 'normal', blinds: { sb: 10, bb: 20 }, buyIn: 2000, autoRebuy: true, messageEnabled: false, avatars: [] },
  stats: { vpip: 0, pfr: 0, won: 0, ev: 0 }
});
vm.runInContext(uiSrc, sandbox);
const dbg = sandbox.window.__dbg;

const RK = '23456789TJQKA';
const SU = { s: '♠', h: '♥', d: '♦', c: '♣' };
function card(c) { return c ? (RK.charAt(c.r - 2) + (SU[c.s] || c.s)) : '??'; }
function cards(arr) { return (arr || []).map(card).join(' '); }

let handId = -1;
const origNext = sandbox.PokerEngine.nextHand;
sandbox.PokerEngine.nextHand = function (g) { handId++; return origNext.apply(this, arguments); };

const hands = {};
const origAct = sandbox.PokerEngine.act;
sandbox.PokerEngine.act = function (g, seat, action) {
  const type = typeof action === 'string' ? action : (action && action.type);
  const p = g.players[seat];
  const snap = {
    hand: handId, street: g.street, seat: seat, type: type,
    amount: action && action.amount,
    pot: g.pot, bet: p.streetBet, cur: g.streetCurrentBet,
    toCall: Math.max(0, g.streetCurrentBet - p.streetBet),
    hole: p.hole ? cards(p.hole) : '', board: cards(g.board)
  };
  const r = origAct.apply(this, arguments);
  snap.potAfter = g.pot;
  snap.streetBetAfter = g.players[seat].streetBet;
  (hands[handId] = hands[handId] || []).push(snap);
  return r;
};

// 玩家座位改为随机的简单策略，避免总是同一个死板玩家影响牌局
let clicks = 0;
while (clicks < 80000) {
  const g = dbg().game;
  if (g && g.handsPlayed >= MAX_HANDS) break;
  const box = elements['actionButtons'];
  if (!box) break;
  const btns = box.children.filter(c => c.tagName === 'button');
  if (!btns.length) break;
  const pick = t => btns.filter(x => (x.textContent||'').indexOf(t) >= 0)[0];
  const r = Math.random();
  let b;
  if (r < 0.30) b = pick('弃牌') || btns[0];
  else if (r < 0.92) b = pick('跟注') || pick('过牌') || btns[0];
  else b = pick('加注') || btns[0];
  try { b.onclick(); } catch (e) { break; }
  clicks++;
}

const g = dbg().game;
const styles = dbg().styles;
const AI = dbg().AI_STYLES;
const nameOf = s => (styles[s] && AI[styles[s]]) ? AI[styles[s]].name : '?';

console.log('跑完 ' + (g ? g.handsPlayed : 0) + ' 手，玩家座位：' + (g ? g.players[0].chips : '?') + ' 筹码');
console.log('');
for (let h = FROM; h < FROM + COUNT; h++) {
  const acts = hands[h];
  if (!acts || !acts.length) continue;
  console.log('════ 第 ' + (h + 1) + ' 手 ════');
  const byStreet = {};
  acts.forEach(a => { (byStreet[a.street] = byStreet[a.street] || []).push(a); });
  ['preflop', 'flop', 'turn', 'river'].forEach(st => {
    const list = byStreet[st];
    if (!list) return;
    const board = list[0].board;
    console.log('[' + ({ preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌' })[st] + ']' + (board ? ' ' + board : ''));
    list.forEach(a => {
      const who = a.seat === 0 ? '你' : ('座位' + a.seat + '(' + nameOf(a.seat) + ')');
      let desc;
      if (a.type === 'raise') desc = '加注到 ' + a.amount;
      else if (a.type === 'call') desc = '跟注 ' + a.toCall;
      else if (a.type === 'check') desc = '过牌';
      else if (a.type === 'fold') desc = '弃牌';
      else if (a.type === 'allin') desc = '全下 ' + a.amount;
      else desc = a.type;
      const hole = a.seat === 0 ? (' [' + a.hole + ']') : '';
      console.log('  ' + who.padEnd(18) + desc.padEnd(16) + ' 池=' + a.pot + ' 要跟=' + a.toCall + hole);
    });
  });
  console.log('');
}

// ---- 汇总统计（只统计 AI 座位，排除玩家 0）----
let post = 0, postBet = 0, flopSeen = 0, handsWithBet = 0, preFolds = 0, preActs = 0, sawShowdown = 0;
Object.keys(hands).forEach(k => {
  const acts = hands[k].filter(a => a.seat !== 0);
  if (!acts.length) return;
  const hasFlop = acts.some(a => a.street === 'flop');
  if (hasFlop) flopSeen++;
  let had = false;
  acts.forEach(a => {
    if (a.street === 'preflop') { preActs++; if (a.type === 'fold') preFolds++; }
    else { post++; if (a.type === 'raise') { postBet++; had = true; } }
  });
  if (had) handsWithBet++;
});
console.log('===== AI 行为汇总 =====');
console.log('看到翻牌的手数：' + flopSeen);
console.log('翻前 AI 弃牌率：' + (preFolds / Math.max(1, preActs) * 100).toFixed(1) + '%');
console.log('翻后 AI 行动数：' + post + '，其中主动下注：' + postBet + '（' + (postBet / Math.max(1, post) * 100).toFixed(1) + '%）');
console.log('有翻后主动下注的手数占比：' + (handsWithBet / Math.max(1, flopSeen) * 100).toFixed(1) + '%');

// ---- 心智检查：读人与情绪有没有真的在跑 ----
const MIND = dbg().AI_MIND;
console.log('===== AI 心智状态 =====');
Object.keys(MIND).sort((a,b)=>a-b).forEach(s => {
  const m = MIND[s];
  const nm = (styles[s] && AI[styles[s]]) ? AI[styles[s]].name : (s === '0' ? '你' : '?');
  const pct = v => m.hands ? (v / m.hands * 100).toFixed(1) + '%' : '—';
  console.log('座位' + s + '(' + nm + ')  手数=' + m.hands + '  VPIP=' + pct(m.vpipHands) + '  PFR=' + pct(m.pfrHands) + '  翻后主动=' + m.aggActs + '/' + m.postActs + '  tilt=' + m.tilt.toFixed(2));
});
const rd = dbg().tableRead(1);
console.log('读桌样本：' + rd.n + ' 人，平均VPIP=' + (rd.avgVpip*100).toFixed(1) + '%，松鱼=' + rd.loose + '，紧手=' + rd.tight);
