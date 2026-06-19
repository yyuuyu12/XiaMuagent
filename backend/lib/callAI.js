const db = require('../db');

// 记录一次 AI 调用的 token 用量（异步、不阻塞、不抛错）
// 兼容 OpenAI 风格(prompt_tokens/completion_tokens) 与 Claude 风格(input_tokens/output_tokens)
function logTokens(model, usage, opts) {
  try {
    if (!usage) return;
    const pt = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const ct = usage.completion_tokens ?? usage.output_tokens ?? 0;
    if (!pt && !ct) return;
    db.query(
      'INSERT INTO ai_token_logs (user_id, module, model, prompt_tokens, completion_tokens) VALUES (?,?,?,?,?)',
      [parseInt(opts.userId) || 0, String(opts.module || '').slice(0, 30), String(model || '').slice(0, 60), pt, ct]
    ).catch(() => {});
  } catch {}
}

async function getAIConfig() {
  const keys = [
    'ai_provider', 'openai_api_key', 'openai_base_url', 'openai_model',
    'claude_api_key', 'claude_model', 'qwen_api_key', 'qwen_model',
    'zhipu_api_key', 'zhipu_model', 'deepseek_api_key', 'deepseek_model',
    'max_tokens_cap',     // 各服务商的输出 token 上限，0 = 不限制
    'ai_model_creation',  // 创作类任务（方向/粗纲/细纲/剧本）专用模型，留空用默认
    'critic_enabled',     // 剧本质检开关 '1'/'0'
  ];
  const cfg = {};
  for (const k of keys) {
    const { rows } = await db.query('SELECT value FROM system_config WHERE config_key = $1', [k]);
    cfg[k] = rows[0]?.value || '';
  }
  return cfg;
}

async function callAI(prompt, opts = {}) {
  const cfg = await getAIConfig();
  const provider = cfg.ai_provider || 'openai';
  // max_tokens_cap: 管理后台可配置各服务商上限（如 xcode.best gpt-5.5 限制 1200）
  // 0 或不填 = 不限制；设置了就强制不超过该值
  const configCap = parseInt(cfg.max_tokens_cap || '0') || 0;
  const rawMax = opts.maxTokens || 2000;
  // opts.bypassCap=true 时忽略全局 max_tokens_cap（用于长稿剧本，避免被中转站默认上限静默砍断）
  const maxTokens = (configCap > 0 && !opts.bypassCap) ? Math.min(rawMax, configCap) : rawMax;

  if (provider === 'openai' || provider === 'qwen') {
    const apiKey = provider === 'openai' ? cfg.openai_api_key : cfg.qwen_api_key;
    const baseUrl = cfg.openai_base_url || 'https://api.openai.com/v1';
    // opts.model 覆盖配置中的默认模型名（用于给写稿环节单配一线模型）
    const model = opts.model || (provider === 'openai' ? (cfg.openai_model || 'gpt-3.5-turbo') : (cfg.qwen_model || 'qwen-turbo'));
    if (!apiKey) throw new Error('AI Key 未配置，请联系管理员');

    const body = { model, messages: [{ role: 'user', content: prompt }], temperature: opts.temperature || 0.8, max_tokens: maxTokens };
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`AI 接口错误: ${await response.text()}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`AI 返回内容异常: ${JSON.stringify(data).slice(0, 200)}`);
    logTokens(model, data.usage, opts);
    return content;
  }

  if (provider === 'claude') {
    const apiKey = cfg.claude_api_key;
    const model = opts.model || cfg.claude_model || 'claude-3-5-haiku-20241022';
    if (!apiKey) throw new Error('Claude Key 未配置');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!response.ok) throw new Error(`Claude 接口错误: ${await response.text()}`);
    const data = await response.json();
    const text = data.content?.[0]?.text;
    if (!text) throw new Error(`Claude 返回内容异常`);
    logTokens(model, data.usage, opts);
    return text;
  }

  if (provider === 'zhipu' || provider === 'glm') {
    const apiKey = cfg.zhipu_api_key;
    const model = opts.model || cfg.zhipu_model || 'glm-4-flash';
    if (!apiKey) throw new Error('智谱 AI Key 未配置');
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: opts.temperature || 0.8, max_tokens: maxTokens }),
    });
    if (!response.ok) throw new Error(`智谱接口错误: ${await response.text()}`);
    const data = await response.json();
    const zc = data.choices?.[0]?.message?.content;
    if (!zc) throw new Error(`智谱返回内容异常`);
    logTokens(model, data.usage, opts);
    return zc;
  }

  if (provider === 'deepseek') {
    const apiKey = cfg.deepseek_api_key;
    const model = opts.model || cfg.deepseek_model || 'deepseek-chat';
    if (!apiKey) throw new Error('DeepSeek Key 未配置，请在后台填写 deepseek_api_key');
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: opts.temperature || 0.8, max_tokens: maxTokens }),
    });
    if (!response.ok) throw new Error(`DeepSeek 接口错误: ${await response.text()}`);
    const data = await response.json();
    const dc = data.choices?.[0]?.message?.content;
    if (!dc) throw new Error(`DeepSeek 返回内容异常: ${JSON.stringify(data).slice(0, 400)}`);
    logTokens(model, data.usage, opts);
    return dc;
  }

  throw new Error(`不支持的 AI 提供商: ${provider}，请在后台选择并配置 Key`);
}

module.exports = { callAI };
