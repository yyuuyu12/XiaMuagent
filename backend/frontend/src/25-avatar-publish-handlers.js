async function handleAvatarVideoSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  if (file.size > 50 * 1024 * 1024) { showToast('视频过大（>50MB），请压缩后上传'); return; }
  const fmt = file.type.includes('quicktime') || file.name.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4';
  // blob URL 立即设置用于预览，base64 后台读取（避免等待卡顿和抖动）
  if (S._avatarSrcBlobUrl) URL.revokeObjectURL(S._avatarSrcBlobUrl);
  const previewUrl = URL.createObjectURL(file);
  setState({ avatarSrcVideoName: file.name, avatarSrcVideoFmt: fmt, avatarErr: '', _avatarSrcBlobUrl: previewUrl, avatarSrcVideoB64: null });
  const reader = new FileReader();
  reader.onload = (e) => {
    const b64 = e.target.result.split(',')[1];
    setState({ avatarSrcVideoB64: b64 });
    showToast('视频已选择 ✓');
  };
  reader.readAsDataURL(file);
}

let _avatarPoller = null;
let _avatarRunSeq = 0;
let _bgAvatarPoller = null; // 切换任务后后台保活轮询
let _bgAvatarTaskId = null;
let _bgAvatarOwnerId = null; // ★ 数字人所属的克隆任务ID，用于后台完成时存入正确session

function _startBgAvatarPoller(taskId, ownerTaskId) {
  if (_bgAvatarPoller) { clearInterval(_bgAvatarPoller); _bgAvatarPoller = null; }
  _bgAvatarTaskId = taskId;
  _bgAvatarOwnerId = ownerTaskId || null; // ★ 记录归属任务
  let failCount = 0;
  _bgAvatarPoller = setInterval(async () => {
    if (!_bgAvatarTaskId) { clearInterval(_bgAvatarPoller); _bgAvatarPoller = null; return; }
    try {
      const r = await api.get(`/ai/video/task/${_bgAvatarTaskId}`);
      if (r.code !== 200) {
        if (++failCount > 8) { clearInterval(_bgAvatarPoller); _bgAvatarPoller = null; _bgAvatarTaskId = null; _bgAvatarOwnerId = null; }
        return;
      }
      const t = r.data;
      if (t.video_url || t.status === 'done') {
        const ownerId = _bgAvatarOwnerId;
        const doneTaskId = _bgAvatarTaskId;
        clearInterval(_bgAvatarPoller); _bgAvatarPoller = null; _bgAvatarTaskId = null; _bgAvatarOwnerId = null;
        // ★ 把视频URL存入正确任务的session，让用户回来后能直接恢复
        if (t.video_url && ownerId) {
          _savePartialSessionForTask(ownerId, 5, { avatarVideoUrl: t.video_url, avatarDoneTaskId: doneTaskId, avatarTaskId: null });
        }
        loadTasks();
        showToast('数字人视频已生成完成，请回到对应任务查看');
      } else if (t.status === 'error' || t.status === 'cancelled') {
        clearInterval(_bgAvatarPoller); _bgAvatarPoller = null; _bgAvatarTaskId = null; _bgAvatarOwnerId = null;
      }
    } catch { if (++failCount > 8) { clearInterval(_bgAvatarPoller); _bgAvatarPoller = null; _bgAvatarTaskId = null; _bgAvatarOwnerId = null; } }
  }, 8000);
}

// ★ TTS 后台轮询（切换任务后继续等待 IndexTTS 完成并存入正确任务session）
let _bgTTSJobId = null;
let _bgTTSOwnerId = null;
let _bgTTSPoller = null;

