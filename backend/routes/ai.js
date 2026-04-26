const express = require('express');
const db = require('../db');
const jwt = require('jsonwebtoken');
const { requireAuth } = require('./auth');
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';

const PUBLIC_TUNNEL_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'XiaMuagent-Backend/1.0',
};

async function readServiceError(resp, fallback = '本地服务返回异常') {
  const text = await resp.text().catch(() => '');
  if (!text) return `${fallback}（HTTP ${resp.status}）`;
  try {
    const data = JSON.parse(text);
    let detail = data.detail || data.msg || data.error;
    if (typeof detail === 'string' && detail.trim().startsWith('{')) {
      try {
        const nested = JSON.parse(detail);
        detail = nested.detail || nested.msg || nested.error || detail;
      } catch (_) {}
    }
    if (Array.isArray(detail)) return detail.map(x => x.msg || JSON.stringify(x)).join('；').slice(0, 300);
    if (detail) return String(detail).slice(0, 300);
  } catch (_) {}
  if (text.includes('<!DOCTYPE')) return `${fallback}：公网穿透地址返回了网页，请检查 asr_url 是否指向本地 ASR 接口`;
  return text.slice(0, 300);
}

// ==================== 获取 AI 配置 ====================
async function getAIConfig() {
  const keys = ['ai_provider','openai_api_key','openai_base_url','openai_model',
    'claude_api_key','claude_model','qwen_api_key','qwen_model',
    'zhipu_api_key','zhipu_model','deepseek_api_key','deepseek_model'];
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

  if (provider === 'deepseek') {
    const apiKey = cfg.deepseek_api_key;
    const model = cfg.deepseek_model || 'deepseek-chat';
    if (!apiKey) throw new Error('DeepSeek Key 未配置，请在后台填写 deepseek_api_key');
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.8, max_tokens: 1000 })
    });
    if (!response.ok) throw new Error(`DeepSeek 接口错误: ${await response.text()}`);
    const data = await response.json();
    const dc = data.choices?.[0]?.message?.content;
    if (!dc) throw new Error(`DeepSeek 返回内容异常: ${JSON.stringify(data).slice(0, 400)}`);
    return dc;
  }

  throw new Error(`不支持的 AI 提供商: ${provider}，请在后台选择 openai / qwen / claude / zhipu / deepseek 并配置对应 Key`);
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

