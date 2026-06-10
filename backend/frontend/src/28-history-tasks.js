async function loadMemberPlans() {
  try {
    const r = await api.get('/config/member-plans');
    if (r.code === 200) { S.memberPlans = r.data; render(); }
  } catch {}
}
function selectPlan(plan) { setState({ selectedPlan: plan }); }
function selectPayment(m) { setState({ selectedPayment: m }); }
function handlePay() { setState({ showPayModal: true }); }
function closePayModal() { setState({ showPayModal: false }); }

// ===== RECENT HISTORY =====
function refreshHistory() {
  S.recentHistoryLoaded = false;
  S.historyLoaded = false;
  S.cloneHistoryLoaded = false;
  S.homeHistoryLoaded = false;
  loadRecentHistory();
  loadHomeHistory();
  loadCloneHistory();
}

async function loadRecentHistory() {
  if (!getToken()) {
    S.recentHistory = [];
    S.recentHistoryLoaded = true;
    render();
    return;
  }
  try {
    const r = await api.get('/history?type=inspire');
    if (apiUnauthorized(r)) { S.recentHistory = []; S.recentHistoryLoaded = true; render(); return; }
    if (r.code === 200) { S.recentHistory = r.data || []; S.recentHistoryLoaded = true; render(); }
  } catch {}
}

async function loadHomeHistory() {
  if (!getToken()) { S.homeHistory = []; S.homeHistoryLoaded = true; render(); return; }
  try {
    const r = await api.get('/history');
    if (apiUnauthorized(r)) { S.homeHistory = []; S.homeHistoryLoaded = true; render(); return; }
    if (r.code === 200) { S.homeHistory = r.data || []; S.homeHistoryLoaded = true; render(); }
  } catch {}
}

async function loadExtractHistory() {
  if (!getToken()) {
    S.extractHistory = [];
    S.extractHistoryLoaded = true;
    render();
    return;
  }
  try {
    const r = await api.get('/history?type=extract');
    if (apiUnauthorized(r)) { S.extractHistory = []; S.extractHistoryLoaded = true; render(); return; }
    if (r.code === 200) { S.extractHistory = r.data || []; S.extractHistoryLoaded = true; render(); }
  } catch {}
}

async function loadCloneHistory() {
  if (!getToken()) {
    S.cloneHistory = [];
    S.cloneHistoryLoaded = true;
    render();
    return;
  }
  try {
    const r = await api.get('/history?type=rewrite');
    if (apiUnauthorized(r)) { S.cloneHistory = []; S.cloneHistoryLoaded = true; render(); return; }
    if (r.code === 200) { S.cloneHistory = r.data || []; S.cloneHistoryLoaded = true; render(); }
  } catch {}
}

function reuseExtractUrl(i) {
  const it = S.extractHistory[i];
  if (!it) return;
  setState({ videoUrl: it.url || it.input || '' });
}

function goInspireWithTag(tag) {
  setState({ currentTab: 'inspire', selectedIndustryId: null, selectedIndustryName: '', customTrack: tag });
}

function cpRecentItem(e, i) {
  e.stopPropagation();
  const it = S.recentHistory[i];
  if (!it||!it.result||!it.result[0]) return;
  copyText(it.result[0].content || it.result[0].hook || '');
  showToast('已复制');
}

function cpHomeCloneItem(e, i) {
  e.stopPropagation();
  const it = S.cloneHistory[i];
  if (!it) return;
  const text = typeof it.result === 'string' ? it.result : (it.result?.content || it.result?.result || '');
  copyText(text || it.input || '');
  showToast('已复制');
}

function openHistoryPage(tab = 'inspire') {
  if (tab === 'tasks') tab = 'inspire';
  setState({ currentTab: 'history', historyTab: tab, historyPageExpanded: null, tasksView: 'list' });
  if (tab === 'clone' && !S.cloneHistoryLoaded) loadCloneHistory();
  if (tab === 'inspire') {
    dismissHomeDoneSeen();
    loadTasks();
  }
}

