function tInspire() {
  if (S.inspireMode === 'analyze') return tInspireAnalyze();
  if (S.inspireMode === 'featured') return tInspireFeatured();
  return tInspireEntry();
}

function tInspireEntry() {
  return `<div class="tab-page">
    <div class="inspire-entry-card inspire-entry-recommended" onclick="setState({inspireMode:'analyze',pathAState:'input',pathAText:'',pathAErr:'',pathAProfile:null,pathASelectedIds:[]});render()">
      <div class="inspire-entry-badge">推荐 · 效果更好</div>
      <div class="inspire-entry-title">对标拆解 →</div>
      <div class="inspire-entry-desc">粘贴抖音主页或视频链接，AI帮你拆解爆款套路并仿写</div>
    </div>
    <div class="inspire-entry-card" onclick="enterFeaturedMode()">
      <div class="inspire-entry-title">行业精选 →</div>
      <div class="inspire-entry-desc">点击行业标签，查看同行高赞口播文案，一键复制使用</div>
    </div>
    <div style="text-align:center;margin-top:20px">
      <span style="font-size:13px;color:#A8A49C;cursor:pointer" onclick="openHistoryPage()">查看我的任务</span>
    </div>
  </div>`;
}

function tInspireAnalyze() {
  if (S.pathAState === 'started') {
    const task = S.pathATaskData;
    const isDone = task?.status === 'done';
    const isFailed = task?.status === 'failed';
    const progress = task?.progress || 0;
    const thinking = task?.thinking || (task ? 'AI 正在准备中...' : '任务已提交，等待处理...');

    let body = '';
    if (isDone) {
      let result = {};
      try {
        result = typeof task.result === 'string' ? JSON.parse(task.result) : (task.result || {});
      } catch {}
      const { analysis = {}, scripts = [], author = {} } = result;
      body = `
        <div style="font-size:15px;font-weight:700;color:#1A1814;margin-bottom:12px;display:flex;align-items:center;gap:6px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="20 6 9 17 4 12"/></svg> 拆解完成</div>
        ${analysis.account_positioning ? `<div class="analysis-card">
          <div class="analysis-title">对标账号分析</div>
          ${analysis.account_positioning?`<div class="analysis-row">定位：${esc(analysis.account_positioning)}</div>`:''}
          ${analysis.target_audience?`<div class="analysis-row">受众：${esc(analysis.target_audience)}</div>`:''}
          ${analysis.tone?`<div class="analysis-row">风格：${esc(analysis.tone)}</div>`:''}
          ${Array.isArray(analysis.content_patterns)&&analysis.content_patterns.length?`<div class="analysis-row">规律：${analysis.content_patterns.map(s=>esc(s)).join('、')}</div>`:''}
        </div>` : ''}
        <div style="font-size:14px;font-weight:700;color:#1A1814;margin-bottom:10px">生成文案（${scripts.length}条）</div>
        ${scripts.map((s,i)=>`<div class="script-result-card">
          <div class="script-hook-badge">${esc(s.hook_type||'文案')}</div>
          <div class="script-content">${esc(s.content)}</div>
          <div class="script-actions">
            <button class="btn-copy-small" onclick="cpPathAInlineScript(${i})">复制</button>
          </div>
        </div>`).join('')}`;
    } else if (isFailed) {
      body = `<div style="text-align:center;padding:24px 0">
        <div style="font-size:36px;margin-bottom:12px">😞</div>
        <div style="font-size:14px;font-weight:600;color:#DC2626;margin-bottom:8px">处理失败</div>
        <div style="font-size:12px;color:#6B6860;margin-bottom:6px">${esc(friendlyError(task.error_msg))}</div>
        ${task.error_msg?`<div style="font-size:10px;color:#B4B2A9;margin-bottom:16px;word-break:break-all">原始错误：${esc(task.error_msg)}</div>`:''}
        <div class="btn-primary" style="display:inline-block;padding:0 24px" onclick="setState({pathAState:'input',pathATaskData:null});render()">重新输入</div>
      </div>`;
    } else {
      body = `<div style="padding:8px 0">
        <div style="font-size:14px;font-weight:600;color:#1A1814;margin-bottom:14px">${esc(task?.title||'AI 拆解任务')}</div>
        <div class="path-a-progress-bar"><div class="path-a-progress-fill" style="width:${progress}%"></div></div>
        <div style="font-size:13px;color:#6B6860;line-height:1.7;min-height:44px">
          <span class="typewriter-text">${esc(thinking)}</span>
        </div>
        <div style="font-size:11px;color:#A8A49C;margin-top:20px;text-align:center">
          通常需要 1-3 分钟，可以先去做别的事 · <span style="text-decoration:underline;cursor:pointer;color:#E8650A" onclick="openHistoryPage()">去任务中心</span>
        </div>
      </div>`;
    }

    return `<div class="tab-page">${body}</div>`;
  }

  if (S.pathAState === 'videos' && S.pathAProfile) {
    const profile = S.pathAProfile;
    const selected = S.pathASelectedIds;
    return `<div class="tab-page">
      <div style="font-size:13px;font-weight:600;color:#1A1814;margin-bottom:4px">@${esc(profile.author.nickname)} 的近期视频</div>
      <div style="font-size:11px;color:#A8A49C;margin-bottom:12px">选择 1-3 条，AI 将拆解其内容套路</div>
      ${profile.videos.map(v=>{
        const on = selected.includes(v.aweme_id);
        const digg = v.stats.digg >= 10000 ? (v.stats.digg/10000).toFixed(1)+'w' : String(v.stats.digg);
        return `<div class="video-list-item" onclick="pathAToggleVideo('${esc(v.aweme_id)}')">
          <div class="video-list-check ${on?'video-list-check-on':''}">
            ${on?'✓':''}
          </div>
          <div class="video-list-info">
            <div class="video-list-title">${esc(v.title)}</div>
            <div class="video-list-meta">${v.duration_sec}秒 · <span class="video-list-digg">❤️ ${digg}</span></div>
          </div>
        </div>`;
      }).join('')}
      <div style="margin-top:4px">
        <span class="section-label">店铺名称（选填，用于文案中自然提及）</span>
        <input class="field-input" placeholder="如：老王二手车" value="${esc(S.pathABrandName||S.userInfo?.brand_name||'')}" oninput="S.pathABrandName=this.value"/>
      </div>
      ${S.pathAErr?`<div class="err-text" style="margin-top:8px">${esc(S.pathAErr)}</div>`:''}
      <div class="btn-primary ${S.pathALoading||selected.length===0?'btn-disabled':''}" style="margin-top:14px"
           onclick="pathAStartAnalyze()">
        ${S.pathALoading?'⏳ 创建任务中...':'开始拆解（已选'+selected.length+'条）'}
      </div>
    </div>`;
  }

  // 默认：链接输入
  return `<div class="tab-page">
    <div class="section-card">
      <span class="section-label">粘贴对标主页或视频链接</span>
      <textarea class="field-input" id="f-path-a-text" rows="3"
        style="height:auto;padding:10px 14px;resize:none;line-height:1.6"
        placeholder="粘贴抖音分享文本或链接，支持主页、单视频"
        oninput="S.pathAText=this.value;render()">${esc(S.pathAText)}</textarea>
      <div style="font-size:11px;color:#A8A49C;margin-top:6px">支持：抖音主页链接 / 单条视频链接 / 分享文本</div>
    </div>
    ${S.pathAErr?`<div class="err-text">${esc(S.pathAErr)}</div>`:''}
    <div class="btn-primary ${S.pathALoading?'btn-disabled':''}" onclick="pathAResolve()">
      ${S.pathALoading?'⏳ 解析中...':'解析并开始'}
    </div>
  </div>`;
}