// ==================== 语音合成 TTS（多通道）====================
// 优先级：Fish Audio 克隆音色 → 本地 edge-tts → OpenAI tts-1 兜底
router.post('/tts', requireAuth, async (req, res) => {
  const { text, voice, speed, cloneVoiceId } = req.body;
  if (!text?.trim()) return res.json({ code: 400, msg: '文案内容不能为空' });
  const trimText = text.trim().slice(0, 4096);

  // ===== 通道1：Fish Audio 克隆音色 =====
  if (cloneVoiceId) {
    try {
      const { rows } = await db.query("SELECT value FROM system_config WHERE config_key='fish_audio_api_key'");
      const fishKey = (rows[0]?.value || '').trim();
      if (!fishKey) return res.json({ code: 400, msg: '未配置 Fish Audio API Key，请管理员在后台填写 fish_audio_api_key' });

      const fishRes = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${fishKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimText, reference_id: cloneVoiceId, format: 'mp3', streaming: false }),
        signal: AbortSignal.timeout(120000),
      });
      if (!fishRes.ok) {
        const errText = await fishRes.text();
        return res.json({ code: 500, msg: `Fish Audio 合成失败: ${errText.slice(0, 200)}` });
      }
      const buf = await fishRes.arrayBuffer();
      return res.json({ code: 200, data: { audio: Buffer.from(buf).toString('base64'), format: 'mp3' } });
    } catch (e) {
      return res.json({ code: 500, msg: `Fish Audio 出错: ${e.message}` });
    }
  }

  // ===== 通道2：IndexTTS 本地克隆音色（异步任务模式，绕过网关超时）=====
  if (voice === 'indextts') {
    const { rows: asrRows } = await db.query("SELECT value FROM system_config WHERE config_key='asr_url'");
    const asrUrl = (asrRows[0]?.value || '').trim();
    if (!asrUrl) return res.json({ code: 500, msg: 'IndexTTS 需要本地 ASR 服务，请在后台配置 asr_url' });
    const { indexRefAudio, indexEmotion, indexEmoAlpha } = req.body;
    if (!indexRefAudio) return res.json({ code: 400, msg: '请先上传参考音频（你的声音样本）才能使用克隆音色' });
    try {
      const resp = await fetch(`${asrUrl}/tts/indextts/submit`, {
        method: 'POST',
        headers: PUBLIC_TUNNEL_HEADERS,
        body: JSON.stringify({ text: trimText, prompt_audio: indexRefAudio, emotion: indexEmotion || 'neutral', emo_alpha_override: indexEmoAlpha != null ? parseFloat(indexEmoAlpha) : null, speed: parseFloat(speed) || 1.0 }),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) {
        const errText = await readServiceError(resp, 'IndexTTS 提交失败');
        return res.json({ code: 500, msg: `IndexTTS 提交失败: ${errText.slice(0, 300)}` });
      }
      const data = await resp.json();
      if (!data.task_id) return res.json({ code: 500, msg: 'IndexTTS 未返回 task_id' });
      return res.json({ code: 202, task_id: data.task_id, asr_url: asrUrl });
    } catch (e) {
      return res.json({ code: 500, msg: `IndexTTS 提交失败: ${e.message}` });
    }
  }

  // ===== 通道3：本地 edge-tts（经由 ASR 服务器）=====
  try {
    const { rows: asrRows } = await db.query("SELECT value FROM system_config WHERE config_key='asr_url'");
    const asrUrl = (asrRows[0]?.value || '').trim();
    if (asrUrl) {
      const edgeRate = Math.max(-50, Math.min(100, Math.round(((parseFloat(speed) || 1.0) - 1.0) * 100)));
      const resp = await fetch(`${asrUrl}/tts/synthesize`, {
        method: 'POST',
        headers: PUBLIC_TUNNEL_HEADERS,
        body: JSON.stringify({ text: trimText, voice: voice || 'xiaoxiao', rate: edgeRate }),
        signal: AbortSignal.timeout(60000),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.audio) return res.json({ code: 200, data: { audio: data.audio, format: 'mp3' } });
      }
    }
  } catch (_) { /* 降级到下一通道 */ }

  // ===== 通道3：OpenAI tts-1 兜底 =====
  const cfg = await getAIConfig();
  if (!cfg.openai_api_key) {
    return res.json({ code: 500, msg: '语音合成失败：本地 ASR 服务未启动，且未配置 OpenAI Key。请启动本地 ASR 服务或在后台配置 OpenAI Key。' });
  }
  const baseUrl = cfg.openai_base_url || 'https://api.openai.com/v1';
  const voiceMap = { xiaoxiao: 'nova', yunjian: 'onyx', xiaoyi: 'nova', yunxi: 'alloy', yunyang: 'echo' };
  const ttsVoice = voiceMap[voice] || 'nova';
  const ttsSpeed = Math.min(Math.max(parseFloat(speed) || 1.0, 0.25), 4.0);
  try {
    const response = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.openai_api_key}` },
      body: JSON.stringify({ model: 'tts-1', input: trimText, voice: ttsVoice, speed: ttsSpeed, response_format: 'mp3' }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      const errText = await response.text();
      return res.json({ code: 500, msg: `语音合成失败: ${errText.slice(0, 200)}` });
    }
    const buf = await response.arrayBuffer();
    return res.json({ code: 200, data: { audio: Buffer.from(buf).toString('base64'), format: 'mp3' } });
  } catch (e) {
    return res.json({ code: 500, msg: `语音合成出错: ${e.message}` });
  }
});

// ==================== 音色克隆（Fish Audio）====================
router.post('/tts/clone', requireAuth, async (req, res) => {
  const { audio, audioName } = req.body;
  if (!audio) return res.json({ code: 400, msg: '请提供音频数据' });

  const { rows } = await db.query("SELECT value FROM system_config WHERE config_key='fish_audio_api_key'");
  const fishKey = (rows[0]?.value || '').trim();
  if (!fishKey) return res.json({ code: 400, msg: '管理员尚未配置 Fish Audio API Key，无法使用音色克隆功能' });

  try {
    const audioBuffer = Buffer.from(audio, 'base64');
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
    formData.append('title', audioName || '我的克隆音色');
    formData.append('train_mode', 'fast');
    formData.append('enhance_audio_quality', 'true');
    formData.append('voices', blob, 'sample.mp3');

    const resp = await fetch('https://api.fish.audio/model', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${fishKey}` },
      body: formData,
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return res.json({ code: 500, msg: `Fish Audio 克隆失败: ${errText.slice(0, 200)}` });
    }
    const data = await resp.json();
    const voiceId = data._id || data.id;
    if (!voiceId) return res.json({ code: 500, msg: `Fish Audio 返回异常: ${JSON.stringify(data).slice(0, 200)}` });
    return res.json({ code: 200, data: { voice_id: voiceId } });
  } catch (e) {
    return res.json({ code: 500, msg: `音色克隆出错: ${e.message}` });
  }
});

