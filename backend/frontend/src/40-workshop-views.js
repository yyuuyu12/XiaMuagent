function tWorkshop() {
  if (!getToken()) {
    return `<div class="tab-page" style="text-align:center;padding-top:80px">
      <div style="font-size:15px;font-weight:600;color:#1A1814;margin-bottom:8px">口播工坊</div>
      <div style="font-size:13px;color:#A8A49C;margin-bottom:18px">登录后体验声音 · 数字人 · 剪辑成片</div>
      <div class="btn-primary" style="max-width:200px;margin:0 auto" onclick="openAuthSheet()">登录 / 注册</div>
    </div>`;
  }
  if (!S.premiumLoaded) {
    return `<div class="tab-page" style="text-align:center;padding-top:90px;color:#9E9890;font-size:14px">
      <div style="width:32px;height:32px;border:3px solid rgba(245,118,42,0.2);border-top-color:#F5762A;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 14px"></div>加载中…</div>`;
  }
  if (!S.premium) {
    return S.workshopView === 'activate' ? tWorkshopActivate() : tWorkshopIntro();
  }
  return S.workshopView === 'bench' ? tWorkshopBench() : tWorkshopLanding();
}

function tWorkshopIntro() {
  const caps = [
    { name: '声音克隆', desc: '上传一段录音，克隆你的专属音色', svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0014 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>` },
    { name: '真人形象', desc: '用你的数字人形象口播出镜', svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` },
    { name: '自动字幕成片', desc: '一键烧录爆款字幕，直接成片', svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><line x1="6" y1="14" x2="11" y2="14"/><line x1="14" y1="14" x2="18" y2="14"/></svg>` },
  ];
  const cases = ['助农带货 · 土鸡', '美食探店 · 口播', '知识科普 · 真人', '穿搭种草 · 数字人', '萌宠日常 · 配音', '本地生活 · 成片'];
  const playSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>`;
  return `<div class="tab-page" style="padding-top:4px;padding-bottom:150px">
    <div style="display:flex;justify-content:center;margin-bottom:6px">
      <div style="width:62%;aspect-ratio:9/16;border-radius:22px;position:relative;overflow:hidden;background:linear-gradient(160deg,#3A332C,#211C17);display:flex;align-items:center;justify-content:center">
        <span style="font-size:12px;color:rgba(255,255,255,0.45);font-family:ui-monospace,monospace">数字人口播样片</span>
        <div style="position:absolute;top:12px;left:12px;display:flex;align-items:center;gap:5px">
          <div style="width:6px;height:6px;border-radius:50%;background:#FF6B57"></div>
          <span style="font-size:10px;color:rgba(255,255,255,0.6);font-family:ui-monospace,monospace">自动循环 · 静音</span>
        </div>
        <div style="position:absolute;bottom:18px;left:0;right:0;text-align:center">
          <span style="font-size:13px;font-weight:800;color:#fff;-webkit-text-stroke:0.6px #000;letter-spacing:0.5px">这一口本味，值得你尝一次</span>
        </div>
      </div>
    </div>
    <div style="padding:16px 12px 4px;text-align:center">
      <div style="font-size:19px;font-weight:700;color:#1A1614;line-height:1.45">把文案，变成你出镜口播的爆款视频</div>
      <div style="font-size:13px;color:#9E9890;margin-top:8px;line-height:1.6">声音 · 数字人 · 自动剪辑，一站式做成可直接发布的成片</div>
    </div>
    <div style="padding:14px 0 0;display:flex;flex-direction:column;gap:10px">
      ${caps.map(c => `<div style="background:#fff;border-radius:16px;padding:14px 16px;display:flex;align-items:center;gap:14px;box-shadow:0 2px 12px rgba(0,0,0,0.05)">
        <div style="background:#FFF3E8;width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${c.svg}</div>
        <div style="flex:1"><div style="font-size:14.5px;font-weight:600;color:#1A1614">${c.name}</div><div style="font-size:12px;color:#9E9890;margin-top:2px">${c.desc}</div></div>
      </div>`).join('')}
    </div>
    <div class="section-label" style="margin:20px 0 12px">看看大家做出了什么</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      ${cases.map(c => `<div style="aspect-ratio:9/16;border-radius:12px;position:relative;overflow:hidden;background:linear-gradient(160deg,#3A332C,#211C17)">
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center">${playSvg}</div>
        <span style="position:absolute;bottom:8px;left:8px;right:8px;font-size:9px;color:rgba(255,255,255,0.7);font-family:ui-monospace,monospace;line-height:1.3">${c}</span>
      </div>`).join('')}
    </div>
    <div class="ws-cta-float">
      <div class="btn-primary" onclick="setState({workshopView:'activate'});render()">了解如何开通</div>
      <div style="text-align:center;font-size:12px;color:#B0AA9F;margin-top:10px">声音 · 数字人 · 剪辑，一次开通全部解锁</div>
    </div>
  </div>`;
}

function tWorkshopActivate() {
  const rights = [
    { name: '声音克隆', desc: '克隆专属音色，无限次合成口播音频' },
    { name: '真人数字人', desc: '上传形象，生成你出镜的口播视频' },
    { name: '自动剪辑成片', desc: '爆款字幕模板，一键烧录直接成片' },
  ];
  const check = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const crown = `<svg width="13" height="13" viewBox="0 0 24 24" fill="#FF9D5C"><path d="M2 7l5 4 5-7 5 7 5-4-2 13H4z"/></svg>`;
  return `<div class="tab-page" style="padding-top:4px">
    <div style="border-radius:24px;padding:24px;background:linear-gradient(135deg,#2A241E,#46382B);margin-bottom:16px">
      <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(245,118,42,0.2);border:1px solid rgba(245,118,42,0.4);border-radius:20px;padding:5px 12px;margin-bottom:14px">${crown}<span style="font-size:12px;color:#FFB87D;font-weight:600">进阶版</span></div>
      <div style="font-size:21px;font-weight:700;color:#fff;line-height:1.4;margin-bottom:8px">声音、数字人、剪辑<br/>一次开通，全部解锁</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.6);line-height:1.6">打包解锁，不分开售卖。开通后口播工坊三大工作台全部可用。</div>
    </div>
    <div class="section-label" style="margin-bottom:10px">开通后你将获得</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${rights.map(r => `<div style="background:#fff;border-radius:16px;padding:15px 16px;display:flex;align-items:center;gap:14px;box-shadow:0 2px 12px rgba(0,0,0,0.05)">
        <div style="flex:1"><div style="font-size:14.5px;font-weight:600;color:#1A1614">${r.name}</div><div style="font-size:12px;color:#9E9890;margin-top:2px">${r.desc}</div></div>${check}
      </div>`).join('')}
    </div>
    <div style="background:#fff;border-radius:16px;padding:16px;margin-top:16px;box-shadow:0 2px 12px rgba(0,0,0,0.05)">
      <div style="font-size:13px;font-weight:600;color:#1A1814;margin-bottom:10px">输入进阶激活码</div>
      <input class="lf-input" type="text" placeholder="请输入进阶激活码" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #EDE9E3;border-radius:12px;font-size:14px;text-transform:uppercase;background:#FAF8F5"
        value="${esc(S.wsCodeInput)}" oninput="S.wsCodeInput=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')handleWorkshopActivate()"/>
      ${S.wsCodeMsg ? `<div style="font-size:12px;margin-top:8px;color:${S.wsCodeOk ? '#10B981' : '#E5484D'}">${esc(S.wsCodeMsg)}</div>` : ''}
      <div class="btn-primary ${S.wsCodeLoading || !S.wsCodeInput.trim() ? 'btn-disabled' : ''}" style="margin-top:12px" onclick="handleWorkshopActivate()">${S.wsCodeLoading ? '开通中…' : '立即开通进阶版'}</div>
    </div>
    <div style="text-align:center;font-size:12px;color:#B0AA9F;margin-top:14px;line-height:1.6">开通由专属顾问协助完成，如有疑问可随时联系客服</div>
  </div>`;
}

async function handleWorkshopActivate() {
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
        setState({ workshopView: 'landing', wsCodeMsg: '' });
      } else {
        showToast(r.msg || '激活成功');
      }
    } else {
      setState({ wsCodeLoading: false, wsCodeOk: false, wsCodeMsg: r.msg || '激活码无效或已使用' });
    }
  } catch {
    setState({ wsCodeLoading: false, wsCodeOk: false, wsCodeMsg: '网络错误，请稍后重试' });
  }
}