function tInspireIndustry() {
  if (S.pathBState === 'done' && S.pathBScripts.length > 0) {
    return `<div class="tab-page">
      <div style="font-size:14px;font-weight:700;color:#1A1814;margin-bottom:12px">生成结果（${S.pathBScripts.length}条）</div>
      ${S.pathBScripts.map((s,i)=>`
        <div class="script-result-card">
          <div class="script-hook-badge">${esc(s.hook_type||'文案')}</div>
          <div class="script-content">${esc(s.content)}</div>
          <div class="script-actions">
            <div class="copy-btn" onclick="cpPathBScript(event,${i})">${S.tasksCopiedId==='pb_'+i?'✓ 已复制':'复制'}</div>
          </div>
        </div>
      `).join('')}
      <div class="btn-secondary" style="margin-top:4px;text-align:center" onclick="setState({pathBState:'form',pathBScripts:[]});render()">重新生成</div>
    </div>`;
  }

  if (S.pathBState === 'clarifying' || S.pathBState === 'generating') {
    const msg = S.pathBState === 'clarifying' ? '正在生成问题...' : '正在生成文案...';
    return `<div class="tab-page">
      <div style="text-align:center;padding:40px 0;font-size:14px;color:#6B6860">⏳ ${msg}</div>
    </div>`;
  }

  if (S.pathBState === 'clarify' && S.pathBQuestions.length > 0) {
    const allAnswered = S.pathBQuestions.every(q => S.pathBAnswers[q.id]);
    return `<div class="tab-page">
      <div style="font-size:13px;color:#6B6860;margin-bottom:14px">回答几个问题，帮助生成更精准的文案</div>
      ${S.pathBQuestions.map(q=>`
        <div class="clarify-question">
          <div class="clarify-q-text">${esc(q.question)}</div>
          <div class="clarify-options">
            ${(q.options||[]).map(opt=>{
              const ans = S.pathBAnswers[q.id];
              const on = Array.isArray(ans) ? ans.includes(opt) : ans === opt;
              return `<div class="clarify-option ${on?'clarify-option-active':''}" onclick="pathBSelectAnswer('${esc(q.id)}','${esc(opt)}','${q.type||'single'}')">${esc(opt)}</div>`;
            }).join('')}
          </div>
        </div>
      `).join('')}
      ${S.pathBErr?`<div class="err-text">${esc(S.pathBErr)}</div>`:''}
      <div class="btn-primary ${!allAnswered?'btn-disabled':''}" onclick="pathBGenerate()">生成文案</div>
    </div>`;
  }

  // 默认：表单
  return `<div class="tab-page">
    <div class="section-card">
      <span class="section-label">选择赛道</span>
      <div class="industry-grid">
        ${S.industries.map(it=>`
          <div class="industry-item ${S.pathBIndustryId===it.id?'industry-active':''}"
               onclick="pathBSelectIndustry(${it.id},'${esc(it.name)}')">${esc(it.name)}</div>
        `).join('')}
      </div>
    </div>
    <div class="section-card">
      <span class="section-label">或自定义赛道</span>
      <input class="field-input" placeholder="如：二手车、烘焙店..." value="${esc(S.pathBCustom)}"
        oninput="S.pathBCustom=this.value;S.pathBIndustryId=null;S.pathBIndustryName='';render()"/>
    </div>
    <div class="section-card">
      <span class="section-label">店铺名称（选填）</span>
      <input class="field-input" placeholder="如：老王二手车" value="${esc(S.pathBBrandName||S.userInfo?.brand_name||'')}"
        oninput="S.pathBBrandName=this.value"/>
    </div>
    ${S.pathBErr?`<div class="err-text">${esc(S.pathBErr)}</div>`:''}
    <div class="btn-primary ${!S.pathBIndustryId&&!S.pathBCustom.trim()?'btn-disabled':''}" onclick="pathBNext()">下一步</div>
  </div>`;
}

