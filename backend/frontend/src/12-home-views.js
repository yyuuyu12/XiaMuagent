function tTabContent() {
  switch(S.currentTab) {
    case 'home':    return tHome();
    case 'extract': return tExtract();
    case 'inspire': return tInspire();
    case 'profile': return tProfile();
    case 'vip':     return tVip();
    case 'history': return tHistory();
    case 'original': return tOriginal();
    case 'agents':   return tAgents();
    case 'workshop': return tWorkshop();
    default:        return tHome();
  }
}

function tBottomTab() {
  // 原创工坊对话页：隐藏底部导航，给输入框让出空间
  if (S.currentTab === 'original' && S.originalView === 'chat') return '';
  const tabDef = [
    { key: 'home',     label: '首页', svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>` },
    { key: 'agents',   label: '智能体', svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M9 11V7a3 3 0 016 0v4"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>` },
    { key: 'workshop', label: '口播工坊', svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0014 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>` },
    { key: 'profile',  label: '我的', svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` },
  ];
  return `<div class="bottom-tab">
    ${tabDef.map(t=>`
    <div class="tab-item ${S.currentTab===t.key?'tab-active':''}" onclick="switchTab('${t.key}')">
      <span class="tab-icon">${t.svg}</span><span class="tab-label">${t.label}</span>
    </div>`).join('')}
  </div>`;
}

// ===== HOME TASK SECTION =====
// 大卡片按最近 1 小时展示，最多 3 条；更早或超出的任务收进下方长条卡片
function updateHomeDoneSeen() {}
function dismissHomeDoneSeen() {}