function _startBgTTSPoller(ttsJobId, ownerTaskId) {
  if (_bgTTSPoller) { clearTimeout(_bgTTSPoller); _bgTTSPoller = null; }
  _bgTTSJobId = ttsJobId;
  _bgTTSOwnerId = ownerTaskId;
  let failCount = 0;
  async function poll() {
    if (!_bgTTSJobId) return;
    try {
      const r = await api.get(`/ai/tts/indextts/task/${_bgTTSJobId}`);
      if (r.code === 200 && r.data) {
        const ownerId = _bgTTSOwnerId;
        _bgTTSJobId = null; _bgTTSOwnerId = null;
        const sessPatch = r.data.audio_url
          ? { ttsAudioB64: '__oss__', ttsOssUrl: r.data.audio_url, ttsAudioFmt: r.data.format || 'wav' }
          : { ttsAudioB64: r.data.audio, ttsAudioFmt: r.data.format || 'wav' };
        await _savePartialSessionForTask(ownerId, 3, sessPatch);
        loadTasks();
        showToast('语音已生成完成，请回到对应任务查看');
        return;
      }
      if (r.code === 500) { _bgTTSJobId = null; _bgTTSOwnerId = null; return; } // 失败，放弃
      if (++failCount > 80) { _bgTTSJobId = null; _bgTTSOwnerId = null; return; } // ~4分钟超时
      _bgTTSPoller = setTimeout(poll, 3000);
    } catch {
      if (++failCount > 8) { _bgTTSJobId = null; _bgTTSOwnerId = null; return; }
      _bgTTSPoller = setTimeout(poll, 3000);
    }
  }
  poll();
}

async function handleAvatarGenerate() {
  if (svcBlocked('video')) return;
  if (!S.ttsAudioUrl && !S.ttsAudioB64) { showToast('请先完成步骤3语音合成'); return; }
  if (!S.avatarSrcVideoB64 && !S.avatarLibKey) { showToast('请先上传或选择人脸视频'); return; }
  if (S.avatarGenerating) return;
  const runSeq = ++_avatarRunSeq;

  // 直接使用已有的 base64（跳过多余的 blob URL → fetch → re-encode 流程）
  let audioB64 = (S.ttsAudioB64 && S.ttsAudioB64 !== '__oss__') ? S.ttsAudioB64 : null;
  if (!audioB64 && S.ttsAudioUrl) {
    try {
      if (S.ttsAudioUrl.startsWith('blob:')) {
        // blob URL：浏览器本地读取
        const resp = await fetch(S.ttsAudioUrl);
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
        audioB64 = btoa(bin);
      } else {
        // OSS/外部 URL：走 Zeabur 服务端代理，避免浏览器 CORS 限制
        const r = await api.post('/ai/proxy-audio', { url: S.ttsAudioUrl });
        if (r.code === 200) audioB64 = r.data.audio;
        else throw new Error(r.msg || '代理下载失败');
      }
    } catch (e) {
      if (runSeq === _avatarRunSeq) setState({ avatarErr: '音频读取失败: ' + e.message });
      return;
    }
  }
  if (!audioB64) {
    setState({ avatarErr: '音频数据为空，请重新生成语音后再试' });
    return;
  }

  // ── 预检：5s 内 ping 一下数字人服务，失败立即报错，不等 90s 超时 ──
  setState({ avatarGenerating: true, avatarErr: '', extractStep: 'avatar_gen', avatarTaskId: null, avatarVideoUrl: null, avatarProgressMsg: '正在连接数字人服务...', avatarProgressPct: 10 });
  try {
    const hc = await api.get('/ai/video/health', AbortSignal.timeout(8000));
    if (runSeq !== _avatarRunSeq) return;
    if (hc.code !== 200) {
      setState({ avatarGenerating: false, avatarErr: '数字人服务不可达：' + (hc.msg || '请确认本地服务已启动，frp 穿透正常'), extractStep: 4 });
      return;
    }
  } catch {
    if (runSeq !== _avatarRunSeq) return;
    setState({ avatarGenerating: false, avatarErr: '数字人服务连接超时，请检查本地 HeyGem 服务和 frp 是否正常运行', extractStep: 4 });
    return;
  }

  setState({ avatarProgressMsg: '正在提交生成任务...', avatarProgressPct: 20 });
  touchCloneTaskActivity();

  // 60 秒提交超时（预检通过后服务应在线，减少等待）
  const _submitAbort = new AbortController();
  const _submitTimeout = setTimeout(() => _submitAbort.abort(), 60000);

  try {
    const saveAvatarName = !S.avatarLibKey && S._pendingAvatarSaveName;
    if (saveAvatarName) setState({ _pendingAvatarSaveName: null });
    const videoPayload = S.avatarLibKey
      ? { avatar_key: S.avatarLibKey, user_id: String(S.userInfo?.id || '') }
      : { video_b64: S.avatarSrcVideoB64, video_fmt: S.avatarSrcVideoFmt || 'mp4',
          ...(saveAvatarName ? { save_avatar_name: saveAvatarName } : {}) };
    const r = await api.post('/ai/video/generate', {
      audio_b64: audioB64,
      audio_fmt: 'wav',
      enhancer: S.avatarBeauty,
      ...videoPayload,
    }, _submitAbort.signal);
    clearTimeout(_submitTimeout);
    if (runSeq !== _avatarRunSeq) return;
    if (r.code !== 200 || !r.data?.task_id) {
      setState({ avatarGenerating: false, avatarErr: r.msg || '数字人生成任务提交失败', extractStep: 4 });
      return;
    }
    const taskId = r.data.task_id;
    if (runSeq !== _avatarRunSeq) {
      cancelRemoteAvatarTask(taskId);
      return;
    }
    setState({ avatarTaskId: taskId, avatarAsrUrl: null, avatarProgressMsg: '任务已提交，正在生成...' });
    saveCloneSession(4);
    _startAvatarPoller(taskId, null, runSeq);
  } catch (e) {
    clearTimeout(_submitTimeout);
    if (runSeq === _avatarRunSeq) {
      const isTimeout = e?.name === 'AbortError';
      setState({
        avatarGenerating: false,
        avatarErr: isTimeout
          ? '提交超时（60秒）：数字人服务无响应，请检查服务是否正常运行后重试'
          : ('数字人生成任务提交失败：' + (e?.message || '未知错误')),
        extractStep: 4,
      });
    }
  }
}