// ===== INSPIRE FEATURED =====
let _featuredRefreshTimer = null;

async function enterFeaturedMode() {
  setState({ inspireMode: 'featured', featuredPage: 'select', featuredIndustry: null, featuredVideos: [], featuredLoading: false, featuredIndustriesLoading: true, featuredErr: '', featuredSelectedIdx: null });
  render();
  await loadFeaturedIndustries();
  if (_featuredRefreshTimer) clearInterval(_featuredRefreshTimer);
  _featuredRefreshTimer = setInterval(async () => {
    if (S.inspireMode !== 'featured') return;
    const prevList = (S.featuredIndustriesList || []).join(',');
    await loadFeaturedIndustries();
    const newList = (S.featuredIndustriesList || []).join(',');
    if (prevList !== newList) render();
    // 内容页：刷新当前行业内容
    if (S.featuredPage === 'content' && S.featuredIndustry && !S.featuredLoading) {
      featuredSelectIndustry(S.featuredIndustry);
    }
  }, 30000);
}

async function loadFeaturedIndustries() {
  if (!S.featuredIndustriesList || S.featuredIndustriesList.length === 0) S.featuredIndustriesLoading = true;
  try {
    const r = await api.get('/industry-videos/industries');
    if (r.code === 200 && Array.isArray(r.data)) {
      setState({ featuredIndustriesList: r.data, featuredIndustriesLoading: false });
      render();
    } else {
      setState({ featuredIndustriesLoading: false });
    }
  } catch(e) {
    setState({ featuredIndustriesLoading: false });
    console.error('[loadFeaturedIndustries]', e);
  }
}

const _IND_ICONS = {'餐饮':'🍳','美业':'💄','房产':'🏠','教育/教培':'📚','教育':'📚','大健康':'💪','装修':'🔨','国学':'☯️','情感':'💕','宠物':'🐾','旅游':'✈️','科技':'💻','养老':'👴','汽车':'🚗','二手车':'🚙','二手车1':'🚙','保险':'🛡️','法律':'⚖️','数码':'📱','职场成长':'💼','职场':'💼','新房销售':'🏡','新房':'🏡'};

