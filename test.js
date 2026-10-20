/* 规则引擎自测：从 德州扑克.html 里抽出 <script id="engine"> 在 node 里跑
   用法：node test.js
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const htmlPath = ['index.html', '德州扑克.html']
  .map(f => path.join(__dirname, f))
  .find(p => fs.existsSync(p));
if (!htmlPath) { console.error('找不到 index.html 或 德州扑克.html'); process.exit(1); }
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
if (!m) { console.error('找不到 engine script'); process.exit(1); }

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox);
const E = sandbox.PokerEngine;

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  XX  ' + name + '\n      期望 ' + b + '\n      实际 ' + a); }
}
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  XX  ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

// ---------- 1. 行动顺序 ----------
section('1 单挑行动顺序');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 1 });
  E.startHand(g);
  eq(g.activeSeat, g.buttonSeat, '翻前 BTN/SB 先行动');
  // BTN 跟注，BB 过牌
  E.act(g, g.activeSeat, { type: 'call' });
  eq(g.activeSeat, (g.buttonSeat + 1) % 2, '翻前 BB 后行动');
  E.act(g, g.activeSeat, { type: 'check' });
  eq(g.street, 'flop', '两人跟平后进入翻牌');
  eq(g.activeSeat, (g.buttonSeat + 1) % 2, '翻后 BB 先行动');
}

// ---------- 2. 三层全下 ----------
section('2 三层全下边池');
{
  const fake = {
    players: [
      { id: 0, totalBet: 100, folded: false },
      { id: 1, totalBet: 300, folded: false },
      { id: 2, totalBet: 500, folded: false }
    ],
    buttonSeat: 0
  };
  const pots = E.buildLayers(fake);
  eq(pots.length, 3, '三层');
  eq(pots[0].amount, 300, '主池 300');
  eq(pots[0].resolution, 'showdown', '主池比牌');
  eq(pots[1].amount, 400, '边池 400');
  eq(pots[1].resolution, 'showdown', '边池比牌');
  eq(pots[2].amount, 200, '最上层 200');
  eq(pots[2].resolution, 'direct', '最上层 direct');
  eq(pots[2].winnerId, 2, '最上层归 500');
  const total = pots.reduce((s, p) => s + p.amount, 0);
  eq(total, 900, '总额守恒 900');
}

// ---------- 3. 三层投入（高投入弃牌，构造数据） ----------
section('3 死钱层合并');
{
  const g = {
    players: [
      { id: 0, totalBet: 100, folded: false },
      { id: 1, totalBet: 300, folded: false },
      { id: 2, totalBet: 500, folded: true }
    ],
    buttonSeat: 0,
    deadMoney: []
  };
  const pots = E.buildLayers(g);
  eq(pots[2].resolution, 'dead', '最高层是死钱');
  const merged = E.mergeDeadLayers(g, pots);
  eq(merged.length, 2, '合并后剩两层');
  eq(merged[0].amount, 300, '底层 300');
  eq(merged[1].amount, 600, '中层 400 + 死钱 200 = 600');
  eq(g.deadMoney.length, 1, 'deadMoney 记录一条');
  eq(g.deadMoney[0].mergedIntoLayer, 1, 'mergedIntoLayer 指向数组下标 1');
  const total = merged.reduce((s, p) => s + p.amount, 0);
  eq(total, 900, '合并后总额仍 900');
}

// ---------- 4. 三层全下（300 弃牌） ----------
section('4 未弃牌者 direct');
{
  const pots = E.buildLayers({
    players: [
      { id: 0, totalBet: 100, folded: false },
      { id: 1, totalBet: 300, folded: true },
      { id: 2, totalBet: 500, folded: false }
    ],
    buttonSeat: 0
  });
  eq(pots.length, 3, '三层');
  eq(pots[1].resolution, 'direct', '中层 direct');
  eq(pots[1].winnerId, 2, '中层归 500');
  eq(pots[2].resolution, 'direct', '上层 direct');
  eq(pots[2].winnerId, 2, '上层归 500');
  const total = pots.reduce((s, p) => s + p.amount, 0);
  eq(total, 900, '总额 900');
}

// ---------- 5. 最小加注 ----------
section('5 最小加注');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 2 });
  E.startHand(g);
  g.street = 'flop';
  g.streetCurrentBet = 100;
  g.lastFullRaiseSize = 100;
  g.activeSeat = 0;
  g.players[0].streetBet = 0;
  g.players[1].streetBet = 100;
  g.players[0].acted = false;
  g.players[0].actedBeforeLastFullRaise = false;
  const acts = E.legalActionsFor(g, 0);
  const raise = acts.filter(a => a.type === 'raise')[0];
  ok(!!raise, '存在加注选项');
  eq(raise.min, 200, '最小加注到 200');
}

// ---------- 6. 短全下后已行动玩家不能加注 ----------
section('6 短全下后不能加注');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 3 });
  E.startHand(g);
  // 手动摆一个「P 已行动、面对不足一个完整加注的短全下」的局面
  g.players[0].streetBet = 100; g.players[0].chips = 1900;
  g.players[1].streetBet = 150; g.players[1].chips = 1850; g.players[1].allIn = true;
  g.streetCurrentBet = 150;
  g.lastFullRaiseSize = 100;
  g.players[0].acted = true;
  g.players[0].actedBeforeLastFullRaise = true;
  g.players[0].facedRaiseAmount = 50;
  g.activeSeat = 0;
  const acts = E.legalActionsFor(g, 0);
  ok(!acts.some(a => a.type === 'raise'), '没有加注权');
  eq(g.players[0].reopenEligible, false, 'reopenEligible 为 false');
}

// ---------- 7. 弃牌投入计入底池金额但不进 eligible ----------
section('7 弃牌者金额与资格');
{
  const pots = E.buildLayers({
    players: [
      { id: 0, totalBet: 100, folded: false },
      { id: 1, totalBet: 100, folded: true }
    ],
    buttonSeat: 0
  });
  eq(pots[0].amount, 200, '弃牌者的 100 也算进池');
  eq(pots[0].eligible, [0], 'eligible 只有未弃牌者');
}

// ---------- 8. 全员过牌到摊牌 ----------
section('8 过牌到摊牌');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 4 });
  E.startHand(g);
  E.act(g, g.activeSeat, { type: 'call' });
  E.act(g, g.activeSeat, { type: 'check' });
  E.act(g, g.activeSeat, { type: 'check' });   // flop
  E.act(g, g.activeSeat, { type: 'check' });
  E.act(g, g.activeSeat, { type: 'check' });   // turn
  E.act(g, g.activeSeat, { type: 'check' });
  E.act(g, g.activeSeat, { type: 'check' });   // river
  E.act(g, g.activeSeat, { type: 'check' });
  eq(g.street, 'showdown', '进入摊牌');
  eq(g.board.length, 5, '发了 5 张公共牌');
  ok(g.result && g.result.showdown, '有摊牌结果');
  const total = g.sidePots.reduce((s, p) => s + p.amount, 0);
  eq(total, g.players.reduce((s, p) => s + p.totalBet, 0), '边池总额守恒');
}

// ---------- 9. 牌型比较 ----------
section('9 牌型');
{
  const c = (r, s) => ({ r, s });
  eq(E.eval5([c(14, 's'), c(13, 's'), c(12, 's'), c(11, 's'), c(10, 's')]), [8, 14], '皇家同花顺');
  eq(E.eval5([c(9, 'h'), c(8, 'h'), c(7, 'h'), c(6, 'h'), c(5, 'h')]), [8, 9], '同花顺');
  eq(E.eval5([c(9, 's'), c(9, 'h'), c(9, 'd'), c(9, 'c'), c(2, 's')]), [7, 9, 2], '四条');
  eq(E.eval5([c(14, 's'), c(2, 's'), c(3, 's'), c(4, 's'), c(5, 's')]), [8, 5], 'A2345 同花顺');
  eq(E.eval5([c(14, 's'), c(2, 'h'), c(3, 'd'), c(4, 'c'), c(5, 's')]), [4, 5], 'A2345 顺子');
  ok(E.cmpVal([8, 5], [8, 6]) < 0, 'A2345 < 23456');
  ok(E.cmpVal([7, 9, 2], [6, 9, 2]) > 0, '四条 > 葫芦');
}

// ---------- 10. 公共牌最大牌型平分 ----------
section('10 公共牌平分与余数');
{
  const c = (r, s) => ({ r, s });
  const board = [c(14, 's'), c(13, 's'), c(12, 's'), c(11, 's'), c(10, 's')];
  const p1 = [c(2, 'h'), c(3, 'h')];
  const p2 = [c(4, 'd'), c(5, 'd')];
  const v1 = E.eval7(p1.concat(board));
  const v2 = E.eval7(p2.concat(board));
  eq(E.cmpVal(v1, v2), 0, '双方都打公共牌，牌力相同');
}

// ---------- 11. 只剩一人 ----------
section('11 只剩一人');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 5 });
  E.startHand(g);
  E.act(g, g.activeSeat, { type: 'fold' });
  eq(g.players[0].folded || g.players[1].folded, true, '有人弃牌');
  ok(g.result && !g.result.showdown, '没摊牌直接收池');
}

// ---------- 12/13. 短盲 ----------
section('12 短 SB');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 6 });
  g.players[g.buttonSeat].chips = 7;   // BTN/SB 只有 7
  E.startHand(g);
  const sb = g.players[g.buttonSeat];
  eq(sb.streetBet, 7, 'SB 只投了 7');
  ok(sb.allIn, 'SB 全下');
  eq(g.streetCurrentBet, 20, '法定当前注仍是 20');
}
section('13 短 BB');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 7 });
  const bbSeat = (g.buttonSeat + 1) % 2;
  g.players[bbSeat].chips = 15;
  E.startHand(g);
  eq(g.players[bbSeat].streetBet, 15, 'BB 只投了 15');
  ok(g.players[bbSeat].allIn, 'BB 全下');
  eq(g.streetCurrentBet, 20, '法定当前注仍是 20');
}

// ---------- 14. 按钮轮转 ----------
section('14 按钮轮转');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 8 });
  E.startHand(g);
  const b0 = g.buttonSeat;
  E.act(g, g.activeSeat, { type: 'fold' });
  E.nextHand(g);
  ok(g.buttonSeat !== b0, '按钮换人');
}

// ---------- 15. 部分全下继续下注 ----------
section('15 部分全下不提前发完');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 9 });
  E.startHand(g);
  E.act(g, g.activeSeat, { type: 'call' });
  E.act(g, g.activeSeat, { type: 'check' });
  // 翻牌圈，一人全下
  g.players[0].chips = 100;
  E.act(g, g.activeSeat, { type: 'allin' });
  eq(g.board.length, 3, '翻牌圈没提前发完');
  ok(g.street === 'flop' || g.street === 'turn', '牌局继续');
}

// ---------- 16. 全员全下 ----------
section('16 全员全下');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 10 });
  E.startHand(g);
  g.players[0].chips = 100;
  g.players[1].chips = 100;
  g.players[0].streetBet = 10; g.players[1].streetBet = 20;
  g.players[0].allIn = false; g.players[1].allIn = false;
  E.act(g, g.activeSeat, { type: 'allin' });
  // 另一方跟注全下
  if (!g.handOver) {
    try { E.act(g, g.activeSeat, { type: 'allin' }); } catch (e) { /* 可能已经结束 */ }
  }
  ok(g.street === 'showdown', '全员全下后直接摊牌');
  eq(g.board.length, 5, '发完 5 张公共牌');
}