function _startAvatarPoller(taskId, asrUrl, runSeq = _avatarRunSeq) {
  if (_avatarPoller) clearInterval(_avatarPoller);
  let elapsed = 0;
  let pollFailCount = 0;
  let inFlight = false; // ★ 防并发锁：上一次轮询还没返回就不再发新请求，避免 done 时多次拉取 50MB video_b64 把上行打满
  _avatarPoller = setInterval(async () => {
    if (runSeq !== _avatarRunSeq || String(S.avatarTaskId || '') !== String(taskId)) {
      clearInterval(_avatarPoller); _avatarPoller = null;
      return;
    }
    if (inFlight) return; // 上一轮没回来，跳过本次 tick
    inFlight = true;
    elapsed += 10;
    try {
      const r = await api.get(`/ai/video/task/${taskId}`);
      if (r.code !== 200) {
        pollFailCount += 1;
        setState({ avatarProgressMsg: pollFailCount >= 3 ? '连接数字人服务不稳定，正在重试...' : '继续等待生成...' });
        return;
      }
      pollFailCount = 0;
      if (runSeq !== _avatarRunSeq || String(S.avatarTaskId || '') !== String(taskId)) return;
      const t = r.data;
      const pct = Math.max(S.avatarProgressPct || 0, Math.min(90, 10 + elapsed * 0.6));
      setState({ avatarProgressPct: pct, avatarProgressMsg: t.msg || '处理中...' });
      // OSS 上传中：提前记录 doneTaskId，避免切换任务后 session 仍走"恢复生成"路径
      if (t.oss_uploading && !S.avatarDoneTaskId) {
        setState({ avatarDoneTaskId: taskId });
        saveCloneSession(4);
      }

      if (t.status === 'done' && t.video_url) {
        // OSS 链接：直接用，无需经过 stream proxy
        if (runSeq !== _avatarRunSeq || String(S.avatarTaskId || '') !== String(taskId)) return;
        clearInterval(_avatarPoller); _avatarPoller = null;
        if (S.avatarVideoUrl && S.avatarVideoUrl.startsWith && S.avatarVideoUrl.startsWith('blob:')) {
          try { URL.revokeObjectURL(S.avatarVideoUrl); } catch {}
        }
        setState({ avatarGenerating: false, avatarVideoUrl: t.video_url, avatarVideoB64: null, avatarDoneTaskId: taskId, avatarTaskId: null, extractStep: 4, avatarProgressPct: 100 });
        saveCloneSession(5); // 数字人视频已就绪 → step5（进入后期步骤）
      } else if (t.status === 'done' && t.video_direct_url) {
        // 视频通过 frp 隧道传输，必须先完整下载成 blob 再播放，否则边传边播会不断转圈缓冲
        if (runSeq !== _avatarRunSeq || String(S.avatarTaskId || '') !== String(taskId)) return;
        clearInterval(_avatarPoller); _avatarPoller = null;
        // ★ 立即设 doneTaskId、清 taskId 并保存 session，确保切换任务后走 doneTaskId 恢复路径而非重启 poller
        setState({ avatarDoneTaskId: taskId, avatarTaskId: null, avatarProgressMsg: '视频生成完成，正在下载视频文件（视频较大请稍候…）', avatarProgressPct: Math.max(S.avatarProgressPct || 0, 92) });
        saveCloneSession(4); // 视频还在下载中，先保存 step4
        try {
          const streamUrl = `${API_BASE}/ai/video/stream/${taskId}?t=${encodeURIComponent(getToken())}`;
          const resp = await fetch(streamUrl);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          if (!blob.size) throw new Error('未收到视频文件');
          if (runSeq !== _avatarRunSeq) return;
          const mp4Blob = blob.type === 'video/mp4' ? blob : new Blob([blob], { type: 'video/mp4' });
          if (S.avatarVideoUrl?.startsWith('blob:')) URL.revokeObjectURL(S.avatarVideoUrl);
          setState({ avatarGenerating: false, avatarVideoUrl: URL.createObjectURL(mp4Blob), avatarVideoB64: null, extractStep: 4, avatarProgressPct: 100 });
          saveCloneSession(5); // 下载完成，视频可用 → step5
        } catch (e) {
          if (runSeq !== _avatarRunSeq) return;
          // 下载失败则降级为直接流式播放（会转圈但至少能看）
          const streamUrl = `${API_BASE}/ai/video/stream/${taskId}?t=${encodeURIComponent(getToken())}`;
          setState({ avatarGenerating: false, avatarVideoUrl: streamUrl, avatarVideoB64: null, extractStep: 4, avatarProgressPct: 100 });
          saveCloneSession(5); // 降级 URL 也是"视频可用" → step5
        }
      } else if (t.status === 'error') {
        clearInterval(_avatarPoller); _avatarPoller = null;
        setState({ avatarGenerating: false, avatarErr: t.error || '生成失败', extractStep: 4 });
      } else if (t.status === 'cancelled') {
        clearInterval(_avatarPoller); _avatarPoller = null;
        setState({ avatarGenerating: false, avatarTaskId: null, avatarAsrUrl: null, extractStep: 4, avatarErr: '已停止生成' });
      }
    } catch (e) {
      pollFailCount += 1;
      const msg = pollFailCount >= 3 ? '连接数字人服务不稳定，正在重试...' : '继续等待生成...';
      setState({ avatarProgressMsg: msg });
      console.error('[avatar poller]', e);
    } finally {
      inFlight = false;
    }
  }, 5000);
}

