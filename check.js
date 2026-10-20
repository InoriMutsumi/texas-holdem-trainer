/* 检查两段脚本的语法，并做一次 DOM 桩冒烟测试 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(require('path').join(__dirname, fs.existsSync(require('path').join(__dirname, 'index.html')) ? 'index.html' : '德州扑克.html'), 'utf8');

function extract(id) {
  const re = new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>');
  const m = html.match(re);
  return m ? m[1] : null;
}

const engineSrc = extract('engine');
const uiSrc = extract('ui');

for (const [id, src] of [['engine', engineSrc], ['ui', uiSrc]]) {
  if (!src) { console.log(id + ': 找不到'); process.exitCode = 1; continue; }
  try {
    new Function(src);
    console.log(id + ': 语法 OK（' + src.split('\n').length + ' 行）');
  } catch (e) {
    console.log(id + ': 语法错误 — ' + e.message);
    process.exitCode = 1;
  }
}

// ---- 用最小 DOM 桩跑一遍 UI，确认没有运行时错误 ----
function makeEl(tag) {
  const el = {
    tagName: tag, className: '', textContent: '', style: {},
    children: [], _attrs: {}, _handlers: {}, _qcache: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelectorAll() { return []; },
    // 极简 querySelector：按 class 名懒创建一个占位子元素，够冒烟用
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
    get onclick() { return this._handlers.click; },
    set onclick(f) { this._handlers.click = f; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
  };
  let inner = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return inner; },
    set(v) { inner = v; if (v === '') { this.children = []; this._qcache = {}; } }   // 模拟清空
  });
  return el;
}

const elements = {};
function getEl(id) {
  if (!elements[id]) elements[id] = makeEl('div');
  return elements[id];
}

const documentStub = {
  getElementById: getEl,
  createElement: makeEl,
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
  body: makeEl('body')
};
const storage = {};
const localStorageStub = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem(k, v) { storage[k] = String(v); },
  removeItem(k) { delete storage[k]; }
};
const sandbox = {
  console,
  document: documentStub,
  location: { search: '' },
  localStorage: localStorageStub,
  setTimeout: (fn) => { fn(); return 0; },   // AI 立即行动，便于同步冒烟
  clearTimeout: () => {},
  confirm: () => true,
  matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  Date, Math, JSON,
  addEventListener() {}, removeEventListener() {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(engineSrc, sandbox);
  console.log('engine 加载 OK，导出：' + Object.keys(sandbox.PokerEngine).length + ' 个 API');
} catch (e) {
  console.log('engine 运行失败 — ' + e.message);
  process.exitCode = 1;
}

// 可选：用 6 人桌 / 9 人桌模式跑冒烟（node check.js six / node check.js nine）
const argMode = process.argv[2];
const tableMode = (argMode === 'nine') ? 'nine' : 'six';
if (tableMode !== 'hu') {
  storage['poker.save.v2'] = JSON.stringify({
    schemaVersion: 2, chips: 2000, hands: 0, rebuys: 0,
    settings: {
      table: tableMode, aiLevel: 'normal', blinds: { sb: 10, bb: 20 },
      buyIn: 2000, autoRebuy: true, messageEnabled: true, avatars: []
    },
    stats: { vpip: 0, pfr: 0, won: 0, ev: 0 }
  });
  console.log('模式：' + (tableMode === 'nine' ? '9 人桌' : '6 人桌'));
}

try {
  vm.runInContext(uiSrc, sandbox);
  console.log('ui 运行 OK（初始渲染没抛错）');
} catch (e) {
  console.log('ui 运行失败 — ' + e.message);
  console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  process.exitCode = 1;
}

// ---- 模拟打 10 手：轮到玩家就点第一个可用按钮 ----
function pickBtn() {
  const box = elements['actionButtons'];
  if (!box) return null;
  const btns = box.children.filter(c => c.tagName === 'button' && !c.disabled);
  if (btns.length === 0) return null;
  // 随机挑一个，覆盖跟注/加注/全下等不同路径
  return btns[Math.floor(Math.random() * btns.length)];
}

let clicks = 0;
let lastHands = -1;
try {
  while (clicks < 400) {
    const handsNow = parseInt(elements['topHands'].textContent || '0', 10);
    if (handsNow >= 10) break;
    const btn = pickBtn();
    if (!btn) { console.log('没有可点按钮，停止'); break; }
    if (clicks < 6 || clicks % 40 === 0) {
      console.log('  [点击' + clicks + '] 按钮="' + btn.textContent + '" 手数=' + handsNow);
    }
    try { btn.onclick(); } catch (e) { console.log('  点击异常：' + e.message); console.log(e.stack.split('\n').slice(0, 6).join('\n')); break; }
    clicks++;
    if (handsNow !== lastHands) { lastHands = handsNow; }
  }
  const hands = parseInt(elements['topHands'].textContent || '0', 10);
  console.log('模拟完成：点击 ' + clicks + ' 次，打完 ' + hands + ' 手');
  // 牌谱是否落进 localStorage
  let saved = [];
  try { saved = JSON.parse(storage['poker.hands.v2'] || '[]'); } catch (e) { saved = []; }
  console.log('牌谱条数：' + saved.length);
  if (hands < 3) {
    console.log('警告：手数太少，可能流程卡住');
    process.exitCode = 1;
  }
  if (saved.length === 0) {
    console.log('警告：牌谱没写进 localStorage');
    process.exitCode = 1;
  }
} catch (e) {
  console.log('模拟对局失败 — ' + e.message);
  console.log(e.stack.split('\n').slice(0, 5).join('\n'));
  process.exitCode = 1;
}
