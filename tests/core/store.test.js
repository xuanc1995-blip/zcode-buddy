'use strict';
/** core/store：快照存储、排序/查找、额度历史与每日聚合（全部在临时数据目录进行） */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-buddy-store-test-'));
process.env.ZCODE_BUDDY_DATA_DIR = TMP; // 必须在 require 之前设置（paths.js 模块加载时读取）

const store = require('../../core/store');

const DAY = 86400000;
const now = Date.now();

/** 直接写一个账号快照文件（绕过 captureCurrent 对真实 ~/.zcode 的依赖） */
function seedAccount(id, name, extra = {}) {
  fs.mkdirSync(store.STORE_DIR, { recursive: true });
  const account = {
    id, userId: id + '0000', name, email: null, provider: 'bigmodel',
    capturedAt: now, updatedAt: now, lastUsedAt: null, quota: null,
    quotaRefreshedAt: null, credentials: '{"x":1}', config: '{}',
    ...extra,
  };
  fs.writeFileSync(path.join(store.STORE_DIR, `${id}.json`), JSON.stringify(account, null, 2), 'utf8');
  return account;
}

describe('store：列表与查找', () => {
  before(() => {
    fs.rmSync(store.STORE_DIR, { recursive: true, force: true });
    seedAccount('aaaaaaaa', '02-工作');
    seedAccount('bbbbbbbb', '01-主号');
    seedAccount('cccccccc', '备用号');
  });

  test('listAccounts 按名称中数字升序，无数字的排最后', () => {
    assert.deepEqual(store.listAccounts().map((a) => a.name), ['01-主号', '02-工作', '备用号']);
  });

  test('listAccounts 默认剥离凭证字段', () => {
    for (const a of store.listAccounts()) {
      assert.equal(a.credentials, undefined);
      assert.equal(a.config, undefined);
    }
  });

  test('findAccount：精确 id → id 前缀 → 名称 → 名称包含', () => {
    assert.equal(store.findAccount('aaaaaaaa').id, 'aaaaaaaa');
    assert.equal(store.findAccount('bbbb').id, 'bbbbbbbb');      // 前缀
    assert.equal(store.findAccount('01-主号').id, 'bbbbbbbb');    // 名称精确
    assert.equal(store.findAccount('备用').id, 'cccccccc');       // 名称包含
    assert.equal(store.findAccount('不存在'), null);
  });

  test('renameAccount 更新名称与 updatedAt；deleteAccount 删除', () => {
    seedAccount('dddddddd', '临时');
    store.renameAccount('dddddddd', '改名后');
    assert.equal(store.findAccount('dddddddd').name, '改名后');
    assert.throws(() => store.renameAccount('nope', 'x'));
    store.deleteAccount('dddddddd');
    assert.equal(store.findAccount('dddddddd'), null);
    assert.throws(() => store.deleteAccount('dddddddd'));
  });

  test('非法 id 拒绝写入/删除（防目录穿越）', () => {
    for (const bad of ['../../evil', '..\\evil', 'a/b', '..', '.tmp', '白名单外语义的 id?']) {
      assert.throws(() => store.renameAccount(bad, 'x'), /非法的账号标识/, `rename 应拒绝: ${bad}`);
      assert.throws(() => store.deleteAccount(bad), /非法的账号标识/, `delete 应拒绝: ${bad}`);
    }
    // 读取侧不受影响
    assert.equal(store.findAccount('../../evil'), null);
  });
});

describe('store：saveQuota 历史与当日消耗', () => {
  before(() => {
    fs.rmSync(store.STORE_DIR, { recursive: true, force: true });
    seedAccount('eeeeeeee', '配额账号');
  });

  const quota = (used, total) => ({
    used, total, remaining: total - used, percentUsed: (used / total) * 100,
    items: [
      { name: 'GLM-5.3', used: used / 2, total: total / 2, remaining: (total - used) / 2 },
      { name: 'GLM-4.6', used: used / 2, total: total / 2, remaining: (total - used) / 2 },
    ],
  });

  test('历史点 60 秒内覆盖、正常追加', () => {
    store.saveQuota('eeeeeeee', quota(10, 100), {});
    const t1 = JSON.parse(fs.readFileSync(path.join(store.STORE_DIR, 'eeeeeeee.json'), 'utf8')).history;
    assert.equal(t1.length, 1);

    store.saveQuota('eeeeeeee', quota(20, 100), {}); // 立即再存 → 覆盖同一点
    const t2 = JSON.parse(fs.readFileSync(path.join(store.STORE_DIR, 'eeeeeeee.json'), 'utf8')).history;
    assert.equal(t2.length, 1);
    assert.equal(t2[0].used, 20);

    // 用旧时间戳伪造「超过 60 秒」：直接操作历史文件
    const acc = JSON.parse(fs.readFileSync(path.join(store.STORE_DIR, 'eeeeeeee.json'), 'utf8'));
    acc.history[0].t = Date.now() - 2 * 60 * 1000;
    fs.writeFileSync(path.join(store.STORE_DIR, 'eeeeeeee.json'), JSON.stringify(acc));
    store.saveQuota('eeeeeeee', quota(30, 100), {});
    const t3 = JSON.parse(fs.readFileSync(path.join(store.STORE_DIR, 'eeeeeeee.json'), 'utf8')).history;
    assert.equal(t3.length, 2);
  });

  test('todayUsed = 各活跃额度 used 之和', () => {
    const acc = JSON.parse(fs.readFileSync(path.join(store.STORE_DIR, 'eeeeeeee.json'), 'utf8'));
    assert.equal(acc.todayUsed, 30);
  });

  test('tokenStatus / markTokenExpired / touch', () => {
    store.markTokenExpired('eeeeeeee');
    store.touch('eeeeeeee');
    const acc = JSON.parse(fs.readFileSync(path.join(store.STORE_DIR, 'eeeeeeee.json'), 'utf8'));
    assert.equal(acc.tokenStatus, 'expired');
    assert.ok(acc.lastUsedAt > 0);
  });
});