// 完全清空克隆工作区（用于重新开始 / 入口新建）
function resetCloneWorkspace(keepTaskId = true) {
  stopClonePoller();
  if (_avatarPoller) { clearInterval(_avatarPoller); _avatarPoller = null; }
  if (_bgAvatarPoller) { clearInterval(_bgAvatarPoller); _bgAvatarPoller = null; _bgAvatarTaskId = null; }
  _avatarRunSeq++;
  _ttsAbortFlag = true;
  const extra = keepTaskId ? {} : { cloneTaskId: null }; // 从入口新建时清掉任务ID，清空内容时保留
  setState({
    extractStep: 0, cloneTaskData: null, ...extra,
    extractedScript: '', rewrittenScript: '', extractErr: '', videoUrl: '',
    rewriteSourceExpanded: false,
    ttsAudioUrl: null, ttsAudioB64: null, ttsGenerating: false, ttsErr: '',
    avatarVideoUrl: null, avatarVideoB64: null,
    avatarTaskId: null, avatarDoneTaskId: null,
    avatarGenerating: false, avatarErr: '',
    avatarProgressPct: 0, avatarProgressMsg: '',
    avatarSrcVideoB64: null, avatarSrcVideoName: '',
    avatarLibKey: null, avatarLibName: '', avatarLibThumb: '',
    avatarSavePrompt: false, _step4AvatarLoaded: false,
    postProcessedVideoUrl: null, postProcessedB64: null, postProcessing: false,
    coverFrameUrl: null, publishTitle: '', publishTags: [],
  });
}