// ===== HISTORY PAGE =====
function tHistory() {
  if (S.tasksView === 'detail' && S.viewingTask) return tTaskDetail();

  const taskKindLocal = t => {
    if (!t) return '克隆';
    if (t.task_kind === 'industry' || t.type === 'industry_gen') return '行业';
    if (t.type === 'profile_analyze' || t.type === 'single_video_analyze') return '对标';
    return '克隆';
  };
  const taskKindClsLocal = t => ({ '克隆':'home-task-mini-action-clone', '对标':'home-task-mini-action-benchmark', '行业':'home-task-mini-action-industry' }[taskKindLocal(t)] || '');
  const DONE_BIG_WINDOW = 1 * 60 * 60 * 1000;
  const taskTimeLocal = t => {
    const raw = t && (t.activity_at || t.updated_at || t.created_at);
    const n = raw ? new Date(raw).getTime() : 0;
    return Number.isNaN(n) ? 0 : n;
  };

  if (!S.tasksLoaded) return `<div class="tab-page">
    <div style="text-align:center;padding-top:60px;font-size:14px;color:#A8A49C">加载中...</div>
  </div>`;

  const allTasks = [...(S.tasksList || [])].sort((a,b) => taskTimeLocal(b) - taskTimeLocal(a)).slice(0, 10);

  if (!allTasks.length) return `<div class="tab-page">
    <div style="display:flex;flex-direction:column;align-items:center;padding-top:60px">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#D0CECA" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:10px"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
      <div style="font-size:14px;color:#A8A49C;margin-bottom:16px">还没有任务记录</div>
    </div>
  </div>`;

  // 沿用首页辅助函数（已在 tHomeTaskSection 闭包外无法直接访问，这里内联一份轻量版）
  const cloneStepOfH = t => Math.max(1, Math.min(6, parseInt(t.clone_step) || (t.status === 'done' ? 3 : 1)));
  const clonePhaseOfH = t => {
    const savedStep = cloneStepOfH(t);
    if (t.status === 'failed') return { step: savedStep, phase: 'failed' };
    if (t.status === 'paused') return { step: savedStep, phase: 'paused' };
    if (t.status === 'pending') return { step: savedStep <= 2 ? 1 : savedStep, phase: 'pending' };
    if (t.status === 'running') return { step: savedStep <= 2 ? 1 : savedStep, phase: 'running' };
    if (t.status === 'extracted') return savedStep > 1 ? { step: savedStep, phase: 'step_done' } : { step: 1, phase: 'extracted' };
    return { step: savedStep, phase: savedStep >= 6 ? 'published' : 'step_done' };
  };
  const bigProgressH = t => {
    if (t.status === 'failed') return Math.max(0, Math.min(100, t.progress || 0));
    if (t.type === 'clone_video') {
      const info = clonePhaseOfH(t);
      if (info.phase === 'step_done' || info.phase === 'published') return null;
      if (info.phase === 'pending') return 0;
      if (info.phase === 'extracting' || info.phase === 'running') return Math.min(88, Math.max(5, (t.progress || 10) * 0.9));
      return t.progress || 0;
    }
    if (t.status === 'done') return null;
    return Math.max(0, Math.min(100, t.progress || 0));
  };
  const bigActionTextH = t => {
    if (t.type === 'clone_video') {
      const info = clonePhaseOfH(t);
      if (info.phase === 'failed') return '查看详情 ›';
      if (info.phase === 'paused') return '等待服务恢复 ›';
      if (info.phase === 'pending' || info.phase === 'running') return '查看提取进展 ›';
      if (info.phase === 'extracted') return '查看提取结果 ›';  // step1：文案已提取，待改写
      if (info.phase === 'step_done' || info.phase === 'published') {
        if (info.step === 2) return '查看提取结果 ›';  // step2：进入改写步骤但未改写
        if (info.step === 3) return '查看改写结果 ›';  // step3：改写完成，待语音
        if (info.step === 4) return '查看语音结果 ›';  // step4：语音完，待数字人
        if (info.step === 5) return t.post_process_done ? '查看后期视频 ›' : '查看数字人视频 ›';
        if (info.step >= 6) return '去发布 ›';
      }
      return '继续 ›';
    }
    if (t.status === 'extracted') return '改写 ›';
    if (t.status === 'done') return '查看结果 ›';
    if (t.status === 'failed') return '查看详情 ›';
    return '查看详情 ›';
  };
  // 历史页徽章：只展示任务类型
  const statusTextH = t => taskKindLabel(t);
  const openTaskActionH = t => (t.type === 'clone_video' && t.status !== 'failed') ? `openExtractWithTask('${t.id}')` : `openTaskFromHome('${t.id}')`;
  const stepsWithLabelsH = currentStep => {
    const labels = ['提取','改写','语音','数字人','后期','发布'];
    const svgCheck = `<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const svgDot = `<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="#F5762A"/></svg>`;
    let html = '<div style="display:flex;align-items:center;width:100%">';
    for (let i = 0; i < 6; i++) {
      const isDone = i + 1 < currentStep;
      const isActive = i + 1 === currentStep;
      const cirBg = isDone ? '#F5762A' : isActive ? 'rgba(245,118,42,0.12)' : '#F0EDE8';
      const cirColor = isDone ? '#fff' : isActive ? '#F5762A' : '#B0AA9F';
      const cirBorder = isActive ? '1.5px solid #F5762A' : 'none';
      const lblColor = i + 1 <= currentStep ? '#F5762A' : '#C8C3BC';
      const lblWeight = isActive ? '700' : '400';
      const inner = isDone ? svgCheck : isActive ? svgDot : (i + 1);
      html += `<div style="display:flex;flex-direction:column;align-items:center;gap:4px">
        <div style="width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;background:${cirBg};color:${cirColor};border:${cirBorder};flex-shrink:0">${inner}</div>
        <div style="font-size:9px;font-weight:${lblWeight};color:${lblColor};white-space:nowrap">${labels[i]}</div>
      </div>`;
      if (i < 5) {
        const lineColor = isDone ? '#F5762A' : '#F0EDE8';
        html += `<div style="flex:1;height:1.5px;background:${lineColor};margin-bottom:14px"></div>`;
      }
    }
    html += '</div>';
    return html;
  };

  const isBig = t => Date.now() - taskTimeLocal(t) < DONE_BIG_WINDOW;

  const bigHtml = allTasks.filter(isBig).map(t => {
    // post_process_done: 后期完成 → 视觉步骤显示为 step6（步骤5打勾）
    const cloneStep = (t.type === 'clone_video' && clonePhaseOfH(t).step === 5 && t.post_process_done)
      ? 6 : cloneStepOfH(t);
    const pct = bigProgressH(t);
    const isDone = t.status === 'done' || (t.type === 'clone_video' && clonePhaseOfH(t).phase === 'published');
    const isFailed = t.status === 'failed';
    const isPending = t.status === 'pending';
    const isRunning = t.status === 'running';
    const bdgColor = '#F5762A';
    const bdgBg = 'rgba(245,118,42,0.12)';
    const showPulse = isRunning || isPending;
    return `<div style="background:#FFF8F3;border-radius:18px;padding:14px 16px;border:1.5px solid rgba(245,118,42,0.2);box-shadow:0 4px 16px rgba(245,96,42,0.08);cursor:pointer" onclick="${openTaskActionH(t)}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px">
        <div style="font-size:13px;font-weight:600;color:#1A1614;line-height:1.5;flex:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(t.title)}</div>
        <div style="flex-shrink:0;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;color:${bdgColor};background:${bdgBg};white-space:nowrap;display:flex;align-items:center;gap:4px">
          ${showPulse ? `<div style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:pulse 1.2s infinite"></div>` : ''}
          ${taskKindLabel(t)}
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:11px;color:#9E9890;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:8px">${esc(formatDisplayTime(t.activity_at || t.updated_at || t.created_at))}</div>
        ${(pct != null && pct > 0 && pct < 100) ? `<div style="font-size:12px;font-weight:700;color:#F5762A;flex-shrink:0">${pct}%</div>` : ''}
      </div>
      <div style="height:4px;background:${(pct === null || pct > 0)?'rgba(245,118,42,0.15)':'#F0EDE8'};border-radius:4px;overflow:hidden;margin-bottom:12px">
        <div style="height:100%;width:${pct === null ? 100 : (pct || 0)}%;background:linear-gradient(90deg,#FF8040,#F5602A);border-radius:4px;transition:width 0.4s"></div>
      </div>
      <div style="margin-bottom:12px">${stepsWithLabelsH(cloneStep)}</div>
      <div style="display:flex;gap:8px">
        <div style="flex:1;padding:9px;text-align:center;background:rgba(245,118,42,0.08);border-radius:10px;font-size:13px;font-weight:600;color:#F5762A;cursor:pointer" onclick="event.stopPropagation();${openTaskActionH(t)}">${bigActionTextH(t)}</div>
      </div>
    </div>`;
  }).join('');

  const iconCloneH = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B6FE0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`;
  const iconInspireH = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  const iconDoneH = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0D9B5C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const iconFailedH = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  const iconRunH = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

  const smallHtml = allTasks.filter(t => !isBig(t)).map(t => {
    const knd = taskKindLocal(t);
    const kndCls = taskKindClsLocal(t);
    const clickFn = openTaskActionH(t);
    let icon, iconCls;
    if (t.status === 'failed') { icon = iconFailedH; iconCls = 'htc-icon-failed'; }
    else if (t.status === 'done') { icon = iconDoneH; iconCls = 'htc-icon-done'; }
    else if (t.status === 'pending' || t.status === 'running') { icon = iconRunH; iconCls = 'htc-icon-inspire'; }
    else { icon = t.type === 'clone_video' ? iconCloneH : iconInspireH; iconCls = t.type === 'clone_video' ? 'htc-icon-clone' : 'htc-icon-inspire'; }
    return `<div class="home-task-mini-card" onclick="${clickFn}">
      <div class="home-task-mini-icon">
        <div class="htc-icon-wrap ${iconCls}" style="width:34px;height:34px;border-radius:10px">${icon}</div>
      </div>
      <div class="home-task-mini-body">
        <div class="home-task-mini-title">${esc(t.title)}</div>
        <div class="home-task-mini-meta">${esc(formatDisplayTime(t.activity_at || t.updated_at || t.created_at))}</div>
      </div>
      <span class="home-task-mini-action ${kndCls}">${knd}</span>
    </div>`;
  }).join('');

  return `<div class="tab-page">
    <div style="padding:0 16px 8px;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:16px;font-weight:700;color:#1A1614">我的任务</span>
      <span style="font-size:12px;color:#A8A49C">${allTasks.length} 条记录</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;padding:0 16px">
      ${bigHtml}
    </div>
    ${smallHtml ? `<div class="home-task-small-scroll" style="padding:0 16px">${smallHtml}</div>` : ''}
  </div>`;
}

function toggleHistoryPage(i) { setState({ historyPageExpanded: S.historyPageExpanded===i?null:i }); }
function toggleClonePage(i) { const key='c'+i; setState({ historyPageExpanded: S.historyPageExpanded===key?null:key }); }

function cpClonePage(e, i) {
  e.stopPropagation();
  const it = S.cloneHistory[i];
  if (!it) return;
  const text = typeof it.result === 'string' ? it.result : (it.result?.content || it.result?.result || '');
  copyText(text);
  showToast('已复制');
}

function switchHistoryTab(tab) {
  setState({ historyTab: tab, historyPageExpanded: null, tasksView: 'list' });
  if (tab === 'clone' && !S.cloneHistoryLoaded) loadCloneHistory();
  if (tab === 'inspire') {
    dismissHomeDoneSeen();
    loadTasks();
  }
}

// ===== 任务页视图 =====
function taskCountdown(t) {
  if (t.status !== 'pending' && t.status !== 'running') return '';
  const expectedSecs = { profile_analyze: 180, single_video_analyze: 90, industry_gen: 20, clone_video: 90 };
  const expected = expectedSecs[t.type] || 120;
  const elapsed = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 1000);
  const remaining = Math.max(0, expected - elapsed);
  if (remaining === 0) return `<span style="font-size:11px;color:#E8650A;font-weight:600">即将完成...</span>`;
  const m = Math.floor(remaining / 60), s = remaining % 60;
  const label = m > 0 ? `${m}分${s}秒` : `${s}秒`;
  return `<span style="font-size:11px;color:#A8A49C">预计还需 <b style="color:#E8650A">${label}</b></span>`;
}