function tHomeTaskSection() {
  if (!S.tasksLoaded && !S.cloneHistoryLoaded) return '';
  const taskKind = t => {
    if (!t) return '克隆';
    if (t.task_kind === 'industry' || t.type === 'industry_gen') return '行业';
    if (t.type === 'profile_analyze' || t.type === 'single_video_analyze') return '对标';
    if (t.type === 'clone_video') {
      const res = typeof t.result === 'string' ? (() => { try { return JSON.parse(t.result); } catch { return {}; } })() : (t.result || {});
      if (res.source === 'featured') return '行业';
    }
    return '克隆';
  };
  // 右上角徽章：只展示任务类型，不展示步骤状态
  const taskKindLabel = t => ({ '克隆':'爆款克隆', '对标':'对标拆解', '行业':'行业精选' }[taskKind(t)] || '爆款克隆');
  const taskKindCls = t => ({ '克隆':'home-task-mini-action-clone', '对标':'home-task-mini-action-benchmark', '行业':'home-task-mini-action-industry' }[taskKind(t)] || '');
  const DONE_BIG_WINDOW = 1 * 60 * 60 * 1000;
  const taskTime = t => {
    const raw = t && (t.activity_at || t.updated_at || t.created_at);
    const n = raw ? new Date(raw).getTime() : 0;
    return Number.isNaN(n) ? 0 : n;
  };
  const sortedTasks = [...(S.tasksList || [])].sort((a, b) => taskTime(b) - taskTime(a));
  const bigCards = sortedTasks
    .filter(t => Date.now() - taskTime(t) < DONE_BIG_WINDOW)
    .slice(0, 5);
  const bigIds = new Set(bigCards.map(t => String(t.id)));
  const oldDoneTasks = sortedTasks
    .filter(t => !bigIds.has(String(t.id)))
    .map(t => ({ _type: 'task', _task: t, label: taskKind(t), text: t.title, created_at: t.activity_at || t.updated_at || t.created_at }));
  const cloneItems = (S.cloneHistory || [])
    .map((it, idx) => ({ _type: 'clone', idx, label: '克隆', text: it.input || '', created_at: it.created_at }));
  const smallItems = [...oldDoneTasks, ...cloneItems]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, Math.max(0, 5 - bigCards.length));

  if (!bigCards.length && !smallItems.length) {
    return `<div style="margin-bottom:14px">
      <div class="home-section-header">
        <span class="home-section-title">我的任务</span>
        <span class="home-section-more" onclick="openHistoryPage()">查看全部 ›</span>
      </div>
      <div class="recent-empty-line">还没有创作记录，快去试试吧</div>
    </div>`;
  }

  // Helper: 6-step row with labels (设计稿统一样式)
  function stepsWithLabels(currentStep) {
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
  }
  // Clone task icon SVG
  const iconClone = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B6FE0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`;
  const iconInspire = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  const iconDone = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0D9B5C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const iconFailed = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  const iconRun = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

  const clampPct = n => Math.max(0, Math.min(100, Math.round(n || 0)));
  const cloneStepOf = t => Math.max(1, Math.min(6, parseInt(t.clone_step) || (t.status === 'done' ? 2 : 1)));
  const clonePhaseOf = t => {
    const stage = t.stage || '';
    const savedStep = cloneStepOf(t);
    if (t.status === 'failed') return { step: savedStep, phase: 'failed' };
    if (t.status === 'paused') return { step: savedStep, phase: 'paused' };
    if (t.status === 'pending') {
      if (stage === 'rewrite' || stage === 'extracted') return { step: 2, phase: 'rewrite_pending' };
      return { step: 1, phase: 'pending' };
    }
    if (t.status === 'running') {
      if (stage === 'rewrite') return { step: 2, phase: 'rewriting' };
      return { step: 1, phase: 'extracting' };
    }
    if (t.status === 'extracted') return savedStep > 1 ? { step: savedStep, phase: 'step_done' } : { step: 1, phase: 'extracted' };
    const step = savedStep;
    return { step, phase: step >= 6 ? 'published' : 'step_done' };
  };
  const cloneDoneLabels = ['提取中','提取完毕','改写完毕','语音完毕','数字人完毕','后期完毕'];
  const cloneNextActions = ['查看提取进展 ›','查看改写结果 ›','查看语音结果 ›','查看语音结果 ›','查看数字人视频 ›','去发布 ›'];
  const cloneStatusText = t => {
    const info = clonePhaseOf(t);
    if (info.phase === 'failed') return '失败';
    if (info.phase === 'paused') return '已暂停';
    if (info.phase === 'pending') return '排队中';
    if (info.phase === 'rewrite_pending') return '等待改写';
    if (info.phase === 'extracting') return '提取中';
    if (info.phase === 'rewriting') return '改写中';
    if (info.phase === 'extracted') return '提取完毕';
    // step5 需区分"数字人完成"vs"后期完成"
    if (info.step === 5 && t.post_process_done) return '后期完毕';
    return cloneDoneLabels[info.step - 1] || '已完成';
  };
  const cloneHintText = t => {
    const info = clonePhaseOf(t);
    if (info.phase === 'failed') return friendlyError(t.error_msg);
    if (info.phase === 'paused') return '渲染服务离线，恢复后自动继续';
    if (info.phase === 'pending') return '文案提取排队中';
    if (info.phase === 'rewrite_pending') return '改写任务排队中，请稍候';
    if (info.phase === 'extracting') return t.thinking || '正在提取视频文案，请稍候';
    if (info.phase === 'rewriting') return t.thinking || '正在AI改写文案，请稍候';
    if (info.phase === 'extracted') return '文案提取完毕';
    // 后端 step 含义：step=3→改写完(待语音) step=4→音频完(待数字人) step=5→数字人完(待后期)
    const hints = [
      '文案提取完毕',       // step 1
      '文案提取完毕',       // step 2
      '改写完毕',           // step 3：有改写稿，下一步生成语音
      '语音已生成',         // step 4：有音频，下一步选数字人
      t.post_process_done ? '后期视频已就绪' : '数字人视频已生成',  // step 5：有数字人视频
      '视频待发布'          // step 6
    ];
    return hints[info.step - 1] || '可继续完成当前步骤';
  };
  const statusText = t => {
    if (t.type === 'clone_video') return cloneStatusText(t);
    return ({ pending:'排队中', running:'进行中', extracted:'改写', done:'已完成', failed:'失败', paused:'已暂停' }[t.status] || t.status);
  };
  // 进度条 = 当前阶段的进展，不是总进展（避免与"后台生成"实时进度冲突）
  const bigProgress = t => {
    if (t.status === 'failed') return Math.max(0, Math.min(100, t.progress || 0));
    if (t.type === 'clone_video') {
      const info = clonePhaseOf(t);
      if (info.phase === 'pending') return 0;
      // 提取中：实际进度的子集
      if (info.phase === 'extracting') return clampPct(Math.min(88, Math.max(5, (t.progress || 10) * 0.9)));
      // 提取完 / 等待改写：改写阶段尚未开始 → 0%
      if (info.phase === 'extracted') return 0;
      if (info.phase === 'rewrite_pending') return 0;
      // 改写中：实际进度
      if (info.phase === 'rewriting') return clampPct(t.progress || 20);
      // 某步骤完成、下一步尚未开始 → 0%（步骤点已表示进度，进度条重置）
      if (info.phase === 'step_done') return null;
      // 全部完成
      if (info.phase === 'published') return 100;
      return 0;
    }
    if (t.status === 'done') return 100;
    return Math.max(0, Math.min(100, t.progress || 0));
  };
  const cloneBadgeCls = t => {
    const info = clonePhaseOf(t);
    if (info.phase === 'failed') return 'htc-badge-failed';
    if (info.phase === 'paused') return 'htc-badge-pending';
    if (info.phase === 'pending') return 'htc-badge-pending';
    if (info.phase === 'extracting' || info.phase === 'rewrite_pending' || info.phase === 'rewriting' || info.phase === 'extracted') return 'htc-badge-extracted';
    return 'htc-badge-done';
  };
  const openTaskAction = t => (t.type === 'clone_video' && t.status !== 'failed') ? `openExtractWithTask('${t.id}')` : `openTaskFromHome('${t.id}')`;
  const bigActionText = t => {
    if (t.type === 'clone_video') {
      const info = clonePhaseOf(t);
      if (info.phase === 'failed') return '查看详情 ›';
      if (info.phase === 'paused') return '等待服务恢复 ›';
      if (info.phase === 'pending' || info.phase === 'extracting') return '查看提取进展 ›';
      if (info.phase === 'rewrite_pending' || info.phase === 'rewriting') return '查看改写进展 ›';
      if (info.phase === 'extracted') return '查看提取结果 ›';  // step1：文案已提取，待改写
      // step_done 按步骤给出明确动作
      if (info.phase === 'step_done' || info.phase === 'published') {
        if (info.step === 2) return '查看提取结果 ›';  // step2：进入改写步骤但未改写，查看提取内容
        if (info.step === 3) return '查看改写结果 ›';  // step3：改写完成，待语音
        if (info.step === 4) return '查看语音结果 ›';  // step4：语音完，待数字人
        if (info.step === 5) return t.post_process_done ? '查看后期视频 ›' : '查看数字人视频 ›';
        if (info.step >= 6) return '去发布 ›';
      }
      return cloneNextActions[info.step - 1] || '继续 ›';
    }
    if (t.status === 'extracted') return '改写 ›';
    if (t.status === 'done') return '查看结果 ›';
    if (t.status === 'failed') return '查看详情 ›';
    return '查看详情 ›';
  };
  const miniAction = t => {
    return { text: taskKind(t), cls: taskKindCls(t) };
  };
  const miniIcon = t => {
    if (t.status === 'failed') return { icon: iconFailed, cls: 'htc-icon-failed' };
    if (t.status === 'done') return { icon: iconDone, cls: 'htc-icon-done' };
    if (t.status === 'pending' || t.status === 'running') return { icon: iconRun, cls: 'htc-icon-inspire' };
    return t.type === 'clone_video' ? { icon: iconClone, cls: 'htc-icon-clone' } : { icon: iconInspire, cls: 'htc-icon-inspire' };
  };

  const hasLive = bigCards.some(t => t.status === 'running' || t.status === 'pending');

  // ── 实时生成卡：语音 / 数字人 / 字幕烧录 ──────────────────────────────
  let liveCard = '';
  const _svgCheck = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`;
  const _svgActiveDot = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" fill="#F5762A"/></svg>`;
  function _hlcSteps(activeStep) {
    const labels = ['提取','改写','语音','数字人','后期','发布'];
    let html = '';
    for (let i = 0; i < labels.length; i++) {
      const cls = i < activeStep ? 'sdone' : i === activeStep ? 'sactive' : 'sinactive';
      const inner = i < activeStep ? _svgCheck : i === activeStep ? _svgActiveDot : (i+1);
      html += `<div class="hlc-step-dot ${cls}">${inner}</div>`;
      if (i < labels.length - 1) html += `<div class="hlc-step-line${i < activeStep ? ' done' : ''}"></div>`;
    }
    return html;
  }

  // liveCard 对应的任务标题（用于卡片顶部，避免和 bigCards 重复时看不出是哪个任务）
  const _liveTaskTitle = S.cloneTaskId
    ? (bigCards.find(t => String(t.id) === String(S.cloneTaskId))?.title || '')
    : '';

  if (S.ttsGenerating) {
    const pct = S.ttsProgressPct || 5;
    liveCard = `<div class="home-live-card" onclick="setState({currentTab:'extract'});render()">
      <div class="hlc-top">
        <div class="hlc-title">${_liveTaskTitle ? esc(_liveTaskTitle) : '语音合成'}</div>
        <div class="hlc-badge-running"><div class="hlc-status-dot"></div>语音合成中</div>
      </div>
      <div class="hlc-hint"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="9" y="2" width="6" height="11" rx="3" stroke="#F5762A" stroke-width="1.8"/><path d="M5 11C5 14.866 8.134 18 12 18" stroke="#F5762A" stroke-width="1.8" stroke-linecap="round"/></svg>正在合成语音中...</div>
      <div class="hlc-progress-row">
        <div class="hlc-bar-wrap"><div class="hlc-bar-fill" data-tts-pct style="width:${pct}%"></div></div>
        <div class="hlc-pct" data-tts-pct-text>${pct}%</div>
      </div>
      <div class="hlc-steps">${_hlcSteps(2)}</div>
      <div class="hlc-actions">
        <div class="hlc-btn-view" onclick="event.stopPropagation();setState({currentTab:'extract'});render()">查看进展</div>
        <div class="hlc-btn-stop" onclick="event.stopPropagation();stopTTSGenerate()">停止</div>
      </div>
    </div>`;
  } else if (S.avatarGenerating) {
    const pct = S.avatarProgressPct || 20;
    liveCard = `<div class="home-live-card" onclick="setState({currentTab:'extract'});render()">
      <div class="hlc-top">
        <div class="hlc-title">${_liveTaskTitle ? esc(_liveTaskTitle) : '数字人视频'}</div>
        <div class="hlc-badge-running"><div class="hlc-status-dot"></div>数字人生成中</div>
      </div>
      <div class="hlc-hint"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="#F5762A" stroke-width="1.8"/><path d="M3 9h18M9 21V9" stroke="#F5762A" stroke-width="1.8"/></svg>${esc(S.avatarProgressMsg||'GPU 渲染中...')}</div>
      <div class="hlc-progress-row">
        <div class="hlc-bar-wrap"><div class="hlc-bar-fill" style="width:${pct}%"></div></div>
        <div class="hlc-pct">${pct}%</div>
      </div>
      <div class="hlc-steps">${_hlcSteps(3)}</div>
      <div class="hlc-actions">
        <div class="hlc-btn-view" onclick="event.stopPropagation();setState({currentTab:'extract'});render()">查看进展</div>
        <div class="hlc-btn-stop" onclick="event.stopPropagation();handleAvatarStop()">停止</div>
      </div>
    </div>`;
  } else if (S.postProcessing) {
    const pct = S.postProgressPct || 5;
    liveCard = `<div class="home-live-card" onclick="setState({currentTab:'extract'});render()">
      <div class="hlc-top">
        <div class="hlc-title">${_liveTaskTitle ? esc(_liveTaskTitle) : '字幕烧录'}</div>
        <div class="hlc-badge-running"><div class="hlc-status-dot"></div>字幕烧录中</div>
      </div>
      <div class="hlc-hint"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="2" y="7" width="20" height="10" rx="2" stroke="#F5762A" stroke-width="1.8"/><path d="M6 11h4M6 14h8" stroke="#F5762A" stroke-width="1.8" stroke-linecap="round"/></svg>正在烧录字幕...</div>
      <div class="hlc-progress-row">
        <div class="hlc-bar-wrap"><div class="hlc-bar-fill" style="width:${pct}%"></div></div>
        <div class="hlc-pct">${pct}%</div>
      </div>
      <div class="hlc-steps">${_hlcSteps(4)}</div>
      <div class="hlc-actions">
        <div class="hlc-btn-view" onclick="event.stopPropagation();setState({currentTab:'extract'});render()">查看进展</div>
      </div>
    </div>`;
  }

  return `<div style="margin-bottom:14px">
    <div class="home-section-header">
      <span class="home-section-title">${(hasLive || liveCard) ? `<span class="task-live-dot"></span>` : ''}我的任务</span>
      <span class="home-section-more" onclick="openHistoryPage()">查看全部 ›</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
    ${liveCard}
    ${bigCards.filter(t => {
      // liveCard 已经展示了这个任务，bigCards 里不重复渲染
      if (liveCard && S.cloneTaskId && String(t.id) === String(S.cloneTaskId)) return false;
      return true;
    }).map(t => {
      const isClone = t.type === 'clone_video';
      // post_process_done: 步骤5后期已完成 → 视觉上显示为 step6（步骤5打勾，步骤6待发布）
      const cloneStep = isClone
        ? (clonePhaseOf(t).step === 5 && t.post_process_done ? 6 : clonePhaseOf(t).step)
        : cloneStepOf(t);
      const pct = bigProgress(t);
      const thinking = isClone
        ? cloneHintText(t)
        : (t.status === 'failed'
          ? friendlyError(t.error_msg)
          : (t.thinking || (t.status === 'pending' ? '等待处理...' : t.status === 'done' ? '最近生成完成' : t.status === 'extracted' ? '文案已提取，可继续改写' : '处理中...')));
      // 徽章颜色（设计稿统一规范）
      const isRunning = t.status === 'running' || (isClone && clonePhaseOf(t).phase === 'extracting') || (isClone && clonePhaseOf(t).phase === 'rewriting');
      const isPending = t.status === 'pending' || (isClone && (clonePhaseOf(t).phase === 'pending' || clonePhaseOf(t).phase === 'rewrite_pending'));
      const isDone = t.status === 'done' || (isClone && clonePhaseOf(t).phase === 'published');
      const isFailed = t.status === 'failed' || (isClone && clonePhaseOf(t).phase === 'failed');
      const bdgColor = '#F5762A';
      const bdgBg = 'rgba(245,118,42,0.12)';
      const showPulse = isRunning || isPending;
      return `<div style="background:#FFF8F3;border-radius:18px;padding:14px 16px;border:1.5px solid rgba(245,118,42,0.2);box-shadow:0 4px 16px rgba(245,96,42,0.08);cursor:pointer;transition:transform 0.15s;-webkit-tap-highlight-color:transparent;margin-bottom:0" onclick="${openTaskAction(t)}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px">
          <div style="font-size:13px;font-weight:600;color:#1A1614;line-height:1.5;flex:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(t.title)}</div>
          <div style="flex-shrink:0;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;color:${bdgColor};background:${bdgBg};white-space:nowrap;display:flex;align-items:center;gap:4px">
            ${showPulse ? `<div style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:pulse 1.2s infinite"></div>` : ''}
            ${taskKindLabel(t)}
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="font-size:11px;color:#9E9890;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:8px">${esc(thinking)}</div>
          ${(pct != null && pct > 0 && pct < 100) ? `<div style="font-size:12px;font-weight:700;color:#F5762A;flex-shrink:0">${pct}%</div>` : ''}
        </div>
        <div style="height:4px;background:${(pct === null || pct > 0)?'rgba(245,118,42,0.15)':'#F0EDE8'};border-radius:4px;overflow:hidden;margin-bottom:12px">
          <div style="height:100%;width:${pct === null ? 100 : (pct || 0)}%;background:linear-gradient(90deg,#FF8040,#F5602A);border-radius:4px;transition:width 0.4s"></div>
        </div>
        <div style="margin-bottom:12px">${stepsWithLabels(cloneStep)}</div>
        <div style="display:flex;gap:8px">
          <div style="flex:1;padding:9px;text-align:center;background:rgba(245,118,42,0.08);border-radius:10px;font-size:13px;font-weight:600;color:#F5762A;cursor:pointer" onclick="event.stopPropagation();${openTaskAction(t)}">${bigActionText(t)}</div>
        </div>
      </div>`;
    }).join('')}
    </div>
    ${smallItems.length > 0 ? `<div class="home-task-small-scroll" style="margin-top:10px">
      ${smallItems.map(it => {
        if (it._type === 'task') {
          const t = it._task;
          if (!t) return '';
          const mi = miniIcon(t);
          const act = miniAction(t);
          const clickFn = t.status === 'failed' ? `switchTab('inspire')` : openTaskAction(t);
          const meta = formatDisplayTime(t.activity_at || t.updated_at || t.created_at);
          return `<div class="home-task-mini-card" onclick="${clickFn}">
            <div class="home-task-mini-icon">
              <div class="htc-icon-wrap ${mi.cls}" style="width:34px;height:34px;border-radius:10px">${mi.icon}</div>
            </div>
            <div class="home-task-mini-body">
              <div class="home-task-mini-title">${esc(t.title)}</div>
              <div class="home-task-mini-meta">${esc(meta)}</div>
            </div>
            <span class="home-task-mini-action ${act.cls}">${act.text}</span>
          </div>`;
        }
        if (it._type === 'clone') {
          return `<div class="home-task-mini-card" onclick="openHistoryPage('clone')">
            <div class="home-task-mini-icon">
              <div class="htc-icon-wrap htc-icon-clone" style="width:34px;height:34px;border-radius:10px">${iconClone}</div>
            </div>
            <div class="home-task-mini-body">
              <div class="home-task-mini-title">${esc(it.text)}</div>
              <div class="home-task-mini-meta">克隆 · ${esc(formatDisplayTime(it.created_at))}</div>
            </div>
            <span class="home-task-mini-action home-task-mini-action-clone">克隆</span>
          </div>`;
        }
        return '';
      }).join('')}
    </div>` : ''}
  </div>`;
}

