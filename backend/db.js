const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'app.db');

// 确保 data 目录存在
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// 开启 WAL 模式，提升并发性能
db.pragma('journal_mode = WAL');

// ==================== 建表 ====================

// 用户表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    phone     TEXT    UNIQUE NOT NULL,
    password  TEXT    NOT NULL,
    nickname  TEXT    DEFAULT '用户',
    avatar    INTEGER DEFAULT 0,
    role      TEXT    DEFAULT 'user',  -- user / admin
    daily_limit INTEGER DEFAULT 5,
    created_at TEXT   DEFAULT (datetime('now', 'localtime'))
  )
`);

// 使用记录表（每日次数统计）
db.exec(`
  CREATE TABLE IF NOT EXISTS usage_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    action     TEXT    NOT NULL,   -- extract / rewrite / inspire
    created_at TEXT    DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`);

// 系统配置表（AI Key、提示词等）
db.exec(`
  CREATE TABLE IF NOT EXISTS system_config (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  )
`);

// 提示词模板表
db.exec(`
  CREATE TABLE IF NOT EXISTS prompt_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    type        TEXT    NOT NULL,   -- rewrite / inspire / extract
    content     TEXT    NOT NULL,
    is_default  INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now', 'localtime'))
  )
`);

// 历史记录表
db.exec(`
  CREATE TABLE IF NOT EXISTS history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    type       TEXT    NOT NULL,   -- inspire / rewrite / extract
    input      TEXT,
    result     TEXT,
    created_at TEXT    DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`);

// 授权码表
db.exec(`
  CREATE TABLE IF NOT EXISTS auth_codes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT    UNIQUE NOT NULL,
    days         INTEGER NOT NULL DEFAULT 30,
    daily_limit  INTEGER NOT NULL DEFAULT 30,
    status       TEXT    DEFAULT 'unused',
    user_id      INTEGER,
    activated_at TEXT,
    created_at   TEXT    DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`);

// 用户表扩展（授权码关联）
try { db.exec('ALTER TABLE users ADD COLUMN auth_code_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN auth_expires_at TEXT'); } catch {}
// 微信登录 openid
try { db.exec('ALTER TABLE users ADD COLUMN openid TEXT'); } catch {}
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_openid ON users(openid) WHERE openid IS NOT NULL'); } catch {}

// 会员套餐默认价格
const memberDefaults = [
  ['member_plan_day_price', '9.90'],
  ['member_plan_week_price', '29.90'],
  ['member_plan_month_price', '69.90'],
  ['member_plan_forever_price', '199.00'],
  ['member_note', '请添加客服微信：Yu975196416'],
];
for (const [k, v] of memberDefaults) {
  const ex = db.prepare('SELECT key FROM system_config WHERE key=?').get(k);
  if (!ex) db.prepare('INSERT INTO system_config (key, value) VALUES (?,?)').run(k, v);
}

// 行业配置表
db.exec(`
  CREATE TABLE IF NOT EXISTS industries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    style_hint  TEXT    DEFAULT '',
    sort_order  INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now', 'localtime'))
  )
`);

// 插入默认行业（如果没有）
const hasInds = db.prepare('SELECT COUNT(*) as cnt FROM industries').get();
if (hasInds.cnt === 0) {
  const defaultInds = ['家居生活','美妆护肤','美食探店','穿搭时尚','健身运动','母婴育儿','数码科技','旅行攻略','职场成长','情感心理'];
  for (let i = 0; i < defaultInds.length; i++) {
    db.prepare('INSERT INTO industries (name, sort_order) VALUES (?, ?)').run(defaultInds[i], i);
  }
}

// 插入默认提示词（如果不存在）
const defaultPrompts = [
  {
    name: '文案改写-默认',
    type: 'rewrite',
    content: `你是一位专业的抖音爆款文案创作者。请将以下原始文案改写成更吸引人的爆款风格。

要求：
1. 保留核心信息和干货内容
2. 开头要有强力钩子，引发好奇或共鸣
3. 用口语化、接地气的语言
4. 加入emoji增加活泼感
5. 结尾要有行动号召（关注/收藏/评论）
6. 字数控制在300字以内

原始文案：
{input}

改写后的爆款文案：`,
    is_default: 1
  },
  {
    name: '文案提取分析-默认',
    type: 'extract',
    content: `请分析以下抖音视频文案，提取其核心结构和爆款要素：

文案内容：
{input}

请按以下格式输出：
【钩子】（开头吸引点）
【核心干货】（主要内容要点）
【爆款公式】（使用了哪些爆款技巧）
【情绪价值】（触动了用户哪些情绪）`,
    is_default: 1
  },
  {
    name: '灵感选题-默认',
    type: 'inspire',
    content: `你是抖音爆款内容策划师。请根据以下行业/赛道，生成5个高潜力选题，每个选题包含：标题钩子、内容框架、预计爆款原因。

行业/赛道：{input}

请生成爆款选题：`,
    is_default: 1
  }
];

// 只在该类型没有默认提示词时才插入
for (const p of defaultPrompts) {
  const exists = db.prepare('SELECT id FROM prompt_templates WHERE type=? AND is_default=1').get(p.type);
  if (!exists) {
    db.prepare('INSERT INTO prompt_templates (name, type, content, is_default) VALUES (?,?,?,?)')
      .run(p.name, p.type, p.content, p.is_default);
  }
}

module.exports = db;