function tTasksList(tabsHtml) {
  if (!getToken()) return `<div class="tab-page">${tabsHtml||''}
    <div style="text-align:center;padding-top:40px;font-size:14px;color:#A8A49C">登录后查看任务记录</div>
  </div>`;
  if (!S.tasksLoaded) return `<div class="tab-page">${tabsHtml||''}
    <div style="text-align:center;padding-top:40px;font-size:14px;color:#A8A49C">加载中...</div>
  </div>`;
  const tasks = S.tasksList.filter(t => t.type !== 'clone_video');
  const typeLabel = t => ({ profile_analyze:'对标拆解', single_video_analyze:'视频分析', industry_gen:'行业生成', clone_video:'克隆' }[t] || t);
  const typeClass = t => ({ profile_analyze:'task-type-a', single_video_analyze:'task-type-v', industry_gen:'task-type-b', clone_video:'task-type-v' }[t] || 'task-type-b');
  const statusLabel = { pending:'排队中', running:'进行中', extracted:'改写', done:'已完成', failed:'失败' };
  const statusClass = { pending:'task-status-pending', running:'task-status-running', extracted:'task-status-running', done:'task-status-done', failed:'task-status-failed' };
  return `<div class="tab-page">${tabsHtml||''}
    ${tasks.length === 0 ? `
      <div style="display:flex;flex-direction:column;align-items:center;padding-top:40px">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#D0CECA" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:10px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <div style="font-size:14px;color:#A8A49C;margin-bottom:16px">还没有任务，去生成吧</div>
        <div class="btn-primary" style="width:auto;padding:0 28px" onclick="switchTab('inspire')">去灵感发现</div>
      </div>` :
      tasks.map(t => {
        const canClick = t.status === 'done' || t.status === 'extracted';
        const clickFn = t.status === 'done' ? `openTask('${t.id}')` : (t.status === 'extracted' ? `startCloneRewrite('${t.id}')` : '');
        const iconInspire = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
        const iconFail = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
        const iconDone = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0D9B5C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        const iconRun = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
        let icon, iconBg, badge, badgeCls, rightAction;
        if (t.status === 'done') { icon=iconDone; iconBg='#EDFAF3'; badge='已完成'; badgeCls='htc-badge-done'; rightAction=`<button class="htc-action-btn" onclick="event.stopPropagation();openTask('${t.id}')">查看结果</button>`; }
        else if (t.status === 'extracted') { icon=iconInspire; iconBg='#FFF0E6'; badge='改写'; badgeCls='htc-badge-extracted'; rightAction=''; }
        else if (t.status === 'failed') { icon=iconFail; iconBg='#FEF2F2'; badge='失败'; badgeCls='htc-badge-failed'; rightAction=`<button class="htc-action-btn htc-retry-btn" onclick="event.stopPropagation();switchTab('inspire')">重试</button>`; }
        else if (t.status === 'running') { icon=iconRun; iconBg='#FFF0E6'; badge='进行中'; badgeCls='htc-badge-running'; rightAction=''; }
        else { icon=iconRun; iconBg='#F5F4F0'; badge='排队中'; badgeCls='htc-badge-pending'; rightAction=''; }
        const delBtn = (t.status==='done'||t.status==='failed') ? `<span style="display:flex;align-items:center;cursor:pointer" onclick="deleteTask(event,'${t.id}')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C8C4BB" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></span>` : '';
        return `<div class="task-card ${canClick?'task-card-clickable':''}" onclick="${clickFn}">
          <div class="htc-row">
            <div class="htc-icon-wrap" style="background:${iconBg};border-radius:13px">${icon}</div>
            <div class="htc-content">
              <div class="htc-content-title" style="font-size:14px">${esc(t.title)}</div>
              <div class="htc-content-sub">${typeLabel(t.type)} · ${formatDisplayTime(t.created_at)}</div>
            </div>
            <div class="htc-right" style="gap:8px">
              <div style="display:flex;align-items:center;gap:6px"><span class="htc-badge ${badgeCls}">${badge}</span>${delBtn}</div>
              ${rightAction}
            </div>
          </div>
          ${t.status==='running'?`
          <div style="margin-top:10px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <div class="htc-progress-wrap" style="flex:1"><div class="htc-progress-fill" style="width:${t.progress||0}%"></div></div>
              <span style="font-size:11px;font-weight:600;color:#F5762A;min-width:28px;text-align:right">${t.progress||0}%</span>
            </div>
            <div class="htc-thinking">${esc(t.thinking||'处理中...')}</div>
            <div style="margin-top:4px">${taskCountdown(t)}</div>
          </div>`:''}
          ${t.status==='pending'?`<div style="font-size:12px;color:#9E9890;margin-top:8px;padding-top:8px;border-top:1px solid #F7F5F1">${taskCountdown(t)||'等待处理...'}</div>`:''}
          ${t.status==='failed'?`<div style="font-size:12px;color:#DC2626;margin-top:8px;padding-top:8px;border-top:1px solid #F7F5F1">${esc(friendlyError(t.error_msg))}</div>`:''}
        </div>`;
      }).join('')
    }
  </div>`;
}

