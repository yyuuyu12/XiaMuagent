function switchTab(tab) {
  const resetProfile = tab !== 'profile';
  setState({
    prevTab: S.currentTab,
    currentTab: tab,
    nicknamePrompt: false,
    ...(tab !== 'agents' ? { selectedAgent: null, agentResult: null, agentErr: '' } : {}),
    ...(resetProfile ? { profileView: 'main', avatarCropOpen: false, avatarCropDataUrl: '' } : {}),
  });
  if (tab === 'profile') fetchMe();
  if (tab === 'vip') loadMemberPlans();
  if (tab === 'home') {
    dismissHomeDoneSeen();
    if (!S.cloneHistoryLoaded) loadCloneHistory(); else render();
    loadTasks();
  }
  if (tab === 'history') {
    if (!S.cloneHistoryLoaded) loadCloneHistory();
    loadTasks();
  }
  if (tab === 'extract') { if (!S.extractHistoryLoaded) loadExtractHistory(); probeServices(); }
  if (tab === 'agents') loadAgents();
  if (tab === 'workshop') {
    loadPremiumStatus();
    if (!S.cloneHistoryLoaded) loadCloneHistory();
    loadTasks();
    probeServices();
  }
}
function goBack() {
  if (S.currentTab === 'history') {
    setState({ currentTab: 'home', historyPageExpanded: null });
  } else {
    setState({ currentTab: 'home' });
  }
  dismissHomeDoneSeen();
  if (!S.cloneHistoryLoaded) loadCloneHistory();
  loadTasks();
}
function openHistoryPage(tab) {
  if (tab === 'tasks') tab = 'inspire';
  setState({ currentTab: 'history', historyTab: tab || 'inspire', historyPageExpanded: null, tasksView: 'list' });
  if (!S.cloneHistoryLoaded && (!tab || tab === 'clone')) loadCloneHistory();
  loadTasks();
}

// ===== USER =====
async function fetchMe() {
  try {
    const r = await api.get('/auth/me');
    if (r.code === 200) {
      const hasNickname = !!(r.data.nickname && r.data.nickname.trim());
      const _uid = r.data.id;
      const _seen = (()=>{try{return JSON.parse(localStorage.getItem('home_done_seen_'+_uid)||'[]');}catch{return [];}})();
      const _dismissed = (()=>{try{return JSON.parse(localStorage.getItem('dismissed_from_home_'+_uid)||'[]');}catch{return [];}})();
      setState({
        userInfo: r.data,
        userName: r.data.nickname || '创作者',
        nicknamePrompt: !hasNickname && !S.nicknamePromptDismissed && S.currentTab === 'home',
        homeDoneSeenIds: _seen,
        dismissedFromHomeIds: _dismissed,
      });
    } else if (r.code === 401) { apiUnauthorized(r); }
  } catch {}
  if (!S.recentHistoryLoaded) loadRecentHistory();
  if (!S.homeHistoryLoaded) loadHomeHistory();
  loadMyVoices();
  api.get('/ai/voices/clone-id').then(r => { if (r.code === 200 && r.data) setState({ ttsCloneVoiceId: r.data }); }).catch(() => {});
}
async function loadIndustries() {
  try {
    const r = await api.get('/config/industries');
    if (r.code === 200) { S.industries = r.data || []; render(); }
  } catch {}
}

// ===== EXTRACT =====
async function handleExtract() {
  if (!ensureLoggedIn()) return;
  if (svcBlocked('asr')) return;
  if (!S.videoUrl.trim() || S.extractLoading) return;
  setState({ extractLoading: true, extractErr: '' });
  try {
    // 已有任务（清空内容后重新提交）→ 复用原任务ID，不新建
    const r = S.cloneTaskId
      ? await api.post('/video/clone-restart', { url: S.videoUrl.trim(), taskId: S.cloneTaskId })
      : await api.post('/video/clone-start', { url: S.videoUrl.trim() });
    if (apiUnauthorized(r)) { setState({ extractLoading: false }); return; }
    if (r.code === 200) {
      setState({ extractLoading: false, cloneTaskId: r.data.taskId, cloneTaskData: null, extractStep: 'cloning' });
      startClonePoller(r.data.taskId);
    } else {
      setState({ extractErr: r.msg || '提交失败，请重试', extractLoading: false });
    }
  } catch {
    setState({ extractErr: '网络错误，请重试', extractLoading: false });
  }
}

