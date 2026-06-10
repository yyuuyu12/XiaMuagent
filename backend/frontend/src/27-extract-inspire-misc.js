async function openExtractWithTask(taskId, fromHistory) {
  // ★ 生成中切换任务拦截：语音/数字人/后期处理进行时弹确认框
  const isGenerating = S.ttsGenerating || S.avatarGenerating || S.postProcessing;
  if (isGenerating && String(S.cloneTaskId) !== String(taskId)) {
    const genLabel = S.ttsGenerating ? '语音生成' : S.avatarGenerating ? '数字人视频生成' : '字幕烧录';
    const ok = await showConfirmModal({
      title: `${genLabel}进行中`,
      body: `切换任务将会导致当前 ${genLabel} 进展中断，确定要切换吗？`,
      confirmText: '切换任务',
      cancelText: '继续等待',
      confirmDanger: true,
    });
    if (!ok) return; // 用户选"继续等待"，不切换
  }
  // 刷新 last_operated_at，小卡点击立即变大卡
  api.post(`/tasks/${taskId}/touch`).catch(()=>{});
  // 如果当前任务正在生成数字人，转为后台轮询，HeyGem 继续跑
  if (S.avatarGenerating && S.avatarTaskId) {
    _startBgAvatarPoller(S.avatarTaskId);
    showToast('数字人生成中，已转至后台，回到该任务可继续查看进度');
  }
  // ★ 停掉所有前台 poller，避免旧任务的 poller 继续写入新任务的步骤状态
  stopClonePoller();  // 防止重新打开任务时旧 clonePoller 和新流程竞争覆盖 extractStep
  if (_avatarPoller) { clearInterval(_avatarPoller); _avatarPoller = null; }
  _avatarRunSeq++;

  // ★ 立即重置所有生成中状态，防止切换任务时上一个任务的状态残留
  // 同时从本地 tasksList 读取已知 clone_step，先跳到正确步骤再等接口返回
  const _cachedTask = (S.tasksList || []).find(t => String(t.id) === String(taskId));
  const _initStep = (() => {
    if (!_cachedTask) return 0;
    const s = _cachedTask.clone_step || 1;
    const st = _cachedTask.status;
    if (st === 'pending' || st === 'running') return ((_cachedTask.stage === 'rewrite' || _cachedTask.stage === 'extracted') ? 'rewriting' : 'cloning');
    // 阶段 → UI 步骤精确映射（done / extracted 共享）：
    // 后期完成 → step5，数字人完成 → step4，TTS/改写完成 → step3，仅提取完成 → step2
    if (st === 'extracted' || st === 'done') {
      if (s >= 6) return 6;   // 发布页（曾到发布步骤）→ 直接恢复到发布页
      if (_cachedTask.post_process_done) return 5;
      if (s >= 5) return 4;   // 数字人完成 → 数字人页
      if (s >= 4) return 3;   // TTS 完成（有音频）→ 语音页
      if (s >= 3) return 2;   // 仅改写完成（无 TTS）→ 改写页，不跳到语音
      if (st === 'extracted' && s <= 1) return 'review';
      return s >= 2 ? 2 : 0;
    }
    return 0;
  })();
  setState({
    currentTab: 'extract', cloneTaskId: taskId, cloneTaskData: null,
    extractStep: _initStep,
    cloneTaskLoading: true,        // ★ 恢复 session 期间禁止步骤3的"请先改写"拦截
    extractErr: '', extractFromHistory: !!fromHistory,
    avatarGenerating: false, avatarTaskId: null, avatarAsrUrl: null,
    avatarVideoUrl: null, avatarVideoB64: null, avatarErr: '',
    avatarProgressPct: 0, avatarProgressMsg: '',
    ttsAudioUrl: null, ttsAudioB64: null, ttsGenerating: false, ttsErr: '',
    postProcessedVideoUrl: null, postProcessedB64: null, postProcessing: false,
    coverFrameUrl: null, rewrittenScript: '', extractedScript: '', rewriteSourceExpanded: false,
  });
  try {
    const r = await api.get(`/tasks/${taskId}`);
    if (r.code !== 200) { setState({ cloneTaskLoading: false, extractStep: 0 }); return; }
    const task = r.data;
    setState({ cloneTaskData: task });
    if (task.status === 'extracted') {
      const restoredEx = await restoreCloneSession(taskId);
      if (!restoredEx) {
        setState({ cloneTaskLoading: false, extractStep: 'review', extractedScript: task.result?.transcript || '' });
      } else {
        setState({ cloneTaskLoading: false, extractedScript: task.result?.transcript || '' });
      }
    } else if (task.status === 'pending' || task.status === 'running') {
      setState({ cloneTaskLoading: false, extractStep: (task.stage === 'rewrite' || task.stage === 'extracted') ? 'rewriting' : 'cloning' });
      startClonePoller(taskId);
    } else if (task.status === 'done') {
      const rewritten = task.result?.rewritten || task.result?.scripts?.[0]?.content || '';
      const restored = await restoreCloneSession(taskId);
      if (!restored) {
        // session 不存在时：必须与 _initStep 的映射一致，避免出现"先 step2 → 再跳 step3"的闪烁
        // 注意：单任务接口的 task.clone_step 为 null（tasks 表无此列），需用列表缓存值
        // 后期完成 → 5；数字人完成 → 4；TTS 完成（s>=4）→ 3；仅改写完成（s=3）→ 2；仅提取 → 2
        const apiStep = Number(_cachedTask?.clone_step || task.clone_step) || 2;
        const postDone = !!(_cachedTask?.post_process_done || task.post_process_done);
        const fallbackStep = postDone ? 5
                          : apiStep >= 5 ? 4
                          : apiStep >= 4 ? 3
                          : 2;
        setState({ cloneTaskLoading: false, extractStep: fallbackStep, rewrittenScript: rewritten, extractedScript: task.result?.transcript || '' });
      } else {
        setState({ cloneTaskLoading: false, rewrittenScript: rewritten, extractedScript: task.result?.transcript || '' });
      }
    } else {
      setState({ cloneTaskLoading: false, extractStep: 0 });
    }
  } catch { setState({ cloneTaskLoading: false, extractStep: 0 }); }
}
async function startCloneRewrite(taskId) {
  try {
    const r = await api.post(`/tasks/${taskId}/start-rewrite`, {});
    if (r.code === 200) { loadTasks(); startTasksPolling(); startTasksTickTimer(); }
    else showToast(r.msg || '触发改写失败');
  } catch { showToast('网络错误，请重试'); }
}