// 入口点击：生成中则继续，否则全新开始（清掉旧任务ID）
async function openCloneEntry() {
  if (S.ttsGenerating || S.avatarGenerating || S.postProcessing) {
    switchTab('extract'); // 有任务跑着，直接进去看，不中断
    return;
  }
  // 有已有任务但未在生成中 → 新建前弹确认（防止意外覆盖进行中的流程步骤）
  // 无任务直接新建
  resetCloneWorkspace(false);
  switchTab('extract');
}

function resetAvatarSelection() {
  // 停掉所有轮询
  if (_avatarPoller) { clearInterval(_avatarPoller); _avatarPoller = null; }
  if (_bgAvatarPoller) { clearInterval(_bgAvatarPoller); _bgAvatarPoller = null; _bgAvatarTaskId = null; }
  _avatarRunSeq++;
  // 清空数字人所有状态，回到步骤4选择界面
  setState({
    extractStep:       4,
    avatarVideoUrl:    null,
    avatarVideoB64:    null,
    avatarTaskId:      null,
    avatarDoneTaskId:  null,
    avatarGenerating:  false,
    avatarErr:         '',
    avatarProgressPct: 0,
    avatarProgressMsg: '',
    avatarSrcVideoB64: null,
    avatarSrcVideoName:'',
    avatarLibKey:      null,
    avatarLibName:     '',
    avatarLibThumb:    '',
    selectedAvatarId:  'self',
  });
  saveCloneSession(4);
}

function cancelRemoteAvatarTask(taskId, asrUrl) {
  if (!taskId) return;
  api.post(`/ai/video/cancel/${taskId}`, {}).catch(() => {
    if (!asrUrl) return;
    fetch(`${asrUrl}/video/cancel/${taskId}`, {
      method: 'POST',
    }).catch(() => {});
  });
}

function handleAvatarStop() {
  const taskId = S.avatarTaskId;
  const asrUrl = S.avatarAsrUrl;
  _avatarRunSeq++;
  if (_avatarPoller) { clearInterval(_avatarPoller); _avatarPoller = null; }
  cancelRemoteAvatarTask(taskId, asrUrl);
  setState({
    avatarGenerating: false,
    avatarTaskId: null,
    avatarAsrUrl: null,
    avatarProgressPct: 0,
    avatarProgressMsg: '',
    avatarErr: '已停止生成，可重新开始',
    extractStep: 4,
  });
  saveCloneSession(4);
}

async function handlePostProcess() {
  if (S.postProcessing) return;
  if (!S.avatarVideoUrl) { showToast('请先生成数字人视频'); return; }
  if (!S.ttsAudioB64)    { showToast('未找到语音数据，请返回步骤3重新合成'); return; }

  setState({ postProcessing: true, postProcessErr: '', postProgressPct: 5 });
  _startPostProgressTimer();
  touchCloneTaskActivity();
  try {
    const r2 = await api.post('/ai/video/postprocess', {
      video_task_id: S.avatarDoneTaskId || null,
      video_b64:     S.avatarVideoB64 || null,
      audio_b64:     S.ttsAudioB64,
      audio_fmt:     'mp3',
      sub_color:     S.subColor,
      outline_color: S.subOutlineColor,
      outline_width: S.subOutlineWidth,
      fontsize:      S.subFontsize,
      sub_style:     S.subStyle || 'default',
      source_text:    S.rewrittenScript || S.extractedScript || '',
      task_id:       S.cloneTaskId || null, // 用于 OSS key 命名
    });
    if (r2.code !== 200) throw new Error(r2.msg || '后期处理失败');
    const data = r2.data;

    // 优先用 OSS URL（持久化，可跨会话恢复）；无 OSS 则降级 base64 → blob URL
    let url;
    if (data.oss_url) {
      url = data.oss_url; // OSS 永久链接，直接用
    } else if (data.video_b64) {
      const raw = atob(data.video_b64);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      url = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }));
    } else {
      throw new Error('后期处理未返回视频');
    }
    _stopPostProgressTimer();
    // postProcessedB64 不再保存到 state（太大），OSS URL 已能持久化
    patchLocalCloneTaskStep(S.cloneTaskId, 5, { post_process_done: true }); // 立即更新首页卡片
    setState({ postProcessing: false, postProgressPct: 100, postProcessedVideoUrl: url });
    saveCloneSession(5); // ★ 步骤5：后期制作完成，保存 OSS URL 到 session
  } catch (e) {
    _stopPostProgressTimer();
    setState({ postProcessing: false, postProgressPct: 0, postProcessErr: e.message });
  }
}