function tWorkshopLanding() {
  const crown = `<svg width="12" height="12" viewBox="0 0 24 24" fill="#7A3D12"><path d="M2 7l5 4 5-7 5 7 5-4-2 13H4z"/></svg>`;
  const docSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  const copies = (S.cloneHistory || []).slice(0, 8);
  const copyCards = copies.length ? copies.map((it, idx) => {
    const txt = _wsCopyText(it);
    const title = (txt || '').replace(/\s+/g, ' ').slice(0, 16) || '改写文案';
    return `<div style="background:#fff;border-radius:16px;padding:14px 16px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.05)" onclick="workshopPickCopy(${idx})">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;border-radius:10px;background:#FFF3E8;display:flex;align-items:center;justify-content:center;flex-shrink:0">${docSvg}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13.5px;font-weight:600;color:#1A1614;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title)}</div>
          <div style="font-size:11px;color:#B0AA9F;margin-top:2px">${esc(_wsRelTime(it.created_at))}</div>
        </div>
        <span style="flex-shrink:0;font-size:12px;font-weight:600;color:#F5762A;background:#FFF3E8;padding:4px 10px;border-radius:20px">制作 ›</span>
      </div>
      <div style="font-size:12px;color:#9E9890;line-height:1.6;margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(txt)}</div>
    </div>`;
  }).join('') : `<div style="background:#fff;border-radius:16px;padding:22px 16px;text-align:center;color:#A8A49C;font-size:13px;box-shadow:0 2px 12px rgba(0,0,0,0.05)">还没有可用文案，先去创作一段吧</div>`;

  const voiceTasks = (S.tasksList || []).filter(t => t && (t.type === 'clone_video' || (parseInt(t.clone_step) || 0) >= 3)).slice(0, 5);
  const taskRows = voiceTasks.length ? voiceTasks.map(t => {
    const done = t.status === 'done';
    const sc = done ? '#22C55E' : '#F5762A', sbg = done ? '#F0FDF4' : '#FFF3E8';
    const label = done ? '已完成' : '进行中';
    return `<div style="background:#fff;border-radius:16px;padding:12px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 12px rgba(0,0,0,0.05)">
      <div style="width:44px;height:56px;border-radius:10px;flex-shrink:0;background:linear-gradient(160deg,#3A332C,#211C17);display:flex;align-items:center;justify-content:center;font-size:8px;color:rgba(255,255,255,0.45)">9:16</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:#1A1614;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.title || '口播任务')}</div>
        <div style="font-size:11px;color:#B0AA9F;margin-top:5px">${esc(_wsRelTime(t.activity_at || t.updated_at || t.created_at))}</div>
      </div>
      <span style="flex-shrink:0;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;color:${sc};background:${sbg}">${label}</span>
    </div>`;
  }).join('') : `<div style="background:#fff;border-radius:16px;padding:18px 16px;text-align:center;color:#A8A49C;font-size:12.5px;box-shadow:0 2px 12px rgba(0,0,0,0.05)">还没有口播成片记录</div>`;

  return `<div class="tab-page" style="padding-top:4px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-size:18px;font-weight:700;color:#1A1614">口播工坊</div>
      <span style="background:linear-gradient(135deg,#FFD9A8,#FFB877);color:#7A3D12;font-size:11px;font-weight:700;padding:5px 11px;border-radius:20px;display:flex;align-items:center;gap:4px">${crown}进阶版</span>
    </div>
    ${_svcMaintBanner()}
    <div class="section-label" style="margin-bottom:6px">开始制作</div>
    <div style="font-size:12.5px;color:#9E9890;line-height:1.6;margin-bottom:12px">口播视频从一段文案开始。选择一条已生成的文案，或先去创作新文案。</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${copyCards}
      <div onclick="switchTab('home')" style="border:1.5px dashed #D8D2C9;border-radius:14px;padding:13px;text-align:center;cursor:pointer;color:#F5762A;font-size:13.5px;font-weight:600">去创作生成新文案</div>
    </div>
    <div class="section-label" style="margin:20px 0 12px">我的口播任务</div>
    <div style="display:flex;flex-direction:column;gap:10px">${taskRows}</div>
  </div>`;
}