function stopExtractTranscribe() {
  if (extractTranscribeController) {
    extractTranscribeController.abort();
    extractTranscribeController = null;
    S.extractTranscribeController = null;
  }
  setState({ extractLoading: false, extractErr: '' });
}
function resetExtract() {
  if (extractController) {
    extractController.abort();
    extractController = null;
    S.extractController = null;
  }
  if (extractTranscribeController) {
    extractTranscribeController.abort();
    extractTranscribeController = null;
    S.extractTranscribeController = null;
  }
  stopClonePoller();
  setState({ extractStep: 0, videoUrl: '', extractedScript: '', rewrittenScript: '', rewriteSourceExpanded: false, extractErr: '', rewriteStyle: '', rewriteGenerating: false, extractLoading: false, cloneTaskId: null, cloneTaskData: null, extractFromHistory: false,
    ttsVoice: 'xiaoxiao', ttsSpeed: 1.0, ttsGenerating: false, ttsAudioUrl: null, ttsErr: '',
    ttsCloning: false, ttsCloneErr: '',
    ttsIndexRefAudio: null, ttsIndexRefName: '', ttsIndexEmotion: 'neutral', ttsEmoIntensity: 5,
    selectedAvatarId: 'self', avatarBeauty: true, avatarClipBreath: true,
    videoColorStyle: 'warm', videoSubtitle: true, videoMusic: false,
    publishTitle: '', publishDesc: '', publishTags: [], publishTitleLoading: false, publishCoverIdx: 0, publishCopied: false });
}
function selectStyle(s) { setState({ rewriteStyle: S.rewriteStyle === s ? '' : s }); }
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    setState({ videoUrl: text });
  } catch { showToast('请手动长按粘贴'); }
}
function copyExtracted() { copyText(S.extractedScript); setState({ copiedId: 'extracted' }); setTimeout(()=>setState({copiedId:''}),1500); }
function copyRewritten() {
  if (!(S.rewrittenScript || '').trim()) { showToast('改写文案为空'); return; }
  copyText(S.rewrittenScript);
  setState({ copiedId: 'rewritten' });
  setTimeout(()=>setState({copiedId:''}),1500);
}

