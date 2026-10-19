/* AI 对 AI 自动对战：验证三档强度是否真的递增
   用法：node _aibench.js [手数]
   原理：从 index.html 里抽出引擎段和 AI 段，在 Node 沙箱里直接对打，不经过 DOM。
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const engineSrc = html.match(/<script id="engine">([\s\S]*?)<\/script>/)[1];
const uiSrc = html.match(/<script id="ui">([\s\S]*?)<\/script>/)[1];

function sliceBetween(src, a, b) {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('抽取失败：' + a);
  return src.slice(i, j);
}

const aiSrc = sliceBetween(uiSrc, '// ---------------- AI ----------------', 'function scheduleAI');
const plStart = uiSrc.indexOf('function posLabel');
const plEnd = uiSrc.indexOf('\n  }', plStart) + 4;
const posSrc = uiSrc.slice(plStart, plEnd);

const sandbox = { console, Math, JSON, Date, game: null };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(engineSrc, sandbox);
const E = sandbox.PokerEngine;
sandbox.E = E;
vm.runInContext(posSrc, sandbox);
vm.runInContext(aiSrc, sandbox);

function playOne(levelA, levelB, btn) {
  const g = E.createGame({
    mode: 'hu', startingChips: 2000, smallBlind: 10, bigBlind: 20, aiLevel: levelA,
  });
  // 关键：createGame 的 buttonSeat 恒为 0，不手动轮换的话座位 0 永远在按钮位
  g.buttonSeat = btn;
  sandbox.game = g;
  const before = g.players.map(p => p.chips);
  E.startHand(g);
  let guard = 0;
  while (!g.handOver && guard++ < 400) {
    const seat = g.activeSeat;
    if (seat < 0) break;
    g.aiLevel = seat === 0 ? levelA : levelB;
    let act;
    try { act = sandbox.aiDecide(g, seat); } catch (e) { act = { type: 'fold' }; }
    E.act(g, seat, act);
  }
  const after = g.players.map(p => p.chips);
  return [after[0] - before[0], after[1] - before[1]];
}

function runMatch(levelA, levelB, hands) {
  let a = 0, b = 0, aWin = 0, bWin = 0, ties = 0;
  const t0 = Date.now();
  for (let i = 0; i < hands; i++) {
    const [da, db] = playOne(levelA, levelB, i % 2);
    a += da; b += db;
    if (da > 0) aWin++; else if (da < 0) bWin++; else ties++;
  }
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  return { a, b, aWin, bWin, ties, sec };
}

const hands = Math.max(1, parseInt(process.argv[2], 10) || 300);
const only = (process.argv[3] && process.argv[4]) ? [[process.argv[3], process.argv[4]]] : null;
const pairs = only || [
  ['easy', 'normal'],
  ['easy', 'hard'],
  ['normal', 'hard'],
];

console.log(`每种对局 ${hands} 手（位置每手交替，引擎自己轮换庄家）\n`);
for (const [x, y] of pairs) {
  const r = runMatch(x, y, hands);
  const winRate = ((r.aWin / hands) * 100).toFixed(1);
  console.log(
    `${x.padEnd(7)} vs ${y.padEnd(7)} → ${x} 净 ${String(r.a).padStart(7)}，` +
    `${y} 净 ${String(r.b).padStart(7)}｜胜率 ${winRate}% ` +
    `(赢 ${r.aWin} / 输 ${r.bWin} / 平 ${r.ties})｜${r.sec}s`
  );
}
