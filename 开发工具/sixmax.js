/* 6 人桌随机对局压力测试（临时脚本） */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(require('path').join(__dirname, '..', fs.existsSync(require('path').join(__dirname, '..', 'index.html')) ? 'index.html' : '德州扑克.html'), 'utf8');
const src = html.match(/<script id="engine">([\s\S]*?)<\/script>/)[1];
const sandbox = { console, Date, Math, JSON };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const E = sandbox.PokerEngine;

let fails = 0;
let hands = 0;
for (let seed = 1; seed <= 60; seed++) {
  const g = E.createGame({ mode: '6max', startingChips: 2000, seed });
  try { E.startHand(g); } catch (e) { console.log('seed', seed, '开局失败', e.message); fails++; continue; }
  let guard = 0;
  try {
    while (!g.handOver && guard++ < 800) {
      const seat = g.activeSeat;
      const acts = E.legalActionsFor(g, seat);
      let a = acts[Math.floor(Math.random() * acts.length)];
      if (a.type === 'raise') {
        const span = a.max - a.min;
        a = { type: 'raise', amount: a.min + (span > 0 ? Math.floor(Math.random() * (span + 1)) : 0) };
      } else if (a.type === 'allin') {
        a = { type: 'allin' };
      }
      E.act(g, seat, a);
    }
  } catch (e) {
    console.log('seed', seed, '第', g.street, '街异常：' + e.message);
    console.log(g.players.map(p => ({
      id: p.id, chips: p.chips, streetBet: p.streetBet, totalBet: p.totalBet,
      folded: p.folded, allIn: p.allIn, acted: p.acted
    })));
    console.log('currentBet=' + g.streetCurrentBet, 'pot=' + g.pot, 'active=' + g.activeSeat);
    fails++;
    continue;
  }
  if (!g.handOver) { console.log('seed', seed, '未结束，guard=', guard, '街=', g.street); fails++; continue; }
  hands++;
  const sumBet = g.players.reduce((s, p) => s + p.totalBet, 0);
  const sp = g.sidePots.reduce((s, x) => s + x.amount, 0) + g.refunds.reduce((s, x) => s + x.amount, 0);
  if (sumBet !== sp) {
    console.log('seed', seed, '守恒失败 totalBet=', sumBet, 'sidePots+refunds=', sp);
    fails++;
  }
  if (g.board.length !== 5 && g.street !== 'showdown') {
    // 只剩一人时提前收池，board 可能不足 5
    if (E.alivePlayers(g).length !== 1) console.log('seed', seed, '牌面不完整', g.board.length, g.street);
  }
}
console.log(fails === 0 ? ('6 人桌 ' + hands + ' 手随机测试全部通过') : ('失败 ' + fails + ' 项'));
process.exitCode = fails === 0 ? 0 : 1;
