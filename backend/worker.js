const db = require('./db');
const { callAI } = require('./lib/callAI');
const taskRunner = require('./taskRunner');

// 内存 ASR 缓存（进程重启后清空，无需 Redis）
const asrCache = new Map();

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
  const { rows: asrRows } = await db.query("SELECT value FROM system_config WHERE config_key = 'asr_url'");
  const asrUrl = asrRows[0]?.value;
  if (!asrUrl) throw new Error('ASR 服务未配置，请在后台设置 asr_url');

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

      let asrOk = false;
      for (const url of (video.play_urls || []).slice(0, 3)) {
        try {
          const asrRes = await fetch(`${asrUrl}/asr/transcribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: `${taskId}_${i}`, mp4Url: url }),
            signal: AbortSignal.timeout(300000),
          });
          if (!asrRes.ok) continue;
          const asrData = await asrRes.json();
          transcript = asrData.text?.trim() || '';
          asrOk = true;
          break;
        } catch { continue; }
      }
      if (!asrOk) transcript = '(此视频转写失败)';

      // 缓存 ASR 结果
      if (transcript && !transcript.startsWith('(')) {
        asrCache.set(`asr:${video.aweme_id}`, transcript);
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

  const { rows: asrRows } = await db.query("SELECT value FROM system_config WHERE config_key = 'asr_url'");
  const asrUrl = asrRows[0]?.value;
  const { rows: tikhubRows } = await db.query("SELECT value FROM system_config WHERE config_key = 'tikhub_api_key'");
  const tikhubKey = tikhubRows[0]?.value;

  if (!asrUrl) throw new Error('ASR 服务未配置');
  if (!tikhubKey) throw new Error('TikHub API Key 未配置');

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

  // 查内存 ASR 缓存
  let transcript = asrCache.get(`asr:${aweme_id}`) || null;

  if (!transcript) {
    const asrRes = await fetch(`${asrUrl}/asr/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, mp4Url }),
      signal: AbortSignal.timeout(300000),
    });
    if (!asrRes.ok) throw new Error(`ASR 失败: ${await asrRes.text()}`);
    const asrData = await asrRes.json();
    transcript = asrData.text?.trim() || '';
    if (transcript) {
      asrCache.set(`asr:${aweme_id}`, transcript);
    }
  }

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
