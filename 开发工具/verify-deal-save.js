#!/usr/bin/env node
/**
 * 复现：选发牌风格 → 保存 → 重开设置，看是否记住。
 * 用法：node 开发工具/verify-deal-save.js
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9700 + Math.floor(Math.random() * 200);
const ROOT = path.resolve(__dirname, '..');
const URL_ = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?noguide=1';

const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + path.join(os.tmpdir(), 'edge-deal-' + Date.now()),
  'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
function getJson(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let d = '';
      r.on('data', c => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
async function waitPort() {
  for (let i = 0; i < 80; i++) {
    try { return await getJson('/json/version'); } catch (e) { await sleep(120); }
  }
  throw new Error('CDP 端口没起来');
}

(async () => {
  let ws;
  try {
    await waitPort();
    const tabs = await getJson('/json/list');
    const page = tabs.find(t => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    await new Promise(r => ws.addEventListener('open', r, { once: true }));
    const send = (method, params) => new Promise(res => {
      const mid = ++id; pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
    const ev = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
      return r.result && r.result.result ? r.result.result.value : undefined;
    };

    await send('Page.navigate', { url: URL_ });
    await sleep(2500);

    // 1) 打开设置，选「热闹」
    await ev(`document.getElementById('btnSettings').click()`);
    await sleep(300);
    await ev(`document.querySelector('#dealPick .theme-btn[data-deal="fun"]').click()`);
    await sleep(100);
    const picked = await ev(`document.querySelector('#dealPick .theme-btn.on').getAttribute('data-deal')`);

    // 2) 不点保存，直接关掉（用户最常见的操作）
    await ev(`document.getElementById('btnCancelSet').click()`);
    await sleep(300);

    // 3) 看存储里写了什么
    const stored = await ev(`(function(){
      var s = JSON.parse(localStorage.getItem('poker.save.v2') || '{}');
      return s.settings ? s.settings.dealStyle : 'NO_SETTINGS';
    })()`);

    // 3.5) 刷新页面，模拟下次打开
    await send('Page.reload');
    await sleep(2200);

    // 4) 再打开设置，看高亮哪个
    await ev(`document.getElementById('btnSettings').click()`);
    await sleep(300);
    const shown = await ev(`document.querySelector('#dealPick .theme-btn.on') ? document.querySelector('#dealPick .theme-btn.on').getAttribute('data-deal') : 'NONE'`);

    console.log('=== 发牌风格保存/回读 ===\n');
    console.log('点了：' + picked);
    console.log('存储里的 dealStyle：' + stored);
    console.log('再次打开设置显示：' + shown);
    console.log('');
    const okAll = picked === 'fun' && stored === 'fun' && shown === 'fun';
    console.log(okAll ? 'PASS' : 'FAIL');
    process.exitCode = okAll ? 0 : 1;
  } catch (e) {
    console.error('失败：' + (e && e.stack || e));
    process.exitCode = 1;
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
  }
})();
