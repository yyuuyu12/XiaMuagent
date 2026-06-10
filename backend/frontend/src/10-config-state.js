// ===== CONFIG =====
const API_BASE = (location.protocol === 'http:' || location.protocol === 'https:') ? `${location.origin}/api` : 'https://app.yyagent.top/api';

// ===== STORAGE =====
function getToken() { return localStorage.getItem('wf_token') || ''; }
function setToken(t) { localStorage.setItem('wf_token', t); }
function clearAuth() { localStorage.removeItem('wf_token'); localStorage.removeItem('wf_user'); }
function getUser() { try { return JSON.parse(localStorage.getItem('wf_user') || 'null'); } catch { return null; } }
function userHomeKey(base) { const uid = (S.userInfo && S.userInfo.id) || (getUser() && getUser().id); return uid ? base + '_' + uid : base; }
function setUser(u) { localStorage.setItem('wf_user', JSON.stringify(u)); }

// ===== API =====
async function apiFetch(method, path, data, signal) {
  const token = getToken();
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) } };
  if (data) opts.body = JSON.stringify(data);
  if (signal) opts.signal = signal;
  const res = await fetch(API_BASE + path, opts);
  const raw = await res.text();
  if (!raw.trim()) {
    return { code: res.status || 500, msg: res.status >= 500 ? '服务器无响应内容，请稍后重试' : '请求失败' };
  }
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.msg === 'string' && j.msg.length > 200) j.msg = j.msg.slice(0, 200) + '…';
    return j;
  } catch {
    return { code: res.status || 500, msg: `服务器返回非 JSON（${res.status}），请检查网关或部署日志` };
  }
}
const api = {
  get: (path, signal) => apiFetch('GET', path, null, signal),
  post: (path, data, signal) => apiFetch('POST', path, data, signal),
  put: (path, data) => apiFetch('PUT', path, data),
  patch: (path, data) => apiFetch('PATCH', path, data),
  del: (path) => apiFetch('DELETE', path),
};