// ---------- 18. 大盲选项 ----------
section('18 大盲选项');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 11 });
  E.startHand(g);
  E.act(g, g.activeSeat, { type: 'call' });   // BTN 跟注
  eq(g.activeSeat, (g.buttonSeat + 1) % 2, '轮到 BB（有选项）');
  const acts = E.legalActionsFor(g, g.activeSeat);
  ok(acts.some(a => a.type === 'check'), 'BB 可以过牌');
  ok(acts.some(a => a.type === 'raise'), 'BB 可以加注');
}

// ---------- 19. 短全下累计 ----------
section('19 短全下累计与重开');
{
  // 直接摆状态：P 跟注 100，Q 加注 200，R 全下 250，S 全下 300
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 12 });
  E.startHand(g);
  const mk = (id, sb, chips, allIn, acted, faced, before) => ({
    id, name: 'P' + id, seat: id, chips, hole: [], streetBet: sb, totalBet: sb,
    folded: false, allIn: !!allIn, acted: !!acted,
    facedRaiseAmount: faced || 0, actedBeforeLastFullRaise: !!before,
    reopenEligible: false
  });
  g.players = [
    mk(0, 100, 1800, false, true, 200, true),   // P：跟注过 100，没全下
    mk(1, 200, 1800, false, true, 100, true),   // Q：加注到 200，没全下
    mk(2, 250, 0, true, true, 50, true),        // R：全下 250，面对 50
    mk(3, 300, 0, true, true, 0, true)          // S：全下 300，最后抬价者
  ];
  g.streetCurrentBet = 300;
  g.lastFullRaiseSize = 100;
  g.lastAggressor = 3;
  g.street = 'flop';
  g.activeSeat = 0;
  g.pot = 1150;
  eq(E.computeReopen(g, 0), true, 'P 重新开放');
  eq(E.computeReopen(g, 1), true, 'Q 重新开放（原加注者但面对新的累计加注）');
  eq(E.computeReopen(g, 2), false, 'R 只有 50，不重开');
  eq(E.computeReopen(g, 3), false, 'S 是最后抬价者，不重开');
}

