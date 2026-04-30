const db = require('./db');

async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      phone           VARCHAR(255) UNIQUE NOT NULL,
      password        TEXT NOT NULL,
      nickname        VARCHAR(100) DEFAULT '用户',
      avatar          INTEGER DEFAULT 0,
      role            VARCHAR(50) DEFAULT 'user',
      daily_limit     INTEGER DEFAULT 5,
      auth_code_id    INTEGER,
      auth_expires_at TEXT,
      openid          VARCHAR(255) UNIQUE,
      created_at      TIMESTAMP DEFAULT NOW()
    ) CHARACTER SET utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      action     TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    ) CHARACTER SET utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS system_config (
      config_key VARCHAR(255) PRIMARY KEY,
      value      TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    ) CHARACTER SET utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL,
      content    MEDIUMTEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    ) CHARACTER SET utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS history (
      id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      type       TEXT NOT NULL,
      input      TEXT,
      result     MEDIUMTEXT,
      created_at TIMESTAMP DEFAULT NOW()
    ) CHARACTER SET utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_codes (
      id           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      code         VARCHAR(255) UNIQUE NOT NULL,
      days         INTEGER NOT NULL DEFAULT 30,
      daily_limit  INTEGER NOT NULL DEFAULT 30,
      status       VARCHAR(50) DEFAULT 'unused',
      user_id      INTEGER,
      activated_at TEXT,
      created_at   TIMESTAMP DEFAULT NOW()
    ) CHARACTER SET utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS industries (
      id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name       TEXT NOT NULL,
      style_hint VARCHAR(500) DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    ) CHARACTER SET utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS industry_videos (
      id           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      industry     VARCHAR(100) NOT NULL,
      aweme_id     VARCHAR(100) NOT NULL UNIQUE,
      author       VARCHAR(200) DEFAULT '',
      cover_url    TEXT,
      video_url    TEXT,
      likes        BIGINT DEFAULT 0,
      transcript   MEDIUMTEXT,
      status       VARCHAR(20) DEFAULT 'ok',
      collected_at TIMESTAMP DEFAULT NOW()
    ) CHARACTER SET utf8mb4
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
      `INSERT IGNORE INTO system_config (config_key, value) VALUES (?, ?)`,
      [k, v]
    );
  }

  // 默认行业
  const { rows: indRows } = await db.query('SELECT COUNT(*) AS cnt FROM industries');
  if (parseInt(indRows[0].cnt) === 0) {
    const defaultInds = ['家居生活','美妆护肤','美食探店','穿搭时尚','健身运动','母婴育儿','数码科技','旅行攻略','职场成长','情感心理'];
    for (let i = 0; i < defaultInds.length; i++) {
      await db.query('INSERT INTO industries (name, sort_order) VALUES (?, ?)', [defaultInds[i], i]);
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
      'SELECT id FROM prompt_templates WHERE type=? AND is_default=1', [p.type]
    );
    if (rows.length === 0) {
      await db.query(
        'INSERT INTO prompt_templates (name, type, content, is_default) VALUES (?,?,?,1)',
        [p.name, p.type, p.content]
      );
    }
  }

  // 启动时将指定手机号设为管理员（已注册用户才会被更新；可多号逗号分隔）
  const adminPhones = (process.env.ADMIN_PHONES || '18201285539')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const phone of adminPhones) {
    await db.query('UPDATE users SET role = ? WHERE phone = ?', ['admin', phone]);
  }

  try {
    await db.query('ALTER TABLE users ADD COLUMN avatar_image MEDIUMTEXT NULL');
  } catch (e) {
    if (!String(e.message || e).includes('Duplicate column name')) console.warn('[initDb] avatar_image:', e.message || e);
  }

  const uiDefaults = [
    ['h5_show_profile_phone', '0'],
    ['h5_show_account_type', '0'],
  ];
  for (const [k, v] of uiDefaults) {
    await db.query('INSERT IGNORE INTO system_config (config_key, value) VALUES (?, ?)', [k, v]);
  }

  // asr_url：若不存在则插入，若已存在但缺少协议头则修正（默认指向 frp 穿透域名）
  await db.query(
    `INSERT IGNORE INTO system_config (config_key, value) VALUES ('asr_url', 'http://asr.yyagent.top')`
  );
  await db.query(
    `UPDATE system_config SET value = 'http://asr.yyagent.top'
     WHERE config_key = 'asr_url' AND value NOT LIKE 'http%'`
  );

  // video_url：数字人视频生成服务地址（VideoReTalking / SadTalker / HeyGem）
  await db.query(
    `INSERT IGNORE INTO system_config (config_key, value) VALUES ('video_url', '')`
  );

  // DeepSeek AI 配置（强制写入，确保可用）
  await db.query(
    `INSERT INTO system_config (config_key, value) VALUES ('ai_provider', 'deepseek')
     ON DUPLICATE KEY UPDATE value = 'deepseek'`
  );
  await db.query(
    `INSERT INTO system_config (config_key, value) VALUES ('deepseek_api_key', 'sk-49991c5474b14a2aa47f60541765f04d')
     ON DUPLICATE KEY UPDATE value = IF(value = '' OR value IS NULL, 'sk-49991c5474b14a2aa47f60541765f04d', value)`
  );
  await db.query(
    `INSERT IGNORE INTO system_config (config_key, value) VALUES ('deepseek_model', 'deepseek-chat')`
  );

  // tasks 表
  await db.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id         VARCHAR(36) PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      type       VARCHAR(50) NOT NULL,
      title      VARCHAR(255) DEFAULT '',
      status     VARCHAR(20) DEFAULT 'pending',
      stage      VARCHAR(50) DEFAULT '',
      progress   INTEGER DEFAULT 0,
      thinking   TEXT,
      input_data MEDIUMTEXT,
      result     MEDIUMTEXT,
      error_msg  TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW() ON UPDATE NOW()
    ) CHARACTER SET utf8mb4
  `);

  // users 表新增 brand_name 字段
  try {
    await db.query('ALTER TABLE users ADD COLUMN brand_name VARCHAR(200) DEFAULT NULL');
  } catch (e) {
    if (!String(e.message || e).includes('Duplicate column name')) console.warn('[initDb] brand_name:', e.message || e);
  }

  // users.password 改为可空（验证码注册的用户没有密码）
  try {
    await db.query("ALTER TABLE users MODIFY COLUMN password TEXT NULL DEFAULT NULL");
  } catch (e) {
    console.warn('[initDb] modify password nullable:', e.message || e);
  }

  // 短信验证码表
  await db.query(`
    CREATE TABLE IF NOT EXISTS sms_codes (
      id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      phone      VARCHAR(20) NOT NULL,
      code       VARCHAR(10) NOT NULL,
      type       VARCHAR(20) NOT NULL DEFAULT 'login',
      expires_at TIMESTAMP NOT NULL,
      used       TINYINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      INDEX idx_phone_created (phone, created_at)
    ) CHARACTER SET utf8mb4
  `);

  // industries 表新增 collect_keywords 字段（采集关键词，逗号分隔）
  try {
    await db.query('ALTER TABLE industries ADD COLUMN collect_keywords TEXT DEFAULT NULL');
  } catch (e) {
    if (!String(e.message || e).includes('Duplicate column name')) console.warn('[initDb] collect_keywords:', e.message || e);
  }

  // 定时采集 & 暂停标志
  await db.query(`INSERT IGNORE INTO system_config (config_key, value) VALUES ('collect_schedule', '')`);
  await db.query(`INSERT IGNORE INTO system_config (config_key, value) VALUES ('collect_paused', '0')`);
  await db.query(`INSERT IGNORE INTO system_config (config_key, value) VALUES ('collect_pending_industry', '')`);
  await db.query(`INSERT IGNORE INTO system_config (config_key, value) VALUES ('collect_state_json', '')`);

  // task_sessions 表（克隆任务跨会话状态：语音/数字人/后期/封面的中间产物与步骤进度）
  // LONGTEXT 最大 4GB，够存 base64 音视频；clone_step 冗余出来便于列表页直接用
  await db.query(`
    CREATE TABLE IF NOT EXISTS task_sessions (
      task_id      VARCHAR(36) NOT NULL,
      user_id      INT NOT NULL,
      clone_step   INT NOT NULL DEFAULT 2,
      session_json LONGTEXT NOT NULL,
      updated_at   TIMESTAMP DEFAULT NOW() ON UPDATE NOW(),
      PRIMARY KEY (task_id, user_id),
      INDEX idx_user_updated (user_id, updated_at)
    ) CHARACTER SET utf8mb4
  `);

  // user_videos 表（OSS存储：每用户最多保留 N 条视频，超出自动删最旧）
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_videos (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      task_id    VARCHAR(36) NOT NULL,
      oss_key    VARCHAR(512) NOT NULL,
      oss_url    VARCHAR(1024) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      INDEX idx_user_created (user_id, created_at),
      UNIQUE KEY uk_task (task_id)
    ) CHARACTER SET utf8mb4
  `);

  console.log('✅ 数据库初始化完成');
}

module.exports = initDb;