// ===== STATE =====
const S = {
  currentTab: 'home',
  showAuthSheet: false,
  isRegMode: false, phone: '', password: '', authErr: '', loading: false,
  authMode: 'sms',       // 'sms' | 'pwd'
  smsCode: '', smsSent: false, smsCountdown: 0,
  pwdSmsCode: '', pwdSmsSent: false, pwdSmsCountdown: 0,
  pwdNew: '', pwdNew2: '', pwdErr: '', pwdLoading: false,
  showAuthCodeInput: false, showAuthCodeSheet: false, showSetPwdSheet: false,
  userName: '创作者', userPhone: '', userInfo: null, userAvatar: 0,
  videoUrl: '', extractStep: 0, extractedScript: '', rewrittenScript: '', rewriteSourceExpanded: false,
  extractLoading: false, extractErr: '', extractRawErr: '', copiedId: '',
  cloneTaskId: null, cloneTaskData: null, extractFromHistory: false,
  industries: [], selectedIndustryId: null, selectedIndustryName: '', customTrack: '',
  inspireScripts: [], inspireLoading: false, inspireErr: '', expandedScript: null,
  matchedIndustry: '', showHistory: false, inspireHistory: [], historyLoaded: false, historyExpanded: null,
  showAvatarPicker: false, authCodeInput: '', authCodeMsg: '', authCodeOk: true, authCodeLoading: false,
  selectedPlan: 'month', selectedPayment: 'wechat', memberPlans: {}, showPayModal: false,
  recentHistory: [], recentHistoryLoaded: false,
  homeHistory: [], homeHistoryLoaded: false,
  nicknamePrompt: false, nicknameInput: '', nicknamePromptDismissed: false,
  nicknameEditing: false, nicknameEditInput: '',
  historyPageExpanded: null,
  historyTab: 'inspire',
  cloneHistory: [], cloneHistoryLoaded: false,
  showTipExpanded: false, rewriteStyle: '', extractHistory: [], extractHistoryLoaded: false,
  profileView: 'main',
  // ===== 灵感发现 · 新流程 =====
  inspireMode: null,          // null | 'analyze' | 'industry' | 'featured'
  inspireFromHome: false,     // 从首页进入时置 true，返回直接回首页
  // 行业精选
  featuredPage: 'select',      // 'select' | 'content'
  featuredIndustry: null, featuredVideos: [], featuredLoading: false, featuredIndustriesLoading: false, featuredErr: '',
  featuredIndustriesList: [], featuredSelectedIdx: null, featuredDetailIdx: null,
  // 路径A
  pathAText: '', pathALoading: false, pathAErr: '',
  pathAState: 'input',        // 'input'|'videos'|'started'
  pathAResolveData: null, pathAProfile: null,
  pathASelectedIds: [], pathABrandName: '',
  pathALastTaskId: null, pathATaskData: null,
  // 路径B
  pathBState: 'form',         // 'form'|'clarifying'|'clarify'|'generating'|'done'
  pathBIndustryId: null, pathBIndustryName: '', pathBCustom: '', pathBBrandName: '',
  pathBQuestions: [], pathBAnswers: {}, pathBErr: '', pathBScripts: [], pathBTaskId: null,
  // 任务页
  tasksList: [], tasksLoaded: false,
  tasksView: 'list',          // 'list'|'detail'
  viewingTask: null,
  tasksDetailFromHome: false, historyFromProfile: false, prevTab: 'home',
  tasksCopiedId: '',
  appH5: { showProfilePhone: false, showAccountType: false },
  avatarCropOpen: false, avatarCropDataUrl: '',
  avatarCropMeta: null,
  avatarCropScale: 100,
  avatarCropX: 0,
  avatarCropY: 0,
  extractTranscribeController: null,
  rewriteGenerating: false,
  homeDoneSeenIds: [],
  dismissedFromHomeIds: [],
  // 步骤3：语音合成
  ttsVoice: 'xiaoxiao', ttsSpeed: 1.0, ttsGenerating: false, ttsAudioUrl: null, ttsErr: '',
  ttsCloneVoiceId: null, ttsCloning: false, ttsCloneErr: '',
  ttsIndexRefAudio: null, ttsIndexRefName: '', ttsIndexEmotion: 'neutral', ttsEmoIntensity: 5,
  // 声音库
  myVoices: [],
  selectedMyVoiceId: '',
  recordingState: 'idle', // idle | recording
  recordingSeconds: 0,
  vmPlayingId: '',
  // 步骤4：数字人
  selectedAvatarId: 'self', avatarBeauty: true, avatarClipBreath: true, avatarErr: '',
  avatarSrcVideoB64: null, avatarSrcVideoName: '', avatarSrcVideoFmt: 'mp4',
  avatarLibKey: null, avatarLibName: '', avatarLibThumb: '',
  avatarTaskId: null, avatarTaskStatus: '', avatarVideoB64: null, avatarVideoUrl: null, avatarGenerating: false, avatarProgressMsg: '初始化中...', avatarProgressPct: 20,
  showAvatarMgmt: false, avatarMgmtList: [], avatarMgmtLoading: false,
  avatarMgmtUploading: false, avatarMgmtUploadName: '', avatarMgmtErr: '', avatarMgmtMode: 'manage',
  avatarMgmtPendingFile: null, avatarMgmtPendingFileName: '', avatarMgmtPendingFileSize: 0,
  avatarSavePrompt: false, avatarSavePromptName: '', avatarSavePromptFmt: 'mp4', _step4AvatarLoaded: false,
  ttsAudioB64: null,
  subColor: '#FFD700', subOutlineColor: '#000000', subFontsize: 46, subOutlineWidth: 3, subTemplate: 'bilingual_douyin', subStyle: 'bilingual_douyin',
  ttsProgressPct: 0, postProgressPct: 0,
  postProcessing: false, postProcessedVideoUrl: null, postProcessedB64: null, postProcessErr: '',
  coverFrameUrl: null, coverTitle: '', coverGenerating: false, coverSeekTime: 1.0,
  // 步骤5：后期制作
  videoColorStyle: 'warm', videoSubtitle: true, videoMusic: false,
  // 步骤6：发布
  publishTitle: '', publishDesc: '', publishTags: [], publishTitleLoading: false, publishDescLoading: false, coverDownloaded: false, publishCopied: false,
  // ===== 原创工坊 =====
  originalView: 'home',      // 'home'|'skill'|'learning'|'new'|'chat'
  originalProject: null,     // 当前项目 {id,title,status,turns,doc}
  originalSkill: null,       // 当前 skill 对象
  originalPending: [],       // 待确认规则列表（学习提议制）[{idx,text,source,sourceType,...}]
  originalPendingOpen: false,// 待确认卡片是否展开
  originalCompacting: false, // 整理自动学习记录进行中
  originalProjects: [],      // 项目列表
  originalMessages: [],      // 当前项目消息列表
  originalChatTab: 'chat',   // 'chat'|'doc'
  originalSkillFreeTextDraft: null, // 自由编辑草稿（null=未初始化）
  originalSkillHistoryOpen: false,  // 历史记录弹窗
  originalInput: '',
  originalLoading: false,
  originalLearningUrl: '',
  originalLearningType: 'account',  // 'account'|'video'
  originalLearningScope: 'global',  // 'global'|'project'
  originalLearningPhase: 'input',   // 'input'|'select'|'result'
  originalLearningItems: [],        // 阶段一提取出的原文/视频列表 [{awemeId,desc,likes,script,selected}]
  originalLearningResult: null,     // 阶段二拆解结果 { type, videos:[...], rules:[...] }
  originalLearningLoading: false,
  // 素材库
  originalMaterials: [],            // 素材列表
  originalMaterialsLoading: false,  // 加载中
  originalMaterialsLoaded: false,   // 是否已首次加载
  originalMaterialsSelected: [],    // 学习时选中的素材 id 数组
  // 素材提取（添加素材页面）
  originalExtractTab: 'text',       // 'text'|'url'
  originalExtractTitle: '',
  originalExtractContent: '',
  originalExtractUrl: '',
  originalExtractUrlLoading: false,
  originalExtractUrlResult: null,   // { title, script, sourceUrl } 从URL提取到的预览
  originalNewTitle: '',
  originalNewBrief: '',
  originalNewDuration: '1min',   // '30s'|'1min'|'3min'
  originalNewStyle: 'informative', // 'informative'|'story'|'contrast'|'twist'
  originalNewPlatform: 'douyin', // 'douyin'|'shipinhao'|'xiaohongshu'
  originalTopics: [],            // 智能选题列表
  originalTopicsLoading: false,  // 正在生成选题
  originalSkillQuickModal: null, // { text, saving } 快速记 Skill 弹窗
  // 分阶段创作 + 项目对标
  originalBoundMaterials: [],     // 当前项目绑定的对标素材 [{id,title,preview}]
  originalBenchmarkSheet: false,  // 对标素材选择弹窗开关
  originalStageBusy: false,       // 阶段流转请求中
  originalNewStaged: true,        // 新建项目是否启用分步创作
  originalNewMaterialIds: [],     // 新建项目时选中的对标素材 id
  // ===== 智能体 =====
  agentsList: [], agentsLoading: false, agentsLoaded: false,
  selectedAgent: null, agentInputs: {}, agentRunning: false, agentResult: null, agentErr: '',
  creditsBalance: null,
  // ===== 进阶（口播工坊）权限 =====
  premium: false, premiumUntil: null, premiumLoaded: false,
  // 口播工坊：view = intro / activate / landing / bench
  workshopView: 'landing', workshopSeg: 'voice', workshopPickedCopy: null,
  // 进阶激活码
  wsCodeInput: '', wsCodeMsg: '', wsCodeOk: false, wsCodeLoading: false,
  // 进阶开通引导弹层
  showPremiumGate: false,
  // 本地算力服务状态（离线友好降级）：{ video:'up'|'down', asr, tts } | null
  svcStatus: null, svcProbing: false,
};
let inspireController = null;
let extractController = null;
let extractTranscribeController = null;
let tasksPollerTimer = null;
let pathAPollerTimer = null;
let clonePollerTimer = null;