// ---------- 20. 守恒 ----------
section('20 守恒');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 13 });
  E.startHand(g);
  E.act(g, g.activeSeat, { type: 'raise', amount: 60 });
  if (!g.handOver) E.act(g, g.activeSeat, { type: 'call' });
  if (!g.handOver) {
    E.act(g, g.activeSeat, { type: 'check' });
    E.act(g, g.activeSeat, { type: 'check' });
    E.act(g, g.activeSeat, { type: 'check' });
    E.act(g, g.activeSeat, { type: 'check' });
    E.act(g, g.activeSeat, { type: 'check' });
    E.act(g, g.activeSeat, { type: 'check' });
  }
  const potSum = g.sidePots.reduce((s, p) => s + p.amount, 0);
  const totalBet = g.players.reduce((s, p) => s + p.totalBet, 0);
  eq(potSum, totalBet, 'sidePots 总额 = totalBet 总额');
}

// ---------- 21. 烧牌 ----------
section('21 烧牌');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 14 });
  E.startHand(g);
  eq(g.deckState.length, 4, '发完底牌 4 张');
  E.act(g, g.activeSeat, { type: 'call' });
  E.act(g, g.activeSeat, { type: 'check' });
  eq(g.deckState.length, 8, '翻牌后 4 底牌 + 1 烧 + 3 公共 = 8');
  ok(g.deckState.some(x => x.burn), 'deckState 里有烧牌位');
  eq(g.board.length, 3, '公共牌 3 张');
}

