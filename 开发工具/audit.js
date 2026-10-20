#!/usr/bin/env node
/**
 * 静态检查：死函数 / 死常量 / 无用 CSS / 调试残留 / 外链
 * 用法：node 开发工具/audit.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function countMatches(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
}

// ---------- 1. 函数 ----------
const fnRe = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
const fns = new Map();
let m;
while ((m = fnRe.exec(html))) {
  const name = m[1];
  fns.set(name, (fns.get(name) || 0) + 1);
}
const deadFns = [];
for (const [name] of fns) {
  // 统计全文出现次数，定义处算 1 次
  const hits = countMatches(html, name);
  if (hits <= 1) deadFns.push(name);
}

// ---------- 2. 顶层 var 常量 ----------
const jsParts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]).join('\n');
const varRe = /^  var ([A-Z][A-Z0-9_]{2,})\s*=/gm;
const consts = new Map();
let cm;
while ((cm = varRe.exec(jsParts))) consts.set(cm[1], true);
const deadConsts = [];
for (const name of consts.keys()) {
  const hits = countMatches(jsParts, name);
  if (hits <= 1) deadConsts.push(name);
}

// ---------- 3. CSS 类 ----------
const cssParts = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x => x[1]).join('\n');
const classes = new Set();
for (const mm of cssParts.matchAll(/\.([a-zA-Z][\w-]*)/g)) classes.add(mm[1]);
const body = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
const deadCss = [];
for (const c of classes) {
  // 在 HTML/JS 里以 class="... c ..." 或 classList.add('c') 形式出现
  const used = body.indexOf(c) >= 0;
  if (!used) deadCss.push(c);
}

// ---------- 4. 调试残留 ----------
const debug = [];
for (const kw of ['console.log', 'console.warn', 'console.error', 'debugger', 'TODO', 'FIXME', 'XXX']) {
  const n = countMatches(jsParts, kw);
  if (n) debug.push(kw + ' × ' + n);
}

// ---------- 5. 外链 ----------
const ext = [];
for (const mm of html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) ext.push(mm[1]);
for (const mm of html.matchAll(/@import\s+url\(([^)]+)\)/g)) ext.push(mm[1]);

// ---------- 6. 统计 ----------
const lines = html.split('\n').length;
const size = Buffer.byteLength(html, 'utf8');

console.log('=== 代码检查 ===\n');
console.log('文件：' + (size / 1024).toFixed(1) + ' KB / ' + lines + ' 行');
console.log('函数：' + fns.size + ' 个');
console.log('顶层常量：' + consts.size + ' 个');
console.log('CSS 类：' + classes.size + ' 个');
console.log('');
console.log('可能没人调用的函数（' + deadFns.length + '）：' + (deadFns.length ? deadFns.join(', ') : '无'));
console.log('可能没用到的常量（' + deadConsts.length + '）：' + (deadConsts.length ? deadConsts.join(', ') : '无'));
console.log('可能没用到的 CSS 类（' + deadCss.length + '）：' + (deadCss.length ? deadCss.slice(0, 40).join(', ') : '无'));
console.log('调试残留：' + (debug.length ? debug.join(' / ') : '无'));
console.log('外部链接：' + (ext.length ? ext.join(', ') : '无'));