// ===== UTILS =====
async function deleteCloneHistoryItem(e, histId) {
  e.stopPropagation();
  if (!confirm('确定删除这条记录吗？')) return;
  try {
    const r = await api.del('/history/' + histId);
    if (r.code === 200) {
      S.cloneHistory = S.cloneHistory.filter(it => it.id !== histId);
      render();
      showToast('已删除');
    } else { showToast(r.msg || '删除失败'); }
  } catch { showToast('删除失败'); }
}
async function deleteTask(e, taskId) {
  e.stopPropagation();
  if (!confirm('确定删除这条任务记录吗？')) return;
  try {
    const r = await api.del(`/tasks/${taskId}`);
    if (r.code === 200) {
      setState({ tasksList: S.tasksList.filter(t => t.id !== taskId) });
      showToast('已删除');
    } else {
      showToast(r.msg || '删除失败');
    }
  } catch { showToast('删除失败'); }
}

function friendlyError(msg) {
  if (!msg) return '任务处理失败，请稍后重试';
  if (msg.includes('524') || msg.includes('timeout occurred') || /timed?\s*out/i.test(msg))
    return 'AI 服务响应超时，可能当前请求量较大，请稍后重试';
  if (msg.includes('<!DOCTYPE') || msg.includes('<html') || msg.includes('Cloudflare') || msg.includes('cloudflare'))
    return 'AI 服务暂时不可用，请稍后重试';
  if (/未配置|未启动|not configured/i.test(msg) && /asr|语音/i.test(msg))
    return '语音识别服务未配置，请联系管理员在后台填写 ASR 服务地址';
  // 中转站不支持 whisper-1
  if (/model_not_found|No available channel.*whisper/i.test(msg))
    return '语音转写失败：当前 AI 中转站不支持 whisper-1 模型，请在后台配置本地 ASR 服务地址';
  // 本地ASR返回错误，附上状态码
  if (/本地ASR返回错误/i.test(msg)) return msg;
  if (/asr|transcri|语音|whisper/i.test(msg))
    return '语音识别服务连接失败，请检查 ASR 服务是否正常运行';
  if (/tikhub|tik\s*hub|视频解析|视频下载|视频信息/i.test(msg))
    return '视频解析失败，请检查链接是否有效后重试';
  if (/ai\s*(接口|调用|错误|失败)|callai|openai|zhipu|api.*error/i.test(msg))
    return 'AI 服务暂时出现问题，请稍后重试';
  if (msg.includes('ASR 服务未配置') || msg.includes('TikHub API Key 未配置'))
    return '服务配置不完整，请联系管理员';
  if (msg.length > 80) return '服务暂时出现问题，请稍后重试';
  return msg;
}