// ---------- 22. 自动补码 ----------
section('22 自动补码');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 15 });
  E.startHand(g);
  E.act(g, g.activeSeat, { type: 'fold' });
  g.players[0].chips = 0;
  E.nextHand(g);
  ok(g.players[0].chips === g.buyIn - 10 || g.players[0].chips === g.buyIn - 20,
    '补码后筹码回到买入额（新一手已扣盲注）', '实际 ' + g.players[0].chips);
  ok(g.rebuys >= 1, '补码次数 +1');
}

// ---------- 23. 换街清零 ----------
section('23 换街清零与快照');
{
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 16 });
  E.startHand(g);
  E.act(g, g.activeSeat, { type: 'call' });
  E.act(g, g.activeSeat, { type: 'check' });
  eq(g.street, 'flop', '进入翻牌');
  eq(g.lastFullRaiseSize, g.bigBlind, '翻牌 lastFullRaiseSize = 大盲');
  eq(g.raiseAccumulator, 0, 'raiseAccumulator 归零');
  g.players.forEach(p => {
    eq(p.facedRaiseAmount, 0, p.name + ' facedRaiseAmount 归零');
    eq(p.actedBeforeLastFullRaise, false, p.name + ' actedBeforeLastFullRaise 归零');
    eq(p.reopenEligible, false, p.name + ' reopenEligible 归零');
  });
}