// ===== 封面生成 =====
async function _extractFrame(videoUrl, seekSec) {
  // OSS/跨域 URL → 通过后端 CORS 代理转成 blob URL，避免 canvas toDataURL tainted 报错
  let srcUrl = videoUrl;
  let blobCreated = false;
  if (videoUrl && !videoUrl.startsWith('blob:') && !videoUrl.startsWith('data:')) {
    try {
      const proxyUrl = `${API_BASE}/ai/cors-proxy?url=${encodeURIComponent(videoUrl)}`;
      const resp = await fetch(proxyUrl, { headers: { 'Authorization': `Bearer ${getToken()}` } });
      if (resp.ok) {
        const blob = await resp.blob();
        srcUrl = URL.createObjectURL(blob);
        blobCreated = true;
      }
    } catch (proxyErr) {
      console.warn('[_extractFrame] 代理失败，回退原始 URL:', proxyErr.message);
    }
  }
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.src = srcUrl;
    const cleanup = () => { if (blobCreated) { try { URL.revokeObjectURL(srcUrl); } catch {} } };
    v.addEventListener('loadeddata', () => {
      v.currentTime = Math.min(seekSec, Math.max(0.1, (v.duration || 10) - 0.5));
    }, { once: true });
    v.addEventListener('seeked', () => {
      try {
        const c = document.createElement('canvas');
        c.width = v.videoWidth || 720;
        c.height = v.videoHeight || 1280;
        c.getContext('2d').drawImage(v, 0, 0);
        cleanup();
        resolve({ dataUrl: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height });
      } catch (e) { cleanup(); reject(e); }
    }, { once: true });
    v.addEventListener('error', () => { cleanup(); reject(new Error('视频加载失败')); }, { once: true });
    v.load();
  });
}

function _drawCoverText(frameDataUrl, title, w, h) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // 字号：宽度的 13%，不低于 44px（确保 >40px 要求）
      const fs = Math.max(44, Math.round(w * 0.13));
      const fontFace = '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
      ctx.font = `900 ${fs}px ${fontFace}`;
      ctx.textAlign = 'center';

      // 自动换行：每行不超过 7 个字
      const maxCharsPerLine = 7;
      const lines = [];
      for (let i = 0; i < title.length; i += maxCharsPerLine) {
        lines.push(title.slice(i, i + maxCharsPerLine));
      }

      const lineH = fs * 1.35;
      const totalH = lines.length * lineH;
      // 垂直居中偏下一点（黄金比例 0.55）
      const startY = h * 0.55 - totalH / 2 + fs;

      // 中间区域半透明暗底，让文字更易读
      const padV = fs * 0.6, padH = w * 0.08;
      const boxX = padH;
      const boxY = startY - fs - padV;
      const boxW = w - padH * 2;
      const boxH = totalH + padV * 2;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      const r = 16;
      ctx.beginPath();
      ctx.moveTo(boxX + r, boxY);
      ctx.lineTo(boxX + boxW - r, boxY);
      ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + r);
      ctx.lineTo(boxX + boxW, boxY + boxH - r);
      ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH);
      ctx.lineTo(boxX + r, boxY + boxH);
      ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - r);
      ctx.lineTo(boxX, boxY + r);
      ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 描边 + 填充文字（每行）
      ctx.lineJoin = 'round';
      ctx.lineWidth = fs * 0.12;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.fillStyle = '#FFFFFF';
      lines.forEach((line, i) => {
        const y = startY + i * lineH;
        ctx.strokeText(line, w / 2, y);
        ctx.fillText(line, w / 2, y);
      });

      resolve(c.toDataURL('image/jpeg', 0.92));
    };
    img.src = frameDataUrl;
  });
}

