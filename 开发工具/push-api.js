#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OWNER = 'InoriMutsumi';
const REPO = 'texas-holdem-trainer';
const BRANCH = 'main';
const TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const API = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
const ROOT = path.resolve(__dirname, '..');

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
  const remote = await call('GET', API + '/git/ref/heads/' + BRANCH);
  const baseSha = remote.object.sha;
  const baseCommit = await call('GET', API + '/git/commits/' + baseSha);
  const baseTree = baseCommit.tree.sha;
  const localTree = git(['rev-parse', 'HEAD^{tree}']);
  console.log('remote HEAD:', baseSha.slice(0, 8));
  if (localTree === baseTree) {
    console.log('same tree, nothing to push');
    return;
  }

  let diffBase = baseSha;
  try {
    git(['cat-file', '-e', baseSha + '^{commit}']);
  } catch (e) {
    diffBase = 'HEAD~1';
    console.log('remote commit not in local repo, diffing', diffBase, '..HEAD');
  }

  let files = [];
  try {
    files = git(['-c', 'core.quotepath=false', 'diff', '--name-status', diffBase, 'HEAD']).split('\n').filter(Boolean);
  } catch (e) {
    console.log('diff failed:', e.message);
  }

  const entries = [];
  for (const line of files) {
    const parts = line.split('\t');
    if (parts[0] === 'D') {
      entries.push({ path: parts[1], mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const file = parts[parts.length - 1];
    let buf = fs.readFileSync(path.join(ROOT, file));
    // 文本文件统一转成 LF 再推，避免 CRLF 让远程判成「整个文件都变了」
    if (!/\.(png|jpe?g|gif|ico|webp|woff2?|ttf)$/i.test(file)) {
      buf = Buffer.from(buf.toString('utf8').split('\r\n').join('\n'), 'utf8');
    }
    const blob = await call('POST', API + '/git/blobs', {
      content: buf.toString('base64'),
      encoding: 'base64',
    });
    entries.push({ path: file.split(path.sep).join('/'), mode: '100644', type: 'blob', sha: blob.sha });
    console.log('  upload', file);
  }

  const tree = await call('POST', API + '/git/trees', { base_tree: baseTree, tree: entries });
  const commit = await call('POST', API + '/git/commits', { message: msg, tree: tree.sha, parents: [baseSha] });
  await call('PATCH', API + '/git/refs/heads/' + BRANCH, { sha: commit.sha, force: false });
  console.log('pushed:', commit.sha.slice(0, 8), '-', msg);
})();