// ===== INSPIRE =====
function selectIndustry(id, name) {
  if (S.selectedIndustryId === id) setState({ selectedIndustryId: null, selectedIndustryName: '' });
  else setState({ selectedIndustryId: id, selectedIndustryName: name, customTrack: '' });
}
async function handleInspire() {
  if (!ensureLoggedIn()) return;
  const track = S.customTrack.trim() || S.selectedIndustryName;
  if (!track || S.inspireLoading) return;
  inspireController = new AbortController();
  setState({ inspireLoading: true, inspireErr: '', inspireScripts: [], matchedIndustry: '' });
  const body = S.selectedIndustryId
    ? { track: S.selectedIndustryName, industryId: S.selectedIndustryId }
    : { track: S.customTrack.trim() };
  try {
    const r = await api.post('/ai/inspire', body, inspireController.signal);
    inspireController = null;
    if (apiUnauthorized(r)) setState({ inspireLoading: false });
    else if (r.code === 200) {
      setState({ inspireScripts: r.data.scripts||[], matchedIndustry: r.data.matchedIndustry||'', expandedScript: null, inspireLoading: false });
      fetchMe(); refreshHistory();
    } else setState({ inspireErr: r.msg||'生成失败，请重试', inspireLoading: false });
  } catch(e) {
    inspireController = null;
    if (e.name !== 'AbortError') setState({ inspireErr: '网络错误，请稍后重试', inspireLoading: false });
    else setState({ inspireLoading: false });
  }
}
function stopInspire() {
  if (inspireController) { inspireController.abort(); inspireController = null; setState({ inspireLoading: false }); }
}
function resetInspire() { setState({ inspireScripts:[], selectedIndustryId:null, selectedIndustryName:'', customTrack:'', matchedIndustry:'', expandedScript:null, inspireErr:'' }); }
function toggleScript(i) { setState({ expandedScript: S.expandedScript===i?null:i }); }
function cpInspire(e, i) {
  e.stopPropagation();
  const s = S.inspireScripts[i];
  copyText(s ? (s.content||s.hook) : '');
  setState({ copiedId: 'inspire_'+i });
  setTimeout(()=>setState({copiedId:''}),1500);
}
async function doExpand(e, i) {
  e.stopPropagation();
  if (!ensureLoggedIn()) return;
  const s = S.inspireScripts[i];
  const track = S.customTrack.trim() || S.selectedIndustryName;
  setState({ inspireLoading: true, inspireErr: '' });
  try {
    const r = await api.post('/ai/inspire-expand', { hook: s.hook, content: s.content, track });
    if (apiUnauthorized(r)) setState({ inspireLoading: false });
    else if (r.code === 200) {
      setState({ inspireScripts: [...(r.data.scripts||[]), ...S.inspireScripts], expandedScript: 0, inspireLoading: false });
      fetchMe(); refreshHistory();
    } else setState({ inspireErr: r.msg||'扩写失败', inspireLoading: false });
  } catch { setState({ inspireErr: '网络错误', inspireLoading: false }); }
}
async function toggleHistory() {
  if (!S.showHistory) {
    if (!ensureLoggedIn()) return;
    if (!S.historyLoaded) await loadHistory();
  }
  setState({ showHistory: !S.showHistory });
}
async function loadHistory() {
  if (!getToken()) return;
  try {
    const r = await api.get('/history?type=inspire');
    if (apiUnauthorized(r)) return;
    if (r.code === 200) { S.inspireHistory = r.data||[]; S.historyLoaded = true; }
  } catch {}
}
async function clearHistory() {
  if (!ensureLoggedIn()) return;
  if (!confirm('确定清空所有历史记录吗？')) return;
  try { await api.del('/history?type=inspire'); setState({ inspireHistory:[], historyLoaded:false }); showToast('已清空'); }
  catch { showToast('操作失败'); }
}
function toggleHistoryItem(i) { setState({ historyExpanded: S.historyExpanded===i?null:i }); }
function cpHistory(e, hi, si) {
  e.stopPropagation();
  const it = S.inspireHistory[hi];
  if (!it||!it.result) return;
  copyText(scriptCopyText(it.result[si]));
  showToast('已复制');
}