// ---------- 24. 9 人桌 ----------
section('24 9 人桌');
{
  const g = E.createGame({ mode: 'nine', startingChips: 2000, seed: 21 });
  eq(g.players.length, 9, '9 个玩家');
  eq(g.mode, 'nine', 'mode = nine');
  E.startHand(g);
  eq(g.activeSeat, (g.buttonSeat + 3) % 9, '9 人桌翻前 UTG（按钮后第 3 位）先行动');
  eq(g.players[(g.buttonSeat + 1) % 9].streetBet, 10, 'SB 投 10');
  eq(g.players[(g.buttonSeat + 2) % 9].streetBet, 20, 'BB 投 20');
  g.players.forEach(p => eq(p.hole.length, 2, p.name + ' 拿到两张底牌'));
}

// ---------- 25. 自定义盲注 ----------
section('25 自定义盲注');
{
  const g = E.createGame({ mode: 'six', startingChips: 4000, smallBlind: 25, bigBlind: 50, seed: 22 });
  E.startHand(g);
  eq(g.smallBlind, 25, '小盲 25');
  eq(g.bigBlind, 50, '大盲 50');
  eq(g.streetCurrentBet, 50, '翻前当前注 = 大盲');
  eq(g.lastFullRaiseSize, 50, '最小加注额初值 = 大盲');
  eq(g.players[(g.buttonSeat + 1) % 6].streetBet, 25, 'SB 投 25');
  eq(g.players[(g.buttonSeat + 2) % 6].streetBet, 50, 'BB 投 50');
}

// ---------- 26. eval7 支持 5 张 ----------
section('26 eval7 五张输入');
{
  const C = (r, s) => ({ r, s });
  const flush5 = [C(14, 's'), C(11, 's'), C(9, 's'), C(6, 's'), C(3, 's')];
  eq(E.eval7(flush5)[0], 5, '5 张同花识别为同花');
  const straight5 = [C(10, 'h'), C(9, 's'), C(8, 'd'), C(7, 'c'), C(6, 'h')];
  eq(E.eval7(straight5)[0], 4, '5 张顺子识别为顺子');
  const quads7 = [C(14, 'h'), C(14, 's'), C(14, 'd'), C(14, 'c'), C(9, 'h'), C(5, 's'), C(2, 'd')];
  eq(E.eval7(quads7)[0], 7, '7 张四条识别为四条');
  let threw = false;
  try { E.eval7([C(2, 'h')]); } catch (e) { threw = true; }
  ok(threw, '少于 5 张直接抛错');
}

// ---------- 27. 未被跟注的超额投入必须退还 ----------
section('27 退还未被跟注的投入');
{
  // 场景：短筹码全下 1000，长筹码投 5000 后弃牌。
  // 标准规则：长筹码多押的 4000 没人能跟，必须退回；短筹码只赢 2000。
  const g = E.createGame({ mode: 'six', startingChips: 5000, seed: 7 });
  E.startHand(g);
  const ps = g.players;
  ps[0].chips = 0; ps[0].totalBet = 5000; ps[0].allIn = true; ps[0].folded = true;
  ps[1].chips = 0; ps[1].totalBet = 1000; ps[1].allIn = true;
  for (let i = 2; i < 6; i++) ps[i].folded = true;
  g.pot = 6000;
  g.board = [];
  E.settle(g);
  eq(ps[0].chips, 4000, '长筹码退回 4000');
  eq(ps[1].chips, 2000, '短筹码只赢 2000');
  eq(ps[0].chips + ps[1].chips, 6000, '筹码守恒');
  eq(g.refunds.length, 1, '记录了一笔退款');
  eq(g.refunds[0].amount, 4000, '退款金额 4000');
}
{
  // 摊牌路径同样要退：短筹码全下 1000 摊牌赢，长筹码的 4000 也要回来
  const g = E.createGame({ mode: 'hu', startingChips: 5000, seed: 8 });
  E.startHand(g);
  const p0 = g.players[0], p1 = g.players[1];
  p0.chips = 0; p0.totalBet = 5000; p0.allIn = true;
  p1.chips = 0; p1.totalBet = 1000; p1.allIn = true;
  g.pot = 6000;
  const C = (r, s) => ({ r, s });
  g.board = [C(2, 'h'), C(7, 'c'), C(9, 'd'), C(11, 's'), C(3, 'h')];
  p0.hole = [C(4, 'c'), C(5, 'd')];
  p1.hole = [C(14, 'h'), C(14, 'd')];
  E.settle(g);
  eq(p0.chips, 4000, '摊牌：长筹码退回 4000');
  eq(p1.chips, 2000, '摊牌：短筹码只赢 2000');
}
{
  // 两人都投同样的钱：没有超额，不该产生退款
  const g = E.createGame({ mode: 'hu', startingChips: 2000, seed: 9 });
  E.startHand(g);
  const p0 = g.players[0], p1 = g.players[1];
  p0.chips = 0; p0.totalBet = 1000; p0.allIn = true; p0.folded = true;
  p1.chips = 0; p1.totalBet = 1000; p1.allIn = true;
  g.pot = 2000;
  g.board = [];
  E.settle(g);
  eq(g.refunds.length, 0, '双方投入相同，无退款');
  eq(p1.chips, 2000, '赢家拿走全部 2000');
}

