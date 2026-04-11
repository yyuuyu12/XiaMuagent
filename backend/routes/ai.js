const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const router = express.Router();

// ==================== 获取 AI 配置 ====================
async function getAIConfig() {
  const keys = ['ai_provider','openai_api_key','openai_base_url','openai_model',
    'claude_api_key','claude_model','qwen_api_key','qwen_model',
    'zhipu_api_key','zhipu_model'];
  const cfg = {};
  for (const k of keys) {
    const { rows } = await db.query('SELECT value FROM system_config WHERE config_key = $1', [k]);
    cfg[k] = rows[0]?.value || '';
  }
  return cfg;
}

// ==================== 每日次数检查 ====================
async function checkAndRecordUsage(userId, action) {
  const { rows } = await db.query('SELECT daily_limit, role FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  if (!user) return { ok: false, msg: '用户不存在，请重新登录' };

  if (user.role === 'admin') {
    await db.query('INSERT INTO usage_logs (user_id, action) VALUES ($1, $2)', [userId, action]);
    return { ok: true, remaining: 999 };
  }

  const { rows: usageRows } = await db.query(
    'SELECT COUNT(*) AS cnt FROM usage_logs WHERE user_id = $1 AND DATE(created_at) = CURRENT_DATE',
    [userId]
  );
  const used = parseInt(usageRows[0].cnt);

  if (used >= user.daily_limit) {
    return { ok: false, msg: `今日免费次数已用完（${user.daily_limit}次），明日再来~` };
  }

  await db.query('INSERT INTO usage_logs (user_id, action) VALUES ($1, $2)', [userId, action]);
  return { ok: true, remaining: user.daily_limit - used - 1 };
}

// ==================== 调用 AI ====================
async function callAI(prompt) {
  const cfg = await getAIConfig();
  const provider = cfg.ai_provider || 'openai';

  if (provider === 'openai' || provider === 'qwen') {
    const apiKey = provider === 'openai' ? cfg.openai_api_key : cfg.qwen_api_key;
    const baseUrl = cfg.openai_base_url || 'https://api.openai.com/v1';
    const model = provider === 'openai' ? (cfg.openai_model || 'gpt-3.5-turbo') : (cfg.qwen_model || 'qwen-turbo');
    if (!apiKey) throw new Error('AI Key 未配置，请联系管理员');

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.8, max_tokens: 1000 })
    });
    if (!response.ok) throw new Error(`AI 接口错误: ${await response.text()}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`AI 返回内容异常: ${JSON.stringify(data).slice(0, 400)}`);
    return content;
  }

  if (provider === 'claude') {
    const apiKey = cfg.claude_api_key;
    const model = cfg.claude_model || 'claude-3-5-haiku-20241022';
    if (!apiKey) throw new Error('Claude Key 未配置，请联系管理员');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
    });
    if (!response.ok) throw new Error(`Claude 接口错误: ${await response.text()}`);
    const data = await response.json();
    const text = data.content?.[0]?.text;
    if (!text) throw new Error(`Claude 返回内容异常: ${JSON.stringify(data).slice(0, 400)}`);
    return text;
  }

  if (provider === 'zhipu' || provider === 'glm') {
    const apiKey = cfg.zhipu_api_key;
    const model = cfg.zhipu_model || 'glm-4-flash';
    if (!apiKey) throw new Error('智谱 AI Key 未配置，请在后台填写 zhipu_api_key');

    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] })
    });
    if (!response.ok) throw new Error(`智谱接口错误: ${await response.text()}`);
    const data = await response.json();
    const zc = data.choices?.[0]?.message?.content;
    if (!zc) throw new Error(`智谱返回内容异常: ${JSON.stringify(data).slice(0, 400)}`);
    return zc;
  }

  throw new Error(`不支持的 AI 提供商: ${provider}，请在后台选择 openai / qwen / claude / zhipu 并配置对应 Key`);
}

// ==================== 文案改写 ====================
router.post('/rewrite', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ code: 400, msg: '请输入文案内容' });

  const usage = await checkAndRecordUsage(req.userId, 'rewrite');
  if (!usage.ok) return res.status(429).json({ code: 429, msg: usage.msg });

  try {
    const { rows } = await db.query(
      `SELECT content FROM prompt_templates WHERE type = 'rewrite' AND is_default = 1`
    );
    const prompt = (rows[0]?.content || '请将以下文案改写为抖音爆款风格：\n{input}').replace('{input}', text);
    const result = await callAI(prompt);

    await db.query('INSERT INTO history (user_id, type, input, result) VALUES ($1,$2,$3,$4)',
      [req.userId, 'rewrite', text.slice(0, 200), JSON.stringify(result)]);

    res.json({ code: 200, data: { result, remaining: usage.remaining } });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// ==================== 灵感生成 ====================
router.post('/inspire', requireAuth, async (req, res) => {
  const { track, industryId } = req.body;
  if (!track?.trim() && !industryId) return res.status(400).json({ code: 400, msg: '请输入行业/赛道' });

  const usage = await checkAndRecordUsage(req.userId, 'inspire');
  if (!usage.ok) return res.status(429).json({ code: 429, msg: usage.msg });

  try {
    let styleHint = '';
    let matchedIndustry = null;
    const inputTrack = track?.trim() || '';

    if (industryId) {
      const { rows } = await db.query('SELECT * FROM industries WHERE id=$1', [industryId]);
      if (rows[0]) { styleHint = rows[0].style_hint || ''; matchedIndustry = rows[0].name; }
    } else if (inputTrack) {
      const { rows: industries } = await db.query('SELECT * FROM industries ORDER BY sort_order ASC, id ASC');
      if (industries.length > 0) {
        const names = industries.map(i => i.name).join('、');
        const matchPrompt = `行业列表：${names}\n\n用户输入："${inputTrack}"\n\n判断最匹配哪个行业，只回复行业名称。不匹配则回复"无"。`;
        const matchResult = (await callAI(matchPrompt)).trim().replace(/[。，,.！!]/g, '');
        const matched = industries.find(i => i.name === matchResult);
        if (matched) { styleHint = matched.style_hint || ''; matchedIndustry = matched.name; }
      }
    }

    const finalTrack = inputTrack || matchedIndustry || '通用';
    const styleSection = styleHint ? `\n创作风格要求：${styleHint}\n` : '';

    const prompt = `你是抖音顶级爆款文案创作者。请为"${finalTrack}"赛道生成4篇可以直接发布的爆款文案。
${styleSection}
严格按照以下JSON格式返回，不要返回任何其他内容：
[
  {
    "hook": "文案第一句话（强力开头，30字以内）",
    "content": "完整文案全文（从第一句话开始写，150-250字，口语化，有情绪价值，中间有干货，结尾有互动引导，可直接复制发布）"
  }
]

要求：
- content字段是完整的、可直接发布的文案全文，不是摘要或标题
- content第一句话就是hook内容，文案要连贯
- 4篇文案风格各异：疑问式、故事式、干货列表式、情绪共鸣式
- 适当使用emoji增加活泼感
- 只返回JSON数组，不要markdown代码块，不要其他文字`;

    const raw = await callAI(prompt);
    let scripts = [];
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      scripts = JSON.parse(cleaned);
      if (!Array.isArray(scripts)) scripts = [];
    } catch {
      scripts = [{ hook: finalTrack + ' 爆款文案', content: raw }];
    }

    await db.query('INSERT INTO history (user_id, type, input, result) VALUES ($1,$2,$3,$4)',
      [req.userId, 'inspire', inputTrack || matchedIndustry, JSON.stringify(scripts)]);

    res.json({ code: 200, data: { scripts, remaining: usage.remaining, matchedIndustry } });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// ==================== 按方向扩展 ====================
router.post('/inspire-expand', requireAuth, async (req, res) => {
  const { hook, content, track } = req.body;
  if (!hook) return res.status(400).json({ code: 400, msg: '参数缺失' });

  const usage = await checkAndRecordUsage(req.userId, 'inspire');
  if (!usage.ok) return res.status(429).json({ code: 429, msg: usage.msg });

  try {
    const prompt = `基于以下爆款文案方向，为"${track || '该赛道'}"再生成5个类似风格的文案变体。

参考文案：
钩子：${hook}
内容：${content || ''}

严格按JSON格式返回，不要其他内容：
[{"hook": "...", "content": "..."}]`;

    const raw = await callAI(prompt);
    let scripts = [];
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      scripts = JSON.parse(cleaned);
      if (!Array.isArray(scripts)) scripts = [];
    } catch {
      scripts = [{ hook: '变体文案', content: raw }];
    }

    await db.query('INSERT INTO history (user_id, type, input, result) VALUES ($1,$2,$3,$4)',
      [req.userId, 'inspire', `按方向扩展: ${hook}`, JSON.stringify(scripts)]);

    res.json({ code: 200, data: { scripts, remaining: usage.remaining } });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

module.exports = router;
