'use strict';
/** core/exporter：.zbak 加密备份导出/导入往返（临时数据目录） */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-buddy-export-test-'));
process.env.ZCODE_BUDDY_DATA_DIR = TMP; // 必须在 require 之前设置

const store = require('../../core/store');
const { exportToFile, importFromFile } = require('../../core/exporter');

function seedAccount(id, name) {
  fs.mkdirSync(store.STORE_DIR, { recursive: true });
  const account = {
    id, userId: id, name, email: null, provider: 'bigmodel',
    capturedAt: Date.now(), updatedAt: Date.now(), lastUsedAt: null,
    quota: { used: 1, total: 2 }, quotaRefreshedAt: Date.now(),
    credentials: '{"enc":true}', config: '{}',
    history: [{ t: Date.now(), used: 1, total: 2, remaining: 1 }],
  };
  fs.writeFileSync(path.join(store.STORE_DIR, `${id}.json`), JSON.stringify(account, null, 2), 'utf8');
}

describe('exporter', () => {
  let backupPath;
  let withDailyPath;

  before(() => {
    fs.rmSync(store.STORE_DIR, { recursive: true, force: true });
    seedAccount('eeeeeeee', '导出账号A');
    seedAccount('ffffffff', '导出账号B');
    backupPath = path.join(TMP, 'backup.zbak');
  });

  after(() => fs.rmSync(TMP, { recursive: true, force: true }));

  test('口令过短拒绝导出', () => {
    assert.throws(() => exportToFile(backupPath, 'abc'), /至少 4 位/);
  });

  test('导出 → 导入（同库合并）round-trip，凭证完整', () => {
    const count = exportToFile(backupPath, 'pass-1234');
    assert.equal(count, 2);

    // 全部已存在 → skipped=2, imported=0
    const r1 = importFromFile(backupPath, 'pass-1234');
    assert.deepEqual({ imported: r1.imported, skipped: r1.skipped }, { imported: 0, skipped: 2 });

    // 删除一个再导入 → imported=1
    store.deleteAccount('ffffffff');
    const r2 = importFromFile(backupPath, 'pass-1234');
    assert.equal(r2.imported, 1);
    const back = store.readAccount('ffffffff');
    assert.equal(back.name, '导出账号B');
    assert.equal(back.credentials, '{"enc":true}');
    assert.equal(back.quota.used, 1);
    assert.equal(back.history.length, 1);
  });

  test('口令错误或文件损坏 → 明确报错', () => {
    assert.throws(() => importFromFile(backupPath, 'wrong-pass'), /解密失败/);
    const bad = path.join(TMP, 'bad.zbak');
    fs.writeFileSync(bad, Buffer.from('this is not a backup at all....'));
    assert.throws(() => importFromFile(bad, 'pass-1234'), /不是有效的/);
  });

  test('备份携带每日消耗历史，导入时补录缺失日期（含分模型）', () => {
    fs.rmSync(store.DAILY_FILE, { force: true });
    store.recordDailySample('gggggggg', 500, { models: { 'GLM-5.3': 300, 'GLM-4.6': 200 } });
    withDailyPath = path.join(TMP, 'with-daily.zbak');
    exportToFile(withDailyPath, 'pass-1234');

    // 模拟新机器：清空每日历史后再导入
    fs.rmSync(store.DAILY_FILE, { force: true });
    const r = importFromFile(withDailyPath, 'pass-1234');
    assert.equal(r.dailyAdded, 1);
    const days = store.readDailySummary({ days: 7 });
    assert.equal(days[0].total, 500);
    assert.deepEqual(days[0].models, { 'GLM-5.3': 300, 'GLM-4.6': 200 });
  });

  test('导入不覆盖本地已有的每日记录', () => {
    store.recordDailySample('hhhhhhhh', 999);
    const r = importFromFile(withDailyPath, 'pass-1234');
    assert.equal(r.dailyAdded, 0); // 今天本地已有记录，备份里的 500 不覆盖
    assert.equal(store.readDailyUsed(store.localDateKey(Date.now()), 'hhhhhhhh'), 999); // 本地值保留
    assert.equal(store.readDailyUsed(store.localDateKey(Date.now()), 'gggggggg'), 500); // 备份补录的仍在
    assert.equal(store.readDailyUsed(store.localDateKey(Date.now())), 1499); // 合计 = 两者之和
  });

  test('备份中的非法账号 id 被跳过（防目录穿越）', () => {
    // 手工构造一份带越界 id 的合法加密备份（GCM tag 正确，绕不过格式校验就只能靠 id 白名单）
    const crypto = require('node:crypto');
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync('pass-1234', salt, 200000, 32, 'sha256');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plain = Buffer.from(JSON.stringify({
      exportedAt: Date.now(),
      accounts: [
        { id: '../../evil', name: '越界写入', credentials: '{"x":1}' },
        { id: 'valid1234', name: '正常账号', credentials: '{"x":1}' },
      ],
    }), 'utf8');
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    const p = path.join(TMP, 'malicious.zbak');
    fs.writeFileSync(p, Buffer.concat([Buffer.from('zcodebuddy-backup v1', 'ascii'), salt, iv, cipher.getAuthTag(), ct]));

    const before = fs.readdirSync(store.STORE_DIR).length;
    const r = importFromFile(p, 'pass-1234');
    assert.equal(r.skipped, 1); // 越界 id 被拒
    assert.equal(r.imported, 1); // 合法 id 正常导入
    assert.equal(fs.existsSync(path.join(store.STORE_DIR, 'valid1234.json')), true);
    assert.equal(fs.existsSync(path.resolve(store.STORE_DIR, '../../evil.json')), false);
    assert.equal(fs.readdirSync(store.STORE_DIR).length, before + 1);
  });
});