function workshopPickCopy(idx) {
  const it = (S.cloneHistory || [])[idx];
  if (!it) return;
  const txt = _wsCopyText(it);
  if (!txt.trim()) { showToast('该文案为空，换一条试试'); return; }
  setState({
    workshopPickedCopy: txt,
    rewrittenScript: txt,
    extractedScript: it.input || txt,
    extractStep: 3,
    workshopView: 'bench', workshopSeg: 'voice',
    ttsErr: '', ttsAudioUrl: null, ttsAudioB64: null,
  });
}

function bridgeToWorkshop(seg) {
  const ta = document.getElementById('f-rewritten-script');
  if (ta) S.rewrittenScript = ta.value;
  const txt = (S.rewrittenScript || '').trim();
  if (!txt) { showToast('请先完成文案改写'); return; }
  if (!S.premium) {
    // 未开通：引导去口播工坊开通
    setState({ currentTab: 'workshop', workshopView: 'intro' });
    loadPremiumStatus();
    render();
    return;
  }
  setState({
    currentTab: 'workshop',
    workshopPickedCopy: txt,
    extractStep: seg === 'avatar' ? 4 : 3,
    workshopView: 'bench', workshopSeg: seg === 'avatar' ? 'avatar' : 'voice',
    ttsErr: '',
  });
  loadPremiumStatus();
}

function exitWorkshopBench() {
  setState({ workshopView: 'landing', workshopPickedCopy: null });
}