function tInspireFeatured() {
  return S.featuredPage === 'content' ? tFeaturedContent() : tFeaturedSelect();
}

function tFeaturedSelect() {
  const list = S.featuredIndustriesList || [];
  if (S.featuredIndustriesLoading && list.length === 0) {
    return `<div class="tab-page">${tAppLoader('正在整理行业热门文案')}</div>`;
  }
  if (list.length === 0) {
    return `<div class="tab-page"><div style="text-align:center;color:#9CA3AF;margin-top:60px;font-size:14px">暂无行业数据，请联系管理员</div></div>`;
  }
  const selected = S.featuredIndustry;
  const cards = list.map(ind => {
    const isSel = ind === selected;
    return `<div class="ind-card ${isSel ? 'ind-card-selected' : ''}" onclick="setState({featuredIndustry:'${esc(ind)}'});render()">
      <span class="ind-card-name">${esc(ind)}</span>
    </div>`;
  }).join('');
  const hasSelected = !!selected;
  return `<div class="tab-page">
    <div class="ind-select-sub">选择你的行业赛道，AI 生成爆款文案创意</div>
    <div class="ind-grid">${cards}</div>
    <button class="ind-confirm-btn${hasSelected ? '' : ' ind-confirm-disabled'}" onclick="${hasSelected ? `featuredSelectIndustry('${esc(selected || '')}')` : ''}">查看行业热门文案</button>
  </div>`;
}

function tFeaturedContent() {
  const di = S.featuredDetailIdx;
  let grid = '';
  if (S.featuredLoading) {
    grid = `<div style="grid-column:1/-1">${tAppLoader('正在加载热门文案')}</div>`;
  } else if (S.featuredErr) {
    grid = `<div style="grid-column:1/-1;text-align:center;color:#EF4444;font-size:13px">${esc(S.featuredErr)}</div>`;
  } else if (!S.featuredVideos || S.featuredVideos.length === 0) {
    grid = `<div style="grid-column:1/-1;text-align:center;color:#9CA3AF;font-size:13px;padding:40px 0">该行业暂无采集数据</div>`;
  } else {
    grid = S.featuredVideos.map((v, i) => `
      <div class="feat-card" onclick="setState({featuredDetailIdx:${i}});render()">
        <div class="feat-card-text">${esc(v.transcript)}</div>
        <div class="feat-card-likes"><svg width="12" height="12" viewBox="0 0 24 24" fill="#F97316" xmlns="http://www.w3.org/2000/svg"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>${fmtLikes(v.likes)}</div>
      </div>`).join('');
  }
  // 详情弹窗
  let modal = '';
  if (di !== null && di !== undefined && S.featuredVideos && S.featuredVideos[di]) {
    const dv = S.featuredVideos[di];
    modal = `<div class="feat-modal-overlay" onclick="if(event.target===this){setState({featuredDetailIdx:null});render()}">
      <div class="feat-modal">
        <div class="feat-modal-handle"></div>
        <div class="feat-modal-body">
          <div class="feat-modal-text">${esc(dv.transcript)}</div>
          <div class="feat-modal-likes"><svg width="14" height="14" viewBox="0 0 24 24" fill="#F97316" xmlns="http://www.w3.org/2000/svg"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>${fmtLikes(dv.likes)} 点赞</div>
        </div>
        <div class="feat-modal-btns">
          <button class="feat-btn-sec" onclick="featuredCopySelected()">复制文案</button>
          <button class="feat-btn-pri" onclick="featuredRewrite()">仿写爆款</button>
        </div>
      </div>
    </div>`;
  }
  return `<div class="tab-page">
    <div class="feat-grid">${grid}</div>
  </div>${modal}`;
}

function fmtLikes(n) {
  if (!n) return '0';
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  return String(n);
}

async function featuredSelectIndustry(ind) {
  if (S.featuredLoading) return;
  setState({ featuredIndustry: ind, featuredPage: 'content', featuredSelectedIdx: null, featuredDetailIdx: null, featuredVideos: [], featuredLoading: true, featuredErr: '' });
  render();
  try {
    const r = await api.get(`/industry-videos?industry=${encodeURIComponent(ind)}&limit=15`);
    if (r.code === 200) {
      setState({ featuredVideos: r.data || [], featuredLoading: false });
    } else {
      setState({ featuredErr: r.msg || '加载失败', featuredLoading: false });
    }
  } catch(e) {
    setState({ featuredErr: '网络错误，请重试', featuredLoading: false });
  }
  render();
}

