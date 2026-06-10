function tAgents() {
  const { agentsList, agentsLoading, creditsBalance } = S;
  if (!getToken()) {
    return `<div class="page-wrap agents-page" style="padding:60px 24px;text-align:center;">
      <div style="margin-bottom:16px;display:flex;justify-content:center;">${agentIconSk({fg:'#C4C0B8',icon:'grid'}, 48)}</div>
      <div style="font-size:18px;font-weight:700;color:#1C1A16;margin-bottom:8px;">智能体</div>
      <div style="font-size:13px;color:#9C8E7A;margin-bottom:24px;">登录后解锁全部 AI 小工具</div>
      <button class="btn-primary" style="width:100%;max-width:200px;" onclick="setState({showAuthSheet:true})">立即登录</button>
    </div>`;
  }
  if (agentsLoading) {
    return `<div class="page-wrap agents-page"><div class="agents-empty">加载中...</div></div>`;
  }
  const pill = creditsBalance !== null
    ? `<div class="agents-credits-pill">${iconCoin(18,'gold')}<span>${creditsBalance}</span></div>`
    : '';
  const cardsHtml = agentsList.length === 0
    ? `<div class="agents-empty">暂无小工具，请稍后再来</div>`
    : `<div class="agents-grid">
        ${agentsList.map((a, idx) => {
          const sk = agentSkin(a, idx);
          return `
          <div class="agent-card" onclick="openAgentDetail(${a.id})">
            <div class="agent-icon-chip" style="background:${sk.bg};">${agentIconSk(sk, 26)}</div>
            <div class="agent-name">${esc(a.name)}</div>
            <div class="agent-desc">${esc(a.description)}</div>
            <div class="agent-cost">${iconCoin(15)}<span>${a.credits_cost} 积分 / 次</span></div>
          </div>`;
        }).join('')}
      </div>`;
  return `<div class="page-wrap agents-page">
    <div class="agents-header">
      <div class="agents-title">智能体</div>
      ${pill}
    </div>
    <div class="agents-subtitle">一组轻量小工具，帮你把灵感快速变成内容。按积分计量，点开即用。</div>
    <div class="agents-section-title">小工具</div>
    ${cardsHtml}
  </div>`;
}

function tAgentDetailOverlay() {
  const { selectedAgent, agentInputs, agentRunning, agentResult, agentErr, creditsBalance } = S;
  if (!selectedAgent) return '';
  return `<div class="agent-detail-overlay" onclick="if(event.target===this)closeAgentDetail()">
    <div class="agent-detail-sheet">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;">
          ${(()=>{ const sk = agentSkin(selectedAgent); return `<div class="agent-icon-chip lg" style="background:${sk.bg};">${agentIconSk(sk, 30)}</div>`; })()}
          <div>
            <div style="font-size:18px;font-weight:700;color:#1C1A16;">${esc(selectedAgent.name)}</div>
            <div style="font-size:13px;color:#9C8E7A;margin-top:2px;">${esc(selectedAgent.description)}</div>
          </div>
        </div>
        <div onclick="closeAgentDetail()" style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#F5F4F1;cursor:pointer;flex-shrink:0;font-size:14px;color:#9C8E7A;">✕</div>
      </div>
      <div style="margin-bottom:16px;display:flex;align-items:center;gap:6px;">
        <span style="font-size:13px;color:#9C8E7A;">消耗积分：</span>
        <span style="font-size:14px;font-weight:700;color:#1C1A16;display:inline-flex;align-items:center;gap:4px;">${iconCoin(15)} ${selectedAgent.credits_cost} 积分 / 次</span>
        ${creditsBalance !== null ? `<span style="font-size:12px;color:#9C8E7A;margin-left:4px;">（余额 ${creditsBalance} 分）</span>` : ''}
      </div>
      ${(selectedAgent.input_fields || []).map(f => `
        <div class="agent-field-label">${esc(f.label)}</div>
        ${f.type === 'textarea'
          ? `<textarea class="agent-field-input" rows="3" placeholder="${(f.placeholder||'').replace(/"/g,'&quot;')}" oninput="setAgentInput('${f.key}',this.value)">${agentInputs[f.key]||''}</textarea>`
          : f.type === 'select'
          ? `<select class="agent-field-select" onchange="setAgentInput('${f.key}',this.value)">
              <option value="">请选择...</option>
              ${(f.options||[]).map(o=>`<option value="${o}"${agentInputs[f.key]===o?' selected':''}>${o}</option>`).join('')}
             </select>`
          : `<input class="agent-field-input" type="text" placeholder="${(f.placeholder||'').replace(/"/g,'&quot;')}" value="${(agentInputs[f.key]||'').replace(/"/g,'&quot;')}" oninput="setAgentInput('${f.key}',this.value)">`
        }
      `).join('')}
      <button class="agent-run-btn" onclick="runAgent()" ${agentRunning?'disabled':''}>
        ${agentRunning
          ? `<span style="width:18px;height:18px;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;display:inline-block;"></span> 生成中...`
          : `立即生成`}
      </button>
      ${agentErr ? `<div style="margin-top:12px;color:#EF4444;font-size:13px;text-align:center;">${esc(agentErr)}</div>` : ''}
      ${agentResult ? `
        <div style="margin-top:14px;">
          <div style="font-size:13px;font-weight:600;color:#4A4035;margin-bottom:8px;">生成结果</div>
          <div class="agent-result-box">${esc(typeof agentResult==='string'?agentResult:JSON.stringify(agentResult,null,2))}</div>
          <button onclick="copyAgentResult()" style="margin-top:10px;width:100%;background:#F5F4F1;border:none;border-radius:10px;padding:11px 0;font-size:14px;font-weight:600;color:#4A4035;cursor:pointer;">复制结果</button>
        </div>
      ` : ''}
    </div>
  </div>`;
}