// ---------- 28 平分余数按按钮左侧顺序 ----------
section('28 平分余数按按钮左侧顺序');
function tieGame(buttonSeat, aliveSeats) {
  const g = E.createGame({ mode: 'six', startingChips: 2000, seed: 21 });
  E.startHand(g);
  g.buttonSeat = buttonSeat;
  const C = (r, s) => ({ r, s });
  // 公共牌是皇家同花顺，三个人最佳手牌相同 => 必然平分
  g.board = [C(14, 's'), C(13, 's'), C(12, 's'), C(11, 's'), C(10, 's')];
  g.players.forEach(p => { p.folded = true; p.totalBet = 0; p.chips = 0; p.allIn = false; });
  g.players[0].totalBet = 100;   // 一个弃牌者投了 100，让池子 = 400
  aliveSeats.forEach(function (seat, i) {
    const p = g.players[seat];
    p.folded = false; p.totalBet = 100; p.chips = 0; p.allIn = true;
    p.hole = [C(2 + i * 2, 'h'), C(3 + i * 2, 'd')];
  });
  g.pot = 400;
  E.settle(g);
  return g;
}
{
  // 按钮在 2 号位：左侧顺序是 3 → 4 → 5，零头给 3
  const g = tieGame(2, [3, 4, 5]);
  eq(g.players[3].chips, 134, '按钮左侧第一人拿零头 134');
  eq(g.players[4].chips, 133, '第二人 133');
  eq(g.players[5].chips, 133, '第三人 133');
  eq(g.players[3].chips + g.players[4].chips + g.players[5].chips, 400, '三人合计 400');
}
{
  // 按钮在 3 号位（自己也是平分者）：顺序变成 4 → 5 → 3，零头给 4
  const g = tieGame(3, [3, 4, 5]);
  eq(g.players[4].chips, 134, '按钮左侧第一人 4 拿零头');
  eq(g.players[5].chips, 133, '第二人 5 拿 133');
  eq(g.players[3].chips, 133, '按钮本人最后拿 133');
}

// ---------- 29 全下金额为负会抛错 ----------
section('29 下注金额不能为负');
{
  const g = E.createGame({ mode: 'six', startingChips: 2000, seed: 22 });
  E.startHand(g);
  const seat = g.activeSeat;
  const p = g.players[seat];
  // 人为构造：已投 500，但当前注只有 300，此时再报一个 400 的加注
  // target(400) > streetCurrentBet(300)，所以不会走「不足跟注」的兜底，
  // pay = 400 - 500 = -100，必须抛错而不是静默吞掉
  p.streetBet = 500;
  p.totalBet = 500;
  g.streetCurrentBet = 300;
  let threw = false;
  try {
    E.act(g, seat, { type: 'raise', amount: 400 });
  } catch (e) {
    threw = /下注金额不能为负/.test(String(e.message));
  }
  ok(threw, '负的下注额会抛错');
}

// ---------- 汇总 ----------
console.log('\n========================================');
console.log('通过 ' + pass + '，失败 ' + fail);
if (fail > 0) process.exit(1);
