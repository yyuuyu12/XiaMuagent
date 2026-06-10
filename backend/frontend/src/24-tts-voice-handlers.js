async function handleTTSGenerate() {
  if (!ensureLoggedIn()) return;
  if (svcBlocked('tts')) return;
  const text = (S.rewrittenScript || '').trim();
  // 有音频说明文案曾存在（可能 session 恢复途中临时为空），允许继续
  if (!text && !(S.ttsAudioUrl || S.ttsAudioB64)) { showToast('请先完成文案改写'); setState({ extractStep: 2 }); return; }
  if (!text) return; // 有音频但文案为空，等 session 恢复完成再操作
  stopTTSAudio();
  _ttsAbortFlag = false;
  setState({ ttsGenerating: true, ttsErr: '', extractStep: 'tts_gen', ttsProgressPct: 5 });
  _startTTSProgressTimer();
  touchCloneTaskActivity();
  try {
    // 处理我的声音（my_xxx格式）
    let voiceId = S.ttsVoice;
    let indexRefAudio = null;
    let indexEmotion = S.ttsIndexEmotion || 'neutral';
    if (voiceId && voiceId.startsWith('my_')) {
      const myId = voiceId.slice(3);
      const myVoice = (S.myVoices || []).find(v => v.id === myId);
      if (!myVoice) { setState({ ttsGenerating: false, ttsErr: '声音不存在，请重新选择', extractStep: 3 }); return; }
      voiceId = 'indextts';
      indexRefAudio = myVoice.audio_b64;
      // 优先用UI上用户实时选的情绪，没选才降级到声音入库时保存的值
      indexEmotion = S.ttsIndexEmotion || myVoice.emotion || 'neutral';
    }
    const payload = { text: text.slice(0, 2000), voice: voiceId, speed: S.ttsSpeed };
    if (voiceId === 'cloned' && S.ttsCloneVoiceId) payload.cloneVoiceId = S.ttsCloneVoiceId;
    if (voiceId === 'indextts') {
      const refAudio = indexRefAudio || S.ttsIndexRefAudio;
      if (!refAudio) { setState({ ttsGenerating: false, ttsErr: '请先上传参考音频', extractStep: 3 }); return; }
      payload.indexRefAudio = refAudio;
      payload.indexEmotion = indexEmotion;
      // neutral 不传强度（不叠模板），其他情绪传用户设置的强度 0-10 → 0.0-1.0
      if (indexEmotion !== 'neutral') {
        payload.indexEmoAlpha = (S.ttsEmoIntensity != null ? S.ttsEmoIntensity : 5) / 10;
      }
    }
    const r = await api.post('/ai/tts', payload);
    if (r.code === 202 && r.task_id) {
      // IndexTTS 异步模式：轮询直到完成
      _currentTTSJobId = r.task_id; // ★ 记录供后台化使用
      setState({ ttsGenerating: true, ttsErr: '', extractStep: 'tts_gen' });
      await _pollIndexTTSTask(r.task_id);
      _currentTTSJobId = null; // ★ 正常结束时清除
      return;
    }
    if (r.code === 200) {
      const audioFmt = (r.data.format || 'mp3').toLowerCase();
      _stopTTSProgressTimer();
      if (r.data.audio_url) {
        // OSS URL：直接用，不走 frp 传输
        setState({ ttsGenerating: false, ttsProgressPct: 100, ttsAudioUrl: r.data.audio_url, ttsAudioB64: r.data.audio || null, ttsAudioFmt: audioFmt, extractStep: 3 });
      } else {
        // base64 降级：转成 Blob URL
        const audioMime = audioFmt === 'wav' ? 'audio/wav' : audioFmt === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
        const audioUrl = _b64ToBlobUrl(r.data.audio, audioMime);
        setState({ ttsGenerating: false, ttsProgressPct: 100, ttsAudioUrl: audioUrl, ttsAudioB64: r.data.audio, ttsAudioFmt: audioFmt, extractStep: 3 });
      }
      saveCloneSession(4); // ★ 步骤4：语音已完成，卡片显示"语音已生成"
    } else {
      _stopTTSProgressTimer();
      setState({ ttsGenerating: false, ttsProgressPct: 0, ttsErr: r.msg || '语音合成失败，请重试', extractStep: 3 });
    }
  } catch {
    _stopTTSProgressTimer();
    setState({ ttsGenerating: false, ttsProgressPct: 0, ttsErr: '网络错误，请重试', extractStep: 3 });
  }
}

