function currentCloneStepFromState() {
  if (S.extractStep === 'cloning') return 1;
  if (S.extractStep === 'review' || S.extractStep === 'rewriting') return 2;
  if (S.extractStep === 'tts_gen') return 3;
  if (S.extractStep === 'avatar_gen') return 4;
  const n = parseInt(S.extractStep);
  return Number.isFinite(n) ? Math.max(1, Math.min(6, n)) : 1;
}

function patchLocalCloneTaskStep(taskId, cloneStep, extraFields) {
  if (!taskId) return;
  const nowIso = new Date().toISOString();
  const pct = Math.max(0, Math.min(100, Math.round((cloneStep / 6) * 100)));
  S.tasksList = (S.tasksList || []).map(t => {
    if (String(t.id) !== String(taskId)) return t;
    return {
      ...t,
      clone_step: cloneStep,           // 直接写当前步骤，允许回退
      // 步骤前进时取大值（防倒退），步骤回退时直接用新步骤对应的进度（避免满进度条残留）
      progress: cloneStep >= (parseInt(t.clone_step) || 1) ? Math.max(t.progress || 0, pct) : pct,
      activity_at: nowIso,
      updated_at: nowIso,
      ...(extraFields || {}),
    };
  });
  // 任何时候都 render，确保 S.tasksList 更新后卡片即时生效（render 是轻量的）
  render();
}

// 保存当前克隆流程的关键状态到服务器（静默，失败不影响用户）
async function saveCloneSession(cloneStep) {
  const taskId = S.cloneTaskId;
  if (!taskId) return;
  cloneStep = parseInt(cloneStep) || 1;   // 直接用调用方传入的步骤，不再与UI当前步骤取max
  patchLocalCloneTaskStep(taskId, cloneStep);
  // 只保存纯数据（base64），不保存 Blob URL（跨会话无效）
  const session = {
    extractedScript:  S.extractedScript  || '',
    rewrittenScript:  S.rewrittenScript  || '',
    ttsVoice:         S.ttsVoice,
    ttsSpeed:         S.ttsSpeed,
    // 音频：OSS URL 时用 '__oss__' 标记，让 tasks.js 步骤判断仍正常工作
    ttsAudioB64:      S.ttsAudioB64 || (S.ttsAudioUrl && !S.ttsAudioUrl.startsWith('blob:') ? '__oss__' : null),
    ttsOssUrl:        (S.ttsAudioUrl && !S.ttsAudioUrl.startsWith('blob:')) ? S.ttsAudioUrl : null,
    ttsAudioFmt:      S.ttsAudioFmt      || 'wav',  // 音频格式，恢复时用正确 MIME
    ttsIndexEmotion:  S.ttsIndexEmotion  || 'neutral',
    avatarVideoB64:   S.avatarVideoB64   || null,   // 步骤4完成后有值（旧流程）
    avatarDoneTaskId: S.avatarDoneTaskId || null,   // 步骤4完成后有值（新流程，用于恢复视频）
    avatarVideoUrl:   (S.avatarVideoUrl && !S.avatarVideoUrl.startsWith('blob:')) ? S.avatarVideoUrl : null, // OSS 永久链接直接保存，blob URL 不保存
    avatarTaskId:     S.avatarTaskId     || null,   // 数字人生成任务ID（生成中时有值）
    avatarAsrUrl:     S.avatarAsrUrl     || null,   // 数字人服务地址（用于恢复poller）
    avatarLibKey:     S.avatarLibKey     || null,
    avatarLibName:    S.avatarLibName    || '',
    avatarLibThumb:   S.avatarLibThumb   || '',
    subColor:         S.subColor,
    subOutlineColor:  S.subOutlineColor,
    subFontsize:      S.subFontsize,
    subOutlineWidth:  S.subOutlineWidth,
    subTemplate:      S.subTemplate,
    subStyle:         S.subStyle,
    // postProcessedB64 可能超过 MySQL 16MB 限制，改用标志位 + OSS URL 记录
    postProcessDone: !!(S.postProcessedVideoUrl || S.postProcessedB64),
    postProcessedVideoUrl: (S.postProcessedVideoUrl && !S.postProcessedVideoUrl.startsWith('blob:')) ? S.postProcessedVideoUrl : null,
    // postProcessedB64 仅在小视频时保存，限制 4MB
    postProcessedB64: (S.postProcessedB64 && S.postProcessedB64.length < 4 * 1024 * 1024) ? S.postProcessedB64 : null,
    coverFrameUrl:    S.coverFrameUrl    || null,   // 封面（dataURL，不大）
    coverTitle:       S.coverTitle       || '',
    publishTitle:     S.publishTitle     || '',
    publishDesc:      S.publishDesc      || '',
    publishTags:      S.publishTags      || [],
  };
  try {
    await api.post(`/tasks/${taskId}/session`, { clone_step: cloneStep, session });
    patchLocalCloneTaskStep(taskId, cloneStep);
  } catch (e) {
    console.warn('[saveCloneSession] 保存失败', e);
  }
}

