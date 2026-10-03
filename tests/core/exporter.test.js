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
});
