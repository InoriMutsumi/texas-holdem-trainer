const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const OWNER = 'InoriMutsumi', REPO = 'texas-holdem-trainer', BRANCH = 'main';
const API = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
const TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
async function call(url) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'sync' } });
  if (!res.ok) throw new Error(res.status + ' ' + url);
  return res.json();
}
(async () => {
  const ref = await call(API + '/git/ref/heads/' + BRANCH);
  const commit = await call(API + '/git/commits/' + ref.object.sha);
  const tree = await call(API + '/git/trees/' + commit.tree.sha + '?recursive=1');
  console.log('远程 HEAD:', ref.object.sha.slice(0, 8), '|', commit.message.split('\n')[0]);
  console.log('文件数:', tree.tree.filter(function (x) { return x.type === 'blob'; }).length);
  const diffs = [];
  for (const item of tree.tree) {
    if (item.type !== 'blob') continue;
    const local = path.join(__dirname, item.path);
    if (!fs.existsSync(local)) { diffs.push([item.path, '新增', item.size]); continue; }
    const sha = execFileSync('git', ['hash-object', local], { encoding: 'utf8', cwd: __dirname }).trim();
    if (sha !== item.sha) diffs.push([item.path, '不同', item.size]);
  }
  console.log('\n需要同步:', diffs.length);
  diffs.forEach(function (d) { console.log('  ' + d[1].padEnd(4), String(d[2]).padStart(8), d[0]); });
})();