function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showToast(msg, duration) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  // 时长自适应：按字数估算阅读时间，长文案最多停 8 秒；点一下立即关闭
  const ms = duration || Math.min(8000, Math.max(2000, String(msg).length * 180));
  document.body.appendChild(t);
  let timer = setTimeout(() => t.remove(), ms);
  t.style.cursor = 'pointer';
  t.addEventListener('click', () => { clearTimeout(timer); t.remove(); });
}

// 单按钮提示弹窗（必须手动点"知道了"才消失，适合较长/重要的提示）
function showAlert(msg, title = '提示') {
  const old = document.getElementById('_global_alert_modal');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = '_global_alert_modal';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(26,22,20,0.45);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)';
  wrap.innerHTML = `
    <div style="background:#fff;border-radius:18px;width:100%;max-width:320px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.18)">
      <div style="padding:22px 20px 6px">
        <div style="font-size:16px;font-weight:700;color:#1A1814;margin-bottom:8px">${title}</div>
        <div style="font-size:14px;color:#6B6560;line-height:1.7">${esc(msg)}</div>
      </div>
      <div style="border-top:1px solid #F0EEE8;margin-top:18px">
        <button id="_alert_ok" style="width:100%;height:50px;font-size:15px;color:#F5762A;background:none;border:none;cursor:pointer;font-weight:700">知道了</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('#_alert_ok').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
}

// 通用确认弹窗，返回 Promise<boolean>（true=确认，false=取消）
function showConfirmModal({ title, body, confirmText = '确认', cancelText = '取消', confirmDanger = false }) {
  return new Promise(resolve => {
    const old = document.getElementById('_global_confirm_modal');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = '_global_confirm_modal';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(26,22,20,0.45);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)';
    wrap.innerHTML = `
      <div style="background:#fff;border-radius:18px;width:100%;max-width:320px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.18)">
        <div style="padding:22px 20px 6px">
          <div style="font-size:16px;font-weight:700;color:#1A1814;margin-bottom:8px">${title}</div>
          <div style="font-size:14px;color:#6B6560;line-height:1.6">${body}</div>
        </div>
        <div style="display:flex;gap:0;border-top:1px solid #F0EEE8;margin-top:18px">
          <button id="_confirm_cancel" style="flex:1;height:50px;font-size:15px;color:#6B6560;background:none;border:none;border-right:1px solid #F0EEE8;cursor:pointer;font-weight:500">${cancelText}</button>
          <button id="_confirm_ok" style="flex:1;height:50px;font-size:15px;color:${confirmDanger ? '#D94B2B' : '#F5762A'};background:none;border:none;cursor:pointer;font-weight:700">${confirmText}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const cleanup = (val) => { wrap.remove(); resolve(val); };
    document.getElementById('_confirm_cancel').onclick = () => cleanup(false);
    document.getElementById('_confirm_ok').onclick    = () => cleanup(true);
    wrap.addEventListener('click', e => { if (e.target === wrap) cleanup(false); });
  });
}
function tAppLoader(text = '加载中...') {
  return `<div class="app-loader">
    <div class="app-loader-mark">
      <span class="app-loader-dot"></span>
      <span class="app-loader-dot"></span>
      <span class="app-loader-dot"></span>
      <span class="app-loader-spark"></span>
    </div>
    <div>${esc(text)}</div>
  </div>`;
}
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => fbCopy(text));
  } else { fbCopy(text); }
}
function fbCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  document.execCommand('copy'); ta.remove();
}