async function generateCover(seekSec, retitleOnly) {
  if (!S.avatarVideoUrl) { showToast('请先生成数字人视频'); return; }
  const t = isNaN(seekSec) ? 1.0 : Math.max(0.5, seekSec);
  setState({ coverGenerating: true });
  touchCloneTaskActivity();
  try {
    // 获取封面短标题
    let title = S.coverTitle;
    if (!title || retitleOnly) {
      const script = (S.rewrittenScript || S.extractedScript || '').trim();
      if (script) {
        const r = await api.post('/ai/cover-title', { script });
        title = (r.code === 200 && r.data?.title) ? r.data.title : script.slice(0, 7);
      } else {
        title = '精彩内容';
      }
    }
    // 抓帧（不带字幕用原始视频）
    const { dataUrl, w, h } = await _extractFrame(S.avatarVideoUrl, t);
    // 叠加文字
    const coverUrl = await _drawCoverText(dataUrl, title, w, h);
    setState({ coverGenerating: false, coverFrameUrl: coverUrl, coverTitle: title, coverSeekTime: t });
    saveCloneSession(6); // ★ 步骤6：封面生成完成，保存 session
  } catch (e) {
    setState({ coverGenerating: false });
    showToast('封面生成失败: ' + e.message);
  }
}

function goToCloneStep6() {
  setState({ extractStep: 6, publishCopied: false });
  saveCloneSession(6);
  // 自动触发标题生成：没有标题 或 有标题但没有简介时都重新生成
  if ((!S.publishTitle || !S.publishDesc) && !S.publishTitleLoading) handlePublishTitleGen();
  // 自动生成封面（有视频时）
  if (S.avatarVideoUrl && !S.coverFrameUrl && !S.coverGenerating) generateCover(1.0);
}

// mode: 'all'(默认) | 'title' | 'desc'
async function handlePublishTitleGen(mode = 'all') {
  if (!ensureLoggedIn()) return;
  const script = (S.rewrittenScript || S.extractedScript || '').trim();
  if (!script) return;
  const titleKey = mode === 'desc' ? {} : { publishTitleLoading: true };
  const descKey  = mode === 'title' ? {} : { publishDescLoading: true };
  setState({ ...titleKey, ...descKey });
  try {
    const r = await api.post('/ai/publish-info', { script: script.slice(0, 800) });
    if (r.code === 200) {
      const patch = { publishTitleLoading: false, publishDescLoading: false };
      if (mode !== 'desc') { patch.publishTitle = r.data.title || ''; patch.publishTags = r.data.tags || []; }
      if (mode !== 'title') { patch.publishDesc = r.data.description || ''; patch.publishTags = r.data.tags || []; }
      setState(patch);
      if (mode !== 'desc') { const el = document.getElementById('pub-title-el'); if (el) el.innerText = patch.publishTitle; }
      if (mode !== 'title') { const el = document.getElementById('pub-desc-el'); if (el) el.innerText = patch.publishDesc; }
    } else {
      setState({ publishTitleLoading: false, publishDescLoading: false });
      showToast(r.msg || '生成失败，请重试');
    }
  } catch {
    setState({ publishTitleLoading: false, publishDescLoading: false });
    showToast('网络错误，请重试');
  }
}

function handlePublishCopy(what) {
  let text = '';
  if (what === 'title') {
    text = S.publishTitle || '';
  } else if (what === 'desc') {
    const tags = S.publishTags.map(t => '#' + t).join(' ');
    text = [S.publishDesc, tags].filter(Boolean).join('\n');
  } else {
    const title = S.publishTitle || (S.rewrittenScript || S.extractedScript || '').slice(0, 28);
    const tags  = S.publishTags.map(t => '#' + t).join(' ');
    text = [title, S.publishDesc, tags].filter(Boolean).join('\n\n');
  }
  const key = what || 'all';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      setState({ publishCopied: key });
      setTimeout(() => setState({ publishCopied: false }), 1800);
    }).catch(() => showToast('复制失败，请手动复制'));
  } else {
    showToast('请手动复制：' + text.slice(0, 60));
  }
}

function downloadCover() {
  if (!S.coverFrameUrl) { showToast('请先生成封面'); return; }
  const a = document.createElement('a');
  a.href = S.coverFrameUrl;
  a.download = '封面_' + Date.now() + '.jpg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setState({ coverDownloaded: true });
  setTimeout(() => setState({ coverDownloaded: false }), 1800);
}

// ===== 任务 Session 持久化 =====