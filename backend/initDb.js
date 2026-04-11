const db = require('./db');

async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              SERIAL PRIMARY KEY,
      phone           TEXT UNIQUE NOT NULL,
      password        TEXT NOT NULL,
      nickname        TEXT DEFAULT '用户',
      avatar          INTEGER DEFAULT 0,
      role            TEXT DEFAULT 'user',
      daily_limit     INTEGER DEFAULT 5,
      auth_code_id    INTEGER,
      auth_expires_at TEXT,
      openid          TEXT UNIQUE,
      created_at      TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      action     TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS system_config (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL,
      content    TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS history (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      type       TEXT NOT NULL,
      input      TEXT,
      result     TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_codes (
      id           SERIAL PRIMARY KEY,
      code         TEXT UNIQUE NOT NULL,
      days         INTEGER NOT NULL DEFAULT 30,
      daily_limit  INTEGER NOT NULL DEFAULT 30,
      status       TEXT DEFAULT 'unused',
      user_id      INTEGER,
      activated_at TEXT,
      created_at   TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS industries (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      style_hint TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // 默认会员价格
  const memberDefaults = [
    ['member_plan_day_price', '9.90'],
    ['member_plan_week_price', '29.90'],
    ['member_plan_month_price', '69.90'],
    ['member_plan_forever_price', '199.00'],
    ['member_note', '请添加客服微信：Yu975196416'],
  ];
  for (const [k, v] of memberDefaults) {
    await db.query(
      `INSERT INTO system_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [k, v]
    );
  }

  // 默认行业
  const { rows: indRows } = await db.query('SELECT COUNT(*) AS cnt FROM industries');
  if (parseInt(indRows[0].cnt) === 0) {
    const defaultInds = ['家居生活','美妆护肤','美食探店','穿搭时尚','健身运动','母婴育儿','数码科技','旅行攻略','职场成长','情感心理'];
    for (let i = 0; i < defaultInds.length; i++) {
      await db.query('INSERT INTO industries (name, sort_order) VALUES ($1, $2)', [defaultInds[i], i]);
    }
  }

  // 默认提示词
  const defaultPrompts = [
    {
      name: '文案改写-默认', type: 'rewrite',
      content: `你是一位专业的抖音爆款文案创作者。请将以下原始文案改写成更吸引人的爆款风格。\n\n要求：\n1. 保留核心信息和干货内容\n2. 开头要有强力钩子，引发好奇或共鸣\n3. 用口语化、接地气的语言\n4. 加入emoji增加活泼感\n5. 结尾要有行动号召（关注/收藏/评论）\n6. 字数控制在300字以内\n\n原始文案：\n{input}\n\n改写后的爆款文案：`
    },
    {
      name: '文案提取分析-默认', type: 'extract',
      content: `请分析以下抖音视频文案，提取其核心结构和爆款要素：\n\n文案内容：\n{input}\n\n请按以下格式输出：\n【钩子】（开头吸引点）\n【核心干货】（主要内容要点）\n【爆款公式】（使用了哪些爆款技巧）\n【情绪价值】（触动了用户哪些情绪）`
    },
    {
      name: '灵感选题-默认', type: 'inspire',
      content: `你是抖音爆款内容策划师。请根据以下行业/赛道，生成5个高潜力选题，每个选题包含：标题钩子、内容框架、预计爆款原因。\n\n行业/赛道：{input}\n\n请生成爆款选题：`
    }
  ];
  for (const p of defaultPrompts) {
    const { rows } = await db.query(
      'SELECT id FROM prompt_templates WHERE type=$1 AND is_default=1', [p.type]
    );
    if (rows.length === 0) {
      await db.query(
        'INSERT INTO prompt_templates (name, type, content, is_default) VALUES ($1,$2,$3,1)',
        [p.name, p.type, p.content]
      );
    }
  }

  console.log('✅ 数据库初始化完成');
}

module.exports = initDb;