function tTaskDetail() {
  const t = S.viewingTask;
  if (!t) return `<div class="tab-page"><div class="empty-tip">加载中...</div></div>`;

  const result = t.result || {};
  const scripts = result.scripts || [];
  const analysis = result.analysis || null;
  const transcript = result.transcript || null;
  const backFn = S.tasksDetailFromHome ? `switchTab('home')` : `setState({tasksView:'list',viewingTask:null})`;

  return `<div class="tab-page">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <div onclick="${backFn}" style="display:flex;align-items:center;gap:4px;font-size:13px;color:#F5762A;cursor:pointer;-webkit-tap-highlight-color:transparent">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>返回
      </div>
      <div style="flex:1;font-size:14px;font-weight:700;color:#1A1814;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title||'任务详情')}</div>
    </div>
    ${t.status === 'failed' ? `
      <div style="background:#FEF2F2;border-radius:10px;padding:14px;margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;color:#DC2626;margin-bottom:6px">任务失败</div>
        <div style="font-size:13px;color:#7F1D1D;line-height:1.6">${esc(friendlyError(t.error_msg))}</div>
      </div>` : ''}
    ${analysis ? `
      <div class="analysis-card">
        <div class="analysis-title">对标账号分析</div>
        ${analysis.account_positioning ? `<div class="analysis-row">定位：${esc(analysis.account_positioning)}</div>` : ''}
        ${analysis.target_audience ? `<div class="analysis-row">受众：${esc(analysis.target_audience)}</div>` : ''}
        ${analysis.tone ? `<div class="analysis-row">风格：${esc(analysis.tone)}</div>` : ''}
        ${Array.isArray(analysis.hook_types)&&analysis.hook_types.length ? `<div class="analysis-row">钩子：${analysis.hook_types.map(h=>esc(h)).join(' / ')}</div>` : ''}
      </div>` : ''}
    ${transcript ? `
      <div style="background:#F7F6F2;border-radius:10px;padding:12px;margin-bottom:12px">
        <div style="font-size:11px;color:#A8A49C;margin-bottom:6px">口播原文</div>
        <div style="font-size:13px;color:#3A3A3A;line-height:1.7;white-space:pre-wrap;word-break:break-all">${esc(transcript)}</div>
      </div>` : ''}
    ${scripts.length > 0 ? `
      <div style="font-size:14px;font-weight:700;color:#1A1814;margin-bottom:10px">生成文案（${scripts.length}条）</div>
      ${scripts.map((s,i) => `
        <div class="script-result-card">
          <div class="script-hook-badge">${esc(s.hook_type||'文案')}</div>
          <div class="script-content">${esc(s.content)}</div>
          <div class="script-actions">
            <div class="copy-btn" onclick="cpTaskScript(event,'${t.id}',${i})">${S.tasksCopiedId===t.id+'_'+i?'✓ 已复制':'复制'}</div>
          </div>
        </div>`).join('')}` : (t.status !== 'failed' ? `<div class="empty-tip">暂无生成内容</div>` : '')}
  </div>`;
}