async function startCloneFromFeatured(videoId, transcript) {
  // ★ 生成中拦截（从 featuredRewrite 直接调用时已检查过，此处防止其他入口绕过）
  const isGenerating = S.ttsGenerating || S.avatarGenerating || S.postProcessing;
  if (isGenerating) {
    const genLabel = S.ttsGenerating ? '语音生成' : S.avatarGenerating ? '数字人视频生成' : '字幕烧录';
    const ok = await showConfirmModal({
      title: `${genLabel}进行中`,
      body: `切换任务将会导致当前 ${genLabel} 进展中断，确定要切换吗？`,
      confirmText: '切换任务', cancelText: '继续等待', confirmDanger: true,
    });
    if (!ok) return;
  }
  if (_featuredRefreshTimer) { clearInterval(_featuredRefreshTimer); _featuredRefreshTimer = null; }
  setState({
    currentTab: 'extract',
    inspireMode: null,
    featuredDetailIdx: null,
    extractStep: 'review',
    extractedScript: transcript || '',
    rewrittenScript: '',
    rewriteSourceExpanded: false,
    extractErr: '',
    extractRawErr: '',
    videoUrl: '',
    cloneTaskId: null,
    cloneTaskData: null,
    taskId: null,
    ttsAudioUrl: null,
    ttsAudioB64: null,
    avatarVideoUrl: null,
    avatarVideoB64: null,
    postProcessedVideoUrl: null,
    postProcessedB64: null,
  });
  try {
    const r = await api.post(`/industry-videos/start-clone/${videoId}`, {});
    if (r.code === 200 && r.data && r.data.task_id) {
      setState({ cloneTaskId: r.data.task_id });
      saveCloneSession(2);
      loadTasks();
    } else {
      showToast(r.msg || '操作失败，请重试');
    }
  } catch(e) {
    showToast('网络错误，请重试');
  }
}

function featuredCopy(i) {
  const v = (S.featuredVideos || [])[i];
  if (!v) return;
  navigator.clipboard.writeText(v.transcript).then(() => showToast('已复制')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = v.transcript; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta); showToast('已复制');
  });
}

async function featuredConfirm() {
  if (!S.featuredIndustry) return;
  setState({ featuredPage: 'content', featuredVideos: [], featuredLoading: true, featuredErr: '', featuredSelectedIdx: null });
  render();
  try {
    const r = await api.get(`/industry-videos?industry=${encodeURIComponent(S.featuredIndustry)}&limit=15`);
    setState({ featuredVideos: r.code === 200 ? (r.data || []) : [], featuredLoading: false, featuredErr: r.code !== 200 ? (r.msg || '加载失败') : '' });
  } catch(e) {
    setState({ featuredErr: '网络错误，请重试', featuredLoading: false });
  }
  render();
}

function featuredCopySelected() {
  if (!ensureLoggedIn()) return;
  const v = (S.featuredVideos || [])[S.featuredDetailIdx];
  if (!v) return;
  navigator.clipboard.writeText(v.transcript).then(() => showToast('已复制')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = v.transcript; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta); showToast('已复制');
  });
}

async function featuredRewrite() {
  if (!ensureLoggedIn()) return;
  const v = (S.featuredVideos || [])[S.featuredDetailIdx];
  if (!v) return;
  // ★ 生成中拦截
  const isGenerating = S.ttsGenerating || S.avatarGenerating || S.postProcessing;
  if (isGenerating) {
    const genLabel = S.ttsGenerating ? '语音生成' : S.avatarGenerating ? '数字人视频生成' : '字幕烧录';
    const ok = await showConfirmModal({
      title: `${genLabel}进行中`,
      body: `切换任务将会导致当前 ${genLabel} 进展中断，确定要切换吗？`,
      confirmText: '切换任务', cancelText: '继续等待', confirmDanger: true,
    });
    if (!ok) return;
  }
  if (v.id) {
    await startCloneFromFeatured(v.id, v.transcript);
    return;
  }
  if (_featuredRefreshTimer) { clearInterval(_featuredRefreshTimer); _featuredRefreshTimer = null; }
  setState({ inspireMode: null, featuredDetailIdx: null, extractedScript: v.transcript, rewrittenScript: '', extractStep: 'review', extractErr: '', extractRawErr: '', videoUrl: '', cloneTaskId: null, cloneTaskData: null, taskId: null });
  switchTab('extract');
  render();
  showToast('已填入爆款文案，点击开始AI改写');
}