// ==================== 发布信息生成（标题+话题标签）====================
// 封面短标题（≤8字）
router.post('/cover-title', requireAuth, async (req, res) => {
  const { script } = req.body;
  if (!script?.trim()) return res.json({ code: 400, msg: '文案不能为空' });
  try {
    const prompt = `根据以下短视频文案，生成一句封面标题。要求：不超过8个字，无标点符号，吸引眼球，直击核心价值点，适合放在视频封面上。只输出标题文字本身，不要引号和解释。\n\n文案：${script.slice(0, 400)}`;
    const raw = await callAI(prompt);
    const title = raw.trim().replace(/["""''《》【】「」\n\r]/g, '').slice(0, 8);
    return res.json({ code: 200, data: { title } });
  } catch (e) {
    return res.json({ code: 500, msg: e.message });
  }
});

router.post('/publish-info', requireAuth, async (req, res) => {
  const { script } = req.body;
  if (!script?.trim()) return res.json({ code: 400, msg: '文案内容不能为空' });

  try {
    const prompt = `根据以下短视频文案，生成：
1. 一个吸引人的发布标题（15-28字，不加引号）
2. 4-6个相关话题标签（不带#号，每个2-6字）

文案内容：
${script.slice(0, 800)}

严格按JSON格式返回，不要其他内容：
{"title": "...", "tags": ["标签1", "标签2", "标签3", "标签4"]}`;

    const raw = await callAI(prompt);
    let result = {};
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(cleaned);
    } catch {
      result = { title: script.slice(0, 25) + '...', tags: [] };
    }
    return res.json({ code: 200, data: { title: result.title || '', tags: result.tags || [] } });
  } catch (e) {
    return res.json({ code: 500, msg: e.message });
  }
});

// 返回数字人视频服务地址（video_url 优先，无则降级到 asr_url）
router.get('/asr-url', requireAuth, async (req, res) => {
  const { rows } = await db.query("SELECT config_key, value FROM system_config WHERE config_key IN ('asr_url','video_url')");
  const cfg = {};
  rows.forEach(r => { cfg[r.config_key] = (r.value || '').trim(); });
  const url = cfg.video_url || cfg.asr_url || '';
  if (!url) return res.json({ code: 500, msg: '请在后台配置数字人服务地址（video_url）' });
  return res.json({ code: 200, data: { url } });
});

function normalizeServiceUrl(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

const VIDEO_FETCH_HEADERS = {
  'User-Agent': 'XiaMuagent-Zeabur/1.0',
  'Accept': 'application/json',
};

// 获取视频服务 URL 的内部工具函数：优先使用真正返回 /health JSON 的地址，避免 video_url 配成网页域名。
// 探活结果缓存 60 秒，避免每次轮询都做跨境探活（Zeabur → 阿里云 延迟较高，频繁探活会引发"连接不稳定"）
let _videoUrlCache = { url: '', expires: 0 };
const VIDEO_URL_CACHE_TTL = 60 * 1000; // 60 秒

async function getVideoUrl() {
  const now = Date.now();
  if (_videoUrlCache.url && _videoUrlCache.expires > now) {
    return _videoUrlCache.url;
  }

  const { rows } = await db.query("SELECT config_key, value FROM system_config WHERE config_key IN ('asr_url','video_url')");
  const cfg = {};
  rows.forEach(r => { cfg[r.config_key] = normalizeServiceUrl(r.value); });
  const candidates = [...new Set([cfg.video_url, cfg.asr_url].filter(Boolean))];
  if (!candidates.length) return '';

  let picked = '';
  for (const url of candidates) {
    try {
      const resp = await fetch(`${url}/health`, {
        headers: VIDEO_FETCH_HEADERS,
        signal: AbortSignal.timeout(10000),
      });
      const ct = resp.headers.get('content-type') || '';
      if (!resp.ok || !ct.includes('application/json')) continue;
      const data = await resp.json();
      if (data && data.status === 'ok') { picked = url; break; }
    } catch {}
  }

  if (!picked) picked = candidates[0];
  _videoUrlCache = { url: picked, expires: now + VIDEO_URL_CACHE_TTL };
  return picked;
}

// 暴露给后台配置改动后立即失效缓存（admin 改 video_url/asr_url 时可调用）
function invalidateVideoUrlCache() {
  _videoUrlCache = { url: '', expires: 0 };
}
router.invalidateVideoUrlCache = invalidateVideoUrlCache;

function htmlServiceError(url, text) {
  const hint = text && text.includes('<!DOCTYPE')
    ? '当前数字人地址返回的是网页，不是本地视频接口。请检查后台 video_url/asr_url，必须指向 frp/heygem 穿透地址（如 http://heygem.yyagent.top），并能打开 /health 返回 JSON。'
    : '数字人接口返回内容异常，请检查后台 video_url/asr_url 配置。';
  return `${hint} 当前地址：${url}`;
}

// ==================== 数字人视频生成 ====================
router.post('/video/generate', requireAuth, async (req, res) => {
  const { audio_b64, video_b64, avatar_key, audio_fmt, video_fmt, enhancer } = req.body;
  if (!audio_b64) return res.json({ code: 400, msg: '请先完成语音合成' });
  if (!video_b64 && !avatar_key) return res.json({ code: 400, msg: '请上传或选择数字人视频' });
  if (audio_b64.length > 6 * 1024 * 1024) return res.json({ code: 400, msg: '音频过大（>4.5MB），请缩短语音' });
  if (video_b64 && video_b64.length > 70 * 1024 * 1024) return res.json({ code: 400, msg: '视频过大（>50MB），请压缩后上传' });

  const videoUrl = await getVideoUrl();
  if (!videoUrl) return res.json({ code: 500, msg: '请在后台配置数字人服务地址（video_url）' });

  try {
    const resp = await fetch(`${videoUrl}/video/generate`, {
      method: 'POST',
      headers: { ...VIDEO_FETCH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_b64,
        audio_fmt: audio_fmt || 'wav',
        enhancer: !!enhancer,
        ...(avatar_key ? { avatar_key } : { video_b64, video_fmt: video_fmt || 'mp4' }),
      }),
      signal: AbortSignal.timeout(120000),
    });
    const text = await resp.text();
    if (!resp.ok) {
      return res.json({ code: 500, msg: text.includes('<!DOCTYPE') ? htmlServiceError(videoUrl, text) : `视频服务出错: ${text.slice(0, 200)}` });
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.json({ code: 500, msg: htmlServiceError(videoUrl, text) });
    }
    return res.json({ code: 200, data });
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('503') || msg.includes('ECONNREFUSED')) return res.json({ code: 503, msg: '数字人服务未启动，请检查本机服务是否运行' });
    return res.json({ code: 500, msg: `视频生成出错: ${msg}` });
  }
});

router.get('/video/task/:taskId', requireAuth, async (req, res) => {
  const { taskId } = req.params;
  const videoUrl = await getVideoUrl();
  if (!videoUrl) return res.json({ code: 500, msg: '未配置数字人服务地址' });

  try {
    const resp = await fetch(`${videoUrl}/video/task/${taskId}`, { headers: VIDEO_FETCH_HEADERS, signal: AbortSignal.timeout(45000) });
    const text = await resp.text();
    if (!resp.ok) return res.json({ code: 500, msg: text.includes('<!DOCTYPE') ? htmlServiceError(videoUrl, text) : '查询失败' });
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.json({ code: 500, msg: htmlServiceError(videoUrl, text) });
    }
    // 生成完成时，把直连下载 URL 注入给前端（浏览器直接从 heygem 公网地址下载，走下行带宽，不走 Zeabur 中转）
    if (data && data.status === 'done') {
      data.video_direct_url = `${videoUrl}/video/file/${taskId}`;
    }
    return res.json({ code: 200, data });
  } catch (e) {
    return res.json({ code: 500, msg: `轮询失败: ${e.message}` });
  }
});

// 视频流式代理（token 放 URL 参数，解决 video src 无法带 Authorization header 的问题）
// 同时转发 Range 请求，支持浏览器拖动进度条
router.get('/video/stream/:taskId', async (req, res) => {
  const token = req.query.t || '';
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.id;
  } catch {
    return res.status(401).json({ code: 401, msg: 'token 无效' });
  }
  const { taskId } = req.params;
  const videoUrl = await getVideoUrl();
  if (!videoUrl) return res.status(500).json({ code: 500, msg: '未配置数字人服务地址' });
  const upHeaders = { ...VIDEO_FETCH_HEADERS };
  if (req.headers.range) upHeaders['Range'] = req.headers.range;
  try {
    const resp = await fetch(`${videoUrl}/video/file/${taskId}`, {
      headers: upHeaders,
      signal: AbortSignal.timeout(600000),
    });
    res.status(resp.status);
    res.setHeader('Content-Type', resp.headers.get('content-type') || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (resp.headers.get('content-length')) res.setHeader('Content-Length', resp.headers.get('content-length'));
    if (resp.headers.get('content-range')) res.setHeader('Content-Range', resp.headers.get('content-range'));
    const { Readable } = require('stream');
    Readable.fromWeb(resp.body).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ code: 500, msg: `流式失败: ${e.message}` });
  }
});

router.post('/video/cancel/:taskId', requireAuth, async (req, res) => {
  const { taskId } = req.params;
  const videoUrl = await getVideoUrl();
  if (!videoUrl) return res.json({ code: 500, msg: '未配置数字人服务地址' });

  try {
    const resp = await fetch(`${videoUrl}/video/cancel/${taskId}`, {
      method: 'POST',
      headers: VIDEO_FETCH_HEADERS,
      signal: AbortSignal.timeout(30000),
    });
    const text = await resp.text();
    if (!resp.ok) return res.json({ code: 500, msg: text.includes('<!DOCTYPE') ? htmlServiceError(videoUrl, text) : '取消失败' });
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.json({ code: 500, msg: htmlServiceError(videoUrl, text) });
    }
    return res.json({ code: 200, data });
  } catch (e) {
    return res.json({ code: 500, msg: `取消失败: ${e.message}` });
  }
});

// 字幕烧录代理（前端是 HTTPS，不能直连 HTTP 的 ASR，需走 Zeabur 中转）
router.post('/video/postprocess', requireAuth, async (req, res) => {
  const { rows } = await db.query("SELECT value FROM system_config WHERE config_key='asr_url'");
  const asrUrl = (rows[0]?.value || '').trim();
  if (!asrUrl) return res.json({ code: 500, msg: '未配置 asr_url' });
  try {
    const resp = await fetch(`${asrUrl}/video/postprocess`, {
      method: 'POST',
      headers: { ...PUBLIC_TUNNEL_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(300000), // 5 分钟
    });
    if (!resp.ok) {
      const text = await resp.text();
      return res.json({ code: 500, msg: `字幕烧录失败: ${text.slice(0, 300)}` });
    }
    const data = await resp.json();
    return res.json({ code: 200, data });
  } catch (e) {
    const isTimeout = e.message && (e.message.includes('timeout') || e.message.includes('aborted'));
    return res.json({ code: 500, msg: isTimeout ? '字幕烧录超时，视频较长时请重试' : `字幕烧录失败: ${e.message}` });
  }
});

// IndexTTS 异步任务轮询
router.get('/tts/indextts/task/:taskId', requireAuth, async (req, res) => {
  const { taskId } = req.params;
  const { rows } = await db.query("SELECT value FROM system_config WHERE config_key='asr_url'");
  const asrUrl = (rows[0]?.value || '').trim();
  if (!asrUrl) return res.json({ code: 500, msg: '未配置 asr_url' });
  try {
    const resp = await fetch(`${asrUrl}/tts/indextts/task/${taskId}`, {
      headers: PUBLIC_TUNNEL_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    const data = await resp.json();
    if (data.status === 'done') {
      return res.json({ code: 200, data: { audio: data.audio, format: data.format || 'wav' } });
    }
    if (data.status === 'error') {
      return res.json({ code: 500, msg: `IndexTTS 推理失败: ${data.error || '未知错误'}` });
    }
    return res.json({ code: 202, status: data.status });
  } catch (e) {
    return res.json({ code: 500, msg: `轮询失败: ${e.message}` });
  }
});

module.exports = router;
