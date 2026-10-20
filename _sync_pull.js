const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const OWNER = 'InoriMutsumi', REPO = 'texas-holdem-trainer', BRANCH = 'main';
const API = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
const TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const H = { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'sync' };
async function call(url) {
  const res = await fetch(url, { headers: H });
  if (!res.ok) throw new Error(res.status + ' ' + url);
  return res.json();
}
(async () => {
  const ref = await call(API + '/git/ref/heads/' + BRANCH);
  const commit = await call(API + '/git/commits/' + ref.object.sha);
  const tree = await call(API + '/git/trees/' + commit.tree.sha + '?recursive=1');
  const want = [];
  for (const item of tree.tree) {
    if (item.type !== 'blob') continue;
    const local = path.join(__dirname, item.path);
    if (!fs.existsSync(local)) { want.push(item); continue; }
    const sha = execFileSync('git', ['hash-object', local], { encoding: 'utf8', cwd: __dirname }).trim();
    if (sha !== item.sha) want.push(item);
  }
  console.log('要下载:', want.length);
  for (const item of want) {
    const enc = item.path.split('/').map(encodeURIComponent).join('/');
    const j = await call(API + '/contents/' + enc + '?ref=' + ref.object.sha);
    const buf = Buffer.from(j.content, 'base64');
    const target = path.join(__dirname, item.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
    console.log('  ✓', item.path, buf.length + 'B');
  }
  console.log('完成，远程 HEAD =', ref.object.sha.slice(0, 8));
})();
