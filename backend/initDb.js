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

  // AI 默认配置（INSERT IGNORE：仅首次插入，不覆盖管理后台已保存的选择）
  await db.query(
    `INSERT IGNORE INTO system_config (config_key, value) VALUES ('ai_provider', 'deepseek')`
  );
  await db.query(
    `INSERT IGNORE INTO system_config (config_key, value) VALUES ('deepseek_api_key', 'sk-49991c5474b14a2aa47f60541765f04d')`
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

  // tasks 表新增 last_operated_at（用户主动操作时刷新，大卡判断依据）
  try {
    await db.query('ALTER TABLE tasks ADD COLUMN last_operated_at TIMESTAMP NULL DEFAULT NULL');
  } catch (e) {
    if (!String(e.message || e).includes('Duplicate column name')) console.warn('[initDb] last_operated_at:', e.message || e);
  }

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

  // avatar_library 表（数字人形象库：OSS存储，跨设备持久）
  await db.query(`
    CREATE TABLE IF NOT EXISTS avatar_library (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      name        VARCHAR(100) NOT NULL,
      oss_key     VARCHAR(512) NOT NULL,
      oss_url     VARCHAR(1024) NOT NULL,
      thumb_url   VARCHAR(1024) DEFAULT NULL,
      created_at  TIMESTAMP DEFAULT NOW(),
      INDEX idx_user_created (user_id, created_at)
    ) CHARACTER SET utf8mb4
  `);

  // user_voices 表（声音库，跨设备持久）
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_voices (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      voice_key  VARCHAR(100) NOT NULL,
      name       VARCHAR(100) NOT NULL,
      emotion    VARCHAR(50) DEFAULT 'neutral',
      audio_b64  MEDIUMTEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      INDEX idx_user (user_id)
    ) CHARACTER SET utf8mb4
  `);

  // avatar_library 表：补 avatar_key / thumbnail 列，oss 列改可空
  try { await db.query('ALTER TABLE avatar_library ADD COLUMN avatar_key VARCHAR(512) DEFAULT NULL'); } catch(e) { if (!String(e.message||e).includes('Duplicate')) console.warn('[initDb] avatar_key:', e.message||e); }
  try { await db.query('ALTER TABLE avatar_library ADD COLUMN thumbnail MEDIUMTEXT DEFAULT NULL'); } catch(e) { if (!String(e.message||e).includes('Duplicate')) console.warn('[initDb] thumbnail:', e.message||e); }
  try { await db.query('ALTER TABLE avatar_library MODIFY COLUMN oss_key VARCHAR(512) DEFAULT NULL'); } catch(e) { console.warn('[initDb] oss_key nullable:', e.message||e); }
  try { await db.query('ALTER TABLE avatar_library MODIFY COLUMN oss_url VARCHAR(1024) DEFAULT NULL'); } catch(e) { console.warn('[initDb] oss_url nullable:', e.message||e); }

  // users 表：补 clone_voice_id 列
  try { await db.query('ALTER TABLE users ADD COLUMN clone_voice_id VARCHAR(255) DEFAULT NULL'); } catch(e) { if (!String(e.message||e).includes('Duplicate')) console.warn('[initDb] clone_voice_id:', e.message||e); }

  // ═══════════════════════════════════════════════════════════════════
  // 原创工坊 cw_* 表
  // ═══════════════════════════════════════════════════════════════════

  // ── 改写历史 ──────────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS cw_history (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      source_type VARCHAR(20) DEFAULT 'manual',
      original    TEXT,
      rewritten   TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 用户积分余额 ───────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS cw_user_credits (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL UNIQUE,
      credits    INT NOT NULL DEFAULT 100,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 积分流水 ───────────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS cw_credit_logs (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      amount     INT NOT NULL,
      action     VARCHAR(50) NOT NULL,
      note       VARCHAR(200) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 激活码 ────────────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS cw_activation_codes (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      code           VARCHAR(32) NOT NULL UNIQUE,
      credits_amount INT NOT NULL DEFAULT 100,
      is_used        TINYINT(1) DEFAULT 0,
      used_by        INT DEFAULT NULL,
      used_at        DATETIME DEFAULT NULL,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 激活码类型（credits=积分码 / premium=进阶解锁码）+ 进阶天数（0=永久全开）
  try { await db.query("ALTER TABLE cw_activation_codes ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'credits'"); } catch(e) { if (!String(e.message||e).includes('Duplicate')) console.warn('[initDb] cw type:', e.message||e); }
  try { await db.query('ALTER TABLE cw_activation_codes ADD COLUMN premium_days INT NOT NULL DEFAULT 0'); } catch(e) { if (!String(e.message||e).includes('Duplicate')) console.warn('[initDb] cw premium_days:', e.message||e); }

  // ── 用户进阶权限 ──────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS cw_user_premium (
      user_id       INT NOT NULL UNIQUE,
      premium_until DATETIME DEFAULT NULL,
      granted_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 智能体配置 ────────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS cw_agents (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      name              VARCHAR(50) NOT NULL,
      description       VARCHAR(200) DEFAULT '',
      image_url         VARCHAR(500) DEFAULT '',
      emoji             VARCHAR(10) DEFAULT '🤖',
      coze_workflow_id  VARCHAR(100) DEFAULT '',
      coze_url          VARCHAR(500) DEFAULT '',
      input_fields      JSON,
      output_type       VARCHAR(20) DEFAULT 'text',
      credits_cost      INT NOT NULL DEFAULT 5,
      sort_order        INT DEFAULT 0,
      is_active         TINYINT(1) DEFAULT 1,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 智能体使用记录 ────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS cw_agent_logs (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      agent_id   INT NOT NULL,
      input      TEXT,
      output     TEXT,
      status     VARCHAR(20) DEFAULT 'success',
      credits    INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_agent (agent_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 预置小工具（仅首次）──────────────────────────────────────────────────
  const { rows: existingAgents } = await db.query('SELECT id, name FROM cw_agents');
  const OLD_PLACEHOLDERS = ['儿童绘本', '萌宠视频', '电商图片', '素材生成'];
  const onlyOldOrEmpty = existingAgents.length === 0 || existingAgents.every(a => OLD_PLACEHOLDERS.includes(a.name));
  const hasNewSet = existingAgents.some(a => a.name === '标题党生成器');

  if (onlyOldOrEmpty && !hasNewSet) {
    await db.query("DELETE FROM cw_agents WHERE name IN ('儿童绘本','萌宠视频','电商图片','素材生成')");
    const agents = [
      { name: '标题党生成器', description: '一句话生成 10 个高点击标题', credits_cost: 2, sort_order: 1,
        input_fields: JSON.stringify([{ key: 'topic', label: '主题/内容', type: 'textarea', placeholder: '用一句话描述你的内容或主题...' }]) },
      { name: '黄金开头钩子', description: '3 秒抓住眼球的开场白', credits_cost: 2, sort_order: 2,
        input_fields: JSON.stringify([{ key: 'topic', label: '视频主题', type: 'text', placeholder: '例如：减脂餐、职场穿搭、旅行攻略...' }]) },
      { name: '选题灵感库', description: '按赛道挖掘当下热门选题', credits_cost: 1, sort_order: 3,
        input_fields: JSON.stringify([{ key: 'industry', label: '赛道/行业', type: 'text', placeholder: '例如：母婴、美妆、数码、健身...' }]) },
      { name: '评论区神回复', description: '高情商互动，养号涨粉', credits_cost: 1, sort_order: 4,
        input_fields: JSON.stringify([{ key: 'comment', label: '原评论', type: 'textarea', placeholder: '粘贴需要回复的评论内容...' }]) },
      { name: '关键词标签', description: '智能推荐高流量话题标签', credits_cost: 1, sort_order: 5,
        input_fields: JSON.stringify([{ key: 'content', label: '内容描述', type: 'textarea', placeholder: '描述你的内容，生成相关话题标签...' }]) },
      { name: '一键润色', description: '把口水话改成有质感的表达', credits_cost: 2, sort_order: 6,
        input_fields: JSON.stringify([{ key: 'text', label: '原文', type: 'textarea', placeholder: '粘贴需要润色的文案...' }]) }
    ];
    for (const a of agents) {
      await db.query(
        'INSERT INTO cw_agents (name, description, emoji, output_type, credits_cost, sort_order, input_fields) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [a.name, a.description, '', 'text', a.credits_cost, a.sort_order, a.input_fields]
      );
    }
    console.log('[DB] 已预置 6 个轻量小工具');
  }

  // ── Skill 文档 ────────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS cw_skills (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL UNIQUE,
      version    VARCHAR(20) DEFAULT 'v1.0',
      rules      JSON,
      keywords   JSON,
      forbidden  JSON,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 原创工坊项目 ──────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS cw_original_projects (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      title      VARCHAR(255) NOT NULL,
      brief      TEXT,
      status     VARCHAR(20) DEFAULT 'draft',
      doc        LONGTEXT,
      turns      INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 项目对话消息 ──────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS cw_original_messages (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      project_id     INT NOT NULL,
      role           VARCHAR(20) NOT NULL,
      content        TEXT NOT NULL,
      has_doc_update TINYINT DEFAULT 0,
      sync_label     VARCHAR(100) DEFAULT NULL,
      sync_done      VARCHAR(20) DEFAULT NULL,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // cw_materials 表：素材库（存竞品原文，永久保留）
  await db.query(`
    CREATE TABLE IF NOT EXISTS cw_materials (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      user_id      INT NOT NULL,
      title        VARCHAR(200) NOT NULL DEFAULT '',
      source_url   VARCHAR(500) DEFAULT NULL,
      source_type  VARCHAR(20)  DEFAULT 'text',
      raw_content  MEDIUMTEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // cw_original_projects 表：补 meta 列（存时长/风格/平台等）
  try { await db.query('ALTER TABLE cw_original_projects ADD COLUMN meta JSON DEFAULT NULL'); } catch(e) { if (!String(e.message||e).includes('Duplicate')) console.warn('[initDb] cw_original_projects.meta:', e.message||e); }
  // cw_original_messages 表：补 auto_learn 列（自动学习提炼的规则）
  try { await db.query('ALTER TABLE cw_original_messages ADD COLUMN auto_learn TEXT DEFAULT NULL'); } catch(e) { if (!String(e.message||e).includes('Duplicate')) console.warn('[initDb] cw_original_messages.auto_learn:', e.message||e); }

  // cw_skills 表：补 check_prompt / free_text / free_text_history 列
  try { await db.query('ALTER TABLE cw_skills ADD COLUMN check_prompt TEXT DEFAULT NULL'); } catch(e) { if (!String(e.message||e).includes('Duplicate')) console.warn('[initDb] check_prompt:', e.message||e); }
  try { await db.query('ALTER TABLE cw_skills ADD COLUMN free_text MEDIUMTEXT DEFAULT NULL'); } catch(e) { if (!String(e.message||e).includes('Duplicate')) console.warn('[initDb] free_text:', e.message||e); }
  try { await db.query('ALTER TABLE cw_skills ADD COLUMN free_text_history JSON DEFAULT NULL'); } catch(e) { if (!String(e.message||e).includes('Duplicate')) console.warn('[initDb] free_text_history:', e.message||e); }

  console.log('✅ 数据库初始化完成');
}

module.exports = initDb;