describe('store：每日聚合（daily.json）', () => {
  before(() => {
    fs.rmSync(store.DAILY_FILE, { force: true }); // saveQuota 测试已顺带写入今日样本，清掉隔离
  });

  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  test('recordDailySample 落盘、同日覆盖、合计正确', () => {
    const today = store.localDateKey(now);
    assert.equal(store.recordDailySample('acc-1', 100, { now }), true);
    assert.equal(store.recordDailySample('acc-2', 50.5, { now }), true);
    assert.equal(store.recordDailySample('acc-1', 120, { now }), true); // 同日同账号覆盖

    const days = store.readDailySummary({ days: 7 });
    assert.equal(days.length, 1);
    assert.equal(days[0].date, today);
    assert.equal(days[0].total, 170.5);
    assert.equal(days[0].accounts['acc-1'].total, 120);
  });

  test('旧版 daily.json（账号值为纯数字）读出时自动规范化', () => {
    const key = store.localDateKey(now - DAY);
    fs.writeFileSync(store.DAILY_FILE, JSON.stringify({
      version: 1,
      days: { [key]: { accounts: { 'old-acc': 88 }, total: 88 } },
    }), 'utf8');
    const days = store.readDailySummary({ days: 7 });
    const day = days.find((d) => d.date === key);
    assert.equal(day.total, 88);
    assert.deepEqual(day.accounts['old-acc'], { total: 88, models: {} });
  });

  test('分模型用量：跨账号聚合到 day.models', () => {
    fs.rmSync(store.DAILY_FILE, { force: true });
    store.recordDailySample('acc-1', 100, { now, models: { 'GLM-5.3': 60, 'GLM-4.6': 40 } });
    store.recordDailySample('acc-2', 10, { now, models: { 'GLM-5.3': 10 } });

    const days = store.readDailySummary({ days: 7 });
    assert.equal(days.length, 1);
    assert.equal(days[0].total, 110);
    assert.deepEqual(days[0].models, { 'GLM-5.3': 70, 'GLM-4.6': 40 });
    assert.deepEqual(days[0].accounts['acc-1'].models, { 'GLM-5.3': 60, 'GLM-4.6': 40 });
  });

  test('readDailyUsed：按日期/按账号读取，缺失返回 null', () => {
    const today = store.localDateKey(now);
    assert.equal(store.readDailyUsed(today), 110);
    assert.equal(store.readDailyUsed(today, 'acc-2'), 10);
    assert.equal(store.readDailyUsed(today, 'nobody'), null);
    assert.equal(store.readDailyUsed('1999-01-01'), null);
  });

  test('只保留最近 120 天（第 121 次写入触发裁剪）', () => {
    const data = { version: 1, days: {} };
    for (let i = 1; i <= 130; i++) {
      const key = store.localDateKey(now - i * DAY);
      data.days[key] = { accounts: { acc: i }, total: i };
    }
    fs.writeFileSync(store.DAILY_FILE, JSON.stringify(data), 'utf8');
    store.recordDailySample('acc', 5, { now }); // 今日样本 → 共 131 天 → 裁到 120

    const days = store.readDailySummary({ days: 200 });
    assert.equal(days.length, 120);
    assert.equal(days[0].total, 119); // 最老的 11 天（130~120 天前）被裁掉
    assert.equal(days[days.length - 1].total, 5); // 今天
  });

  test('坏文件 / 空数据时读出空结果不抛错', () => {
    fs.writeFileSync(store.DAILY_FILE, 'not-json{', 'utf8');
    assert.deepEqual(store.readDailySummary({}), []);
    assert.equal(store.recordDailySample('acc-1', 1, { now }), true); // 坏文件被重置为合法结构
    fs.rmSync(store.DAILY_FILE, { force: true });
    assert.deepEqual(store.readDailySummary({}), []);
  });

  test('recordDailySample 拒绝空值', () => {
    assert.equal(store.recordDailySample('acc-1', null, { now }), false);
    assert.equal(store.recordDailySample('', 5, { now }), false);
  });
});
