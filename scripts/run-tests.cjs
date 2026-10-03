#!/usr/bin/env node
'use strict';
/**
 * 测试启动器：显式收集 tests/core/*.test.js 后交给 node --test。
 * 之所以不用 glob：Node 20（CI）不支持 --test glob 参数，Node 24（本机）
 * 不支持目录参数，两种写法都会在另一端炸掉（v0.6.1 首发踩坑）。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'tests', 'core');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => path.join(dir, f));

if (files.length === 0) {
  console.error('tests/core 下没有找到 *.test.js');
  process.exit(1);
}

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