function startClonePoller(taskId) {
  if (clonePollerTimer) clearInterval(clonePollerTimer);
  clonePollerTimer = setInterval(async () => {
    if (S.currentTab !== 'extract') return;
    if (S.cloneTaskId !== taskId) { stopClonePoller(); return; } // ★ 已切换到其他任务
    try {
      const r = await api.get(`/tasks/${taskId}`);
      if (r.code !== 200) return;
      if (S.cloneTaskId !== taskId) return; // ★ 请求返回期间可能已切换
      const task = r.data;
      setState({ cloneTaskData: task });
      if (task.status === 'extracted') {
        stopClonePoller();
        setState({ extractStep: 'review', extractedScript: task.result?.transcript || '' });
      } else if (task.status === 'done') {
        stopClonePoller();
        const rewritten = task.result?.rewritten || task.result?.scripts?.[0]?.content || '';
        setState({ extractStep: 2, rewrittenScript: rewritten, rewriteSourceExpanded: false, extractedScript: task.result?.transcript || S.extractedScript });
        saveCloneSession(2);
        loadTasks();
      } else if (task.status === 'pending' || task.status === 'running') {
        const nextStep = (task.stage === 'rewrite' || task.stage === 'extracted') ? 'rewriting' : 'cloning';
        if (S.extractStep !== nextStep) setState({ extractStep: nextStep });
      } else if (task.status === 'failed') {
        stopClonePoller();
        setState({ extractStep: 0, extractErr: friendlyError(task.error_msg), extractRawErr: task.error_msg || '', cloneTaskId: null, cloneTaskData: null });
        loadTasks();
      }
    } catch {}
  }, 2000);
}

function stopClonePoller() {
  if (clonePollerTimer) { clearInterval(clonePollerTimer); clonePollerTimer = null; }
}

async function handleCloneRewrite() {
  // 先从 DOM 读最新内容（oninput 可能未触发）
  const ta = document.getElementById('f-extracted-script') || document.getElementById('f-extracted-script-v2');
  if (ta) S.extractedScript = ta.value;
  const text = S.extractedScript.trim();
  if (!text) { showToast('请先填写原始文案'); return; }

  const wasRewriteStep = S.extractStep === 2;
  // 清空旧 cloneTaskData 的 progress/thinking，避免重写进度条闪烁满格（旧 done 状态 progress=100）
  const resetTaskData = S.cloneTaskData ? { ...S.cloneTaskData, progress: 0, thinking: '' } : null;
  setState({ extractStep: 'rewriting', rewriteSourceExpanded: false, extractErr: '', cloneTaskData: resetTaskData });
  saveCloneSession(2);
  if (S.cloneTaskId) {
    try {
      const r = await api.post(`/tasks/${S.cloneTaskId}/start-rewrite`, { editedTranscript: text });
      if (apiUnauthorized(r)) return;
      if (r.code !== 200) {
        setState({ extractStep: wasRewriteStep ? 2 : 'review', extractErr: r.msg || '改写失败，请重试' });
        return;
      }
      const nowIso = new Date().toISOString();
      S.tasksList = (S.tasksList || []).map(t => String(t.id) === String(S.cloneTaskId)
        ? { ...t, status: 'pending', stage: 'extracted', progress: 50, clone_step: 2, activity_at: nowIso, updated_at: nowIso }
        : t);
      startClonePoller(S.cloneTaskId);
      loadTasks();
      return;
    } catch (e) {
      setState({ extractStep: wasRewriteStep ? 2 : 'review', extractErr: '网络错误，请重试' });
      return;
    }
  }
  try {
    // 直接把用户编辑好的文案传给 AI 改写，不经过 task 队列
    const r = await api.post('/ai/rewrite', { text });
    if (r.code === 200) {
      const rewritten = (r.data?.result || '').trim();
      if (!rewritten) {
        setState({ extractStep: 2, rewrittenScript: '', rewriteSourceExpanded: false, extractErr: 'AI改写结果为空，请点击重新改写' });
        return;
      }
      setState({ extractStep: 2, rewrittenScript: rewritten, rewriteSourceExpanded: false, extractErr: '' });
      // 把任务状态更新为 done，并保存 session（step=2），首页进度条才能更新
      if (S.cloneTaskId) {
        api.post(`/tasks/${S.cloneTaskId}/set-rewritten`, { rewrittenScript: rewritten }).catch(() => {});
        saveCloneSession(2);
        loadTasks(); // 刷新首页任务列表
      }
    } else {
      setState({ extractStep: wasRewriteStep ? 2 : 'review', extractErr: r.msg || '改写失败，请重试' });
    }
  } catch (e) {
    setState({ extractStep: wasRewriteStep ? 2 : 'review', extractErr: '网络错误，请重试' });
  }
}

// ===== 克隆步骤3-6 handlers =====
function syncRewriteActions() {
  const source = document.getElementById('f-extracted-script-v2');
  const rewritten = document.getElementById('f-rewritten-script');
  if (source) S.extractedScript = source.value;
  if (rewritten) S.rewrittenScript = rewritten.value;
  const hasSource = !!(S.extractedScript || '').trim();
  const hasRewrite = !!(S.rewrittenScript || '').trim();
  const toggle = (id, enabled) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('btn-disabled', !enabled);
  };
  toggle('clone-rerewrite-btn', hasSource);
  toggle('copy-rewritten-btn', hasRewrite);
  toggle('clone-step3-btn', hasRewrite);
}

