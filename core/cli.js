'use strict';
/**
 * ZCode Buddy CLI（调试/无界面场景用）
 *   node core/cli.js status              当前账号与 ZCode 运行状态
 *   node core/cli.js list                账号快照列表
 *   node core/cli.js capture [名称]       保存当前登录态为快照
 *   node core/cli.js use <id|名称>        切换到指定账号（会关闭并重启 ZCode）
 *   node core/cli.js quota [id|all]      查询额度并缓存
 *   node core/cli.js rename <id> <名称>
 *   node core/cli.js delete <id>
 *   node core/cli.js rollback            回滚到上次切换前
 */
const { CREDENTIALS_FILE, CONFIG_FILE, findZCodeExe } = require('./paths');
const fingerprint = require('./fingerprint');
const store = require('./store');
const switcher = require('./switcher');
const quota = require('./quota');

const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—');
const fmtQuota = (v) => (v == null ? '未知' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v));

function cmdStatus() {
  const fp = fingerprint.extractCurrent();
  const running = switcher.isZCodeRunning();
  console.log('ZCode 客户端 :', running ? '运行中' : '未运行');
  console.log('ZCode 路径   :', findZCodeExe() || '未找到（可设 ZCODE_EXE）');
  console.log('credentials  :', CREDENTIALS_FILE);
  console.log('config       :', CONFIG_FILE);
  console.log('快照目录     :', store.STORE_DIR);
  console.log('可回滚       :', switcher.hasLastBackup() ? '是' : '否');
  if (fp) {
    console.log('当前账号     :', fp.label);
    console.log('  user_id    :', fp.userId);
    console.log('  shortId    :', fp.shortId);
    console.log('  provider   :', fp.provider);
  } else {
    console.log('当前账号     : 无法识别（未登录或文件结构变化）');
  }
}

function cmdList() {
  const accounts = store.listAccounts();
  if (accounts.length === 0) {
    console.log('暂无账号快照，先用 `capture` 保存当前登录态。');
    return;
  }
  const current = fingerprint.extractCurrent();
  for (const a of accounts) {
    const mark = current && current.shortId === a.id ? '*' : ' ';
    const q = a.quota;
    const quotaText = q
      ? `${fmtQuota(q.remaining)} / ${fmtQuota(q.total)}${q.percentUsed != null ? `（已用 ${q.percentUsed.toFixed(1)}%）` : ''}`
      : '未查询';
    console.log(`${mark} [${a.id}] ${a.name}${a.email ? ` <${a.email}>` : ''}`);
    console.log(`    套餐: ${(q && q.plan && (q.plan.tier || q.plan.planName)) || '—'}  额度: ${quotaText}  抓取: ${fmtDate(a.capturedAt)}  上次使用: ${fmtDate(a.lastUsedAt)}`);
  }
  if (current) console.log('\n* 为当前登录账号');
}

async function cmdCapture(name) {
  const { account, updated } = store.captureCurrent({ name: name || undefined });
  console.log(`${updated ? '更新' : '保存'}成功：[${account.id}] ${account.name}${account.email ? ` <${account.email}>` : ''}`);
}

async function cmdUse(query, opts) {
  const account = store.findAccount(String(query || ''));
  if (!account) throw new Error(`找不到账号：${query}（用 list 查看现有快照）`);
  const restart = !opts.includes('--no-restart');
  console.log(`切换到 [${account.id}] ${account.name} ...`);
  const result = await switcher.applyState(
    { credentials: account.credentials, config: account.config },
    { restart },
  );
  account.lastUsedAt = Date.now();
  store.touch(account.id);
  console.log(`完成。${result.wasRunning ? '（ZCode 已关闭）' : ''}${result.restarted ? ' ZCode 已重新启动。' : restart ? ' 请手动启动 ZCode。' : '（--no-restart，未重启 ZCode）'}`);
}

async function cmdQuota(query) {
  const target = String(query || 'current');
  if (target === 'all') {
    const accounts = store.listAccounts({ withPayload: true });
    for (const account of accounts) {
      await refreshOne(account);
      await new Promise((r) => setTimeout(r, 800)); // 轻微间隔，降低限流概率
    }
    return;
  }
  if (target === 'current') {
    const info = await quota.queryCurrent();
    printQuota('当前登录账号', info);
    return;
  }
  const account = store.findAccount(target);
  if (!account) throw new Error(`找不到账号：${target}`);
  await refreshOne(account);
}

async function refreshOne(account) {
  process.stdout.write(`查询 [${account.id}] ${account.name} ... `);
  try {
    const info = await quota.queryAccount(account);
    store.saveQuota(account.id, info);
    console.log('OK');
    printQuota(account.name, info);
  } catch (e) {
    console.log('失败：' + e.message);
  }
}

function printQuota(title, info) {
  console.log(`\n【${title}】`);
  if (info.plan) {
    console.log(`  套餐: ${info.plan.tier || ''}${info.plan.planName ? `（${info.plan.planName}）` : ''}  到期: ${fmtDate(info.plan.expiresAt)}`);
  }
  console.log(`  额度: ${fmtQuota(info.remaining)} / ${fmtQuota(info.total)}${info.percentUsed != null ? `（已用 ${info.percentUsed.toFixed(1)}%）` : ''}`);
  for (const item of info.items) {
    console.log(`   - ${item.name}: ${fmtQuota(item.remaining)} / ${fmtQuota(item.total)}${item.expiresAt ? `（${fmtDate(item.expiresAt)} 到期）` : ''}`);
  }
  if (info.isEmpty) console.log('  （该账号暂无套餐/额度数据）');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case undefined:
      case 'status': return cmdStatus();
      case 'list': return cmdList();
      case 'capture': return await cmdCapture(rest[0]);
      case 'use': return await cmdUse(rest[0], rest.slice(1));
      case 'quota': return await cmdQuota(rest[0]);
      case 'rename': {
        if (rest.length < 2) throw new Error('用法: rename <id> <新名称>');
        const account = store.renameAccount(rest[0], rest[1]);
        return console.log(`已重命名为：${account.name}`);
      }
      case 'delete': {
        if (!rest[0]) throw new Error('用法: delete <id>');
        store.deleteAccount(rest[0]);
        return console.log(`已删除：${rest[0]}`);
      }
      case 'rollback': {
        const result = await switcher.rollback();
        return console.log(`已回滚。${result.restarted ? 'ZCode 已重新启动。' : '请手动启动 ZCode。'}`);
      }
      default:
        throw new Error(`未知命令：${cmd}（可用：status/list/capture/use/quota/rename/delete/rollback）`);
    }
  } catch (e) {
    console.error('错误：' + e.message);
    process.exitCode = 1;
  }
}

main();