// ===== 任务 API 函数 =====
function mergeActiveCloneTaskStep(list) {
  if (!S.cloneTaskId || !Array.isArray(list)) return list;
  // 只在主动生成中（语音/数字人/后期）时才用本地UI步骤覆盖服务端步骤，
  // 避免 S.extractStep 的旧值（如之前到过步骤6）在首页把卡片错误地抬高
  const isActiveGen = S.ttsGenerating || S.avatarGenerating || S.postProcessing;
  if (!isActiveGen) return list;
  const activeStep = currentCloneStepFromState();
  return list.map(t => String(t.id) === String(S.cloneTaskId)
    ? { ...t, clone_step: Math.max(parseInt(t.clone_step) || 1, activeStep) }
    : t);
}

async function loadTasks() {
  if (!getToken()) return;
  try {
    const r = await api.get('/tasks');
    if (r.code === 200) {
      const tasks = mergeActiveCloneTaskStep(r.data);
      setState({ tasksList: tasks, tasksLoaded: true });
      updateHomeDoneSeen();
      const hasRunning = tasks.some(t => t.status === 'pending' || t.status === 'running');
      if (hasRunning) { startTasksPolling(); startTasksTickTimer(); }
      else { stopTasksPolling(); stopTasksTickTimer(); }
    }
  } catch {}
}