// ===== PROFILE =====
function tPresetAvatar(i) {
  const idx = Math.max(0, Math.min(7, parseInt(i, 10) || 0));
  const avatars = [
    `<rect width="100" height="100" fill="#DDE2F6"/>
      <circle cx="27" cy="56" r="13" fill="#8B98F6" stroke="#050505" stroke-width="3.5"/>
      <circle cx="73" cy="56" r="13" fill="#8B98F6" stroke="#050505" stroke-width="3.5"/>
      <path d="M23 104c4-21 17-31 27-31s23 10 27 31H23z" fill="#4A164F" stroke="#050505" stroke-width="3.5"/>
      <rect x="40" y="61" width="20" height="18" rx="7" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <circle cx="25" cy="44" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <circle cx="75" cy="44" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <ellipse cx="50" cy="42" rx="25" ry="27" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <path d="M18 39c0-24 14-36 32-36s32 12 32 36v7c-15-1-29-7-34-17-8 8-19 13-30 14z" fill="#8B98F6" stroke="#050505" stroke-width="3.5" stroke-linejoin="round"/>
      <ellipse cx="40" cy="44" rx="4.2" ry="6.2" fill="#050505"/><ellipse cx="60" cy="44" rx="4.2" ry="6.2" fill="#050505"/>
      <circle cx="38.6" cy="41.7" r="1.4" fill="#fff"/><circle cx="58.6" cy="41.7" r="1.4" fill="#fff"/>
      <path d="M35 33l12 2M55 35l12-3" stroke="#050505" stroke-width="3.2" stroke-linecap="round"/>
      <circle cx="50" cy="49" r="1.8" fill="#050505"/>
      <path d="M50 58c3-.4 5-2 6-4" stroke="#8A1F2D" stroke-width="2.7" stroke-linecap="round" fill="none"/>`,
    `<rect width="100" height="100" fill="#CFE8F8"/>
      <path d="M26 42c0-22 11-34 24-34s24 12 24 34v7c0 19-11 31-24 31S26 68 26 49z" fill="#E79A4B" stroke="#050505" stroke-width="3.5"/>
      <path d="M23 104c4-21 17-33 27-33s23 12 27 33H23z" fill="#FFFFFF" stroke="#050505" stroke-width="3.5"/>
      <path d="M34 59h32v29H34z" fill="#4B4B4B" stroke="#050505" stroke-width="3.5"/>
      <path d="M40 65l10 6 10-6" fill="none" stroke="#050505" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M64 72v13M36 72v13" stroke="#3D94C8" stroke-width="4" stroke-linecap="round"/>
      <circle cx="25" cy="42" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <circle cx="75" cy="42" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <path d="M26 39c0-20 10-28 24-28s24 8 24 28v5H26z" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <path d="M24 28c0-17 10-27 26-27s26 10 26 27v11H24z" fill="#4F90C3" stroke="#050505" stroke-width="3.5"/>
      <path d="M43 24h14c3 0 5 2 5 5H38c0-3 2-5 5-5z" fill="#FFD3D8" stroke="#050505" stroke-width="3.2"/>
      <ellipse cx="41" cy="42" rx="4" ry="6" fill="#050505"/><ellipse cx="59" cy="42" rx="4" ry="6" fill="#050505"/>
      <circle cx="39.6" cy="39.8" r="1.3" fill="#fff"/><circle cx="57.6" cy="39.8" r="1.3" fill="#fff"/>
      <path d="M34 32l11 2M55 34l11-2" stroke="#050505" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M50 45v6" stroke="#050505" stroke-width="2.5" stroke-linecap="round"/>`,
    `<rect width="100" height="100" fill="#F1CEF0"/>
      <path d="M20 41c0-25 14-39 31-39s30 14 30 39v50H20z" fill="#A044A8" stroke="#050505" stroke-width="3.5"/>
      <path d="M22 100c4-20 17-30 28-30s24 10 28 30H22z" fill="#72B8E6" stroke="#050505" stroke-width="3.5"/>
      <rect x="40" y="60" width="20" height="17" rx="7" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <circle cx="24" cy="43" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <circle cx="76" cy="43" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <ellipse cx="50" cy="43" rx="25" ry="27" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <path d="M21 36c7 0 25-5 39-22 1 10 8 18 20 22v-3C80 14 67 2 51 2S21 14 21 33z" fill="#A044A8" stroke="#050505" stroke-width="3.5" stroke-linejoin="round"/>
      <rect x="24" y="40" width="10" height="31" rx="5" fill="#A044A8" stroke="#050505" stroke-width="3.5"/>
      <rect x="66" y="40" width="10" height="31" rx="5" fill="#A044A8" stroke="#050505" stroke-width="3.5"/>
      <circle cx="39" cy="43" r="9" fill="rgba(255,255,255,.45)" stroke="#fff" stroke-width="3"/>
      <circle cx="61" cy="43" r="9" fill="rgba(255,255,255,.45)" stroke="#fff" stroke-width="3"/>
      <path d="M48 43h4" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="39" cy="43" rx="3.7" ry="5.4" fill="#888"/><ellipse cx="61" cy="43" rx="3.7" ry="5.4" fill="#888"/>
      <path d="M44 56c3 4 9 4 12 0" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/>`,
    `<rect width="100" height="100" fill="#F9EFCF"/>
      <path d="M67 24c11 1 19 7 23 16-10 4-21 3-29-4zM67 40c12-1 22 3 29 11-9 7-23 9-35 5z" fill="#FFE08A" stroke="#050505" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M22 104c4-23 17-34 28-34s24 11 28 34H22z" fill="#0899B7" stroke="#050505" stroke-width="3.5"/>
      <rect x="39" y="61" width="22" height="23" rx="4" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <circle cx="24" cy="43" r="9" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <circle cx="76" cy="43" r="9" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <ellipse cx="50" cy="43" rx="26" ry="28" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <path d="M24 31c0-19 12-29 26-29s26 10 26 29v10H24z" fill="#F2676B" stroke="#050505" stroke-width="3.5"/>
      <path d="M23 43c4 17 15 27 27 27s23-10 27-27" fill="none" stroke="#006A78" stroke-width="4" stroke-linecap="round"/>
      <path d="M36 36c4-3 8-3 11 0M54 36c4-3 8-3 11 0" stroke="#050505" stroke-width="3.5" stroke-linecap="round"/>
      <circle cx="40" cy="48" r="4" fill="#fff"/><circle cx="60" cy="48" r="4" fill="#fff"/>
      <path d="M39 53c-2 4-2 7-1 9M61 53c2 4 2 7 1 9" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M45 61c2-4 8-4 10 0" stroke="#8A1F2D" stroke-width="2.8" stroke-linecap="round" fill="none"/>`,
    `<rect width="100" height="100" fill="#F7D7B5"/>
      <path d="M18 104c5-24 19-35 32-35s27 11 32 35H18z" fill="#E8DFFF" stroke="#050505" stroke-width="3.5"/>
      <rect x="36" y="58" width="28" height="35" rx="6" fill="#5EA1C6" stroke="#050505" stroke-width="3.5"/>
      <path d="M40 78v18M60 78v18" stroke="#050505" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M23 42c0-22 12-35 27-35s27 13 27 35v15c0 13-11 22-27 22S23 70 23 57z" fill="#E9994E" stroke="#050505" stroke-width="3.5"/>
      <circle cx="26" cy="47" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <circle cx="74" cy="47" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <ellipse cx="50" cy="46" rx="25" ry="27" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <path d="M24 41c13-8 19-18 26-23 8 9 17 20 27 23V23C77 11 67 5 50 5S23 12 23 25z" fill="#E9994E" stroke="#050505" stroke-width="3.5" stroke-linejoin="round"/>
      <ellipse cx="39" cy="47" rx="4.1" ry="5.8" fill="#050505"/><ellipse cx="61" cy="47" rx="4.1" ry="5.8" fill="#050505"/>
      <circle cx="37.8" cy="44.7" r="1.4" fill="#fff"/><circle cx="59.8" cy="44.7" r="1.4" fill="#fff"/>
      <path d="M34 38l10 2M56 40l10-2" stroke="#050505" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M46 59c2 3 6 3 8 0" stroke="#8A5650" stroke-width="2.8" stroke-linecap="round" fill="none"/>
      <path d="M50 49v7" stroke="#050505" stroke-width="2.8" stroke-linecap="round"/>`,
    `<rect width="100" height="100" fill="#DCEBFA"/>
      <path d="M22 104c5-22 18-33 28-33s23 11 28 33H22z" fill="#168AA3" stroke="#050505" stroke-width="3.5"/>
      <rect x="39" y="60" width="22" height="18" rx="5" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <circle cx="25" cy="46" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <circle cx="75" cy="46" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <ellipse cx="50" cy="47" rx="25" ry="27" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <path d="M20 43c0-24 12-37 30-37s30 13 30 37v8H64l-5-21-6 22-7-22-4 21H20z" fill="#9CC4EF" stroke="#050505" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M22 52c3 13 8 24 18 31M78 52c-3 13-8 24-18 31" fill="none" stroke="#9CC4EF" stroke-width="7" stroke-linecap="round"/>
      <ellipse cx="39" cy="49" rx="4.2" ry="6" fill="#050505"/><ellipse cx="61" cy="49" rx="4.2" ry="6" fill="#050505"/>
      <circle cx="37.8" cy="46.8" r="1.4" fill="#fff"/><circle cx="59.8" cy="46.8" r="1.4" fill="#fff"/>
      <path d="M34 40l11 2M55 42l11-2" stroke="#050505" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M45 62c3 4 8 4 11 0" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
      <path d="M36 74h28M43 77v19M50 77v19M57 77v19" stroke="#BDE8FF" stroke-width="2.3" stroke-linecap="round"/>`,
    `<rect width="100" height="100" fill="#FAD4E3"/>
      <path d="M19 104c5-23 18-34 31-34s26 11 31 34H19z" fill="#E63B74" stroke="#050505" stroke-width="3.5"/>
      <rect x="36" y="67" width="28" height="30" rx="5" fill="#B76EA4" stroke="#050505" stroke-width="3.5"/>
      <path d="M23 42c0-23 12-37 27-37s27 14 27 37v48H23z" fill="#8D0B3B" stroke="#050505" stroke-width="3.5"/>
      <circle cx="25" cy="48" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <circle cx="75" cy="48" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <ellipse cx="50" cy="47" rx="25" ry="27" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <path d="M23 38c12 0 22-7 27-20 7 12 17 18 27 20V24C77 12 67 5 50 5S23 12 23 24z" fill="#8D0B3B" stroke="#050505" stroke-width="3.5" stroke-linejoin="round"/>
      <circle cx="40" cy="50" r="4.2" fill="#050505"/>
      <path d="M59 44l-5 6 5 6" stroke="#050505" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M35 40c4-2 8-2 12 0M54 40c4-2 8-2 12 0" stroke="#050505" stroke-width="2.8" stroke-linecap="round"/>
      <circle cx="50" cy="56" r="2.3" fill="#050505"/>
      <path d="M48 64c4 0 7-2 9-6" stroke="#8A1F2D" stroke-width="3.1" stroke-linecap="round" fill="none"/>
      <path d="M38 82v14M62 82v14" stroke="#050505" stroke-width="3.2" stroke-linecap="round"/>`,
    `<rect width="100" height="100" fill="#F7D5B2"/>
      <path d="M18 104c5-24 19-35 32-35s27 11 32 35H18z" fill="#E8DFFF" stroke="#050505" stroke-width="3.5"/>
      <rect x="36" y="58" width="28" height="35" rx="6" fill="#5EA1C6" stroke="#050505" stroke-width="3.5"/>
      <path d="M40 78v18M60 78v18" stroke="#050505" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M23 42c0-22 12-35 27-35s27 13 27 35v15c0 13-11 22-27 22S23 70 23 57z" fill="#E9994E" stroke="#050505" stroke-width="3.5"/>
      <circle cx="26" cy="47" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <circle cx="74" cy="47" r="8" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <ellipse cx="50" cy="46" rx="25" ry="27" fill="#FFD3D8" stroke="#050505" stroke-width="3.5"/>
      <path d="M24 41c13-8 19-18 26-23 8 9 17 20 27 23V23C77 11 67 5 50 5S23 12 23 25z" fill="#E9994E" stroke="#050505" stroke-width="3.5" stroke-linejoin="round"/>
      <ellipse cx="39" cy="47" rx="4.1" ry="5.8" fill="#050505"/><ellipse cx="61" cy="47" rx="4.1" ry="5.8" fill="#050505"/>
      <circle cx="37.8" cy="44.7" r="1.4" fill="#fff"/><circle cx="59.8" cy="44.7" r="1.4" fill="#fff"/>
      <path d="M34 38l10 2M56 40l10-2" stroke="#050505" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M46 59c2 3 6 3 8 0" stroke="#8A5650" stroke-width="2.8" stroke-linecap="round" fill="none"/>
      <path d="M50 49v7" stroke="#050505" stroke-width="2.8" stroke-linecap="round"/>`
  ];
  return `<svg class="preset-avatar-svg" viewBox="0 0 100 100" aria-hidden="true">${avatars[idx]}</svg>`;
}