async function loadAgents() {
  if (S.agentsLoaded) {
    try {
      const r = await api.get('/credits/balance');
      if (r.code === 200) setState({ creditsBalance: r.data.credits });
    } catch {}
    render();
    return;
  }
  setState({ agentsLoading: true });
  render();
  try {
    const [ar, cr] = await Promise.all([
      api.get('/agents'),
      api.get('/credits/balance').catch(() => null)
    ]);
    setState({
      agentsList: ar.code === 200 ? (ar.data || []) : [],
      agentsLoaded: true,
      agentsLoading: false,
      creditsBalance: cr && cr.code === 200 ? cr.data.credits : null
    });
  } catch {
    setState({ agentsLoading: false });
    showToast('加载失败，请重试');
  }
  render();
}

function openAgentDetail(agentId) {
  const agent = S.agentsList.find(a => a.id === agentId);
  if (!agent) return;
  setState({ selectedAgent: agent, agentInputs: {}, agentResult: null, agentErr: '', agentRunning: false });
}

function closeAgentDetail() {
  setState({ selectedAgent: null, agentResult: null, agentErr: '', agentInputs: {}, agentRunning: false });
}

function setAgentInput(key, val) {
  S.agentInputs = { ...S.agentInputs, [key]: val };
}

async function runAgent() {
  const { selectedAgent, agentInputs } = S;
  if (!selectedAgent || S.agentRunning) return;
  for (const f of (selectedAgent.input_fields || [])) {
    if (!agentInputs[f.key]?.trim()) {
      setState({ agentErr: `请填写「${f.label}」` });
      return;
    }
  }
  setState({ agentRunning: true, agentErr: '', agentResult: null });
  try {
    const r = await api.post(`/agents/${selectedAgent.id}/run`, { inputs: agentInputs });
    if (r.code !== 200) {
      setState({ agentRunning: false, agentErr: r.msg || '调用失败，请重试' });
      return;
    }
    let output = r.data.output;
    if (typeof output === 'string') {
      try {
        const p = JSON.parse(output);
        output = p.output || p.text || p.result || p.content || output;
      } catch {}
    }
    setState({ agentRunning: false, agentResult: output, creditsBalance: r.data.credits_left });
  } catch {
    setState({ agentRunning: false, agentErr: '网络错误，请重试' });
  }
}

function copyAgentResult() {
  const { agentResult } = S;
  if (!agentResult) return;
  const text = typeof agentResult === 'string' ? agentResult : JSON.stringify(agentResult, null, 2);
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('已复制 ✓')).catch(() => {});
  } else {
    const el = document.createElement('textarea');
    el.value = text; el.style.position = 'fixed'; el.style.opacity = '0';
    document.body.appendChild(el); el.focus(); el.select();
    document.execCommand('copy'); document.body.removeChild(el);
    showToast('已复制 ✓');
  }
}

async function loadPremiumStatus() {
  try {
    const r = await api.get('/credits/status');
    if (r.code === 200) {
      setState({
        creditsBalance: r.data.credits,
        premium: !!r.data.premium,
        premiumUntil: r.data.premium_until || null,
        premiumLoaded: true,
      });
    } else {
      setState({ premiumLoaded: true });
    }
  } catch {
    setState({ premiumLoaded: true });
  }
}

// 探测本地算力服务状态（数字人/ASR/IndexTTS），结果用于灰显不可用步骤
async function probeServices(force) {
  if (S.svcProbing) return;
  // 已有结果且非强制：60 秒内不重复探测（后端也有 60 秒缓存）
  if (!force && S.svcStatus && Date.now() - (S._svcAt || 0) < 60000) return;
  setState({ svcProbing: true });
  try {
    const r = await api.get('/ai/services-status');
    if (r.code === 200 && r.data) {
      S._svcAt = Date.now();
      setState({ svcStatus: r.data, svcProbing: false });
    } else {
      setState({ svcProbing: false });
    }
  } catch {
    setState({ svcProbing: false });
  }
  render();
}
// 渲染服务离线提示横幅（口播工坊落地页用）
function _svcMaintBanner() {
  const s = S.svcStatus;
  if (!s) return '';
  const down = [];
  if (s.asr === 'down') down.push('语音识别');
  if (s.tts === 'down') down.push('声音克隆');
  if (s.video === 'down') down.push('数字人');
  if (!down.length) return '';
  return `<div style="background:#FFF4E5;border:1px solid #FFD9A8;border-radius:14px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:flex-start;gap:10px">
    <span style="flex-shrink:0;font-size:15px">⚠️</span>
    <div style="flex:1;font-size:12.5px;color:#7A5A2E;line-height:1.6">
      <b>${down.join('、')}</b>服务正在维护中，相关步骤暂时不可用，已生成的内容不受影响。请稍后再试。
    </div>
  </div>`;
}

// 操作前服务预检：若对应服务离线则拦截并提示。返回 true = 已拦截
function svcBlocked(kind) {
  const s = S.svcStatus;
  if (s && s[kind] === 'down') {
    showToast('渲染服务维护中，请稍后再试');
    return true;
  }
  return false;
}

// ===== INIT =====
(function init() {
  const token = getToken();
  if (token) {
    const user = getUser();
    if (user) { S.userName = user.nickname||'创作者'; S.userPhone = user.phone||''; S.userAvatar = user.avatar||0; }
    render(); fetchMe(); loadIndustries(); loadAppH5Settings(); loadTasks(); loadCloneHistory(); loadPremiumStatus();
  } else { render(); loadIndustries(); }
})();