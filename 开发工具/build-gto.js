/**
 * build-gto.js —— 把 poker-hand-review (MIT) 的 mtt/8max 100BB 翻前表
 * 转换成单文件网页可直接内嵌的 window.GTO_TABLE 数据结构。
 *
 * 可重复运行：
 *   - raw/ 里缺哪个 json 就自动去 GitHub 拉哪个（本机 node 直连可用）
 *   - 每次运行都会重新生成 D:\大肥鱼\交付物\德州扑克游戏成品\gto-data.js
 *
 * 用法：node build-gto.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---------- 路径 ----------
const ROOT_URL = 'https://raw.githubusercontent.com/matthiola0/poker-hand-review/main/gto-preflop/mtt/8max/charts/';
const RAW_DIR = path.resolve(__dirname, 'raw');
const MANIFEST = path.join(RAW_DIR, '_manifest.json');
const OUT_FILE = path.resolve(__dirname, 'gto-data.js');

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const ACTION_ORDER = ['raise', 'call', 'allin', 'fold']; // 输出顺序 r c a f
const LETTER = { raise: 'r', call: 'c', allin: 'a', fold: 'f' };

const problems = [];   // 记录数据异常，最后打印
const fixes = [];      // 记录归一化修改

// ---------- 1. 169 手牌顺序 ----------
function buildHands() {
  const out = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      if (i === j) out.push(RANKS[i] + RANKS[j]);            // 对子
      else if (i < j) out.push(RANKS[i] + RANKS[j] + 's');   // 同花，高牌取行
      else out.push(RANKS[j] + RANKS[i] + 'o');              // 非同花，高牌取列
    }
  }
  return out;
}

// ---------- 2. 数字格式化：最多 2 位小数、去尾零、1 省略 ----------
function fmtFreq(v) {
  const r = Math.round(v * 100) / 100;
  if (r >= 1) return '';                 // 1 -> ""（"r" 而不是 "r1"）
  return String(r).replace(/^0\./, '0.'); // 0.6 -> "0.6"；0.05 -> "0.05"
}

// ---------- 3. 单个手牌动作 -> 动作串 ----------
function toCode(acts) {
  let items = ACTION_ORDER.filter((k) => Number(acts[k]) > 0).map((k) => [k, Number(acts[k])]);
  if (items.length === 0) return null; // 无任何动作，交给调用方记异常

  // 纯 fold
  if (items.length === 1 && items[0][0] === 'fold') return '';

  // 按比例归一化到 1（源数据有几条和为 0.97 / 1.01，游戏里需要凑满 100%）
  const sum = items.reduce((a, [, v]) => a + v, 0);
  let scaled = items.map(([k, v]) => [k, Math.round((v / sum) * 100) / 100]);

  // 舍入后为 0 的动作丢弃
  scaled = scaled.filter(([, v]) => v > 0);

  // 残差并入频率最大的动作，保证和精确为 1
  const total = scaled.reduce((a, [, v]) => a + v, 0);
  const diff = Math.round((1 - total) * 100) / 100;
  if (diff !== 0) {
    let mi = 0;
    for (let i = 1; i < scaled.length; i++) if (scaled[i][1] > scaled[mi][1]) mi = i;
    scaled[mi][1] = Math.round((scaled[mi][1] + diff) * 100) / 100;
    if (scaled[mi][1] <= 0) throw new Error('归一化后频率越界: ' + JSON.stringify(acts));
  }

  if (scaled.length === 1 && scaled[0][0] === 'fold') return '';
  return scaled.map(([k, v]) => LETTER[k] + fmtFreq(v)).join('');
}

// ---------- 4. 抓取缺失的原始文件 ----------
async function getJSON(url, tries = 4) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'gto-build/1.0' } });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < tries) await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  throw lastErr;
}

async function ensureRaw(charts) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  for (const c of charts) {
    const file = path.join(RAW_DIR, c.scenario + '__' + c.name + '.json');
    if (fs.existsSync(file)) continue;
    console.log('缓存缺失，下载:', path.basename(file));
    const data = await getJSON(ROOT_URL + c.path);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }
}

// ---------- 5. 主流程 ----------
(async () => {
  // 拉索引（缓存优先：raw/_manifest.json 已存过就直接用，保证离线也能重建）
  let charts;
  if (fs.existsSync(MANIFEST)) {
    charts = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } else {
    const idx = await getJSON(ROOT_URL + 'index.json');
    charts = idx.charts.filter((c) => c.stack_bb === 100);
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(MANIFEST, JSON.stringify(charts, null, 2), 'utf8');
  }
  charts = charts.filter((c) => c.stack_bb === 100);
  assert(charts.length === 26, `100BB 条目应为 26，实际 ${charts.length}`);
  await ensureRaw(charts);

  const hands = buildHands();
  const spots = {};
  const spotStats = [];

  for (const c of charts) {
    const file = path.join(RAW_DIR, c.scenario + '__' + c.name + '.json');
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    const key = c.scenario + '/' + c.name;

    const missing = hands.filter((h) => !(h in d.actions));
    if (missing.length) problems.push(`${key}: 缺 ${missing.length} 手牌 (${missing.slice(0, 5).join(',')}...)`);
    const extra = Object.keys(d.actions).filter((h) => !hands.includes(h));
    if (extra.length) problems.push(`${key}: 多出非标准键 ${extra.slice(0, 5).join(',')}`);

    const arr = [];
    let foldOnly = 0, mixed = 0, noAct = 0;
    for (const h of hands) {
      const acts = d.actions[h] || {};
      const rawSum = Object.values(acts).reduce((a, v) => a + Number(v), 0);
      if (Object.keys(acts).length === 0 || rawSum === 0) {
        noAct++;
        problems.push(`${key}/${h}: 没有任何动作`);
        arr.push('');
        continue;
      }
      const code = toCode(acts);
      if (code === '') foldOnly++;
      else {
        mixed++;
        if (Math.abs(rawSum - 1) > 1e-9) {
          fixes.push(`${key}/${h}: 原始和 ${rawSum} -> ${code}`);
        }
        const s = sumFromCode(code);
        if (Math.abs(s - 1) > 1e-9) problems.push(`${key}/${h}: 归一化后和 ${s}`);
      }
      arr.push(code);
    }
    spots[key] = arr;

    // 与源文件 freqs (1-fold) 交叉核对
    let freqMismatch = 0;
    if (d.freqs) {
      for (const h of hands) {
        const fold = Number((d.actions[h] || {}).fold || 0);
        const expect = 1 - fold;
        const got = Number(d.freqs[h]);
        if (Number.isFinite(got) && Math.abs(expect - got) > 0.02) freqMismatch++;
      }
      if (freqMismatch) problems.push(`${key}: freqs 与 1-fold 不一致 ${freqMismatch} 处`);
    }
    spotStats.push({ key, mixed, foldOnly, noAct });
  }

  // ---------- 6. 生成文件 ----------
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const lines = [];
  lines.push('// GTO 翻前表（8-max MTT，100BB）');
  lines.push('// 数据来源：https://github.com/matthiola0/poker-hand-review （MIT License）');
  lines.push('window.GTO_TABLE = {');
  lines.push('  meta: { set: "mtt/8max", stack: 100, source: "matthiola0/poker-hand-review", license: "MIT" },');
  lines.push('  hands: [');
  lines.push(chunk(hands, 13).map((row) => '    ' + row.map((x) => '"' + x + '"').join(', ')).join(',\n'));
  lines.push('  ],');
  lines.push('  spots: {');
  const keys = Object.keys(spots);
  keys.forEach((k, ki) => {
    lines.push('    ' + JSON.stringify(k) + ': [');
    lines.push(chunk(spots[k], 13).map((row) => '      ' + row.map((x) => JSON.stringify(x)).join(', ')).join(',\n'));
    lines.push('    ]' + (ki === keys.length - 1 ? '' : ','));
  });
  lines.push('  }');
  lines.push('};');
  lines.push('');
  fs.writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');

  // ---------- 7. 验证 ----------
  console.log('\n================ 验证 ================');
  // 1. hands
  assert(hands.length === 169, `hands.length=${hands.length}`);
  assert(new Set(hands).size === 169, `hands 有重复，去重后 ${new Set(hands).size}`);
  for (const h of ['AA', 'AKs', 'AKo', '22']) assert(hands.includes(h), `缺关键手牌 ${h}`);
  assert(hands[0] === 'AA' && hands[1] === 'AKs' && hands[12] === 'A2s' && hands[13] === 'AKo', 'hands 首行顺序不对');
  assert(hands[26] === 'AQo' && hands[27] === 'KQo' && hands[28] === 'QQ', 'hands 第三行顺序不对');
  assert(hands[168] === '22', 'hands 末项应为 22');
  console.log('✓ [1] hands 169 项唯一，首项 AA / 末项 22');

  // 2. spots 数量
  assert(Object.keys(spots).length === 26, `spots=${Object.keys(spots).length}`);
  console.log('✓ [2] spots 恰好 26 个');

  // 3. 每个 spot 169 项
  for (const k of Object.keys(spots)) assert(spots[k].length === 169, `${k} 长度 ${spots[k].length}`);
  console.log('✓ [3] 26 个 spot 各 169 项');

  // 4. 频率和
  let checked = 0;
  for (const k of Object.keys(spots)) {
    for (let i = 0; i < 169; i++) {
      const code = spots[k][i];
      const s = code === '' ? 1 : sumFromCode(code);
      assert(Math.abs(s - 1) <= 0.02, `${k}/${hands[i]} 频率和 ${s} (${code})`);
      checked++;
    }
  }
  console.log(`✓ [4] ${checked} 个条目频率和均 ≈ 1`);

  // 5. vm 加载
  const src = fs.readFileSync(OUT_FILE, 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'gto-data.js' });
  const T = ctx.window.GTO_TABLE;
  assert(T && typeof T === 'object', 'window.GTO_TABLE 不存在');
  assert(T.meta && T.meta.set === 'mtt/8max' && T.meta.stack === 100, 'meta 不对');
  assert(T.hands.length === 169, 'vm 里 hands 长度不对');
  assert(Object.keys(T.spots).length === 26, 'vm 里 spots 数量不对');
  for (const k of keys) assert(k in T.spots, `vm 里缺 spot ${k}`);
  const size = fs.statSync(OUT_FILE).size;
  console.log(`✓ [5] vm 加载成功，window.GTO_TABLE 就绪，26 个 spot 齐全`);
  console.log(`    文件：${OUT_FILE}`);
  console.log(`    字节数：${size} bytes (${(size / 1024).toFixed(1)} KB)`);

  // 6. 样例
  const pick = (spot, hand) => T.spots[spot][T.hands.indexOf(hand)];
  console.log('✓ [6] 样例条目：');
  for (const [sp, hs] of [
    ['rfi/BTN', ['AA', '72o', 'T9s']],
    ['vs-open/BB-vs-SBlimp', ['AA', '32o']],
    ['vs-open/SB-vs-BB', ['AA', 'K5s', '74o']],
  ]) {
    for (const h of hs) console.log(`    ${sp} / ${h} = ${JSON.stringify(pick(sp, h))}`);
  }

  // 严格式：禁止 "f1"/"r1" 这类写法；纯弃牌必须是空串
  let badCode = 0;
  for (const k of Object.keys(spots)) {
    for (const code of spots[k]) {
      if (/[rcaf]1(?![0-9.])/.test(code)) { badCode++; problems.push(`${k}: 出现省略式 "${code}"`); }
      if (code !== '' && !/^[rcaf]/.test(code)) { badCode++; problems.push(`${k}: 非法串 "${code}"`); }
    }
  }
  assert(badCode === 0, `有 ${badCode} 个格式非法的动作串`);
  console.log('✓ [7] 动作串格式合法（无 "f1"/"r1"，纯弃牌为 ""）');

  // 附加统计
  console.log('\n================ 统计 ================');
  for (const s of spotStats) {
    console.log(`  ${s.key.padEnd(30)} 混合 ${String(s.mixed).padStart(3)} 纯弃 ${String(s.foldOnly).padStart(3)} 无动作 ${s.noAct}`);
  }
  if (fixes.length) {
    console.log(`\n归一化修正 ${fixes.length} 条（源数据频率和不为 1）：`);
    for (const f of fixes) console.log('  ·', f);
  }
  if (problems.length) {
    console.log(`\n⚠ 数据异常 ${problems.length} 条：`);
    for (const p of problems.slice(0, 30)) console.log('  ·', p);
  } else {
    console.log('\n无结构异常（169 键齐全、无空动作、freqs 与 1-fold 一致）。');
  }
  console.log('\n全部验证通过 ✅');
})().catch((e) => {
  console.error('\n❌ 构建失败：', e.message);
  console.error(e.stack);
  process.exit(1);
});

// ---------- 工具函数 ----------
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
// 从动作串反解频率和，用于验证
function sumFromCode(code) {
  let sum = 0;
  let i = 0;
  const letters = 'rcaf';
  while (i < code.length) {
    const ch = code[i];
    if (!letters.includes(ch)) throw new Error('非法动作字符: ' + code);
    i++;
    let num = '';
    while (i < code.length && /[0-9.]/.test(code[i])) { num += code[i]; i++; }
    sum += num === '' ? 1 : parseFloat(num);
  }
  return Math.round(sum * 1e6) / 1e6;
}