let _lastTasksJson = '';
function startTasksPolling() {
  if (tasksPollerTimer) return;
  tasksPollerTimer = setInterval(async () => {
    try {
      const r = await api.get('/tasks');
      if (r.code === 200) {
        const tasks = mergeActiveCloneTaskStep(r.data);
        // 用 JSON 摘要判断数据是否真的变化，没变化就不触发 render，避免手机滚动时被打断
        const newJson = JSON.stringify(tasks.map(t => `${t.id}:${t.status}:${t.stage}:${t.clone_step}:${t.progress}:${t.error_msg||''}`));
        const changed = newJson !== _lastTasksJson;
        _lastTasksJson = newJson;
        S.tasksList = tasks;
        updateHomeDoneSeen();
        // 只在 home/history 页、且数据真正变化时才渲染
        if (changed && (S.currentTab === 'home' || S.currentTab === 'history')) render();
        const hasRunning = tasks.some(t => t.status === 'pending' || t.status === 'running');
        if (!hasRunning) stopTasksPolling();
      }
    } catch {}
  }, 2500);
}

// tasksTickTimer：原用于每秒刷新"相对时间"，但时间格式是固定时间戳（非"X分钟前"），
// 每秒整页 render 对手机滚动性能伤害极大且无任何收益，直接废弃。
function startTasksTickTimer() { /* 已废弃，保留空函数避免调用报错 */ }
function stopTasksTickTimer() {
  if (tasksTickTimer) { clearInterval(tasksTickTimer); tasksTickTimer = null; }
}