function goToCloneStep3() {
  const ta = document.getElementById('f-rewritten-script');
  if (ta) S.rewrittenScript = ta.value;
  if (!(S.rewrittenScript || '').trim()) {
    showToast('请先完成文案改写');
    setState({ extractStep: 2, extractErr: '请先完成文案改写，再进入语音合成' });
    return;
  }
  // 未开通进阶版 → 引导去口播工坊开通
  if (!S.premium) {
    showPremiumGate();
    return;
  }
  setState({ extractStep: 3, ttsErr: '' });
  saveCloneSession(3);
}

// 弹出进阶开通引导弹层
function showPremiumGate() {
  setState({ showPremiumGate: true });
}
function closePremiumGate() {
  setState({ showPremiumGate: false });
}
function tPremiumGate() {
  if (!S.showPremiumGate) return '';
  const crown = `<svg width="14" height="14" viewBox="0 0 24 24" fill="#FF9D5C"><path d="M2 7l5 4 5-7 5 7 5-4-2 13H4z"/></svg>`;
  return `<div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:flex-end;justify-content:center" onclick="if(event.target===this)closePremiumGate()">
    <div style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:480px;padding:24px 20px 36px;box-sizing:border-box">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="background:linear-gradient(135deg,#2A241E,#46382B);border-radius:10px;width:36px;height:36px;display:flex;align-items:center;justify-content:center">${crown}</div>
          <div>
            <div style="font-size:16px;font-weight:700;color:#1A1814">解锁口播工坊</div>
            <div style="font-size:12px;color:#9E9890;margin-top:1px">开通进阶版，解锁语音·数字人·剪辑</div>
          </div>
        </div>
        <div onclick="closePremiumGate()" style="width:28px;height:28px;border-radius:50%;background:#F5F4F1;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:#9E9890">✕</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
        ${['声音克隆 — 克隆专属音色，无限次合成口播音频','真人数字人 — 上传形象，生成出镜口播视频','自动字幕成片 — 爆款字幕模板，一键烧录直接成片'].map(t=>`
          <div style="background:#FAF8F5;border-radius:12px;padding:10px 14px;font-size:13px;color:#4A4035;display:flex;align-items:center;gap:8px">
            <span style="color:#22C55E;font-size:15px">✓</span>${t}
          </div>`).join('')}
      </div>
      <div style="background:#fff;border-radius:14px;padding:14px;border:1px solid #EDE9E3;margin-bottom:12px">
        <div style="font-size:12px;font-weight:600;color:#1A1814;margin-bottom:8px">输入进阶激活码</div>
        <input type="text" placeholder="请输入进阶激活码" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #EDE9E3;border-radius:10px;font-size:14px;text-transform:uppercase;background:#FAF8F5;outline:none"
          value="${esc(S.wsCodeInput)}" oninput="S.wsCodeInput=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')handleWorkshopActivateGate()"/>
        ${S.wsCodeMsg ? `<div style="font-size:12px;margin-top:6px;color:${S.wsCodeOk?'#10B981':'#E5484D'}">${esc(S.wsCodeMsg)}</div>` : ''}
        <div class="btn-primary ${S.wsCodeLoading||!S.wsCodeInput.trim()?'btn-disabled':''}" style="margin-top:10px" onclick="handleWorkshopActivateGate()">${S.wsCodeLoading?'开通中…':'立即开通进阶版'}</div>
      </div>
      <div onclick="switchTab('workshop');closePremiumGate();" style="text-align:center;font-size:13px;color:#F5762A;font-weight:600;cursor:pointer;padding:4px 0">查看口播工坊详情 ›</div>
    </div>
  </div>`;
}

async function handleWorkshopActivateGate() {
  if (!ensureLoggedIn()) return;
  const code = (S.wsCodeInput || '').trim();
  if (!code || S.wsCodeLoading) return;
  setState({ wsCodeLoading: true, wsCodeMsg: '' });
  try {
    const r = await api.post('/credits/activate', { code });
    if (r.code === 200) {
      const ok = !!(r.data && r.data.premium);
      setState({ wsCodeLoading: false, wsCodeInput: '', wsCodeOk: true, wsCodeMsg: r.msg || '开通成功' });
      await loadPremiumStatus();
      if (ok || S.premium) {
        showToast('进阶版已解锁');
        closePremiumGate();
        goToCloneStep3();
      } else {
        setState({ wsCodeMsg: r.msg || '激活成功' });
      }
    } else {
      setState({ wsCodeLoading: false, wsCodeOk: false, wsCodeMsg: r.msg || '激活码无效或已使用' });
    }
  } catch {
    setState({ wsCodeLoading: false, wsCodeOk: false, wsCodeMsg: '网络错误，请稍后重试' });
  }
}
