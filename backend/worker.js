const db = require('./db');
const { callAI } = require('./lib/callAI');
const taskRunner = require('./taskRunner');

// 内存 ASR 缓存（进程重启后清空，无需 Redis）
const asrCache = new Map();

// ===== OpenAI Whisper API 转写（本地 ASR 未配置时的云端备选）=====
async function transcribeWithWhisper(mp4Url, apiKey, baseUrl) {
  const videoResp = await fetch(mp4Url, { signal: AbortSignal.timeout(120000) });
  if (!videoResp.ok) throw new Error(`下载视频失败: ${videoResp.status}`);
  const videoBuffer = Buffer.from(await videoResp.arrayBuffer());

  if (videoBuffer.byteLength > 24 * 1024 * 1024) {
    throw new Error('视频文件超过 24MB，无法通过 Whisper 转写，请换较短的视频');
  }

  const formData = new FormData();
  const blob = new Blob([videoBuffer], { type: 'video/mp4' });
  formData.append('file', blob, 'audio.mp4');
  formData.append('model', 'whisper-1');
  formData.append('language', 'zh');

  const whisperUrl = (baseUrl || 'https://api.openai.com/v1') + '/audio/transcriptions';
  const resp = await fetch(whisperUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(180000),
  });
  if (!resp.ok) throw new Error(`Whisper 转写失败: ${await resp.text()}`);
  const data = await resp.json();
  return data.text?.trim() || '';
}

// 读取 ASR 相关配置（本地 asr_url 优先，否则用 OpenAI Whisper）
async function getAsrConfig() {
  const { rows } = await db.query(
    "SELECT config_key, value FROM system_config WHERE config_key IN ('asr_url','openai_api_key','openai_base_url')"
  );
  const cfg = {};
  rows.forEach(r => { cfg[r.config_key] = r.value; });
  return {
    asrUrl: cfg.asr_url || '',
    openaiKey: cfg.openai_api_key || '',
    openaiBaseUrl: cfg.openai_base_url || 'https://api.openai.com/v1',
  };
}

