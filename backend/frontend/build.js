#!/usr/bin/env node
/**
 * 前端构建脚本（任务 7）—— 纯拼接，零逻辑改动。
 *
 * 读取 src/ 下所有片段文件，按文件名升序拼接，用 '\n' 连接，
 * 输出覆盖 ../public/index.html。
 *
 * 数学保证：原文件 = parts.join('\n')；按行连续切片后各片 = 子数组.join('\n')；
 * 再用 '\n' 连接各片 === 原文件逐字符一致。详见 README 注释与 baseline.html diff 校验。
 *
 * 用法：npm run build:fe   （在 backend/ 目录下）
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const OUT_FILE = path.join(__dirname, '..', 'public', 'index.html');

const files = fs.readdirSync(SRC_DIR)
  .filter(f => /\.(html|css|js)$/.test(f))
  .sort();

if (!files.length) {
  console.error('[build:fe] src/ 下没有片段文件，已中止');
  process.exit(1);
}

const pieces = files.map(f => fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
const output = pieces.join('\n');

fs.writeFileSync(OUT_FILE, output);
console.log(`[build:fe] 已拼接 ${files.length} 个片段 → ${path.relative(process.cwd(), OUT_FILE)}`);
files.forEach(f => console.log('  + ' + f));