async function _pollIndexTTSTask(taskId) {
  const ownerTaskId = S.cloneTaskId; // ★ 记录发起时的任务ID
  const maxWait = 20 * 60 * 1000;
  const start = Date.now();
  let pollCount = 0;
  while (Date.now() - start < maxWait) {
    // 前5次每1.5s查一次（覆盖大多数推理完成时机），之后每4s一次
    const interval = pollCount < 5 ? 1500 : 4000;
    pollCount++;
    if (_ttsAbortFlag || S.cloneTaskId !== ownerTaskId) { _stopTTSProgressTimer(); return; } // ★ abort 或已切换任务
    await new Promise(r => setTimeout(r, interval));
    if (_ttsAbortFlag || S.cloneTaskId !== ownerTaskId) { _stopTTSProgressTimer(); return; } // ★ 等待期间可能已切换
    try {
      const r = await api.get(`/ai/tts/indextts/task/${taskId}`);
      if (S.cloneTaskId !== ownerTaskId) return; // ★ 请求返回期间可能已切换
      if (r.code === 200 && r.data) {
        const audioFmt = (r.data.format || 'wav').toLowerCase();
        if (r.data.audio_url) {
          setState({ ttsGenerating: false, ttsAudioUrl: r.data.audio_url, ttsAudioB64: r.data.audio || null, ttsAudioFmt: audioFmt, extractStep: 3 });
        } else {
          const audioMime = audioFmt === 'wav' ? 'audio/wav' : 'audio/mpeg';
          const audioUrl = _b64ToBlobUrl(r.data.audio, audioMime);
          setState({ ttsGenerating: false, ttsAudioUrl: audioUrl, ttsAudioB64: r.data.audio, ttsAudioFmt: audioFmt, extractStep: 3 });
        }
        saveCloneSession(4); // ★ 步骤4：语音已完成，卡片显示"语音已生成"
        return;
      }
      if (r.code === 500) {
        setState({ ttsGenerating: false, ttsErr: r.msg || '声音克隆失败', extractStep: 3 });
        return;
      }
    } catch {
      // 网络抖动，继续等
    }
  }
  if (S.cloneTaskId === ownerTaskId) {
    setState({ ttsGenerating: false, ttsErr: '声音克隆超时，请重试', extractStep: 3 });
  }
}

function _b64ToBlobUrl(b64, mime) {
  try {
    const raw = atob(b64);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    return URL.createObjectURL(new Blob([buf], { type: mime }));
  } catch { return `data:${mime};base64,${b64}`; }
}

let _ttsAudio = null;

// 停止 TTS 音频播放（切步骤/重新合成时调用）
function stopTTSAudio() {
  if (_ttsAudio && !_ttsAudio.paused) {
    _ttsAudio.pause();
    _ttsAudio.currentTime = 0;
    _updatePlayBtn(false);
  }
}

function playTTSAudio() {
  if (!S.ttsAudioUrl) return;
  // 已有实例且是同一个URL：切换播放/暂停
  if (_ttsAudio && _ttsAudio._src === S.ttsAudioUrl) {
    if (_ttsAudio.paused) {
      _ttsAudio.play().catch(e => showToast('播放失败：' + e.message));
      _updatePlayBtn(true);
    } else {
      _ttsAudio.pause();
      _updatePlayBtn(false);
    }
    return;
  }
  // 停掉旧的
  if (_ttsAudio) { _ttsAudio.pause(); _ttsAudio = null; }
  try {
    _ttsAudio = new Audio(S.ttsAudioUrl);
    _ttsAudio._src = S.ttsAudioUrl;
    _ttsAudio.addEventListener('error', () => { showToast('播放失败'); _updatePlayBtn(false); });
    _ttsAudio.addEventListener('ended', () => { _updatePlayBtn(false); });
    _ttsAudio.play().catch(e => showToast('播放失败：' + e.message));
    _updatePlayBtn(true);
  } catch (e) { showToast('播放失败：' + e.message); }
}

function _updatePlayBtn(playing) {
  const btn = document.querySelector('.audio-play-btn');
  const card = document.querySelector('.voice-preview-card');
  if (card) card.classList.toggle('is-playing', !!playing);
  if (btn) {
    btn.innerHTML = playing
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  }
}

async function handleIndexRefAudioSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result.split(',')[1];
    setState({ ttsIndexRefAudio: base64, ttsIndexRefName: file.name });
    showToast('参考音频已加载');
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