async function doTranscribe(taskId, mp4Url, cacheKey, asrUrl, openaiKey, openaiBaseUrl) {
  let transcript = asrCache.get(`asr:${cacheKey}`) || null;
  if (transcript) return transcript;

  if (asrUrl) {
    try {
      const asrRes = await fetch(`${asrUrl}/asr/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, mp4Url }),
        signal: AbortSignal.timeout(300000),
      });
      if (!asrRes.ok) throw new Error(`本地ASR返回错误: ${asrRes.status}`);
      const asrData = await asrRes.json();
      transcript = asrData.text?.trim() || '';
    } catch (asrErr) {
      if (!openaiKey) throw new Error(`本地语音识别服务不可用 (${asrErr.message})，且未配置 OpenAI API Key 作为备用`);
      console.warn(`[Worker] 本地ASR失败，降级到Whisper: ${asrErr.message}`);
      transcript = await transcribeWithWhisper(mp4Url, openaiKey, openaiBaseUrl);
    }
  } else if (openaiKey) {
    transcript = await transcribeWithWhisper(mp4Url, openaiKey, openaiBaseUrl);
  } else {
    throw new Error('语音识别未配置：请在管理后台填写本地 ASR 地址，或配置 OpenAI API Key（自动调用 Whisper 转写）');
  }

  if (transcript && cacheKey) asrCache.set(`asr:${cacheKey}`, transcript);
  return transcript;
}

// ===== 进度更新工具 =====
async function updateTask(taskId, fields) {
  const sets = Object.entries(fields).map(([k], i) => `${k} = $${i + 1}`).join(', ');
  const vals = [...Object.values(fields), taskId];
  await db.query(`UPDATE tasks SET ${sets}, updated_at = NOW() WHERE id = $${vals.length}`, vals);
}

// ===== 主页分析任务处理 =====
async function processProfileAnalyze(taskId) {
  const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = rows[0];
  if (!task) throw new Error(`任务 ${taskId} 不存在`);

  const input = JSON.parse(task.input_data || '{}');
  const { author = {}, selected_videos = [], brand_name = '' } = input;

  // 读 ASR 地址
  const { asrUrl, openaiKey, openaiBaseUrl } = await getAsrConfig();
  if (!asrUrl && !openaiKey) throw new Error('语音识别未配置：请在管理后台填写本地 ASR 地址，或配置 OpenAI API Key');

  // ===== Stage 1-3: ASR 串行处理每个视频 =====
  const transcripts = [];
  for (let i = 0; i < selected_videos.length; i++) {
    const video = selected_videos[i];
    const stageProgress = 10 + i * 20;

    await updateTask(taskId, { status: 'running', stage: 'asr', thinking: `正在听第 ${i + 1} 条视频说了什么...`, progress: stageProgress });

    // 查内存 ASR 缓存
    let transcript = asrCache.get(`asr:${video.aweme_id}`) || null;

    if (!transcript) {
      const mp4Url = video.play_urls?.[0];
      if (!mp4Url) {
        transcripts.push({ ...video, transcript: '(此视频无播放地址)' });
        continue;
      }

      try {
        transcript = await doTranscribe(`${taskId}_${i}`, mp4Url, video.aweme_id, asrUrl, openaiKey, openaiBaseUrl);
      } catch {
        transcript = '(此视频转写失败)';
      }
    }

    transcripts.push({ ...video, transcript });
  }

  // ===== Stage 4: AI 账号拆解 =====
  await updateTask(taskId, { stage: 'analyze', thinking: '正在分析这个账号的内容定位...', progress: 70 });

  const videosText = transcripts
    .map((v, i) => `视频${i + 1}：\n标题：${v.title}\n点赞：${v.stats?.digg || 0}\n文案：${v.transcript || '(无)'}`)
    .join('\n\n');

  const analyzePrompt = `你是短视频内容分析师。分析以下抖音账号的内容策略。

账号昵称：${author.nickname || ''}
账号签名：${author.signature || ''}

${videosText}

只输出JSON：
{"account_positioning":"账号定位(30字内)","target_audience":"目标受众(20字内)","content_patterns":["规律1","规律2"],"hook_types":["钩子类型"],"tone":"语言风格"}`;

  const analyzeRaw = await callAI(analyzePrompt, { temperature: 0.3 });
  let analysis = {};
  try {
    const cleaned = analyzeRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    analysis = JSON.parse(cleaned);
  } catch {
    analysis = { account_positioning: '内容创作者', tone: '口语化' };
  }

  // ===== Stage 5: AI 仿写 =====
  await updateTask(taskId, { stage: 'rewrite', thinking: '正在为你量身定制原创文案...', progress: 85 });

  const scriptsPrompt = `你是短视频文案撰稿人，服务对象是个体户老板，需要真人口播文案。

【对标账号分析】
${JSON.stringify(analysis)}

【用户信息】
店铺名称：${brand_name || '无'}

生成5条原创仿写文案，只学套路不抄袭：
1. 严格5条，差异化明显
2. 每条：开头钩子(1-2句)+主体(3-5句)+结尾CTA(1句)
3. 约30秒，口语化，像真人说话
4. 钩子类型5条全不同：痛点提问/反常识/数字冲击/故事开场/福利诱惑
5. 品牌名仅1-2条自然提及，放结尾
6. 禁止"家人们""老铁们"

只输出JSON数组：
[{"id":1,"hook_type":"痛点提问","content":"完整文案"}]`;

  const scriptsRaw = await callAI(scriptsPrompt, { temperature: 0.8, maxTokens: 2000 });
  let scripts = [];
  try {
    const cleaned = scriptsRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    scripts = JSON.parse(cleaned);
    if (!Array.isArray(scripts)) scripts = [];
  } catch {
    scripts = [{ id: 1, hook_type: '仿写', content: scriptsRaw }];
  }

  // 完成
  await db.query(
    'UPDATE tasks SET status = $1, progress = $2, thinking = $3, result = $4, stage = $5, updated_at = NOW() WHERE id = $6',
    ['done', 100, '', JSON.stringify({ analysis, scripts, author }), 'done', taskId]
  );
}

// ===== 单视频分析任务处理 =====
async function processSingleVideoAnalyze(taskId) {
  const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = rows[0];
  if (!task) throw new Error(`任务 ${taskId} 不存在`);

  const input = JSON.parse(task.input_data || '{}');
  const { aweme_id, brand_name = '' } = input;

  const { rows: tikhubRows } = await db.query("SELECT value FROM system_config WHERE config_key = 'tikhub_api_key'");
  const tikhubKey = tikhubRows[0]?.value;
  const { asrUrl, openaiKey, openaiBaseUrl } = await getAsrConfig();

  if (!tikhubKey) throw new Error('TikHub API Key 未配置');
  if (!asrUrl && !openaiKey) throw new Error('语音识别未配置：请在管理后台填写本地 ASR 地址，或配置 OpenAI API Key');

  await updateTask(taskId, { status: 'running', stage: 'download', thinking: '正在解析视频信息...', progress: 10 });

  // 获取 mp4 地址
  const videoResp = await fetch(
    `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video?aweme_id=${aweme_id}`,
    { headers: { 'Authorization': `Bearer ${tikhubKey}` }, signal: AbortSignal.timeout(15000) }
  );
  if (!videoResp.ok) throw new Error(`TikHub 返回 ${videoResp.status}`);
  const videoData = await videoResp.json();
  const item = videoData?.data?.aweme_details?.[0] || videoData?.data?.aweme_detail;
  if (!item) throw new Error('无法获取视频信息，请检查链接是否正确');
  const mp4Url = item.video?.play_addr?.url_list?.[0] || item.video?.download_addr?.url_list?.[0];
  if (!mp4Url) throw new Error('无法获取视频下载地址');

  // 更新标题
  const videoTitle = item.desc?.slice(0, 40) || `视频 ${aweme_id}`;
  await db.query('UPDATE tasks SET title = $1 WHERE id = $2', [videoTitle + ' 的分析', taskId]);

  await updateTask(taskId, { stage: 'asr', thinking: '正在听视频说了什么...', progress: 30 });

  const transcript = await doTranscribe(taskId, mp4Url, aweme_id, asrUrl, openaiKey, openaiBaseUrl);

  await updateTask(taskId, { stage: 'rewrite', thinking: '正在仿写文案...', progress: 70 });

  // 读改写提示词模板
  const { rows: tplRows } = await db.query("SELECT content FROM prompt_templates WHERE type = 'rewrite' AND is_default = 1");
  const tpl = tplRows[0]?.content || '请将以下文案改写为抖音爆款风格：\n{input}';
  const rewritePrompt = tpl.replace('{input}', transcript || '(无口播内容)');
  const rewritten = await callAI(rewritePrompt);

  await db.query(
    'UPDATE tasks SET status = $1, progress = $2, thinking = $3, result = $4, stage = $5, updated_at = NOW() WHERE id = $6',
    ['done', 100, '', JSON.stringify({ transcript, scripts: [{ id: 1, hook_type: '仿写', content: rewritten }] }), 'done', taskId]
  );
}

// ===== 克隆任务两阶段处理 =====
async function processCloneVideo(taskId) {
  const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = rows[0];
  if (!task) throw new Error(`任务 ${taskId} 不存在`);

  // 阶段2：已提取，继续改写
  if (task.stage === 'extracted') {
    const existing = typeof task.result === 'string' ? JSON.parse(task.result) : (task.result || {});
    await processCloneRewritePhase(taskId, existing);
    return;
  }

  // 阶段1：提取文案
  await processCloneExtractPhase(taskId, task);
}

async function processCloneExtractPhase(taskId, task) {
  const input = JSON.parse(task.input_data || '{}');
  const { url = '' } = input;

  const { rows: cfgRows } = await db.query("SELECT value FROM system_config WHERE config_key = 'tikhub_api_key'");
  const tikhubKey = cfgRows[0]?.value;
  if (!tikhubKey) throw new Error('TikHub API Key 未配置');
  const { asrUrl, openaiKey, openaiBaseUrl } = await getAsrConfig();
  if (!asrUrl && !openaiKey) throw new Error('语音识别未配置：请在管理后台填写本地 ASR 地址，或配置 OpenAI API Key');

  await updateTask(taskId, { status: 'running', stage: 'download', thinking: '正在解析视频链接...', progress: 10 });

  const urlMatch = url.match(/https?:\/\/[^\s\u4e00-\u9fff，。！？、]+/);
  const cleanUrl = urlMatch ? urlMatch[0].replace(/\/+$/, '') + '/' : url.trim();
  let awemeId = '';
  try {
    const resp = await fetch(cleanUrl, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    const m = resp.url.match(/\/video\/(\d+)/);
    awemeId = m?.[1] || '';
  } catch {}

  await updateTask(taskId, { thinking: '正在获取视频信息...', progress: 20 });

  const tikhubUrl = awemeId
    ? `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video?aweme_id=${awemeId}`
    : `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video?aweme_id=0&url=${encodeURIComponent(cleanUrl)}`;
  const vResp = await fetch(tikhubUrl, { headers: { Authorization: `Bearer ${tikhubKey}` }, signal: AbortSignal.timeout(15000) });
  if (!vResp.ok) throw new Error(`视频解析失败: ${vResp.status}`);
  const vData = await vResp.json();
  const item = vData?.data?.aweme_details?.[0] || vData?.data?.aweme_detail;
  if (!item) throw new Error('无法获取视频信息，请检查链接是否正确');
  const mp4Url = item.video?.play_addr?.url_list?.[0] || item.video?.download_addr?.url_list?.[0];
  if (!mp4Url) throw new Error('无法获取视频下载地址');

  const videoTitle = item.desc?.slice(0, 30) || '视频';
  const author = item.author?.nickname || '';
  await db.query('UPDATE tasks SET title = $1 WHERE id = $2', [`${videoTitle} 的克隆`, taskId]);

  await updateTask(taskId, { stage: 'asr', thinking: '正在识别视频语音...', progress: 35 });

  const transcript = await doTranscribe(taskId, mp4Url, awemeId || cleanUrl, asrUrl, openaiKey, openaiBaseUrl);

  // 阶段1完成，等待用户触发改写
  await db.query(
    'UPDATE tasks SET status=$1, stage=$2, progress=$3, thinking=$4, result=$5, updated_at=NOW() WHERE id=$6',
    ['extracted', 'extracted', 50, '', JSON.stringify({ transcript, title: videoTitle, author }), taskId]
  );
}

async function processCloneRewritePhase(taskId, existing) {
  const { transcript = '', title = '', author = '' } = existing;
  await updateTask(taskId, { status: 'running', stage: 'rewrite', thinking: '正在AI改写文案...', progress: 70 });

  const { rows: tplRows } = await db.query("SELECT content FROM prompt_templates WHERE type = 'rewrite' AND is_default = 1");
  const tpl = tplRows[0]?.content || '请将以下文案改写为抖音爆款风格：\n{input}';
  const rewritten = await callAI(tpl.replace('{input}', transcript || '(无口播内容)'));

  await db.query(
    'UPDATE tasks SET status=$1, progress=$2, thinking=$3, result=$4, stage=$5, updated_at=NOW() WHERE id=$6',
    ['done', 100, '', JSON.stringify({ transcript, rewritten, title, author, scripts: [{ id: 1, hook_type: '克隆改写', content: rewritten }] }), 'done', taskId]
  );
}

const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟上限

// ===== 注册任务处理器 =====
taskRunner.setHandler(async (job) => {
  const { taskId, type } = job;
  console.log(`[Worker] 开始处理任务 ${taskId} (${type})`);

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('任务超时，已超过10分钟，请稍后重试')), TASK_TIMEOUT_MS)
  );

  const processPromise = (async () => {
    if (type === 'profile_analyze') await processProfileAnalyze(taskId);
    else if (type === 'single_video_analyze') await processSingleVideoAnalyze(taskId);
    else if (type === 'clone_video') await processCloneVideo(taskId);
    else throw new Error(`未知任务类型: ${type}`);
  })();

  try {
    await Promise.race([processPromise, timeoutPromise]);
    console.log(`[Worker] 任务完成: ${taskId}`);
  } catch (err) {
    console.error(`[Worker] 任务失败: ${taskId}`, err.message);
    await db.query(
      'UPDATE tasks SET status = $1, error_msg = $2, updated_at = NOW() WHERE id = $3',
      ['failed', err.message, taskId]
    ).catch(() => {});
    throw err;
  }
});

// ===== 启动时清理卡住的任务 =====
(async () => {
  try {
    const { rows } = await db.query(
      `UPDATE tasks SET status = 'failed', error_msg = '服务重启，任务中断，请重新生成'
       WHERE status IN ('pending', 'running')
       RETURNING id`
    );
    if (rows.length > 0) {
      console.log(`[Worker] 清理了 ${rows.length} 个中断任务`);
    }
  } catch (e) {
    // MySQL 不支持 RETURNING，用两步
    try {
      await db.query(
        `UPDATE tasks SET status = 'failed', error_msg = '服务重启，任务中断，请重新生成'
         WHERE status IN ('pending', 'running')`
      );
    } catch {}
  }
})();

console.log('✅ TaskRunner Worker 已就绪');
