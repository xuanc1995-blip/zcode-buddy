#!/usr/bin/env node
'use strict';
/**
 * 发版脚本：一条命令完成 版本号 → 提交 → tag → 推送 → 盯 CI。
 *
 * 用法：
 *   node scripts/release.mjs 0.6.0              # 标准发版（发版前先手写 CHANGELOG.md）
 *   node scripts/release.mjs 0.6.0 --dispatch   # 推完 tag 后手动派发 CI（tag 推送没触发工作流时用）
 *   node scripts/release.mjs 0.6.0 --no-watch   # 不等待 CI 构建结果
 *
 * 踩坑记录（为什么这么写）：
 * - GitHub 限制：一次推送超过 3 个 tag 不触发任何工作流 → 本脚本永远只推 1 个 tag，且提供 --dispatch 兜底
 * - 本机 git 推 GitHub 偶发 403/超时（IPv6）→ 推送失败自动重试 3 次
 * - 发版内容（CHANGELOG）需人工确认后提前写好，脚本只校验不代写
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const versionArg = args.find((a) => !a.startsWith('--'));
const wantDispatch = args.includes('--dispatch');
const watch = !args.includes('--no-watch');

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
function run(cmd, cmdArgs, { capture = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', ...(capture ? {} : { stdio: 'inherit' }) });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} 失败（退出码 ${r.status}）${capture && r.stderr ? '：' + r.stderr.trim() : ''}`);
  return capture ? (r.stdout || '') : undefined;
}
const git = (...a) => run('git', a);
const gitOut = (...a) => run('git', a, { capture: true });

// ---------------------------------------------------------------------------
// 1. 前置校验
// ---------------------------------------------------------------------------
if (!versionArg) fail('用法：node scripts/release.mjs <version> [--dispatch] [--no-watch]（例：0.6.0）');
const version = versionArg.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`版本号不合法：${versionArg}（期望 X.Y.Z）`);
const tag = `v${version}`;

const branch = gitOut('rev-parse', '--abbrev-ref', 'HEAD').trim();
if (branch !== 'master') fail(`当前分支是 ${branch}，请在 master 上发版`);
try {
  gitOut('diff', '--quiet');
  gitOut('diff', '--cached', '--quiet');
} catch (_) {
  fail('工作区不干净：先提交或暂存所有改动再发版');
}

const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
if (!new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(changelog)) {
  fail(`CHANGELOG.md 里还没有 ${version} 的条目（先补好再发版）`);
}
console.log(`✓ 前置校验通过：master 分支干净，CHANGELOG 已包含 ${version}`);

// ---------------------------------------------------------------------------
// 2. 版本号 + 提交 + tag
// ---------------------------------------------------------------------------
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.version !== version) {
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  git('add', 'package.json');
  git('commit', '-m', `chore: release ${tag}`);
  console.log(`✓ package.json → ${version}，已提交`);
} else {
  console.log(`• package.json 已是 ${version}，跳过改版本`);
}

const existing = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd: ROOT, encoding: 'utf8' });
if (existing.status === 0) {
  console.log(`• 本地已有 tag ${tag}，跳过创建`);
} else {
  git('tag', '-a', tag, '-m', `${tag}: 发布（详见 CHANGELOG.md）`);
  console.log(`✓ 已创建 tag ${tag}`);
}

// ---------------------------------------------------------------------------
// 3. 推送（带重试；tag 单独推以保证触发 CI）
// ---------------------------------------------------------------------------
async function pushWithRetry(pushArgs) {
  for (let i = 1; i <= 3; i++) {
    try {
      run('git', pushArgs);
      return;
    } catch (e) {
      console.warn(`  推送失败（第 ${i}/3 次）：${e.message.split('\n')[0]}`);
      if (i === 3) throw e;
      await sleep(3000);
    }
  }
}

try {
  await pushWithRetry(['push', 'origin', 'master:main']);
  console.log('✓ 已推送 master → origin/main');
  await pushWithRetry(['push', 'origin', tag]);
  console.log(`✓ 已推送 tag ${tag}（单 tag 推送可触发 Release 工作流）`);
} catch (e) {
  fail(`推送失败：${e.message}\n  网络恢复后手动执行：git push origin master:main && git push origin ${tag}\n  若 tag 已推上但 CI 未启动：gh workflow run release.yml --ref ${tag}`);
}

if (wantDispatch) {
  run('gh', ['workflow', 'run', 'release.yml', '--ref', tag, '--repo', 'xuanc1995-blip/zcode-buddy']);
  console.log(`✓ 已手动派发 Release 工作流（${tag}）`);
}

// ---------------------------------------------------------------------------
// 4. 盯 CI
// ---------------------------------------------------------------------------
if (!watch) {
  console.log(`完成。构建进度：https://github.com/xuanc1995-blip/zcode-buddy/actions`);
  process.exit(0);
}

console.log('等待 CI 构建完成（每 30 秒轮询，最长 30 分钟）…');
const deadline = Date.now() + 30 * 60 * 1000;
while (Date.now() < deadline) {
  await sleep(30000);
  const out = spawnSync('gh', ['run', 'list', '--workflow=release.yml', '--limit', '10', '--json', 'headBranch,status,conclusion', '--repo', 'xuanc1995-blip/zcode-buddy'], { encoding: 'utf8' });
  if (out.status !== 0) { console.warn('  gh run list 查询失败，继续等待…'); continue; }
  let runs;
  try { runs = JSON.parse(out.stdout); } catch (_) { continue; }
  const mine = runs.find((r) => r.headBranch === tag);
  if (!mine) { console.log('  尚未看到本轮构建（可能排队中）…'); continue; }
  if (mine.status !== 'completed') { console.log(`  构建中：${mine.status}…`); continue; }
  if (mine.conclusion === 'success') {
    console.log(`✓ 构建成功：https://github.com/xuanc1995-blip/zcode-buddy/releases/tag/${tag}`);
    console.log('  收尾提醒：gh release edit 校正 Release 标题与说明（CI 生成的是纯 compare 链接）');
    process.exit(0);
  }
  fail(`构建失败（${mine.conclusion}）：https://github.com/xuanc1995-blip/zcode-buddy/actions — 修复后可删 tag 重发或手动挂附件`);
}
fail('等待超时（30 分钟）：请到 Actions 页确认构建状态');