// ── 后台生成：切换到首页，任务继续运行 ──────────────────────────────────
function goHomeBackground() {
  setState({ currentTab: 'home' });
  loadTasks();
  render();
}

// ── TTS 模拟进度 + 实时计时器 ──────────────────────────────────────────
let _ttsProgressTimer = null;
let _ttsElapsedTimer = null;
function _startTTSProgressTimer() {
  _stopTTSProgressTimer();
  const t0 = Date.now();
  setState({ ttsProgressPct: 5, ttsStartTime: t0, ttsElapsedSecs: 0, ttsDuration: null });
  let pct = 5;
  _ttsProgressTimer = setInterval(() => {
    if (!S.ttsGenerating) { _stopTTSProgressTimer(); return; }
    if (pct < 88) {
      pct = Math.min(88, pct + (Math.random() * 3 + 0.5));
      S.ttsProgressPct = Math.round(pct);  // 直接写，避免触发完整 render
      // 同步更新首页小卡 + 语音页进度条 DOM（两处都加了 data-tts-pct 属性）
      const pctStr = Math.round(pct) + '%';
      document.querySelectorAll('[data-tts-pct]').forEach(el => { el.style.width = pctStr; });
      document.querySelectorAll('[data-tts-pct-text]').forEach(el => { el.textContent = pctStr; });
    }
  }, 700);
  _ttsElapsedTimer = setInterval(() => {
    if (!S.ttsGenerating) { _stopTTSProgressTimer(); return; }
    const secs = Math.floor((Date.now() - t0) / 1000);
    S.ttsElapsedSecs = secs;
    // 只更新计时数字，不触发完整 render（直接操作 DOM）
    const el = document.querySelector('[data-tts-elapsed]');
    if (el) el.textContent = secs + 's';
  }, 1000);
}
function _stopTTSProgressTimer() {
  if (_ttsProgressTimer) { clearInterval(_ttsProgressTimer); _ttsProgressTimer = null; }
  if (_ttsElapsedTimer) { clearInterval(_ttsElapsedTimer); _ttsElapsedTimer = null; }
}

// ── 停止 TTS 生成 ────────────────────────────────────────────────────────
let _ttsAbortFlag = false;
function stopTTSGenerate() {
  _ttsAbortFlag = true;
  _stopTTSProgressTimer();
  setState({ ttsGenerating: false, ttsProgressPct: 0, extractStep: 3 });
  showToast('已停止语音合成');
}

// ── 后期烧录模拟进度计时器 ───────────────────────────────────────────────
let _postProgressTimer = null;
function _startPostProgressTimer() {
  _stopPostProgressTimer();
  setState({ postProgressPct: 5 });
  let pct = 5;
  _postProgressTimer = setInterval(() => {
    if (!S.postProcessing) { _stopPostProgressTimer(); return; }
    if (pct < 85) {
      pct = Math.min(85, pct + (Math.random() * 2 + 0.3));
      setState({ postProgressPct: Math.round(pct) });
    }
  }, 1200);
}
function _stopPostProgressTimer() {
  if (_postProgressTimer) { clearInterval(_postProgressTimer); _postProgressTimer = null; }
}

async function touchCloneTaskActivity() {
  const taskId = S.cloneTaskId;
  if (!taskId) return;
  try {
    await api.post(`/tasks/${taskId}/touch`, {});
    const nowIso = new Date().toISOString();
    S.tasksList = (S.tasksList || []).map(t => String(t.id) === String(taskId)
      ? { ...t, activity_at: nowIso, updated_at: nowIso }
      : t);
  } catch (e) {
    console.warn('[touchCloneTaskActivity] 刷新失败', e);
  }
}

