#!/usr/bin/env node
/**
 * 发牌风格统计：对比 真实 / 热闹 / 炸裂 三档下，
 * 每手「全桌最终能达到的最高牌型」分布，以及玩家底牌强度分布。
 *
 * 用法：node 开发工具/dealstyle-stats.js [手数]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
if (!m) { console.error('找不到 engine'); process.exit(1); }
const sandbox = { console, Date, Math };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox, { filename: 'engine.js' });
const E = sandbox.PokerEngine;

const CN = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

function dramaOf(g) {
  const sim = g.deck.slice();
  if (sim.length < 8) return 0;
  const board = [];
  sim.pop();
  for (let i = 0; i < 3; i++) board.push(sim.pop());
  sim.pop(); board.push(sim.pop());
  sim.pop(); board.push(sim.pop());
  let best = 0;
  for (const p of g.players) {
    if (!p.hole || p.hole.length < 2) continue;
    const r = E.eval7(p.hole.concat(board));
    if (r[0] > best) best = r[0];
  }
  return best;
}

// 简易 Chen 公式（和引擎里 holeStrength 一致），只看玩家底牌
function chen(hole) {
  const a = Math.max(hole[0].r, hole[1].r);
  const b = Math.min(hole[0].r, hole[1].r);
  const suited = hole[0].s === hole[1].s;
  const highScore = { 14: 10, 13: 8, 12: 7, 11: 6, 10: 5 }[a] || (a / 2);
  let score = highScore;
  if (a === b) score = Math.max(5, highScore * 2);
  if (suited) score += 2;
  const gap = a - b;
  if (a !== b) {
    if (gap === 1) score += 1;
    else if (gap === 2) score -= 1;
    else if (gap === 3) score -= 2;
    else if (gap === 4) score -= 4;
    else score -= 5;
  }
  if (score < 0 && gap <= 4) score = 0;
  return Math.max(0, Math.min(1, (score + 1) / 21));
}

const N = parseInt(process.argv[2], 10) || 500;

function run(style) {
  const dist = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let strongHole = 0;   // 玩家底牌 ≥ 0.55
  let playable = 0;     // 玩家底牌 ≥ 0.45
  let tries = 0;
  for (let i = 0; i < N; i++) {
    const g = E.createGame({ mode: 'six', startingChips: 2000, dealStyle: style, seed: 1000 + i, humanSeat: 0 });
    E.startHand(g);
    const d = dramaOf(g);
    dist[d]++;
    tries += g.dealTries || 0;
    const st = chen(g.players[0].hole);
    if (st >= 0.55) strongHole++;
    if (st >= 0.45) playable++;
  }
  return { dist, strongHole, playable, avgTries: tries / N };
}

console.log(`每种发牌风格跑 ${N} 手（6 人桌）\n`);
console.log('牌型      ' + ['真实', '热闹', '炸裂'].map(s => s.padStart(8)).join(''));
const res = { real: run('real'), fun: run('fun'), wild: run('wild') };
for (let i = 8; i >= 0; i--) {
  const row = ['real', 'fun', 'wild'].map(k => {
    const pct = (res[k].dist[i] / N * 100);
    return (pct.toFixed(1) + '%').padStart(8);
  }).join('');
  console.log(CN[i].padEnd(8) + row);
}
console.log('');
console.log('指标                ' + ['真实', '热闹', '炸裂'].map(s => s.padStart(8)).join(''));
console.log('两对以上占比        ' + ['real', 'fun', 'wild'].map(k => {
  const p = (res[k].dist.slice(2).reduce((a, b) => a + b, 0) / N * 100).toFixed(1) + '%';
  return p.padStart(8);
}).join(''));
console.log('三条以上占比        ' + ['real', 'fun', 'wild'].map(k => {
  const p = (res[k].dist.slice(3).reduce((a, b) => a + b, 0) / N * 100).toFixed(1) + '%';
  return p.padStart(8);
}).join(''));
console.log('玩家底牌≥0.55       ' + ['real', 'fun', 'wild'].map(k => {
  return ((res[k].strongHole / N) * 100).toFixed(1) + '%';
}).map(x => x.padStart(8)).join(''));
console.log('玩家底牌≥0.45       ' + ['real', 'fun', 'wild'].map(k => {
  return ((res[k].playable / N) * 100).toFixed(1) + '%';
}).map(x => x.padStart(8)).join(''));
console.log('平均重洗次数        ' + ['real', 'fun', 'wild'].map(k => {
  return res[k].avgTries.toFixed(2);
}).map(x => x.padStart(8)).join(''));

// ---- 玩家参与度：模拟「连续弃牌 N 手」后下一手的底牌质量 ----
function idleTest(style, idle, N2) {
  let strong = 0, playable = 0, avg = 0;
  for (let i = 0; i < N2; i++) {
    const g = E.createGame({ mode: 'six', startingChips: 2000, dealStyle: style, seed: 50000 + i, humanSeat: 0 });
    g.idleHands = idle;
    E.startHand(g);
    const st = chen(g.players[0].hole);
    avg += st;
    if (st >= 0.55) strong++;
    if (st >= 0.45) playable++;
  }
  return { strong: strong / N2, playable: playable / N2, avg: avg / N2 };
}

const M = 300;
console.log('');
console.log('玩家参与度（模拟连续弃牌后）');
console.log('');
console.log('场景                      真实      热闹      炸裂');
for (const [label, idle] of [['连续弃牌 0 手', 0], ['连续弃牌 3 手', 3], ['连续弃牌 5 手', 5]]) {
  const cells = ['real', 'fun', 'wild'].map(k => {
    const r = idleTest(k, idle, M);
    return ('底牌≥0.55 ' + (r.strong * 100).toFixed(0) + '%').padStart(16);
  }).join('');
  console.log(label.padEnd(22) + cells);
}
console.log('');
for (const [label, idle] of [['连续弃牌 0 手', 0], ['连续弃牌 3 手', 3], ['连续弃牌 5 手', 5]]) {
  const cells = ['real', 'fun', 'wild'].map(k => {
    const r = idleTest(k, idle, M);
    return ('均值 ' + r.avg.toFixed(3)).padStart(16);
  }).join('');
  console.log(label.padEnd(22) + cells);
}
