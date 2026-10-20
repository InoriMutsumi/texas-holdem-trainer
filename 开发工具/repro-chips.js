/* 复现「短筹码全下、长筹码投更多，短筹码赢走全部」的问题
   用法：node 开发工具/repro-chips.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox);
const E = sandbox.PokerEngine;

function card(str) {
  const rank = str.slice(0, -1), suit = str.slice(-1);
  const ranks = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
  return { r: ranks[rank], s: suit };
}

function scenario(name, opts) {
  const g = E.createGame({ mode: 'hu', startingChips: 5000, seed: 1 });
  E.startHand(g);

  const p0 = g.players[0], p1 = g.players[1];
  // 构造：p0（玩家）投 5000 全下，p1（AI）投 1000 全下
  p0.chips = 0; p0.totalBet = 5000; p0.allIn = true;
  p1.chips = 0; p1.totalBet = 1000; p1.allIn = true;
  g.pot = 6000;
  g.board = [card('2h'), card('7c'), card('9d'), card('Js'), card('3h')];
  p0.hole = [card('4c'), card('5d')];   // 玩家：高牌 5
  p1.hole = [card('Ah'), card('Ad')];   // AI：一对 A（赢）

  const before0 = p0.chips, before1 = p1.chips;
  E.settle(g);

  console.log('== ' + name + ' ==');
  console.log('  投入：玩家 5000 / AI 1000，底池 6000');
  console.log('  结算后筹码：玩家 ' + p0.chips + '，AI ' + p1.chips);
  console.log('  赢得明细：' + g.result.winners.map(w => g.players[w.playerId].name + ' +' + w.amount + ' (' + w.reason + ')').join(' | '));
  console.log('  边池：' + JSON.stringify((g.sidePots || []).map(s => ({ a: s.amount, res: s.resolution, el: s.eligible }))));
  const total = p0.chips + p1.chips;
  console.log('  筹码守恒：' + total + (total === 6000 ? ' ✔' : ' ✘ 应为 6000'));
  console.log('  AI 净得：' + (p1.chips - before1) + '（正确应为 +1000，因为它只投了 1000）');
  console.log('');
}

scenario('场景：短筹码全下 1000 vs 长筹码全下 5000，短筹码赢');

// 场景 B：6 人桌，短筹码全下 1000，长筹码下注 5000 后弃牌（其他人也弃牌）
(function () {
  const g = E.createGame({ mode: 'six', startingChips: 5000, seed: 7 });
  E.startHand(g);
  const [p0, p1, p2, p3, p4, p5] = g.players;
  p0.chips = 0; p0.totalBet = 5000; p0.allIn = true;   // 长筹码全下后弃牌（模拟）
  p0.folded = true;
  p1.chips = 0; p1.totalBet = 1000; p1.allIn = true;   // 短筹码全下，未弃牌
  p2.folded = true; p3.folded = true; p4.folded = true; p5.folded = true;
  g.pot = 6000;
  g.board = [];  // 无公共牌，直接结算
  E.settle(g);
  console.log('== 场景 B：短筹码全下 1000 vs 长筹码投 5000 后弃牌 ==');
  console.log('  结算后筹码：长筹码 ' + p0.chips + '，短筹码 ' + p1.chips);
  console.log('  明细：' + g.result.winners.map(w => g.players[w.playerId].name + ' +' + w.amount + ' (' + w.reason + ')').join(' | '));
  console.log('  两侧合计：' + (p0.chips + p1.chips) + '（应守恒 6000）');
  console.log('  按标准规则：短筹码只该赢 1000+1000=2000，长筹码 5000 里未被跟注的 4000 应退回');
  console.log('');
})();