// 从服务器恢复克隆任务 session 状态，并跳到对应步骤
async function restoreCloneSession(taskId) {
  try {
    const r = await api.get(`/tasks/${taskId}/session`);
    if (r.code !== 200 || !r.data) return false;
    const { clone_step, session: s } = r.data;
    if (!s) return false;

    const patch = {
      extractedScript:      s.extractedScript || '',
      rewrittenScript:      s.rewrittenScript || '',
      ttsVoice:             s.ttsVoice        || 'xiaoxiao',
      ttsSpeed:             s.ttsSpeed        || 1.0,
      ttsIndexEmotion:      s.ttsIndexEmotion || 'neutral',
      avatarLibKey:         s.avatarLibKey    || null,
      avatarLibName:        s.avatarLibName   || '',
      avatarLibThumb:       s.avatarLibThumb  || '',
      subColor:             s.subColor        || '#FFD700',
      subOutlineColor:      s.subOutlineColor || '#000000',
      subFontsize:          s.subFontsize     || 46,
      subOutlineWidth:      s.subOutlineWidth || 3,
      subTemplate:          s.subTemplate     || 'bilingual_douyin',
      subStyle:             s.subStyle        || 'bilingual_douyin',
      coverTitle:           s.coverTitle      || '',
      publishTitle:         s.publishTitle    || '',
      publishDesc:          s.publishDesc     || '',
      publishTags:          s.publishTags     || [],
      // ★ 阶段 → UI 步骤精确映射：
      //   发布页（有封面或发布标题）→ step6
      //   后期视频已就绪 → step5（后期预览）
      //   数字人视频已就绪 / 生成中 → step4（视频预览/生成态）
      //   音频已就绪 / 改写完成 → step3（语音页）
      //   仅提取完成 → step2（改写页）
      extractStep: (() => {
        if (s.coverFrameUrl || s.publishTitle) return 6;  // 曾到发布页 → 恢复到发布页
        if (s.postProcessDone || s.postProcessedVideoUrl || s.postProcessedB64) return 5;
        if (s.avatarDoneTaskId || s.avatarVideoUrl || s.avatarVideoB64 || s.avatarTaskId) return 4;
        if (s.ttsAudioB64 || s.ttsOssUrl) return 3;   // 有音频（B64或OSS）→ 语音页
        return clone_step || 2;
      })(),
      // ★ 显式重置所有"进行中"状态，防止旧 session 脏数据残留
      avatarGenerating:     false,
      avatarTaskId:         null,
      avatarAsrUrl:         null,
      avatarVideoUrl:       null,
      avatarVideoB64:       null,
      avatarErr:            '',
      avatarProgressPct:    0,
      avatarProgressMsg:    '',
      ttsAudioUrl:          null,
      ttsAudioB64:          null,
      ttsGenerating:        false,
      ttsErr:               '',
      postProcessedVideoUrl: null,
      postProcessedB64:     null,
      postProcessing:       false,
      coverFrameUrl:        null,
    };
    // 音频恢复：OSS URL 直接用；base64 转 Blob URL
    if (s.ttsAudioB64 === '__oss__' && s.ttsOssUrl) {
      patch.ttsAudioUrl = s.ttsOssUrl;
      patch.ttsAudioB64 = null;
      patch.ttsAudioFmt = s.ttsAudioFmt || 'wav';
    } else if (s.ttsAudioB64) {
      const _fmt = (s.ttsAudioFmt || 'mp3').toLowerCase();
      const _mime = _fmt === 'wav' ? 'audio/wav' : _fmt === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
      patch.ttsAudioB64 = s.ttsAudioB64;
      patch.ttsAudioFmt = _fmt;
      patch.ttsAudioUrl = _b64ToBlobUrl(s.ttsAudioB64, _mime);
    }
    // 数字人视频恢复：优先用 base64，其次用已保存的 OSS URL，最后异步拉取
    if (s.avatarVideoB64) {
      patch.avatarVideoB64 = s.avatarVideoB64;
      patch.avatarVideoUrl = _b64ToBlobUrl(s.avatarVideoB64, 'video/mp4');
    } else if (s.avatarVideoUrl) {
      // OSS 永久链接已保存，直接用，无需异步请求
      patch.avatarDoneTaskId = s.avatarDoneTaskId || null;
      patch.avatarVideoUrl = s.avatarVideoUrl;
    } else if (s.avatarDoneTaskId) {
      patch.avatarDoneTaskId = s.avatarDoneTaskId;
      // 异步恢复视频：优先用 OSS URL（直接播放），无则下载 blob（避免 frp 流式转圈）
      const _restoreOwnerTask = taskId; // ★ 记录恢复时的任务ID，防止写错任务状态
      setTimeout(async () => {
        // 轮询直到 OSS 完成或超时（最多等 5 分钟，每 8 秒查一次）
        const MAX_WAIT = 5 * 60 * 1000;
        const POLL_INTERVAL = 8000;
        const startTime = Date.now();
        while (true) {
          if (S.cloneTaskId !== _restoreOwnerTask) return; // ★ 已切换到其他任务，放弃
          try {
            const r = await api.get(`/ai/video/task/${s.avatarDoneTaskId}`);
            if (S.cloneTaskId !== _restoreOwnerTask) return; // ★ 请求返回期间可能已切换
            if (r?.code === 200 && r.data?.video_url) {
              setState({ avatarVideoUrl: r.data.video_url });
              return;
            }
            if (r?.code === 200 && r.data?.oss_uploading) {
              if (Date.now() - startTime < MAX_WAIT) {
                await new Promise(res => setTimeout(res, POLL_INTERVAL));
                continue;
              }
            }
          } catch {}
          break;
        }
        if (S.cloneTaskId !== _restoreOwnerTask) return; // ★ 最终写入前再校验一次
        // 无 OSS：通过 stream proxy 下载完整 blob，保证播放流畅
        try {
          const streamUrl = `${API_BASE}/ai/video/stream/${s.avatarDoneTaskId}?t=${encodeURIComponent(getToken())}`;
          const resp = await fetch(streamUrl);
          if (!resp.ok) throw new Error('download failed');
          const blob = await resp.blob();
          if (!blob.size) throw new Error('empty');
          if (S.cloneTaskId !== _restoreOwnerTask) return; // ★ 下载期间可能已切换
          const mp4Blob = blob.type === 'video/mp4' ? blob : new Blob([blob], { type: 'video/mp4' });
          setState({ avatarVideoUrl: URL.createObjectURL(mp4Blob) });
        } catch {
          if (S.cloneTaskId !== _restoreOwnerTask) return;
          const streamUrl = `${API_BASE}/ai/video/stream/${s.avatarDoneTaskId}?t=${encodeURIComponent(getToken())}`;
          setState({ avatarVideoUrl: streamUrl });
        }
      }, 300);
    } else if (s.avatarTaskId) {
      // 视频未完成但有任务ID → 恢复"生成中"状态并重启poller
      // 注意：avatarAsrUrl 在新流程中始终为 null，不能用它做判断
      patch.avatarTaskId    = s.avatarTaskId;
      patch.avatarAsrUrl    = s.avatarAsrUrl || null;
      patch.avatarGenerating = true;
      patch.extractStep     = 'avatar_gen';
      patch.avatarProgressMsg = '恢复中，继续等待生成...';
      patch.avatarProgressPct = 30;
      // setState 之后再启动 poller（停掉后台 poller，改为前台展示进度）
      if (_bgAvatarPoller && _bgAvatarTaskId === s.avatarTaskId) {
        clearInterval(_bgAvatarPoller); _bgAvatarPoller = null; _bgAvatarTaskId = null;
      }
      setTimeout(() => _startAvatarPoller(s.avatarTaskId, s.avatarAsrUrl || null), 500);
    }
    // 后期视频恢复：优先用 OSS URL，其次 base64
    if (s.postProcessedVideoUrl) {
      patch.postProcessedVideoUrl = s.postProcessedVideoUrl;
    } else if (s.postProcessedB64) {
      patch.postProcessedB64 = s.postProcessedB64;
      patch.postProcessedVideoUrl = _b64ToBlobUrl(s.postProcessedB64, 'video/mp4');
    }
    // 封面（dataURL 可直接用）
    if (s.coverFrameUrl) patch.coverFrameUrl = s.coverFrameUrl;

    setState(patch);
    return true;
  } catch (e) {
    console.warn('[restoreCloneSession] 恢复失败', e);
    return false;
  }
}
