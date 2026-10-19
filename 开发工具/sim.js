/* 风格对打赛：让 6 人桌跑 N 手，统计每个 AI 座位的翻前 VPIP / PFR / 加注率
   用法：node sim.js [手数] */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const DIR = path.resolve(__dirname, '..');
const html = fs.readFileSync(DIR + '/index.html', 'utf8');
const gtoSrc = fs.readFileSync(DIR + '/gto-data.js', 'utf8');
const MAX_HANDS = parseInt(process.argv[2] || '300', 10);

function extract(id) {
  const re = new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>');
  const m = html.match(re);
  return m ? m[1] : null;
}
const engineSrc = extract('engine');
let uiSrc = extract('ui');

// 在 IIFE 内部开一个只读探针，方便外部读取闭包里的状态
const marker = "'use strict';";
const at = uiSrc.indexOf(marker);
uiSrc = uiSrc.slice(0, at + marker.length) +
  '\n  window.__dbg = function () { return { game: game, styles: _seatStyle, styleOf: styleOf, AI_STYLES: AI_STYLES, gtoSpot: gtoSpot, gtoFreqFor: gtoFreqFor, handAdvice: handAdvice, gtoPos: gtoPos, holeKey: holeKey, GTO: GTO, GTO_IDX: GTO_IDX, parseGtoCode: parseGtoCode, stylePreflop: stylePreflop, blurFreq: blurFreq }; };' +
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
      if (!this._qcache[cls]) {
        const child = makeEl('div');
        child.className = cls;
        this.appendChild(child);
        this._qcache[cls] = child;
      }
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
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);

vm.runInContext(gtoSrc, sandbox);
vm.runInContext(engineSrc, sandbox);

storage['poker.save.v2'] = JSON.stringify({
  schemaVersion: 2, chips: 2000, hands: 0, rebuys: 0,
  settings: {
    table: 'six', aiLevel: 'normal', blinds: { sb: 10, bb: 20 },
    buyIn: 2000, autoRebuy: true, messageEnabled: false, avatars: []
  },
  stats: { vpip: 0, pfr: 0, won: 0, ev: 0 }
});

vm.runInContext(uiSrc, sandbox);
const dbg = sandbox.window.__dbg;

// ---- 包装 nextHand，拿到每手牌的唯一编号（engine 内部直接调 startHand，包 startHand 没用）----
let handId = 0;
const seen = {};
const stats = {};
const origNext = sandbox.PokerEngine.nextHand;
sandbox.PokerEngine.nextHand = function (g) { handId++; return origNext.apply(this, arguments); };

const origAct = sandbox.PokerEngine.act;
sandbox.PokerEngine.act = function (g, seat, action) {
  const type = typeof action === 'string' ? action : (action && action.type);
  if (seat !== 0 && g.street === 'preflop') {
    const key = handId + ':' + seat;
    if (!seen[key]) {
      if (type === 'raise' || type === 'allin' || type === 'call' || type === 'fold') {
        seen[key] = true;
        const s = stats[seat] || (stats[seat] = { n: 0, vpip: 0, pfr: 0, call: 0, fold: 0 });
        s.n++;
        if (type === 'raise' || type === 'allin') { s.vpip++; s.pfr++; }
        else if (type === 'call') { s.vpip++; s.call++; }
        else if (type === 'fold') { s.fold++; }
      }
    }
  }
  return origAct.apply(this, arguments);
};

// ---- 开始模拟 ----
const start = Date.now();
let clicks = 0;
while (clicks < 60000) {
  const g = dbg().game;
  if (g && g.handsPlayed >= MAX_HANDS) break;
  const box = elements['actionButtons'];
  if (!box) break;
  const btns = box.children.filter(c => c.tagName === 'button');
  if (!btns.length) break;
  const b = btns[Math.floor(Math.random() * btns.length)];
  try { b.onclick(); } catch (e) { console.log('点击异常：' + e.message); break; }
  clicks++;
}

const g = dbg().game;
const styles = dbg().styles;
const AI_STYLES = dbg().AI_STYLES;
const elapsed = Date.now() - start;

console.log('===== 风格对打赛结果 =====');
console.log('手数：' + (g ? g.handsPlayed : 0) + '　点击：' + clicks + '　耗时：' + (elapsed / 1000).toFixed(1) + ' 秒');
console.log('');
console.log('座位  风格      样本   VPIP    PFR   加注占比  跟注占比  弃牌占比');
const rows = [];
Object.keys(stats).map(Number).sort((a, b) => a - b).forEach(seat => {
  const s = stats[seat];
  const name = styles[seat] || '-';
  const display = AI_STYLES[name] ? AI_STYLES[name].name : name;
  const vpip = (s.vpip / s.n * 100).toFixed(1);
  const pfr = (s.pfr / s.n * 100).toFixed(1);
  const raiseShare = s.vpip ? (s.pfr / s.vpip * 100).toFixed(0) : '0';
  const callShare = s.vpip ? (s.call / s.vpip * 100).toFixed(0) : '0';
  const foldShare = (s.fold / s.n * 100).toFixed(0);
  console.log(String(seat).padEnd(5) + display.padEnd(8) + String(s.n).padStart(5) +
    vpip.padStart(7) + '%' + pfr.padStart(7) + '%' +
    raiseShare.padStart(8) + '%' + callShare.padStart(8) + '%' + foldShare.padStart(8) + '%');
  rows.push({ seat, name: display, key: name, vpip: s.vpip / s.n, pfr: s.pfr / s.n, n: s.n });
});

// 与本风格的 GTO 基准比较（翻前进入率应随 enterMul 单调变化）
const ordered = rows.slice().sort((a, b) => AI_STYLES[a.key].enterMul - AI_STYLES[b.key].enterMul);
console.log('');
console.log('按 enterMul 从紧到松排序（检验单调性）：');
ordered.forEach(r => {
  console.log('  ' + r.name.padEnd(6) + ' enterMul=' + AI_STYLES[r.key].enterMul.toFixed(2) +
    '  实测 VPIP=' + (r.vpip * 100).toFixed(1) + '%');
});
let mono = true;
for (let i = 1; i < ordered.length; i++) {
  if (ordered[i].vpip + 0.02 < ordered[i - 1].vpip) mono = false;
}
console.log('');
console.log('VPIP 单调性：' + (mono ? '✅ 通过' : '❌ 有逆序（样本小或位置差异导致）'));

// ---- GTO 查看器冒烟 ----
console.log('');
try {
  getEl('btnGto').onclick();
  const grid = getEl('gtoGrid');
  const cells = (grid.innerHTML.match(/gto-cell/g) || []).length;
  console.log('GTO 查看器：渲染 ' + cells + ' 格 ' + (cells === 169 ? '✅' : '❌ 应为 169'));
  const sel = getEl('gtoSpotSel');
  console.log('场景下拉：' + (sel.innerHTML.match(/<option/g) || []).length + ' 项');
} catch (e) {
  console.log('GTO 查看器报错：' + e.message);
  console.log(e.stack.split('\n').slice(0, 4).join('\n'));
}