async function handleCloneAudioSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  setState({ ttsCloning: true, ttsCloneErr: '' });
  try {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const base64 = e.target.result.split(',')[1];
        const r = await api.post('/ai/tts/clone', { audio: base64, audioName: file.name.replace(/\.[^.]+$/, '') || '我的音色' });
        if (r.code === 200) {
          const voiceId = r.data.voice_id;
          setState({ ttsCloning: false, ttsCloneVoiceId: voiceId, ttsVoice: 'cloned', ttsCloneErr: '' });
          api.post('/ai/voices/clone-id', { clone_voice_id: voiceId }).catch(() => {});
          showToast('音色克隆成功，已自动切换');
        } else {
          setState({ ttsCloning: false, ttsCloneErr: r.msg || '克隆失败，请重试' });
        }
      } catch (err) {
        setState({ ttsCloning: false, ttsCloneErr: '网络错误：' + err.message });
      }
    };
    reader.readAsDataURL(file);
  } catch (err) {
    setState({ ttsCloning: false, ttsCloneErr: '文件读取失败：' + err.message });
  }
  // 清空 input，允许同一文件重复上传
  event.target.value = '';
}

// ===== 声音库 =====
function selectVoice(id) {
  setState({ ttsVoice: id });
}

function gotoVoiceManager() {
  setState({ currentTab: 'profile', profileView: 'voices' });
}

function formatRecTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

function saveMyVoices(arr) {
  setState({ myVoices: arr });
}

async function loadMyVoices() {
  try {
    const r = await api.get('/ai/voices');
    if (r.code === 200) setState({ myVoices: r.data || [] });
  } catch(e) { console.warn('loadMyVoices:', e.message); }
}

// 检查 base64 音频时长，返回 Promise<{ok, seconds, msg}>
async function checkAudioB64(b64) {
  try {
    const raw = atob(b64);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await ctx.decodeAudioData(buf.buffer.slice(0));
    ctx.close();
    const secs = decoded.duration;
    if (secs < 3) return { ok: false, seconds: secs, msg: `音频太短（${secs.toFixed(1)}s），建议 5~30 秒清晰语音` };
    if (secs > 60) return { ok: false, seconds: secs, msg: `音频太长（${secs.toFixed(0)}s），请裁剪到 60 秒以内` };
    if (secs > 30) return { ok: true, seconds: secs, msg: `音频较长（${secs.toFixed(0)}s），建议使用 5~30 秒，过长会导致超时` };
    return { ok: true, seconds: secs, msg: '' };
  } catch {
    // 解码失败时不拦截，由服务端判断
    return { ok: true, seconds: 0, msg: '' };
  }
}

// 检查 base64 大小（字节）
function checkAudioSize(b64) {
  const bytes = Math.round(b64.length * 3 / 4);
  if (bytes > 8 * 1024 * 1024) return { ok: false, msg: `文件过大（${(bytes/1024/1024).toFixed(1)} MB），请压缩到 8 MB 以内` };
  return { ok: true };
}

async function addToMyVoiceLibrary(name, audio_b64, emotion) {
  const arr = [...(S.myVoices || [])];
  if (arr.length >= 8) { showToast('声音库已满（最多8个）'); return; }
  // 大小校验
  const sizeCheck = checkAudioSize(audio_b64);
  if (!sizeCheck.ok) { showToast(sizeCheck.msg); return; }
  // 时长校验
  const durCheck = await checkAudioB64(audio_b64);
  if (!durCheck.ok) { showToast(durCheck.msg); return; }
  if (durCheck.msg) showToast(durCheck.msg); // 仅警告，不拦截
  const id = Date.now().toString(36);
  arr.push({ id, name, audio_b64, emotion: emotion || 'neutral' });
  saveMyVoices(arr);
  // 持久化到 DB
  api.post('/ai/voices', { voice_key: id, name, emotion: emotion || 'neutral', audio_b64 }).catch(() => {});
  showToast(`声音已添加（${durCheck.seconds > 0 ? durCheck.seconds.toFixed(1)+'s' : ''}）`);
}

let _vmAudio = null;

function playMyVoice(id) {
  const voice = (S.myVoices || []).find(v => v.id === id);
  if (!voice) return;

  // 同一个 — 切换播放/暂停
  if (_vmAudio && _vmAudio._vmId === id) {
    if (_vmAudio.paused) {
      _vmAudio.play();
      setState({ vmPlayingId: id });
    } else {
      _vmAudio.pause();
      setState({ vmPlayingId: '' });
    }
    return;
  }

  // 停掉上一个
  if (_vmAudio) { _vmAudio.pause(); _vmAudio = null; }

  // 把 base64 转成 Blob URL 再播（移动端兼容好）
  try {
    const raw = atob(voice.audio_b64);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    _vmAudio = new Audio(url);
    _vmAudio._vmId = id;
    _vmAudio.onended = () => setState({ vmPlayingId: '' });
    _vmAudio.onerror = () => { showToast('播放失败'); setState({ vmPlayingId: '' }); };
    _vmAudio.play().catch(e => { showToast('播放失败：' + e.message); setState({ vmPlayingId: '' }); });
    setState({ vmPlayingId: id });
  } catch (e) {
    showToast('播放失败：' + e.message);
  }
}