function stopTasksPolling() {
  if (tasksPollerTimer) { clearInterval(tasksPollerTimer); tasksPollerTimer = null; }
}

async function openTask(taskId) {
  setState({ tasksView: 'detail', viewingTask: null });
  try {
    const r = await api.get(`/tasks/${taskId}`);
    if (r.code === 200) setState({ viewingTask: r.data });
    else setState({ tasksView: 'list' });
  } catch { setState({ tasksView: 'list' }); }
}

function cpTaskScript(e, taskId, idx) {
  e.stopPropagation();
  const t = S.viewingTask;
  if (!t || !t.result) return;
  const scripts = t.result.scripts || [];
  copyText(scripts[idx]?.content || '');
  setState({ tasksCopiedId: taskId + '_' + idx });
  setTimeout(() => { setState({ tasksCopiedId: '' }); }, 2000);
}

function cpPathBScript(e, idx) {
  e.stopPropagation();
  const s = S.pathBScripts[idx];
  if (!s) return;
  copyText(s.content || '');
  setState({ tasksCopiedId: 'pb_' + idx });
  setTimeout(() => { setState({ tasksCopiedId: '' }); }, 2000);
}

// ===== 路径A 进度轮询 =====
function startPathAPolling(taskId) {
  if (pathAPollerTimer) clearInterval(pathAPollerTimer);
  pathAPollerTimer = setInterval(async () => {
    if (S.pathALastTaskId !== taskId) { clearInterval(pathAPollerTimer); pathAPollerTimer = null; return; } // ★ 已切换到其他任务
    try {
      const r = await api.get(`/tasks/${taskId}`);
      if (S.pathALastTaskId !== taskId) return; // ★ 请求返回期间可能已切换
      if (r.code === 200) {
        setState({ pathATaskData: r.data });
        if (r.data.status === 'done' || r.data.status === 'failed') {
          clearInterval(pathAPollerTimer);
          pathAPollerTimer = null;
        }
      }
    } catch {}
  }, 2500);
}

function stopPathAPolling() {
  if (pathAPollerTimer) { clearInterval(pathAPollerTimer); pathAPollerTimer = null; }
}

function cpPathAInlineScript(i) {
  const task = S.pathATaskData;
  if (!task) return;
  let result = {};
  try { result = typeof task.result === 'string' ? JSON.parse(task.result) : (task.result || {}); } catch {}
  const s = (result.scripts || [])[i];
  if (s) { copyText(s.content); showToast('已复制'); }
}

// ===== 路径A 函数 =====
async function pathAResolve() {
  if (!ensureLoggedIn()) return;
  const text = S.pathAText.trim();
  if (!text) { setState({ pathAErr: '请粘贴链接或分享文本' }); return; }
  setState({ pathALoading: true, pathAErr: '' });
  try {
    const r = await api.post('/inspire/resolve', { text });
    if (r.code !== 200) { setState({ pathAErr: r.msg, pathALoading: false }); return; }
    const data = r.data;

    if (data.type === 'video') {
      // 单视频 → 直接建任务
      const r2 = await api.post('/inspire/start-single-video', { aweme_id: data.aweme_id, brand_name: S.pathABrandName });
      if (r2.code !== 200) { setState({ pathAErr: r2.msg, pathALoading: false }); return; }
      setState({ pathALoading: false, pathAState: 'started', pathALastTaskId: r2.data.taskId, pathATaskData: null });
      startPathAPolling(r2.data.taskId);
    } else {
      // 主页 → 拉视频列表
      const r3 = await api.post('/inspire/profile-videos', { sec_user_id: data.sec_user_id });
      if (r3.code !== 200) { setState({ pathAErr: r3.msg, pathALoading: false }); return; }
      const top3 = r3.data.videos.slice(0, 3).map(v => v.aweme_id);
      setState({ pathALoading: false, pathAResolveData: data, pathAProfile: r3.data, pathASelectedIds: top3, pathAState: 'videos' });
    }
  } catch (e) {
    setState({ pathAErr: '网络错误，请重试', pathALoading: false });
  }
}

function pathAToggleVideo(awemeId) {
  const ids = [...S.pathASelectedIds];
  const idx = ids.indexOf(awemeId);
  if (idx >= 0) { ids.splice(idx, 1); setState({ pathASelectedIds: ids }); }
  else if (ids.length < 3) { setState({ pathASelectedIds: [...ids, awemeId] }); }
  else showToast('最多选 3 条视频');
}

