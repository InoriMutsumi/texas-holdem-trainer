/**
 * inline-gto.js —— 把 gto-data.js 内联进 index.html，恢复「单文件双击即玩」。
 *
 * 背景：build-gto.js 的设计意图就是「单文件网页可直接内嵌」，
 * 但生成的是独立文件 + <script src>，分享时容易漏掉。
 * 每次 build-gto.js 重新生成数据后，跑一次本脚本即可。
 *
 * 用法：node 开发工具/inline-gto.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const dataPath = path.join(root, 'gto-data.js');
const TAG = '<script src="gto-data.js"></script>';

let html = fs.readFileSync(htmlPath, 'utf8');
if (html.indexOf(TAG) < 0) {
  console.log('index.html 里没有外链标签，已经是内联状态（或结构已变），跳过');
  process.exit(0);
}
const data = fs.readFileSync(dataPath, 'utf8');
html = html.replace(TAG, '<script id="gto-data">\n' + data + '\n</script>');
fs.writeFileSync(htmlPath, html);
console.log('已内联 gto-data.js → index.html（' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB）');