function deleteMyVoice(id) {
  const arr = (S.myVoices || []).filter(v => v.id !== id);
  saveMyVoices(arr);
  if (S.ttsVoice === 'my_' + id) setState({ ttsVoice: 'xiaoxiao' });
  fetch(`/api/ai/voices/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${getToken()}` } }).catch(() => {});
}

async function handleVMUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  const reader = new FileReader();
  reader.onload = (e) => {
    const b64 = e.target.result.split(',')[1];
    const name = file.name.replace(/\.[^.]+$/, '') || '我的声音';
    addToMyVoiceLibrary(name, b64, 'neutral');
  };
  reader.readAsDataURL(file);
}

let _recMediaRecorder = null;
let _recChunks = [];
let _recTimer = null;

async function startMicRecording() {
  if (S.recordingState === 'recording') return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _recChunks = [];
    _recMediaRecorder = new MediaRecorder(stream);
    _recMediaRecorder.ondataavailable = e => { if (e.data.size > 0) _recChunks.push(e.data); };
    _recMediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(_recChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = (ev) => {
        const b64 = ev.target.result.split(',')[1];
        const name = '录音_' + new Date().toLocaleTimeString('zh-CN', { hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit' }).replace(/:/g,'-');
        addToMyVoiceLibrary(name, b64, 'neutral');
      };
      reader.readAsDataURL(blob);
    };
    _recMediaRecorder.start();
    setState({ recordingState: 'recording', recordingSeconds: 0 });
    _recTimer = setInterval(() => {
      const secs = (S.recordingSeconds || 0) + 1;
      S.recordingSeconds = secs;
      const el = document.getElementById('recTimer');
      if (el) el.textContent = formatRecTime(secs);
      const bar = document.querySelector('.path-a-progress-fill');
      if (bar) bar.style.width = Math.min(100, secs / 30 * 100) + '%';
      if (secs >= 60) stopMicRecording(); // 最长1分钟
    }, 1000);
  } catch (err) {
    showToast('麦克风权限被拒绝：' + (err.message || err));
  }
}

function stopMicRecording() {
  if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
  if (_recMediaRecorder && _recMediaRecorder.state !== 'inactive') {
    _recMediaRecorder.stop();
  }
  setState({ recordingState: 'idle' });
}

// ===== 语速滑块（不触发setState防止抖动）=====
function onEmoIntensityInput(el) {
  const v = parseInt(el.value);
  S.ttsEmoIntensity = v;
  // 更新滑块颜色和标签，不触发 setState 重绘避免抖动
  const pct = v / 10 * 100;
  el.style.background = `linear-gradient(to right,#F97316 ${pct}%,#E8E4DC ${pct}%)`;
  const lbl = el.closest('.section-card').querySelector('span[style*="font-weight:700"]');
  if (lbl) lbl.firstChild.textContent = v + ' ';
}

function onSpeedInput(val) {
  S.ttsSpeed = val / 100;
  const lbl = document.getElementById('speedLabel');
  if (lbl) lbl.textContent = S.ttsSpeed.toFixed(1) + 'x';
  const slider = document.getElementById('speedSlider');
  if (slider) {
    const pct = Math.round((S.ttsSpeed - 0.5) / 1.5 * 100);
    slider.style.background = `linear-gradient(to right,#FF6B35 ${pct}%,#E8E4DC ${pct}%)`;
  }
}

function setTTSSpeedPreset(v) {
  setState({ ttsSpeed: v });
}

function goToCloneStep2() {
  stopTTSAudio();
  // 仅导航回改写页，不清除音频 session —— 音频在用户主动"重新改写"时才清除
  setState({ extractStep: 2, ttsErr: '' });
}

function goToCloneStep4() {
  stopTTSAudio();
  // 进入数字人步骤时清除旧视频数据：新语音对应新视频，避免旧 avatarDoneTaskId 触发假加载
  setState({ extractStep: 4, avatarErr: '', avatarDoneTaskId: null, avatarVideoUrl: null, avatarVideoB64: null });
  saveCloneSession(4); // 进入步骤4时立刻保存，防止离开后恢复回步骤3
}

function goToCloneStep5() {
  setState({ extractStep: 5 });
  saveCloneSession(5);
}