async function openTaskFromHome(taskId) {
  dismissHomeDoneSeen();
  setState({ currentTab: 'history', historyTab: 'inspire', tasksView: 'detail', viewingTask: null, tasksDetailFromHome: true });
  loadTasks();
  try {
    const r = await api.get(`/tasks/${taskId}`);
    if (r.code === 200) setState({ viewingTask: r.data });
    else setState({ tasksView: 'list' });
  } catch { setState({ tasksView: 'list' }); }
}

// ===== HOME =====
function tHome() {
  const u = S.userInfo;
  // 欢迎语：有昵称显示昵称，无昵称显示「你好，老板」
  const hasNickname = !!(u?.nickname && u.nickname.trim());
  const hour = new Date().getHours();
  const timeGreet = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  const greetText = hasNickname ? esc(u.nickname) : '朋友';

  // 用次进度条：已登录但数据未加载时显示空进度条
  let usageSection;
  if (!u) {
    usageSection = '';
  } else if (u.role === 'admin' || u.daily_limit >= 999) {
    usageSection = `<div class="usage-bar"><span class="usage-text">次数：无限制 ∞</span></div>`;
  } else {
    const used = u.used_today || 0;
    const limit = u.daily_limit || 5;
    const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
    usageSection = `<div class="usage-progress-wrap">
      <div class="usage-progress-bar">
        <div class="usage-progress-fill ${pct>=80?'usage-progress-warn':''}" style="width:${Math.min(pct,100)}%"></div>
      </div>
      <span class="usage-progress-text">${used}/${limit}次</span>
    </div>`;
  }

  // 热门行业：优先读后端数据，兜底用默认
  const hotTags = S.industries.length > 0
    ? S.industries
    : [{name:'美妆'},{name:'母婴'},{name:'数码'},{name:'食品'},{name:'服装'},{name:'宠物'},{name:'家居'}];

  return `<div class="tab-page home-page">
    <div class="welcome-banner">
      <span class="welcome-greet">${timeGreet}</span>
      <span class="welcome-name">${greetText}</span>
      <span class="welcome-hi">今天想创作什么爆款内容？</span>
      ${usageSection}
    </div>
    <div class="home-section-header" style="margin-top:8px">
      <span class="home-section-title">核心功能</span>
    </div>
    <div class="feat-clone-card" onclick="openCloneEntry()">
      <div class="feat-clone-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div>
      <div class="feat-clone-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6B6FE0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></div>
      <div class="feat-clone-title">爆款克隆</div>
      <div class="feat-clone-desc">粘贴抖音 / 快手链接，一键提取文案并 AI 改写成你的风格</div>
      <div class="feat-clone-tags">
        <span class="feat-clone-tag">语音提取</span>
        <span class="feat-clone-tag">AI 改写</span>
        <span class="feat-clone-tag">一键复制</span>
      </div>
    </div>
    <div class="feat-sub-grid">
      <div class="feat-sub-card" onclick="setState({currentTab:'inspire',inspireMode:'analyze',inspireFromHome:true});render()">
        <div class="feat-sub-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="feat-sub-icon" style="background:#FFF3E8"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M4.9 4.9L7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/></svg></div>
        <div class="feat-sub-title">对标拆解</div>
        <div class="feat-sub-desc">分析竞品文案结构与爆点</div>
      </div>
      <div class="feat-sub-card" onclick="setState({currentTab:'inspire',inspireFromHome:true});enterFeaturedMode()">
        <div class="feat-sub-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="feat-sub-icon" style="background:#F0FDF4"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h11"/><path d="M4 12h9"/><path d="M4 17h6"/><path d="M17 10l3 3-3 3"/><path d="M13 13h7"/></svg></div>
        <div class="feat-sub-title">行业精选</div>
        <div class="feat-sub-desc">按赛道浏览爆款文案合集</div>
      </div>
    </div>
    <!-- 原创工坊入口 -->
    <div class="orig-home-card" onclick="enterOriginal()">
      <div class="feat-clone-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div>
      <div class="orig-home-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F5602A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      </div>
      <div class="orig-home-title">原创工坊</div>
      <div class="orig-home-desc">打造专属风格，项目制深度创作——做自己，而不是抄别人</div>
      <div class="orig-home-tags">
        <span class="orig-home-tag">Skill 系统</span>
        <span class="orig-home-tag">项目对话</span>
        <span class="orig-home-tag">同步学习</span>
      </div>
    </div>
    ${tHomeTaskSection()}
  </div>`;
}