async function pathAStartAnalyze() {
  if (!ensureLoggedIn()) return;
  if (S.pathASelectedIds.length === 0) { showToast('请至少选 1 条视频'); return; }
  setState({ pathALoading: true, pathAErr: '' });
  try {
    const r = await api.post('/inspire/start-analyze', {
      sec_user_id: S.pathAResolveData.sec_user_id,
      selected_video_ids: S.pathASelectedIds,
      brand_name: S.pathABrandName,
    });
    if (r.code !== 200) { setState({ pathAErr: r.msg, pathALoading: false }); return; }
    setState({ pathALoading: false, pathAState: 'started', pathALastTaskId: r.data.taskId, pathATaskData: null });
    startPathAPolling(r.data.taskId);
  } catch (e) {
    setState({ pathAErr: '网络错误，请重试', pathALoading: false });
  }
}

// ===== 路径B 函数 =====
function pathBSelectIndustry(id, name) {
  setState({ pathBIndustryId: id, pathBIndustryName: name, pathBCustom: '' });
}

async function pathBNext() {
  if (!ensureLoggedIn()) return;
  const industry = S.pathBIndustryName || S.pathBCustom.trim();
  if (!industry) { setState({ pathBErr: '请选择或输入行业' }); return; }
  setState({ pathBState: 'clarifying', pathBErr: '' });
  try {
    const r = await api.post('/inspire/clarify', { industry });
    if (r.code !== 200) { setState({ pathBState: 'form', pathBErr: r.msg }); return; }
    setState({ pathBState: 'clarify', pathBQuestions: r.data.questions, pathBAnswers: {} });
  } catch {
    setState({ pathBState: 'form', pathBErr: '网络错误，请重试' });
  }
}

function pathBSelectAnswer(questionId, option, type) {
  const answers = { ...S.pathBAnswers };
  if (type === 'multi') {
    const cur = Array.isArray(answers[questionId]) ? answers[questionId] : [];
    answers[questionId] = cur.includes(option) ? cur.filter(o => o !== option) : [...cur, option];
  } else {
    answers[questionId] = option;
  }
  setState({ pathBAnswers: answers });
}

async function pathBGenerate() {
  if (!ensureLoggedIn()) return;
  const industry = S.pathBIndustryName || S.pathBCustom.trim();
  setState({ pathBState: 'generating', pathBErr: '' });
  try {
    const answers = S.pathBQuestions.map(q => ({
      question: q.question,
      answer: S.pathBAnswers[q.id] || '(未选)',
    }));
    const r = await api.post('/inspire/generate-industry', { industry, brand_name: S.pathBBrandName, answers });
    if (r.code !== 200) { setState({ pathBState: 'clarify', pathBErr: r.msg }); return; }
    setState({ pathBState: 'done', pathBScripts: r.data.scripts, pathBTaskId: r.data.taskId });
  } catch {
    setState({ pathBState: 'clarify', pathBErr: '网络错误，请重试' });
  }
}

function scriptCopyText(s) {
  if (!s) return '';
  const hook = String(s.hook || '').trim();
  const body = String(s.content || '').trim();
  if (body && hook && body !== hook) return hook + '\n\n' + body;
  return body || hook;
}

function cpHistoryPage(e, hi, si) {
  e.stopPropagation();
  const it = S.recentHistory[hi];
  if (!it||!it.result) return;
  copyText(scriptCopyText(it.result[si]));
  showToast('已复制');
}

// ===== NICKNAME PROMPT =====
function tNicknamePrompt() {
  return `<div class="nickname-prompt">
    <span class="nickname-prompt-text">你叫什么？设置一个昵称吧 😊</span>
    <div class="nickname-prompt-row">
      <input class="nickname-prompt-input" id="f-nickname" placeholder="输入你的昵称" maxlength="20"
        value="${esc(S.nicknameInput)}" oninput="S.nicknameInput=this.value"/>
      <div class="nickname-prompt-confirm" onclick="confirmNickname()">确认</div>
    </div>
    <div class="nickname-prompt-skip" onclick="dismissNicknamePrompt()">跳过</div>
  </div>`;
}

async function confirmNickname() {
  const name = S.nicknameInput.trim();
  if (!name) { showToast('请输入昵称'); return; }
  try {
    await api.put('/auth/profile', { nickname: name });
  } catch {}
  const user = getUser() || {};
  setUser({ ...user, nickname: name });
  setState({ nicknamePrompt: false, nicknamePromptDismissed: true, userName: name, nicknameInput: '' });
  showToast('昵称已设置');
}

function dismissNicknamePrompt() {
  setState({ nicknamePrompt: false, nicknamePromptDismissed: true });
}

// ===== 原创工坊 =====
