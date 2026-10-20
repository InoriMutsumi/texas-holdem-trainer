/* 用 CDP 模拟真实手机视口截图（Edge headless 的 --window-size 有最小宽度限制，390 会被抬到 492）
   用法：node _shot_mobile.js <url> <输出png> [宽] [高] [dpr]
*/
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333 + Math.floor(Math.random() * 200);
const URL = process.argv[2];
const OUT = process.argv[3];
const W = +(process.argv[4] || 390);
const H = +(process.argv[5] || 844);
const DPR = +(process.argv[6] || 2);
const SCROLL = process.argv[7] || '';   // 可选：截图前执行的一段 JS（例如滚到底）

if (!URL || !OUT) {
  console.error('用法: node _shot_mobile.js <url> <输出png> [宽] [高] [dpr]');
  process.exit(1);
}

const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + path.join(os.tmpdir(), 'edge-cdp-' + Date.now()),
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
    try { return await getJson('/json/version'); } catch (e) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error('DevTools 端口没起来');
}

(async () => {
  await waitPort();
  const targets = await getJson('/json/list');
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('没有 page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise(resolve => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: DPR, mobile: true,
    screenWidth: W, screenHeight: H,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await new Promise(r => setTimeout(r, 3800));

  if (SCROLL) {
  try { await send('Runtime.evaluate', { expression: SCROLL }); await wait(400); } catch (e) {}
}
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('已保存 ' + OUT + '（' + W + '×' + H + ' @' + DPR + 'x）');

  proc.kill();
  process.exit(0);
})().catch(e => {
  console.error('失败：' + e.message);
  proc.kill();
  process.exit(1);
});
