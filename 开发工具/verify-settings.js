#!/usr/bin/env node
/**
 * 交互验证：设置面板里「主题」和「发牌风格」两组按钮互不干扰。
 * 用 CDP 真的去点，然后读回 body[data-theme] 与按钮状态。
 *
 * 用法：node 开发工具/verify-settings.js
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 300);
const ROOT = path.resolve(__dirname, '..');
const URL_ = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?settings=1&noguide=1';

const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + path.join(os.tmpdir(), 'edge-verify-' + Date.now()),
  'about:blank',
], { stdio: 'ignore' });

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    function send(method, params) {
      return new Promise(res => {
        const mid = ++id;
        pending.set(mid, res);
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      });
    }
    async function evaluate(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
      return r.result && r.result.result ? r.result.result.value : undefined;
    }

    await send('Page.navigate', { url: URL_ });
    await sleep(2500);

    const before = await evaluate(`document.body.getAttribute('data-theme')`);

    // 点「热闹」
    await evaluate(`(function(){
      var b = document.querySelector('#dealPick .theme-btn[data-deal="fun"]');
      b.click();
      return true;
    })()`);
    await sleep(200);
    const afterDealTheme = await evaluate(`document.body.getAttribute('data-theme')`);
    const funOn = await evaluate(`document.querySelector('#dealPick .theme-btn[data-deal="fun"]').classList.contains('on')`);
    const greenOn = await evaluate(`document.querySelector('.theme-btn[data-theme="green"]').classList.contains('on')`);

    // 点「蓝调」
    await evaluate(`document.querySelector('.theme-btn[data-theme="blue"]').click()`);
    await sleep(200);
    const afterBlueTheme = await evaluate(`document.body.getAttribute('data-theme')`);
    const funStillOn = await evaluate(`document.querySelector('#dealPick .theme-btn[data-deal="fun"]').classList.contains('on')`);

    const pass = [];
    const fail = [];
    function check(cond, name, detail) {
      if (cond) pass.push(name);
      else fail.push(name + (detail ? '（' + detail + '）' : ''));
    }
    check(afterDealTheme === before, '点发牌风格不改主题', before + ' → ' + afterDealTheme);
    check(funOn === true, '点「热闹」后它高亮');
    check(greenOn === true, '点「热闹」不影响绿毯高亮');
    check(afterBlueTheme === 'blue', '点「蓝调」主题变蓝', String(afterBlueTheme));
    check(funStillOn === true, '点「蓝调」不清掉发牌风格高亮');

    console.log('=== 设置面板交互验证 ===\n');
    pass.forEach(n => console.log('  ok  ' + n));
    fail.forEach(n => console.log('  FAIL  ' + n));
    console.log('\n通过 ' + pass.length + '，失败 ' + fail.length);
    process.exitCode = fail.length ? 1 : 0;
  } catch (e) {
    console.error('验证失败：' + (e && e.stack || e));
    process.exitCode = 1;
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
  }
})();
