#!/usr/bin/env node
/* 用 GitHub Data API 把本地 HEAD 全量同步到远程（需要 gh 已登录）。
   为什么不用 git push：本机到 github.com:443 的 git 通道经常被重置，
   但 api.github.com 通，所以走 REST API。

   策略：对比「本地 tree」与「远程 tree」的 blob sha（git 内部就是内容 sha1），
   只上传有变化的文件、删除远程多出来的文件；文本统一转 LF 再传。

   用法：node 开发工具/push-api.js ["提交说明"] */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OWNER = 'InoriMutsumi';
const REPO = 'texas-holdem-trainer';
const BRANCH = 'main';
const TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const API = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
const BIN_RE = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|mp3|mp4|zip)$/i;

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'dsh-push-api',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(method + ' ' + url + ' -> ' + res.status + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}

(async () => {
  const msg = process.argv[2] || git(['log', '-1', '--pretty=%s']);

  const ref = await call('GET', API + '/git/ref/heads/' + BRANCH);
  const baseSha = ref.object.sha;
  const baseCommit = await call('GET', API + '/git/commits/' + baseSha);
  const baseTree = baseCommit.tree.sha;

  console.log('remote HEAD:', baseSha.slice(0, 8));

  // 本地 HEAD 的 tree（blob sha 与 GitHub 一致）
  const local = {};
  for (const line of git(['-c', 'core.quotepath=false', 'ls-tree', '-r', 'HEAD']).split('\n').filter(Boolean)) {
    const m = line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
    if (m) local[m[2]] = m[1];
  }

  // 远程 tree
  const remote = {};
  const rt = await call('GET', API + '/git/trees/' + baseTree + '?recursive=1');
  for (const it of rt.tree || []) {
    if (it.type === 'blob') remote[it.path] = it.sha;
  }

  const entries = [];
  let del = 0, up = 0;

  for (const p of Object.keys(remote)) {
    if (!(p in local)) {
      entries.push({ path: p, mode: '100644', type: 'blob', sha: null });
      console.log('  delete', p);
      del++;
    }
  }

  for (const p of Object.keys(local)) {
    if (remote[p] === local[p]) continue;
    let buf = fs.readFileSync(path.join(ROOT, p));
    if (!BIN_RE.test(p)) {
      const s = buf.toString('utf8');
      if (s.indexOf('\r\n') >= 0) buf = Buffer.from(s.split('\r\n').join('\n'), 'utf8');
    }
    const blob = await call('POST', API + '/git/blobs', {
      content: buf.toString('base64'),
      encoding: 'base64',
    });
    entries.push({ path: p, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('  upload', p);
    up++;
  }

  if (!entries.length) {
    console.log('远程已与本地一致，无需推送');
    return;
  }

  const tree = await call('POST', API + '/git/trees', { base_tree: baseTree, tree: entries });
  const commit = await call('POST', API + '/git/commits', {
    message: msg,
    tree: tree.sha,
    parents: [baseSha],
  });
  await call('PATCH', API + '/git/refs/heads/' + BRANCH, { sha: commit.sha, force: false });

  console.log('\n改动：上传 ' + up + ' 个，删除 ' + del + ' 个');
  console.log('pushed: ' + commit.sha.slice(0, 8) + ' - ' + msg);
})().catch((e) => {
  console.error('推送失败:', e.message);
  process.exit(1);
});
