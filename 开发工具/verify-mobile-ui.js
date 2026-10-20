/* 手机端 UI 交互体检：在手机视口下依次打开每个弹层/抽屉，检查
   ① 弹层是否横向溢出 ② 关闭按钮能否真的关掉 ③ 是否有内部滚动
   用法：node 开发工具/verify-mobile-ui.js [宽] [高]
   注意：页面逻辑都在 IIFE 里，外部 eval 调不到 showXxx，所以全部通过点按钮触发。
*/
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 300);
const W = +(process.argv[2] || 390);
const H = +(process.argv[3] || 844);
const FILE = path.resolve(__dirname, '..', 'index.html');
const URL = 'file:///' + FILE.replace(/\\/g, '/') + '?table=six&noguide=1';

const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + path.join(os.tmpdir(), 'edge-ui-' + Date.now()),
  'about:blank',
], { stdio: 'ignore' });

const getJson = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
    let d = ''; r.on('data', c => (d += c));
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let list = null;
  for (let i = 0; i < 60 && !list; i++) {
    try { list = await getJson('/json/list'); } catch (e) { await wait(200); }
  }
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise(resolve => {
    const id = ++seq; pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 2, mobile: true, screenWidth: W, screenHeight: H,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await wait(3500);

  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    const ex = r.result && r.result.exceptionDetails;
    if (ex) return { __err: ex.exception ? (ex.exception.description || ex.text) : ex.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await ev(`window.__q = s => document.querySelector(s);
    window.__state = () => {
      const o = __q('#overlay'), m = __q('#modal'), p = __q('#infoPanel');
      const shown = o && o.classList.contains('show');
      const infoOpen = p && p.classList.contains('open');
      const r = m ? m.getBoundingClientRect() : null;
      let w = 0, h = 0, ox = false, oy = false;
      if (r) {
        w = Math.round(r.width); h = Math.round(r.height);
        ox = r.left < -1 || r.right > window.innerWidth + 1;
        oy = r.top < -1 || r.bottom > window.innerHeight + 1;
      }
      return { shown, infoOpen, w, h, ox, oy,
        vw: window.innerWidth, vh: window.innerHeight,
        scrollH: m ? m.scrollHeight : 0, clientH: m ? m.clientHeight : 0 };
    };
    window.__closeByBtn = () => {
      const all = document.querySelectorAll('#modal button');
      for (let i = 0; i < all.length; i++) {
        if (/关闭|取消|知道了|收起/.test(all[i].textContent)) { all[i].click(); return all[i].textContent.trim(); }
      }
      return null;
    };
    true`);

  const results = [];

  // 方式一：顶栏直接可见的按钮
  // 方式二：藏在「更多」菜单里（手机端顶栏按钮大多隐藏）
  const run = async (name, opener, closer) => {
    const o = await ev(opener);
    if (o && o.__err) { results.push({ name, err: o.__err }); return; }
    await wait(650);
    const st = await ev(`__state()`);
    const cl = await ev(closer);
    await wait(450);
    const after = await ev(`__state()`);
    const closed = !(after && (after.shown || after.infoOpen));
    results.push({ name, ...st, closed, closeLabel: cl });
  };

  const viaMenu = act =>
    `(function(){ __q('#btnMore').click(); return true; })()`;

  const pickAct = act =>
    `(function(){ const b = document.querySelector('.more-item[data-act="${act}"]'); if (b) { b.click(); return true; } return false; })()`;

  // 更多菜单本身
  await run('更多菜单', viaMenu(), `__closeByBtn()`);
  // 抽屉
  await run('信息抽屉', `(function(){ __q('#btnInfo').click(); return true; })()`, `(function(){ __q('#infoClose').click(); return true; })()`);

  // 菜单里的各项
  const acts = [
    ['guide', '规则教学'],
    ['settings', '设置'],
    ['stats', '统计'],
    ['history', '牌谱'],
    ['gto', 'GTO 表'],
  ];
  for (const [act, label] of acts) {
    await ev(viaMenu());
    await wait(400);
    await ev(pickAct(act));
    await wait(700);
    const st = await ev(`__state()`);
    const cl = await ev(`__closeByBtn()`);
    await wait(450);
    const after = await ev(`__state()`);
    const closed = !(after && (after.shown || after.infoOpen));
    results.push({ name: label, ...st, closed, closeLabel: cl });
  }

  // 挑战（顶栏 🏆 可见）
  await run('挑战', `(function(){ __q('#btnChallenge').click(); return true; })()`, `__closeByBtn()`);
  // 范围大图（右侧栏 ⤢，手机在抽屉里）
  await ev(`(function(){ __q('#btnInfo').click(); return true; })()`);
  await wait(500);
  await ev(`(function(){ __q('#btnRangeChart').click(); return true; })()`);
  await wait(700);
  const stRc = await ev(`__state()`);
  const clRc = await ev(`__closeByBtn()`);
  await wait(450);
  const afterRc = await ev(`__state()`);
  results.push({ name: '范围大图', ...stRc, closed: !(afterRc && afterRc.shown), closeLabel: clRc });
  await ev(`(function(){ if (__q('#infoClose')) __q('#infoClose').click(); return true; })()`);

  console.log('\n视口 ' + W + '×' + H + '\n');
  const pad = (s, n) => String(s).padEnd(n, ' ');
  console.log(pad('弹层', 12) + pad('打开', 6) + pad('宽×高', 12) + pad('横向溢出', 10) + pad('纵向溢出', 10) + pad('关闭', 8) + '内部滚动');
  let bad = 0;
  for (const r of results) {
    if (r.err) { bad++; console.log(pad(r.name, 12) + '✗ 打开时报错：' + String(r.err).slice(0, 100)); continue; }
    const ok = (r.shown || r.infoOpen) && r.closed && !r.ox;
    if (!ok) bad++;
    console.log(
      pad(r.name, 12) +
      pad((r.shown || r.infoOpen) ? '是' : '✗否', 6) +
      pad(r.w + '×' + r.h, 12) +
      pad(r.ox ? '✗是' : '否', 10) +
      pad(r.oy ? '✗是' : '否', 10) +
      pad(r.closed ? '成功' : '✗失败', 8) +
      (r.scrollH > r.clientH ? '有(' + r.scrollH + '>' + r.clientH + ')' : '无')
    );
  }
  console.log('\n结论：' + (bad === 0 ? '全部正常' : bad + ' 项有问题'));
  ws.close(); proc.kill(); process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error('失败：' + e.message); proc.kill(); process.exit(1); });
