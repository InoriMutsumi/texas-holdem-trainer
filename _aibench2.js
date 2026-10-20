/* 6 人桌 AI 对战 + 频率统计：验证「像不像现实高手」
   用法：node _aibench2.js [难度] [手数] [桌型]
   例：  node _aibench2.js hard 300 six
   统计口径（对照 6-max 现金局 GTO 基准）：
     VPIP  22–27%   PFR 18–22%   3bet 7–9%   Cbet 55–70%   WTSD 27–32%   W$SD 52–58%
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const engineSrc = html.match(/<script id="engine">([\s\S]*?)<\/script>/)[1];
const uiSrc = html.match(/<script id="ui">([\s\S]*?)<\/script>/)[1];
const gtoSrc = html.match(/<script id="gto-data">([\s\S]*?)<\/script>/)[1];

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
vm.runInContext(gtoSrc, sandbox);
vm.runInContext(engineSrc, sandbox);
const E = sandbox.PokerEngine;
sandbox.E = E;
vm.runInContext(posSrc, sandbox);
vm.runInContext(aiSrc, sandbox);

// FAST=1：把蒙特卡洛抽样降到 400。频率统计依赖的是决策分布，不是精确胜率，
// 这样 600 手能从十几分钟压到两三分钟。
// 实验开关：NORANGE=1 关掉范围追踪，用来定位 WTSD 低的根因
if (process.env.NORANGE === '1' && sandbox.AI_PROFILE && sandbox.AI_PROFILE.hard) {
  sandbox.AI_PROFILE.hard.noRange = true;
}
if (process.env.FAST === '1') {
  sandbox.AI_PROFILE.hard.iters = 400;
  sandbox.AI_PROFILE.normal.iters = 300;
}

const LEVEL = process.argv[2] || 'hard';
const HANDS = Number(process.argv[3] || 300);
const MODE = process.argv[4] || 'six';
const N = MODE === 'six' ? 6 : 2;
const BALANCED = process.env.BALANCED !== '0';   // 默认只测均衡性格，BALANCED=0 才带随机性格

function newStats(n) {
  return Array.from({ length: n }, () => ({
    hands: 0, vpip: 0, pfr: 0, tbCh: 0, tb: 0, cbCh: 0, cb: 0, sawFlop: 0, sd: 0, sdWin: 0, net: 0
  }));
}

function analyze(g, stats) {
  const acts = g.actions;
  const vp = new Set(), pf = new Set();
  let firstRaiseSeen = false;
  for (const a of acts) {
    if (a.street !== 'preflop') break;
    if (a.type === 'call' || a.type === 'raise' || a.type === 'allin') vp.add(a.playerId);
    if (a.type === 'raise' || a.type === 'allin') pf.add(a.playerId);
    if (!firstRaiseSeen) {
      if (a.type === 'raise' || a.type === 'allin') firstRaiseSeen = true;
    } else {
      stats[a.playerId].tbCh++;
      if (a.type === 'raise' || a.type === 'allin') stats[a.playerId].tb++;
    }
  }
  let pfAgg = -1;
  for (const a of acts) {
    if (a.street !== 'preflop') break;
    if (a.type === 'raise' || a.type === 'allin') pfAgg = a.playerId;
  }
  if (pfAgg >= 0) {
    const flopActs = acts.filter(a => a.street === 'flop');
    const idx = flopActs.findIndex(a => a.playerId === pfAgg);
    if (idx >= 0) {
      const betBefore = flopActs.slice(0, idx).some(a => a.type === 'raise' || a.type === 'allin');
      if (!betBefore) {
        stats[pfAgg].cbCh++;
        const my = flopActs[idx];
        if (my.type === 'raise' || my.type === 'allin') stats[pfAgg].cb++;
      }
    }
  }
  // 看到翻牌的人（WTSD 的规范分母）
  const sawFlopSeats = new Set();
  for (const a of acts) {
    if (a.street === 'preflop' || a.street === 'flop') sawFlopSeats.add(a.playerId);
  }
  for (let s = 0; s < N; s++) {
    stats[s].hands++;
    if (vp.has(s)) stats[s].vpip++;
    if (pf.has(s)) stats[s].pfr++;
    if (sawFlopSeats.has(s)) stats[s].sawFlop++;
  }
  // 诊断：翻牌圈到底弃了多少
  let flopActsN = 0, flopFold = 0;
  for (const a of acts) {
    if (a.street !== 'flop') continue;
    flopActsN++;
    if (a.type === 'fold') flopFold++;
  }
  stats.__flopActs = (stats.__flopActs || 0) + flopActsN;
  stats.__flopFold = (stats.__flopFold || 0) + flopFold;
  if (g.result && g.result.showdown) {
    const won = new Set(g.result.winners.map(w => w.playerId));
    for (let s = 0; s < N; s++) {
      if (!g.players[s].folded) {
        stats[s].sd++;
        if (won.has(s)) stats[s].sdWin++;
      }
    }
  }
}

const stats = newStats(N);
const t0 = Date.now();
for (let i = 0; i < HANDS; i++) {
  const g = E.createGame({ mode: MODE, startingChips: 2000, smallBlind: 10, bigBlind: 20, aiLevel: LEVEL });
  g.buttonSeat = (i % N + N) % N;
  // 关掉随机性格：这里要测的是「纯 GTO 均衡打法像不像高手」，
  // 带上松凶/跟注站/疯子之后 VPIP 会被性格乘数拉高，测的就不是 GTO 了
  if (BALANCED) sandbox._seatStyle = {};
  sandbox.game = g;
  const before = g.players.map(p => p.chips);
  E.startHand(g);
  let guard = 0;
  while (!g.handOver && guard++ < 600) {
    const seat = g.activeSeat;
    if (seat < 0) break;
    let act;
    try { act = sandbox.aiDecide(g, seat); } catch (e) { act = { type: 'fold' }; }
    E.act(g, seat, act);
  }
  analyze(g, stats);
  const after = g.players.map(p => p.chips);
  for (let s = 0; s < N; s++) stats[s].net += after[s] - before[s];
  if ((i + 1) % 50 === 0) {
    process.stdout.write(`\r  ${i + 1}/${HANDS} 手 · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
console.log('\n');

const pct = (a, b) => b ? (a / b * 100).toFixed(1) : '—';
const pad = (s, n) => String(s).padStart(n);

console.log(`${MODE === 'six' ? '6 人桌' : '单挑'} · ${LEVEL} × ${N} · ${HANDS} 手\n`);
console.log('座位  VPIP   PFR   3bet  Cbet  WTSD  W$SD   净盈亏');
console.log('----  ----   ----  ----  ----  ----  ----   ------');
for (let s = 0; s < N; s++) {
  const t = stats[s];
  console.log(
    pad('S' + s, 4) + pad(pct(t.vpip, t.hands), 7) + pad(pct(t.pfr, t.hands), 7) +
    pad(pct(t.tb, t.tbCh), 6) + pad(pct(t.cb, t.cbCh), 6) +
    pad(pct(t.sd, t.sawFlop), 6) + pad(pct(t.sdWin, t.sd), 6) +
    pad((t.net >= 0 ? '+' : '') + t.net, 8)
  );
}
console.log('\nGTO 基准（6-max 现金局）：VPIP 22–27 · PFR 18–22 · 3bet 7–9 · Cbet 55–70 · WTSD 27–32 · W$SD 52–58');