// ===== 克隆流程步骤条 =====
function cloneCurrentStep() {
  const s = S.extractStep;
  if (s === 0 || s === 'cloning' || s === 'review') return 1;
  if (s === 'rewriting' || s === 2) return 2;
  if (s === 3 || s === 'tts_gen') return 3;
  if (s === 4 || s === 'avatar_gen') return 4;
  if (s === 5) return 5;
  if (s === 6) return 6;
  return 1;
}

function tCloneStepBar() {
  const cur = cloneCurrentStep();
  if (cur === 0) return '';
  const steps = ['提取','改写','语音','数字人','后期','发布'];
  const CHECK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`;
  let parts = [];
  steps.forEach((label, i) => {
    const n = i + 1;
    const done = n < cur, active = n === cur;
    const nc = done ? 'csb-node csb-node-done' : (active ? 'csb-node csb-node-active' : 'csb-node csb-node-idle');
    const lc = done ? 'csb-lbl csb-lbl-done' : (active ? 'csb-lbl csb-lbl-active' : 'csb-lbl csb-lbl-idle');
    const inner = done ? CHECK : n;
    parts.push(`<div class="csb-step"><div class="${nc}">${inner}</div><div class="${lc}">${label}</div></div>`);
    if (n < 6) parts.push(`<div class="csb-line ${done ? 'csb-line-done' : 'csb-line-idle'}"></div>`);
  });
  return `<div class="clone-step-bar"><div class="clone-step-bar-inner">${parts.join('')}</div></div>`;
}

function tCloneActions(primary, secondary = []) {
  const primaryCls = ['clone-action-main'];
  if (primary.disabled) primaryCls.push('btn-disabled');
  const main = `<div ${primary.id ? `id="${primary.id}" ` : ''}class="${primaryCls.join(' ')}" onclick="${primary.disabled ? '' : primary.onclick}">${primary.text}</div>`;
  const secs = secondary.filter(Boolean).map(btn => {
    const cls = ['clone-action-secondary'];
    if (btn.disabled) cls.push('btn-disabled');
    return `<div ${btn.id ? `id="${btn.id}" ` : ''}class="${cls.join(' ')}" onclick="${btn.disabled ? '' : btn.onclick}">${btn.text}</div>`;
  }).join('');
  const rowCls = secondary.filter(Boolean).length === 1 ? 'clone-action-secondary-row clone-action-secondary-row-single' : 'clone-action-secondary-row';
  return `<div class="clone-action-stack">${main}${secs ? `<div class="${rowCls}">${secs}</div>` : ''}</div>`;
}

// ===== EXTRACT =====