// ===== PROFILE =====
function toggleAvatarPicker() { openProfileEdit(); }
async function selectAvatar(i) {
  const nextInfo = S.userInfo ? { ...S.userInfo, avatar: i, avatar_image: null } : S.userInfo;
  setState({ userAvatar: i, showAvatarPicker: false, userInfo: nextInfo });
  try {
    await api.post('/auth/update-avatar', { avatar: i });
    const user = getUser()||{}; setUser({...user, avatar:i, avatar_image:null});
    if (S.userInfo) { S.userInfo = {...S.userInfo, avatar:i, avatar_image:null}; }
    fetchMe();
  } catch {}
}
function openProfileEdit() {
  setState({
    profileView: 'edit',
    showAvatarPicker: false,
    nicknameEditInput: S.userName === '创作者' ? '' : S.userName,
  });
  setTimeout(() => { const el = document.getElementById('f-profile-nick'); if (el) el.focus(); }, 80);
}
function goProfileEditBack() {
  setState({ profileView: 'main', avatarCropOpen: false, avatarCropDataUrl: '' });
}
function onAvatarFile(ev) {
  const f = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) { showToast('图片需小于 5MB'); return; }
  loadAvatarImage(f).then(({ dataUrl, width, height }) => {
    setState({
      avatarCropOpen: true,
      avatarCropDataUrl: dataUrl,
      avatarCropMeta: { width, height },
      avatarCropScale: 100,
      avatarCropX: 0,
      avatarCropY: 0,
    });
  }).catch(() => showToast('图片处理失败'));
}
function loadAvatarImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ dataUrl: String(reader.result || ''), width: img.width, height: img.height });
      img.onerror = () => reject(new Error('bad image'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('read fail'));
    reader.readAsDataURL(file);
  });
}
function setAvatarCropScale(v) {
  const percent = Math.max(20, Math.min(220, Number(v) || 100));
  setState({ avatarCropScale: percent });
}
function startAvatarDrag(e) {
  if (!S.avatarCropOpen) return;
  S._avatarDrag = { x: e.clientX, y: e.clientY, ox: S.avatarCropX || 0, oy: S.avatarCropY || 0 };
}
function moveAvatarDrag(e) {
  if (!S._avatarDrag) return;
  const dx = e.clientX - S._avatarDrag.x;
  const dy = e.clientY - S._avatarDrag.y;
  S.avatarCropX = S._avatarDrag.ox + dx;
  S.avatarCropY = S._avatarDrag.oy + dy;
  render();
}
function endAvatarDrag() {
  S._avatarDrag = null;
}
function cancelAvatarCrop() {
  setState({ avatarCropOpen: false, avatarCropDataUrl: '', avatarCropMeta: null, avatarCropScale: 100, avatarCropX: 0, avatarCropY: 0 });
}
async function confirmAvatarCrop() {
  if (!S.avatarCropDataUrl || !S.avatarCropMeta) return;
  const outSize = 420;
  const previewSize = 220;
  const scale = Math.max(0.2, Number(S.avatarCropScale || 100) / 100);
  const x = Number(S.avatarCropX || 0);
  const y = Number(S.avatarCropY || 0);
  const source = new Image();
  source.src = S.avatarCropDataUrl;
  await new Promise((res, rej) => { source.onload = res; source.onerror = rej; });
  const base = Math.max(previewSize / source.width, previewSize / source.height);
  const drawScale = base * scale;
  const drawW = source.width * drawScale;
  const drawH = source.height * drawScale;
  const canvas = document.createElement('canvas');
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext('2d');
  const ratio = outSize / previewSize;
  const dx = ((previewSize - drawW) / 2 + x) * ratio;
  const dy = ((previewSize - drawH) / 2 + y) * ratio;
  ctx.drawImage(source, dx, dy, drawW * ratio, drawH * ratio);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  try {
    const r = await api.put('/auth/profile', { avatar_image: dataUrl });
    if (r.code !== 200) { showToast(r.msg || '上传失败'); return; }
  } catch { showToast('网络错误'); return; }
  setState({ avatarCropOpen: false, avatarCropDataUrl: '', avatarCropMeta: null, avatarCropScale: 1, avatarCropX: 0, avatarCropY: 0 });
  await fetchMe();
  showToast('头像已更新');
}
async function saveProfileEdit() {
  const name = S.nicknameEditInput.trim();
  if (!name) { showToast('请输入昵称'); return; }
  const brandEl = document.getElementById('f-profile-brand');
  const brandName = brandEl ? brandEl.value.trim() : (S.userInfo?.brand_name || '');
  try {
    const r = await api.put('/auth/profile', { nickname: name, brand_name: brandName });
    if (r.code !== 200) { showToast(r.msg || '保存失败'); return; }
  } catch { showToast('网络错误'); return; }
  const user = getUser() || {};
  setUser({ ...user, nickname: name });
  if (S.userInfo) S.userInfo = { ...S.userInfo, nickname: name, brand_name: brandName };
  setState({ userName: name, profileView: 'main' });
  showToast('已保存');
  fetchMe();
}
async function loadAppH5Settings() {
  try {
    const r = await api.get('/config/app-h5-settings');
    if (r.code === 200 && r.data) {
      S.appH5 = { showProfilePhone: !!r.data.showProfilePhone, showAccountType: !!r.data.showAccountType };
      render();
    }
  } catch {}
}
function openHistoryFromProfile() {
  setState({ currentTab: 'history', historyTab: 'inspire', historyPageExpanded: null, tasksView: 'list', historyFromProfile: true });
  loadTasks();
}
async function handleActivateCode() {
  if (!ensureLoggedIn()) return;
  const code = S.authCodeInput.trim();
  if (!code || S.authCodeLoading) return;
  setState({ authCodeLoading: true, authCodeMsg: '' });
  try {
    const r = await api.post('/auth/activate-code', { code });
    if (r.code === 200) {
      setState({ authCodeLoading: false, authCodeInput: '' });
      await fetchMe();
      showToast('激活成功！');
      setTimeout(() => setState({ showAuthCodeSheet: false }), 1200);
    } else setState({ authCodeMsg: r.msg||'激活失败', authCodeOk:false, authCodeLoading:false });
  } catch { setState({ authCodeMsg:'网络错误，请稍后重试', authCodeOk:false, authCodeLoading:false }); }
}
function handleLogout() {
  if (!confirm('确定要退出登录吗？')) return;
  clearAuth();
  setState({ page:'login', currentTab:'home', showAuthSheet:false, userInfo:null, userName:'创作者', userPhone:'', userAvatar:0, phone:'', password:'', smsCode:'', smsSent:false, smsCountdown:0, authErr:'', authMode:'sms', recentHistory:[], recentHistoryLoaded:false, homeHistory:[], homeHistoryLoaded:false, extractHistory:[], extractHistoryLoaded:false, inspireHistory:[], historyLoaded:false, cloneHistory:[], cloneHistoryLoaded:false, nicknamePrompt:false, nicknamePromptDismissed:false, profileView:'main', avatarCropOpen:false, avatarCropDataUrl:'' });
}

