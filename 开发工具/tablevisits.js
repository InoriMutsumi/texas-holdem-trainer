/* 9 人桌实况统计：AI 真实的入池率、每手进翻牌人数、各位置 VPIP
   用法：node 开发工具/tablevisits.js [手数] [档位 easy|normal|hard]
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
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

// GTO 表在单独一个 script 里，是 window.GTO_TABLE；AI 段启动时会读它建索引。
// 不设这个，AI 的翻前会永远走「查不到表」的兜底分支，统计出来的弃牌率全是假的。
(function () {
  const at = html.indexOf('window.GTO_TABLE');
  if (at < 0) return;
  const b = html.indexOf('{', at);
  let d = 0, end = -1;
  for (let k = b; k < html.length; k++) {
    const c = html[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) { end = k; break; } }
  }
  if (end > 0) sandbox.GTO_TABLE = eval('(' + html.slice(b, end + 1) + ')');
})();

vm.runInContext(posSrc, sandbox);
vm.runInContext(aiSrc, sandbox);

const HANDS = Math.max(1, parseInt(process.argv[2], 10) || 200);
const LEVEL = process.argv[3] || 'normal';

const POS_9 = ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'MP+1', 'HJ', 'CO'];
const posStat = {};
POS_9.forEach(p => (posStat[p] = { hands: 0, vpip: 0, pfr: 0, fold: 0 }));

let sumFlopPlayers = 0;
let flopHist = {};
let sumShowdown = 0;
let handsCounted = 0;
let sawFlop = 0;       // 有翻牌的手数
let noFlopHands = 0;   // 翻前就结束

const g = E.createGame({ mode: 'nine', startingChips: 2000, aiLevel: LEVEL });

for (let h = 0; h < HANDS; h++) {
  g.aiLevel = LEVEL;
  g.players.forEach(p => { if (p.chips <= 0) p.chips = 2000; });
  E.startHand(g);
  const n = g.players.length;

  // 记录每个玩家翻前的动作（用于算 VPIP/PFR）
  const pre = g.players.map(() => ({ vpip: false, pfr: false, folded: false }));
  sandbox.game = g;
  const myPos = g.players.map((p, i) => sandbox.posLabel(i));
  let guard = 0;
  let flopPlayers = -1;

  while (!g.handOver && guard++ < 900) {
    if (flopPlayers < 0 && g.street === 'flop') {
      flopPlayers = g.players.filter(p => !p.folded).length;
    }
    const seat = g.activeSeat;
    if (seat < 0) break;
    let act;
    try { act = sandbox.aiDecide(g, seat); } catch (e) { act = { type: 'fold' }; }

    // 翻前统计
    if (g.street === 'preflop') {
      if (act.type === 'call' || act.type === 'raise' || act.type === 'allin') {
        // 盲注不算主动入池：大盲/小盲过牌到免费看牌也算，但按标准 VPIP 只算主动投钱
        const p = g.players[seat];
        const isBlindOnly = (act.type === 'call' && p.streetBet >= g.streetCurrentBet);
        if (!isBlindOnly) pre[seat].vpip = true;
      }
      if (act.type === 'raise') pre[seat].pfr = true;
      if (act.type === 'fold') pre[seat].folded = true;
    }
    E.act(g, seat, act);
  }

  // 如果翻前就结束了，进翻牌人数记 0
  if (flopPlayers < 0) { noFlopHands++; flopPlayers = 0; } else { sawFlop++; }

  handsCounted++;
  sumFlopPlayers += flopPlayers;
  flopHist[flopPlayers] = (flopHist[flopPlayers] || 0) + 1;

  // 摊牌人数
  const alive = g.players.filter(p => !p.folded).length;
  if (g.result && g.result.showdown) sumShowdown += alive;

  for (let i = 0; i < n; i++) {
    const ps = posStat[myPos[i]];
    if (!ps) continue;
    ps.hands++;
    if (pre[i].vpip) ps.vpip++;
    if (pre[i].pfr) ps.pfr++;
    if (pre[i].folded) ps.fold++;
  }
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-');

console.log(`9 人桌 · ${LEVEL} 档 · ${HANDS} 手\n`);
console.log(`平均每手进翻牌人数：${(sumFlopPlayers / handsCounted).toFixed(2)} 人`);
console.log(`翻前就结束（没人看翻牌）：${noFlopHands} 手（${pct(noFlopHands, handsCounted)}）`);
console.log(`平均摊牌人数：${g.result && sawFlop ? (sumShowdown / Math.max(1, sawFlop)).toFixed(2) : '-'}\n`);

console.log('进翻牌人数分布：');
Object.keys(flopHist).sort((a, b) => a - b).forEach(k => {
  const v = flopHist[k];
  const bar = '█'.repeat(Math.round((v / handsCounted) * 50));
  console.log(`  ${String(k).padStart(2)} 人  ${String(v).padStart(4)} 手 ${pct(v, handsCounted).padStart(6)}  ${bar}`);
});

console.log('\n各位置（9 人桌）：');
console.log('  位置     手数   VPIP    PFR    弃牌率');
['UTG', 'UTG+1', 'MP', 'MP+1', 'HJ', 'CO', 'BTN', 'SB', 'BB'].forEach(p => {
  const s = posStat[p];
  if (!s || !s.hands) return;
  console.log(
    '  ' + p.padEnd(7) + String(s.hands).padStart(5) + '  ' +
    pct(s.vpip, s.hands).padStart(6) + '  ' + pct(s.pfr, s.hands).padStart(6) + '  ' +
    pct(s.fold, s.hands).padStart(6)
  );
});

const totalVpip = Object.values(posStat).reduce((a, s) => a + s.vpip, 0);
const totalHands = Object.values(posStat).reduce((a, s) => a + s.hands, 0);
console.log('\n全桌平均 VPIP：' + pct(totalVpip, totalHands));