function tWorkshopBench() {
  const snippet = (S.workshopPickedCopy || S.rewrittenScript || '').replace(/\s+/g, ' ');
  const tagSvg = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
  const refBar = `<div style="background:#FFF8F3;border:1px solid #FFE0C7;border-radius:14px;padding:11px 14px;display:flex;align-items:center;gap:10px;margin-bottom:12px">
    <span style="display:flex;align-items:center;gap:4px;flex-shrink:0;font-size:11px;font-weight:600;color:#F5762A;background:#FFF3E8;padding:3px 8px;border-radius:12px">${tagSvg}已引用文案</span>
    <div style="flex:1;min-width:0;font-size:12.5px;color:#7A6F65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(snippet)}</div>
    <span onclick="exitWorkshopBench()" style="flex-shrink:0;font-size:12px;font-weight:600;color:#F5762A;cursor:pointer">更换</span>
  </div>`;
  const sb = tCloneStepBar();
  let stepHtml;
  if (S.extractStep === 4 || S.extractStep === 'avatar_gen') stepHtml = tCloneStep4(sb);
  else if (S.extractStep === 5) stepHtml = tCloneStep5(sb);
  else if (S.extractStep === 6) stepHtml = tCloneStep6(sb);
  else stepHtml = tCloneStep3(sb);
  return `<div style="padding:12px 16px 0">${refBar}</div>${stepHtml}`;
}

// ===== 智能体 =====
const _AGENT_SKIN_PATHS = {
  title:   '<path d="M5 5.5h14M12 5.5V19M9 19h6"/>',
  spark:   '<path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9L12 3Z"/>',
  list:    '<circle cx="5" cy="7" r="1.3"/><circle cx="5" cy="12" r="1.3"/><circle cx="5" cy="17" r="1.3"/><path d="M9 7h11M9 12h9M9 17h11"/>',
  chat:    '<path d="M5 5.5h14a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H10l-4.2 3.4a.5.5 0 0 1-.8-.4V7.5a2 2 0 0 1 2-2Z"/>',
  hash:    '<path d="M9.5 4 7.5 20M16.5 4l-2 16M4 9.2h16M3.5 14.8h16"/>',
  refresh: '<path d="M20.5 8a8 8 0 1 0 1.2 6.5"/><path d="M20.5 3.5V8H16"/>',
  grid:    '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'
};
const _AGENT_SKINS = {
  '标题党生成器': { bg:'#FCEBDA', fg:'#E89A52', icon:'title' },
  '黄金开头钩子': { bg:'#F9DEEA', fg:'#DE89AE', icon:'spark' },
  '选题灵感库':   { bg:'#DCEEDC', fg:'#6FAE78', icon:'list' },
  '评论区神回复': { bg:'#E2DFF6', fg:'#8A80D6', icon:'chat' },
  '关键词标签':   { bg:'#D6EDE5', fg:'#57AD97', icon:'hash' },
  '一键润色':     { bg:'#FCEBDA', fg:'#E89A52', icon:'refresh' }
};
const _AGENT_PALETTE = [
  { bg:'#FCEBDA', fg:'#E89A52' }, { bg:'#F9DEEA', fg:'#DE89AE' },
  { bg:'#DCEEDC', fg:'#6FAE78' }, { bg:'#E2DFF6', fg:'#8A80D6' },
  { bg:'#D6EDE5', fg:'#57AD97' }
];
function agentSkin(a, idx = 0) {
  const name = (a && a.name) || '';
  if (_AGENT_SKINS[name]) return _AGENT_SKINS[name];
  let icon = 'grid';
  if (/标题/.test(name)) icon = 'title';
  else if (/钩子|开头|开场|文案/.test(name)) icon = 'spark';
  else if (/选题|灵感|赛道/.test(name)) icon = 'list';
  else if (/评论|回复|互动/.test(name)) icon = 'chat';
  else if (/标签|关键词|话题/.test(name)) icon = 'hash';
  else if (/润色|改写|改稿/.test(name)) icon = 'refresh';
  const c = _AGENT_PALETTE[idx % _AGENT_PALETTE.length];
  return { bg: c.bg, fg: c.fg, icon };
}
function agentIconSk(sk, size = 26) {
  const sw = sk.icon === 'title' ? 2 : 1.8;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${sk.fg}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${_AGENT_SKIN_PATHS[sk.icon] || _AGENT_SKIN_PATHS.grid}</svg>`;
}
function iconCoin(size = 15, mode = 'gray') {
  const fill   = mode === 'gold' ? '#F4A94C' : 'none';
  const stroke = mode === 'gold' ? '#F4A94C' : '#C4BCB0';
  const txt    = mode === 'gold' ? '#fff'    : '#A89E90';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="vertical-align:-2px;flex-shrink:0;">
    <circle cx="12" cy="12" r="9.3" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>
    <text x="12" y="16" text-anchor="middle" font-size="11" font-weight="700" fill="${txt}" font-family="-apple-system,'PingFang SC',sans-serif">积</text>
  </svg>`;
}