// ===== 数字人管理 =====
async function openAvatarMgmt(mode) {
  if (!S.userInfo) { openAuthSheet(); return; }
  setState({
    showAvatarMgmt: true,
    avatarMgmtMode: mode || 'manage',
    avatarMgmtErr: '',
    avatarMgmtUploadName: '',
    avatarMgmtPendingFile: null,
    avatarMgmtPendingFileName: '',
    avatarMgmtPendingFileSize: 0,
  });
  await loadAvatarList();
}

async function loadAvatarList() {
  const u = S.userInfo;
  if (!u) return;
  setState({ avatarMgmtLoading: true, avatarMgmtErr: '' });
  try {
    const r = await api.get('/ai/avatar/list');
    if (r.code !== 200) { setState({ avatarMgmtLoading: false, avatarMgmtErr: '加载失败：' + r.msg }); return; }
    setState({ avatarMgmtList: r.data || [], avatarMgmtLoading: false });
  } catch(e) {
    setState({ avatarMgmtLoading: false, avatarMgmtErr: '加载失败：' + e.message });
  }
}

function formatAvatarFileSize(size) {
  if (!size) return '';
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function handleAvatarMgmtFileSelect(ev) {
  const file = ev && ev.target && ev.target.files && ev.target.files[0];
  if (!file) return;
  if (file.size > 300 * 1024 * 1024) {
    setState({ avatarMgmtErr: '视频过大，请压缩到 300MB 以内后再上传' });
    return;
  }
  const fallbackName = file.name.replace(/\.[^.]+$/, '');
  setState({
    avatarMgmtPendingFile: file,
    avatarMgmtPendingFileName: file.name,
    avatarMgmtPendingFileSize: file.size || 0,
    avatarMgmtUploadName: S.avatarMgmtUploadName.trim() || fallbackName,
    avatarMgmtErr: '',
  });
}

async function submitAvatarUpload() {
  const u = S.userInfo;
  const file = S.avatarMgmtPendingFile;
  if (!u) return;
  if (!file) { setState({ avatarMgmtErr: '请先选择要上传的视频' }); return; }
  if (S.avatarMgmtUploading) return;
  setState({ avatarMgmtUploading: true, avatarMgmtErr: '' });
  try {
    const fd = new FormData();
    fd.append('user_id', String(u.id));
    fd.append('name', S.avatarMgmtUploadName.trim() || file.name.replace(/\.[^.]+$/, ''));
    fd.append('video', file);
    const r = await fetch('/api/ai/avatar/upload', { method: 'POST', headers: { 'Authorization': `Bearer ${getToken()}` }, body: fd });
    if (!r.ok) { const t = await r.json().catch(()=>({})); throw new Error(t.msg || r.statusText); }
    const resp = await r.json();
    if (resp.code !== 200) throw new Error(resp.msg || '上传失败');
    setState({
      avatarMgmtUploading: false,
      avatarMgmtUploadName: '',
      avatarMgmtPendingFile: null,
      avatarMgmtPendingFileName: '',
      avatarMgmtPendingFileSize: 0,
    });
    showToast('上传成功 ✓');
    await loadAvatarList();
  } catch(e) {
    setState({ avatarMgmtUploading: false, avatarMgmtErr: '上传失败：' + e.message });
  }
}

async function deleteAvatar(avatarId) {
  if (!confirm('确定删除这个数字人吗？')) return;
  const u = S.userInfo;
  try {
    const urlR = await api.get('/ai/asr-url');
    const asrUrl = urlR.data.url.replace(/\/$/, '');
    await fetch(`${asrUrl}/avatar/${u.id}/${avatarId}`, { method: 'DELETE' });
    setState({ avatarMgmtList: S.avatarMgmtList.filter(a => a.id !== avatarId) });
    showToast('已删除');
  } catch(e) { showToast('删除失败'); }
}

function selectAvatarFromLib(avatar) {
  setState({
    showAvatarMgmt: false,
    avatarLibKey: avatar.key,
    avatarLibName: avatar.name,
    avatarLibThumb: avatar.thumbnail || '',
    avatarSrcVideoB64: null,
    avatarSrcVideoName: '',
    _avatarSrcBlobUrl: null,
  });
  showToast(`已选择：${avatar.name}`);
}

// ── Step4 本地视频选择（带保存提示） ──
let _avatarPendingFile = null;

async function handleAvatarLocalSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  if (file.size > 200 * 1024 * 1024) { showToast('视频过大（>200MB），请压缩后上传'); return; }
  const fmt = file.type.includes('quicktime') || file.name.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4';
  _avatarPendingFile = file;
  const today = new Date();
  const defaultName = `我的数字人_${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
  setState({ avatarSavePrompt: true, avatarSavePromptName: defaultName, avatarSavePromptFmt: fmt });
}

function tAvatarSavePrompt() {
  return `<div style="position:fixed;inset:0;background:rgba(0,0,0,0.52);z-index:2000;display:flex;align-items:flex-end;justify-content:center"
    onclick="if(event.target===this)setState({avatarSavePrompt:false})">
    <div style="background:#fff;border-radius:24px 24px 0 0;padding:28px 22px 36px;width:100%;max-width:480px;box-shadow:0 -8px 40px rgba(0,0,0,0.15)">
      <div style="width:36px;height:4px;background:#E0DDD8;border-radius:4px;margin:0 auto 22px"></div>
      <div style="font-size:18px;font-weight:700;color:#1A1614;margin-bottom:6px">要保存为数字人模板吗？</div>
      <div style="font-size:13px;color:#9E9890;margin-bottom:20px;line-height:1.5">保存后下次可直接选用，无需重新上传视频</div>
      <div style="margin-bottom:20px">
        <div style="font-size:12px;color:#6B6560;font-weight:500;margin-bottom:7px">模板名称</div>
        <input type="text" value="${esc(S.avatarSavePromptName)}"
          oninput="setState({avatarSavePromptName:this.value})"
          style="width:100%;border:1.5px solid #E8E4E0;border-radius:12px;padding:12px 14px;font-size:15px;color:#1A1614;outline:none;box-sizing:border-box;background:#FAFAF8"
          placeholder="给你的数字人起个名字" maxlength="20"/>
      </div>
      <div style="display:flex;gap:10px">
        <button onclick="handleAvatarDirectUse()"
          style="flex:1;padding:14px;border:1.5px solid #E8E4E0;border-radius:14px;background:#fff;font-size:14px;color:#6B6560;cursor:pointer;font-weight:500">
          直接使用
        </button>
        <button onclick="handleAvatarSaveAndUse()"
          style="flex:1.6;padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,#FF8040,#F5602A);font-size:14px;color:#fff;cursor:pointer;font-weight:700;box-shadow:0 4px 14px rgba(245,96,42,0.32)">
          保存并使用 ✓
        </button>
      </div>
    </div>
  </div>`;
}

async function handleAvatarDirectUse() {
  const file = _avatarPendingFile;
  if (!file) { setState({ avatarSavePrompt: false }); return; }
  const fmt = S.avatarSavePromptFmt;
  if (S._avatarSrcBlobUrl) URL.revokeObjectURL(S._avatarSrcBlobUrl);
  const previewUrl = URL.createObjectURL(file);
  setState({
    avatarSavePrompt: false,
    avatarSrcVideoName: file.name, avatarSrcVideoFmt: fmt,
    avatarErr: '', _avatarSrcBlobUrl: previewUrl, avatarSrcVideoB64: null,
    avatarLibKey: null, avatarLibName: '', avatarLibThumb: '',
  });
  const reader = new FileReader();
  reader.onload = (e) => {
    setState({ avatarSrcVideoB64: e.target.result.split(',')[1] });
    showToast('视频已选择 ✓');
  };
  reader.readAsDataURL(file);
}

async function handleAvatarSaveAndUse() {
  const file = _avatarPendingFile;
  const name = (S.avatarSavePromptName || '').trim() || (file?.name?.replace(/\.[^.]+$/,'') || '我的数字人');
  await handleAvatarDirectUse();
  // 只记名字，生成时随 video_b64 一起带过去，HeyGem 顺手存，零额外传输
  setState({ _pendingAvatarSaveName: name });
}

async function _saveAvatarToLib(file, name) {
  if (!file) return;
  try {
    const u = S.userInfo;
    if (!u) return;
    const fd = new FormData();
    fd.append('user_id', String(u.id));
    fd.append('name', name);
    fd.append('video', file);
    const r = await fetch('/api/ai/avatar/upload', { method: 'POST', headers: { 'Authorization': `Bearer ${getToken()}` }, body: fd });
    const resp = await r.json().catch(() => ({}));
    if (r.ok && resp.code === 200) {
      showToast(`"${name}" 已保存到数字人库 ✓`);
      setState({ _step4AvatarLoaded: false });
      loadAvatarList();
    }
  } catch(e) {
    console.warn('保存数字人模板失败:', e.message);
  }
}

function tAvatarMgmt() {
  const mode = S.avatarMgmtMode;
  const isSelect = mode === 'select';
  const list = S.avatarMgmtList;
  const uploadIcon = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
  const avatarIcon = '<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="#F97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>';
  const trashIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  const videoIcon = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 9l4-2v10l-4-2"/></svg>';
  const pendingFile = S.avatarMgmtPendingFile;
  const pendingName = S.avatarMgmtPendingFileName || (pendingFile && pendingFile.name) || '';
  const pendingMeta = formatAvatarFileSize(S.avatarMgmtPendingFileSize || (pendingFile && pendingFile.size) || 0);

  const listHtml = S.avatarMgmtLoading
    ? `<div class="avatar-mgmt-loading">加载中...</div>`
    : list.length === 0
      ? `<div class="avatar-mgmt-empty">
           <div class="avatar-mgmt-empty-icon">${avatarIcon}</div>
           <div class="avatar-mgmt-empty-title">还没有数字人</div>
           <div class="avatar-mgmt-empty-sub">上传一段清晰正脸视频，后续生成时可以直接选用。</div>
         </div>`
      : list.map(a => `
        <div class="avatar-mgmt-item">
          ${a.thumbnail
            ? `<img class="avatar-mgmt-thumb" src="${a.thumbnail}" alt=""/>`
            : `<div class="avatar-mgmt-thumb avatar-mgmt-thumb-fallback">${avatarIcon}</div>`}
          <div class="avatar-mgmt-info">
            <div class="avatar-mgmt-name">${esc(a.name)}</div>
            <div class="avatar-mgmt-time">${esc(a.created_at||'')}</div>
          </div>
          <div class="avatar-mgmt-actions">
            ${isSelect ? `<div onclick="selectAvatarFromLib(${JSON.stringify(a).replace(/"/g,'&quot;')})"
              class="avatar-mgmt-select-btn">选用</div>` : ''}
            ${!isSelect ? `<div onclick="deleteAvatar('${a.id}')" class="avatar-mgmt-delete-btn">${trashIcon}</div>` : ''}
          </div>
        </div>`).join('');

  return `<div class="avatar-mgmt-page">
    <div class="avatar-mgmt-top">
      <div onclick="setState({showAvatarMgmt:false})" class="avatar-mgmt-back">
        <svg width="9" height="15" viewBox="0 0 9 15" fill="none"><path d="M7.5 1.5L2 7.5L7.5 13.5" stroke="#1A1614" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <span class="avatar-mgmt-title">${isSelect ? '选择数字人' : '数字人管理'}</span>
      <div class="avatar-mgmt-spacer"></div>
    </div>
    <div class="avatar-mgmt-content">
      <div class="avatar-mgmt-card">
        <div class="avatar-mgmt-card-head">
          <div>
            <div class="avatar-mgmt-card-title">上传新数字人</div>
            <div class="avatar-mgmt-card-sub">建议上传 5-30 秒正脸视频，画面稳定会更利于生成。</div>
          </div>
        </div>
        <input id="avatarMgmtNameInput" type="text" placeholder="命名（可选）" value="${esc(S.avatarMgmtUploadName)}"
          oninput="S.avatarMgmtUploadName=this.value"
          class="avatar-mgmt-input"/>
        <input type="file" id="avatarMgmtFileInput" accept="video/mp4,video/quicktime,video/mov,video/*" style="display:none"
          onchange="handleAvatarMgmtFileSelect(event)"/>
        ${pendingFile ? `
          <div class="avatar-mgmt-file-row">
            <div class="avatar-mgmt-file-icon">${videoIcon}</div>
            <div class="avatar-mgmt-file-info">
              <div class="avatar-mgmt-file-name">${esc(pendingName)}</div>
              <div class="avatar-mgmt-file-meta">${esc(pendingMeta || '已选择视频')}</div>
            </div>
            <div class="avatar-mgmt-change-btn" onclick="${S.avatarMgmtUploading?'':"document.getElementById('avatarMgmtFileInput').click()"}">更换</div>
          </div>
        ` : ''}
        <div onclick="${S.avatarMgmtUploading?'':(pendingFile?'submitAvatarUpload()':"document.getElementById('avatarMgmtFileInput').click()")}"
          class="avatar-mgmt-upload ${S.avatarMgmtUploading?'avatar-mgmt-upload-disabled':(pendingFile?'':'avatar-mgmt-pick')}">
          ${S.avatarMgmtUploading ? `${uploadIcon} 上传中...` : (pendingFile ? `${uploadIcon} 提交上传` : `${uploadIcon} 选择视频`)}
        </div>
        ${S.avatarMgmtErr ? `<div class="avatar-mgmt-error">${esc(S.avatarMgmtErr)}</div>` : ''}
      </div>
      <div class="avatar-mgmt-card">
        <div class="avatar-mgmt-card-head">
          <div>
            <div class="avatar-mgmt-card-title">我的数字人</div>
            <div class="avatar-mgmt-card-sub">${isSelect ? '选择一个形象用于当前视频生成。' : '管理已上传的形象视频。'}</div>
          </div>
          <div class="avatar-mgmt-count">${list.length} 个</div>
        </div>
        ${listHtml}
      </div>
    </div>
  </div>`;
}

// ===== VIP =====