function formatDisplayTime(iso) {
  if (iso == null || iso === '') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).replace('T', ' ').slice(0, 16);
  const p = (n) => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function maskPhone(phone) {
  const s = String(phone || '');
  if (s.length < 7) return s;
  return s.slice(0, 3) + '****' + s.slice(-4);
}

// ===== RENDER ENGINE =====
let _lastRenderedViewKey = '';

function getViewKey() {
  const historyKey = S.currentTab === 'history'
    ? `${S.historyTab || ''}:${S.tasksView || ''}:${S.viewingTask?.id || ''}`
    : '';
  const profileKey = S.currentTab === 'profile' ? (S.profileView || '') : '';
  const extractKey = S.currentTab === 'extract'
    ? `${S.extractStep || ''}:${S.cloneTaskId || S.taskId || ''}`
    : '';
  const inspireKey = S.currentTab === 'inspire'
    ? `${S.inspireMode || ''}:${S.pathAState || ''}:${S.featuredPage || ''}`
    : '';
  const modalKey = S.showAvatarMgmt ? 'avatar-mgmt' : '';
  return [S.currentTab, historyKey, profileKey, extractKey, inspireKey, modalKey].join('|');
}

function setState(updates) {
  const focusId = document.activeElement && document.activeElement.id;
  const focusSel = [document.activeElement && document.activeElement.selectionStart,
                    document.activeElement && document.activeElement.selectionEnd];
  Object.assign(S, updates);
  render();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus(); try { el.setSelectionRange(focusSel[0], focusSel[1]); } catch { try { el.setSelectionRange(el.value.length, el.value.length); } catch {} } }
  }
}
function render() {
  const oldScroller = document.querySelector('.page-content');
  const oldScrollTop = oldScroller ? oldScroller.scrollTop : 0;
  const oldViewKey = _lastRenderedViewKey;
  const newViewKey = getViewKey();
  // 保存 blob video 节点，渲染后复用，避免视频闪烁
  const oldVideo = document.querySelector('#app video[src^="blob:"]');
  const oldVideoSrc = oldVideo ? oldVideo.src : null;
  document.getElementById('app').innerHTML = tMain();
  _lastRenderedViewKey = newViewKey;
  if (oldVideoSrc) {
    const newVideo = document.querySelector('#app video');
    if (newVideo && newVideo.src === oldVideoSrc) {
      newVideo.parentNode.replaceChild(oldVideo, newVideo);
    }
  }
  if (oldViewKey && oldViewKey === newViewKey) {
    const newScroller = document.querySelector('.page-content');
    if (newScroller) {
      const maxTop = Math.max(0, newScroller.scrollHeight - newScroller.clientHeight);
      newScroller.scrollTop = Math.min(oldScrollTop, maxTop);
    }
  }
}

function openAuthSheet() { setState({ showAuthSheet: true, authErr: '' }); }
function closeAuthSheet() { setState({ showAuthSheet: false, authErr: '', loading: false }); }

/** 需要登录的操作入口：未登录则弹出底部登录层 */
function ensureLoggedIn() {
  if (getToken()) return true;
  openAuthSheet();
  return false;
}

function apiUnauthorized(r) {
  if (r && r.code === 401) {
    const had = !!getToken();
    clearAuth();
    setState({ userInfo: null, userName: '创作者', userPhone: '', userAvatar: 0, recentHistory: [], recentHistoryLoaded: false, inspireHistory: [], historyLoaded: false, homeDoneSeenIds: [], dismissedFromHomeIds: [] });
    if (had) { openAuthSheet(); showToast('登录已过期，请重新登录'); }
    return true;
  }
  return false;
}

// ===== LOGIN TEMPLATE =====