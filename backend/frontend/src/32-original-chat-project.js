function tOriginalChat() {
  const proj = S.originalProject;
  const messages = S.originalMessages || [];
  const tab = S.originalChatTab || 'chat';
  const loading = S.originalLoading;
  if (!proj) return `<div style="background:#F4F1EC;min-height:100%;padding:80px 16px;text-align:center;color:#B0AA9F">项目数据加载中…</div>`;

  // ── 分阶段创作状态 ──
  const STAGE_FLOW = [
    { key: 'direction', name: '方向', full: '选题方向' },
    { key: 'outline',   name: '粗纲', full: '内容粗纲' },
    { key: 'detail',    name: '细纲', full: '细化大纲' },
    { key: 'script',    name: '剧本', full: '口播剧本' },
  ];
  const curStage = proj.stage || 'script';
  const curIdx = Math.max(0, STAGE_FLOW.findIndex(s => s.key === curStage));
  const curStageName = STAGE_FLOW[curIdx].full;
  const arts = proj.artifacts || {};
  const inStagedFlow = curStage !== 'script' || !!(arts.direction || arts.outline || arts.detail);
  const nextStage = curIdx < STAGE_FLOW.length - 1 ? STAGE_FLOW[curIdx + 1] : null;

  const ver = (S.originalSkill && S.originalSkill.version) ? S.originalSkill.version : 'v1.0';
  const ruleCount = S.originalSkill ? Object.values(S.originalSkill.rules || {}).flat().length : 0;
  const aiAvatar = `<div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#1E1A14,#3A2E1E);display:flex;align-items:center;justify-content:center;flex-shrink:0">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFB877" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
  </div>`;

  const renderMsg = (msg) => {
    if (msg.role === 'user') {
      return `<div style="display:flex;justify-content:flex-end">
        <div style="max-width:78%;background:#F5602A;border-radius:18px 4px 18px 18px;padding:10px 14px">
          <div style="font-size:14px;color:#fff;line-height:1.7">${esc(msg.content)}</div>
        </div>
      </div>`;
    }
    const displayContent = (msg.content || '').replace(/【新文案】[\s\S]*?【\/新文案】/g, '').trim();
    let syncCard = '';
    if (msg.sync_done === 'synced') {
      syncCard = `<div style="margin-top:8px;padding:8px 12px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;display:flex;align-items:center;gap:7px">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span style="font-size:12px;color:#059669;font-weight:600">「${esc(msg.sync_label||'规律')}」已同步到 Skill</span>
      </div>`;
    } else if (msg.sync_done === 'skipped') {
      syncCard = `<div style="margin-top:8px;padding:7px 12px;background:#F9F7F4;border-radius:10px"><span style="font-size:12px;color:#B0AA9F">仅用于本项目，未同步 Skill</span></div>`;
    } else if (msg.sync_label) {
      syncCard = `<div style="margin-top:8px;padding:12px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:12px">
        <div style="font-size:12px;color:#92400E;line-height:1.6;margin-bottom:10px">
          <span style="font-weight:700">「${esc(msg.sync_label)}」效果不错</span>，要同步到 Skill 吗？
          <div style="font-size:11px;color:#B45309;margin-top:1px">同步后所有项目自动应用这条规律</div>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" onclick="syncOriginalRule(${msg.id},'${esc(msg.sync_label)}')" style="flex:1;padding:8px;background:linear-gradient(135deg,#FF8040,#F5602A);border:none;border-radius:9px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">同步·全局通用</button>
          <button type="button" onclick="skipOriginalRule(${msg.id})" style="flex:1;padding:8px;background:rgba(0,0,0,0.06);border:none;border-radius:9px;color:#7A6F65;font-size:12px;font-weight:600;cursor:pointer">不同步·仅本项目</button>
        </div>
      </div>`;
    }
    return `<div style="display:flex;flex-direction:column;align-items:flex-start">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">
        ${aiAvatar}<span style="font-size:11px;color:#9E9890;font-weight:600">原创工坊 · Skill ${esc(ver)}</span>
      </div>
      <div style="max-width:88%;background:#fff;border-radius:4px 18px 18px 18px;padding:12px 14px;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
        <div style="font-size:13.5px;color:#2A241E;line-height:1.7">${displayContent ? esc(displayContent) : '文案已更新，点下方查看'}</div>
        ${msg.has_doc_update ? `<div onclick="setState({originalChatTab:'doc'});render()" style="margin-top:8px;display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#F5602A;font-weight:600;cursor:pointer;background:#FFF3E8;padding:5px 10px;border-radius:8px">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F5602A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> 查看当前${STAGE_FLOW[curIdx].name} ›
        </div>` : ''}
        ${syncCard}
        ${msg.auto_learn ? `<div style="margin-top:8px;padding:7px 12px;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;display:flex;align-items:center;gap:7px">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0EA5E9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.09 6.26L20 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l5.91-1.01L12 2z"/></svg>
          <span style="font-size:12px;color:#0369A1;font-weight:600">已自动记入 Skill：${esc(msg.auto_learn)}</span>
        </div>` : ''}
      </div>
    </div>`;
  };

  const banner = `<div style="display:flex;justify-content:center">
    <span style="font-size:11px;color:#9E9890;background:rgba(0,0,0,0.05);padding:4px 13px;border-radius:20px">已加载 Skill ${esc(ver)} · ${ruleCount} 条规则生效</span>
  </div>`;

  const chatView = `<div id="orig-chat-scroll" style="flex:1;overflow-y:auto;min-height:0;padding:14px 16px;display:flex;flex-direction:column;gap:18px;-webkit-overflow-scrolling:touch">
    ${banner}
    ${messages.length === 0
      ? `<div style="text-align:center;padding:24px 0;color:#B0AA9F;font-size:13.5px;line-height:1.7">告诉 AI 你想创作什么内容，<br>或直接提要求修改文案</div>`
      : messages.map(renderMsg).join('')}
    ${loading ? `<div style="display:flex;align-items:center;gap:8px">
      ${aiAvatar}
      <div style="background:#fff;border-radius:4px 18px 18px 18px;padding:11px 15px;box-shadow:0 2px 8px rgba(0,0,0,0.06);display:flex;gap:5px;align-items:center">
        <div style="width:6px;height:6px;border-radius:50%;background:#C8C3BC;animation:pulse 1s 0s infinite"></div>
        <div style="width:6px;height:6px;border-radius:50%;background:#C8C3BC;animation:pulse 1s 0.25s infinite"></div>
        <div style="width:6px;height:6px;border-radius:50%;background:#C8C3BC;animation:pulse 1s 0.5s infinite"></div>
      </div>
    </div>` : ''}
    <div style="height:4px"></div>
  </div>`;

  const inputActive = !!(S.originalInput && S.originalInput.trim()) && !loading;
  const skillQuickModal = S.originalSkillQuickModal; // { text, saving }
  const skillQuickSheet = skillQuickModal ? `
    <div onclick="if(event.target===this){setState({originalSkillQuickModal:null});render()}" style="position:fixed;inset:0;z-index:9300;background:rgba(26,22,20,0.5);display:flex;align-items:flex-end;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)">
      <div style="background:#fff;border-radius:22px 22px 0 0;width:100%;padding:20px 20px 32px;box-shadow:0 -4px 24px rgba(0,0,0,0.14)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:15px;font-weight:700;color:#1A1614">📌 记入 Skill</span>
          <button onclick="setState({originalSkillQuickModal:null});render()" style="background:none;border:none;color:#B0AA9F;font-size:22px;cursor:pointer;line-height:1;padding:0 4px">×</button>
        </div>
        <div style="font-size:12px;color:#B0AA9F;margin-bottom:12px">直接追加到 Skill 自由编辑末尾，不影响现有内容</div>
        <textarea id="_skill_quick_ta" oninput="S.originalSkillQuickModal={...S.originalSkillQuickModal,text:this.value}"
          style="width:100%;height:100px;border:1.5px solid #EDE9E3;border-radius:12px;padding:12px;font-size:14px;color:#1A1614;line-height:1.7;font-family:inherit;resize:none;box-sizing:border-box;outline:none"
          placeholder="例如：- 禁止用"这只是其中一个功能"这类AI腔套话&#10;- 开场必须是动作或数字，不能是自我介绍">${esc(skillQuickModal.text||'')}</textarea>
        <button onclick="_skillQuickSave()" ${skillQuickModal.saving?'disabled':''} style="margin-top:12px;width:100%;padding:13px 0;border:none;border-radius:14px;background:${skillQuickModal.saving?'#E8E4DF':'linear-gradient(135deg,#FF8040,#F5602A)'};color:${skillQuickModal.saving?'#B0AA9F':'#fff'};font-size:15px;font-weight:700;cursor:${skillQuickModal.saving?'default':'pointer'}">
          ${skillQuickModal.saving?'保存中…':'追加到 Skill'}
        </button>
      </div>
    </div>` : '';

  const inputBar = `<div style="padding:6px 14px 22px;background:rgba(247,245,241,0.97);border-top:1px solid rgba(0,0,0,0.06);flex-shrink:0">
    <div style="display:flex;gap:8px;align-items:center">
      <button onclick="_openSkillQuick()" title="记入 Skill" style="width:38px;height:38px;border-radius:50%;background:#FFF3E8;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F5602A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      </button>
      <div style="flex:1;background:#fff;border-radius:22px;border:1.5px solid ${inputActive?'#F5602A':'#EDE9E3'};padding:10px 15px;transition:border-color .2s">
        <input id="orig-chat-input" value="${esc(S.originalInput||'')}" oninput="S.originalInput=this.value;_origChatInputState()" onkeydown="if(event.key==='Enter'){event.preventDefault();sendOriginalMessage()}"
          placeholder="告诉我想调整什么…" style="width:100%;border:none;outline:none;font-size:14px;color:#1A1614;background:transparent;font-family:inherit" />
      </div>
      <div id="orig-chat-send" onclick="sendOriginalMessage()" style="width:44px;height:44px;border-radius:50%;background:${inputActive?'linear-gradient(135deg,#FF8040,#F5602A)':'#E8E4DF'};display:flex;align-items:center;justify-content:center;cursor:${inputActive?'pointer':'default'};flex-shrink:0;transition:all .2s;box-shadow:${inputActive?'0 4px 12px rgba(245,96,42,0.35)':'none'}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${inputActive?'#fff':'#B0AA9F'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </div>
    </div>
  </div>
  ${skillQuickSheet}`;

  const docCopyBtnId = 'orig-doc-copy';
  // 阶段流转控制条（仅分步项目显示）
  let stageActions = '';
  if (inStagedFlow && proj.doc) {
    const busy = S.originalStageBusy;
    const backBtn = curIdx > 0
      ? `<button type="button" onclick="backOriginalStage()" ${busy?'disabled':''} style="padding:10px 14px;font-size:13px;color:#9E9890;background:#fff;border:1px solid #EDE9E3;border-radius:12px;cursor:${busy?'default':'pointer'}">← 回上一步</button>`
      : '';
    const fwdBtn = nextStage
      ? `<button type="button" onclick="advanceOriginalStage()" ${busy?'disabled':''} style="flex:1;padding:11px 0;font-size:13.5px;font-weight:700;color:#fff;background:${busy?'#E8C9B8':'linear-gradient(135deg,#FF8040,#F5602A)'};border:none;border-radius:12px;cursor:${busy?'default':'pointer'};box-shadow:0 4px 12px rgba(245,96,42,0.28)">${busy?'生成中…':`确认 ${STAGE_FLOW[curIdx].name}，写${nextStage.name} →`}</button>`
      : `<button type="button" onclick="advanceOriginalStage()" ${busy?'disabled':''} style="flex:1;padding:11px 0;font-size:13.5px;font-weight:700;color:#fff;background:${busy?'#A7C9A0':'linear-gradient(135deg,#34C759,#28A745)'};border:none;border-radius:12px;cursor:${busy?'default':'pointer'}">${busy?'处理中…':'✓ 完成定稿'}</button>`;
    stageActions = `<div style="display:flex;gap:8px;align-items:center;padding-top:12px;border-top:1px solid #F0EDE8;margin-top:4px">${backBtn}${fwdBtn}</div>`;
  }
  const docView = `<div style="flex:1;overflow-y:auto;min-height:0;padding:12px 22px 24px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch">
    <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid #F0EDE8">
      <div>
        <div style="font-size:11px;color:#B0AA9F;margin-bottom:2px">${inStagedFlow ? `当前${curStageName} · 阶段产出` : '当前剧本 · 活文档'}</div>
        <div style="font-size:12.5px;color:#9E9890">${inStagedFlow ? '满意后点下方进入下一步' : '每次对话调整后自动更新'}</div>
      </div>
      ${proj.doc ? `<button type="button" id="${docCopyBtnId}" onclick="copyOriginalDoc('${docCopyBtnId}')" style="padding:7px 13px;font-size:12px;display:flex;align-items:center;gap:5px;color:#6E6860;background:#fff;border:1px solid #F0EDE8;border-radius:12px;cursor:pointer">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>复制
      </button>` : ''}
    </div>
    ${proj.doc
      ? `<div style="font-size:14px;color:#1A1614;line-height:1.9;white-space:pre-wrap;letter-spacing:0.01em;padding:4px 0;font-family:inherit">${esc(proj.doc)}</div>
         ${stageActions || `<div style="padding-top:12px;border-top:1px solid #F0EDE8;display:flex;align-items:center;gap:8px"><span style="font-size:11px;color:#B0AA9F">最后更新：对话第 ${proj.turns||0} 轮</span></div>`}`
      : `<div style="text-align:center;padding:48px 0;color:#B0AA9F;font-size:14px">${inStagedFlow ? `还没有${curStageName}，<br>在「对话调整」里让 AI 帮你写` : '剧本还没生成，<br>开始对话让 AI 帮你写吧'}</div>`}
  </div>`;

  const pill = (id, label, badge) => `<div onclick="setState({originalChatTab:'${id}'});render()" style="padding:8px 16px;border-radius:22px;font-size:13px;font-weight:${tab===id?700:500};background:${tab===id?'#fff':'transparent'};color:${tab===id?'#1A1614':'#9E9890'};cursor:pointer;box-shadow:${tab===id?'0 2px 8px rgba(0,0,0,0.1)':'none'};transition:all .2s;white-space:nowrap">${label}${badge||''}</div>`;

  // 阶段进度条（仅分步项目）
  const stageBar = inStagedFlow ? `<div style="display:flex;align-items:center;padding:8px 20px 4px;flex-shrink:0">
    ${STAGE_FLOW.map((s, i) => {
      const done = i < curIdx, active = i === curIdx;
      const circle = `<div style="width:21px;height:21px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;flex-shrink:0;background:${active?'linear-gradient(135deg,#FF8040,#F5602A)':done?'#FBD9C4':'#E8E4DF'};color:${active?'#fff':done?'#F5602A':'#B0AA9F'}">${done?'✓':(i+1)}</div>`;
      const label = `<span style="font-size:11px;font-weight:${active?700:500};color:${active?'#F5602A':done?'#C8956F':'#B0AA9F'};margin-left:4px;white-space:nowrap">${s.name}</span>`;
      const line = i < STAGE_FLOW.length - 1 ? `<div style="flex:1;height:2px;border-radius:2px;background:${i<curIdx?'#FBD9C4':'#E8E4DF'};margin:0 6px"></div>` : '';
      return `<div style="display:flex;align-items:center;flex-shrink:0">${circle}${label}</div>${line}`;
    }).join('')}
  </div>` : '';

  // 对标素材 chip
  const benchCount = (S.originalBoundMaterials || []).length;
  const benchChip = `<div onclick="openBenchmarkSheet()" style="display:flex;align-items:center;gap:4px;padding:7px 12px;border-radius:20px;background:${benchCount?'#FFF3E8':'#fff'};border:1px solid ${benchCount?'#FBCBA6':'#EDE9E3'};cursor:pointer;flex-shrink:0">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${benchCount?'#F5602A':'#9E9890'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
    <span style="font-size:12px;font-weight:600;color:${benchCount?'#F5602A':'#9E9890'}">对标${benchCount?` ${benchCount}`:''}</span>
  </div>`;

  // 对标素材选择弹窗
  let benchSheet = '';
  if (S.originalBenchmarkSheet) {
    const boundIds = new Set((S.originalBoundMaterials || []).map(m => m.id));
    const mats = S.originalMaterials || [];
    const rows = mats.length ? mats.map(m => {
      const on = boundIds.has(m.id);
      return `<div onclick="toggleBenchmarkMaterial(${m.id})" style="display:flex;align-items:center;gap:10px;padding:12px;border:1.5px solid ${on?'#F5602A':'#EDE9E3'};background:${on?'#FFF7F2':'#fff'};border-radius:12px;cursor:pointer;margin-bottom:8px">
        <div style="width:20px;height:20px;border-radius:6px;border:2px solid ${on?'#F5602A':'#D8D2C8'};background:${on?'#F5602A':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0">${on?'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>':''}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13.5px;font-weight:600;color:#1A1614;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.title||'未命名素材')}</div>
          <div style="font-size:11.5px;color:#B0AA9F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">${esc(m.preview||'')}</div>
        </div>
      </div>`;
    }).join('') : `<div style="text-align:center;padding:30px 0;color:#B0AA9F;font-size:13px;line-height:1.8">素材库还没有素材<br>先到素材库添加竞品原文</div>`;
    benchSheet = `<div onclick="if(event.target===this){setState({originalBenchmarkSheet:false});render()}" style="position:fixed;inset:0;z-index:9300;background:rgba(26,22,20,0.5);display:flex;align-items:flex-end;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)">
      <div style="background:#fff;border-radius:22px 22px 0 0;width:100%;max-height:74vh;display:flex;flex-direction:column;box-shadow:0 -4px 24px rgba(0,0,0,0.14)">
        <div style="padding:18px 20px 10px;display:flex;align-items:flex-start;justify-content:space-between">
          <div><div style="font-size:16px;font-weight:700;color:#1A1614">📌 项目对标素材</div><div style="font-size:12px;color:#B0AA9F;margin-top:3px;line-height:1.5">写文案时只参考勾选的素材<br>学它的结构/钩子/节奏，绝不照抄原句</div></div>
          <button onclick="setState({originalBenchmarkSheet:false});render()" style="background:none;border:none;color:#B0AA9F;font-size:24px;cursor:pointer;line-height:1;padding:0 4px">×</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:6px 20px 12px;-webkit-overflow-scrolling:touch">${S.originalMaterialsLoading?'<div style="text-align:center;padding:30px;color:#B0AA9F">加载中…</div>':rows}</div>
        <div style="padding:12px 20px 24px;border-top:1px solid #F0EDE8">
          <button onclick="setState({originalBenchmarkSheet:false});render()" style="width:100%;padding:13px 0;border:none;border-radius:14px;background:linear-gradient(135deg,#FF8040,#F5602A);color:#fff;font-size:15px;font-weight:700;cursor:pointer">完成（已选 ${benchCount}）</button>
        </div>
      </div>
    </div>`;
  }

  return `<div style="background:#F4F1EC;height:100%;display:flex;flex-direction:column">
    ${stageBar}
    <div style="display:flex;gap:6px;padding:6px 18px 10px;flex-shrink:0;align-items:center;justify-content:space-between">
      <div style="display:flex;gap:6px;min-width:0">
        ${pill('doc',`当前${STAGE_FLOW[curIdx].name}`, proj.doc?` <span style="font-size:9px;background:#F5602A;color:#fff;border-radius:6px;padding:1px 5px;vertical-align:middle">新</span>`:'')}
        ${pill('chat','对话调整')}
      </div>
      ${benchChip}
    </div>
    ${tab === 'doc' ? docView : chatView}
    ${tab === 'chat' ? inputBar : ''}
    ${benchSheet}
  </div>`;
}

function _origChatInputState() {
  const active = !!(S.originalInput && S.originalInput.trim()) && !S.originalLoading;
  const send = document.getElementById('orig-chat-send');
  const inputEl = document.getElementById('orig-chat-input');
  if (send) {
    send.style.background = active ? 'linear-gradient(135deg,#FF8040,#F5602A)' : '#E8E4DF';
    send.style.cursor = active ? 'pointer' : 'default';
    send.style.boxShadow = active ? '0 4px 12px rgba(245,96,42,0.35)' : 'none';
    const path = send.querySelector('svg');
    if (path) path.setAttribute('stroke', active ? '#fff' : '#B0AA9F');
  }
  if (inputEl) {
    const wrap = inputEl.parentElement;
    if (wrap) wrap.style.borderColor = (S.originalInput && S.originalInput.trim()) ? '#F5602A' : '#EDE9E3';
  }
}

function _origLearnInputState() {
  const active = !!(S.originalLearningUrl && S.originalLearningUrl.trim()) && !S.originalLearningLoading;
  const btn = document.getElementById('learning-analyze-btn');
  if (btn) {
    btn.style.background = active ? 'linear-gradient(135deg,#FF8040,#F5602A)' : '#E8E4DF';
    btn.style.color = active ? '#fff' : '#B0AA9F';
    btn.style.cursor = active ? 'pointer' : 'default';
  }
  const wrap = document.getElementById('learning-url-wrap');
  if (wrap) wrap.style.borderColor = (S.originalLearningUrl && S.originalLearningUrl.trim()) ? '#F5602A' : '#EDE9E3';
}

async function copyOriginalDoc(btnId) {
  const doc = (S.originalProject && S.originalProject.doc) || '';
  if (!doc) return;
  try {
    await navigator.clipboard.writeText(doc);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = doc; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>已复制';
    btn.style.color = '#22C55E'; btn.style.borderColor = '#BBF0CC';
    setTimeout(() => { const b = document.getElementById(btnId); if (b) render(); }, 1400);
  }
}

async function openOriginalProject(id) {
  setState({ originalLoading: true, originalView: 'chat', originalChatTab: 'chat', originalInput: '' });
  render();
  try {
    const r = await api.get('/original/projects/' + id);
    if (r.code === 200) {
      setState({
        originalProject: r.data.project,
        originalMessages: r.data.messages || [],
        originalBoundMaterials: r.data.boundMaterials || [],
        originalLoading: false,
      });
    } else {
      setState({ originalLoading: false });
      showToast(r.msg || '加载失败');
    }
  } catch { setState({ originalLoading: false }); showToast('网络错误'); }
  render();
  setTimeout(() => {
    const el = document.getElementById('orig-chat-scroll');
    if (el) el.scrollTop = el.scrollHeight;
  }, 80);
}

async function createOriginalProject() {
  const title = (document.getElementById('orig-new-title') ? document.getElementById('orig-new-title').value : S.originalNewTitle).trim();
  const brief = (document.getElementById('orig-new-brief') ? document.getElementById('orig-new-brief').value : S.originalNewBrief).trim();
  if (!title) { showToast('请填写视频主题'); return; }
  if (S.originalLoading) return;
  const duration = S.originalNewDuration || '1min';
  const style = S.originalNewStyle || 'informative';
  const platform = S.originalNewPlatform || 'douyin';
  const staged = S.originalNewStaged !== false;
  const materialIds = S.originalNewMaterialIds || [];
  setState({ originalLoading: true, originalNewTitle: title, originalNewBrief: brief });
  render();
  try {
    const r = await api.post('/original/projects', { title, brief, duration, angle: brief, style, platform, staged, materialIds });
    if (r.code === 200) {
      const rProj = await api.get('/original/projects');
      setState({
        originalProjects: rProj.code === 200 ? rProj.data : S.originalProjects,
        originalProject: r.data,
        originalMessages: [],
        originalBoundMaterials: [],
        originalNewMaterialIds: [],
        originalLoading: false,
        originalView: 'chat',
        originalChatTab: staged ? 'chat' : 'chat',
        originalInput: '',
      });
      showToast(staged ? '项目已创建 · 先定选题方向' : '项目已创建 ✓');
    } else {
      setState({ originalLoading: false });
      showToast(r.msg || '创建失败');
    }
  } catch { setState({ originalLoading: false }); showToast('网络错误'); }
  render();
}

async function sendOriginalMessage() {
  const inputEl = document.getElementById('orig-chat-input');
  const input = (inputEl ? inputEl.value : S.originalInput).trim();
  if (!input || S.originalLoading || !S.originalProject) return;
  setState({
    originalInput: '',
    originalLoading: true,
    originalMessages: [...S.originalMessages, { role: 'user', content: input }],
  });
  render();
  setTimeout(() => {
    const el = document.getElementById('orig-chat-scroll');
    if (el) el.scrollTop = el.scrollHeight;
  }, 40);
  try {
    const r = await api.post('/original/projects/' + S.originalProject.id + '/chat', { message: input });
    if (r.code === 200) {
      setState({
        originalMessages: [...S.originalMessages, r.data.message],
        originalProject: { ...S.originalProject, doc: r.data.doc, turns: r.data.turns, stage: r.data.stage || S.originalProject.stage },
        originalLoading: false,
      });
    } else {
      setState({ originalLoading: false });
      showToast(r.msg || '发送失败');
    }
  } catch { setState({ originalLoading: false }); showToast('网络错误'); }
  render();
  setTimeout(() => {
    const el = document.getElementById('orig-chat-scroll');
    if (el) el.scrollTop = el.scrollHeight;
  }, 80);
}

// 确认当前阶段产出，进入下一阶段（后端自动生成下一阶段初稿）
async function advanceOriginalStage() {
  if (!S.originalProject || S.originalStageBusy) return;
  setState({ originalStageBusy: true });
  render();
  try {
    const r = await api.post('/original/projects/' + S.originalProject.id + '/stage/advance', {});
    if (r.code === 200) {
      if (r.data.done) {
        setState({ originalProject: { ...S.originalProject, status: 'final' }, originalStageBusy: false });
        showToast('已完成定稿 ✓');
      } else {
        const tip = { role: 'ai', content: `✅ 已确认，进入「${r.data.tipName}」`, has_doc_update: 0, stage: r.data.stage };
        setState({
          originalProject: { ...S.originalProject, stage: r.data.stage, doc: r.data.doc, turns: r.data.turns,
            artifacts: { ...(S.originalProject.artifacts||{}), [r.data.prevStage]: S.originalProject.doc } },
          originalMessages: [...S.originalMessages, tip, r.data.message],
          originalChatTab: 'doc',
          originalStageBusy: false,
        });
        showToast('进入：' + r.data.tipName);
      }
    } else {
      setState({ originalStageBusy: false });
      showToast(r.msg || '操作失败');
    }
  } catch { setState({ originalStageBusy: false }); showToast('网络错误'); }
  render();
}

// 回退到上一阶段
async function backOriginalStage() {
  if (!S.originalProject || S.originalStageBusy) return;
  if (!confirm('回到上一步？当前这一步的内容会被上一步已确认的内容替换。')) return;
  setState({ originalStageBusy: true });
  render();
  try {
    const r = await api.post('/original/projects/' + S.originalProject.id + '/stage/back', {});
    if (r.code === 200) {
      setState({
        originalProject: { ...S.originalProject, stage: r.data.stage, doc: r.data.doc, status: 'draft' },
        originalStageBusy: false,
        originalChatTab: 'doc',
      });
    } else {
      setState({ originalStageBusy: false });
      showToast(r.msg || '操作失败');
    }
  } catch { setState({ originalStageBusy: false }); showToast('网络错误'); }
  render();
}

// 打开对标素材选择弹窗（按需加载素材库）
async function openBenchmarkSheet() {
  setState({ originalBenchmarkSheet: true });
  render();
  if (!S.originalMaterialsLoaded) await loadMaterials();
}

// 勾选/取消勾选某个对标素材（即时绑定到当前项目）
async function toggleBenchmarkMaterial(id) {
  if (!S.originalProject) return;
  const bound = S.originalBoundMaterials || [];
  const isOn = bound.some(m => m.id === id);
  const pid = S.originalProject.id;
  try {
    if (isOn) {
      await api.del(`/original/projects/${pid}/materials/${id}`);
      setState({ originalBoundMaterials: bound.filter(m => m.id !== id) });
    } else {
      const r = await api.post(`/original/projects/${pid}/materials`, { materialIds: [id] });
      if (r.code === 200) setState({ originalBoundMaterials: r.data || bound });
    }
  } catch { showToast('网络错误'); }
  render();
}

async function syncOriginalRule(msgId, label) {
  try {
    const r = await api.patch('/original/projects/' + S.originalProject.id, { msgId, syncDone: 'synced' });
    if (r.code === 200) {
      setState({
        originalMessages: S.originalMessages.map(m => m.id === msgId ? { ...m, sync_done: 'synced' } : m),
      });
      const rSkill = await api.get('/original/skill');
      if (rSkill.code === 200) setState({ originalSkill: rSkill.data });
      showToast('已同步到 Skill ✓');
    } else {
      showToast(r.msg || '同步失败');
    }
  } catch { showToast('网络错误'); }
  render();
}

async function skipOriginalRule(msgId) {
  try {
    await api.patch('/original/projects/' + S.originalProject.id, { msgId, syncDone: 'skipped' });
    setState({
      originalMessages: S.originalMessages.map(m => m.id === msgId ? { ...m, sync_done: 'skipped' } : m),
    });
  } catch {}
  render();
}

// 切换账号场景下某条视频的勾选（最多 4 条）
function _toggleLearnItem(idx) {
  const items = (S.originalLearningItems || []).slice();
  const it = items[idx];
  if (!it) return;
  if (!it.selected && items.filter(x => x.selected).length >= 4) {
    showToast('最多拆解 4 条');
    return;
  }
  items[idx] = { ...it, selected: !it.selected };
  setState({ originalLearningItems: items });
  render();
}

// ── 素材库操作 ──────────────────────────────────────
async function loadMaterials() {
  if (S.originalMaterialsLoading) return;
  setState({ originalMaterialsLoading: true });
  try {
    const j = await api.get('/original/materials');
    setState({ originalMaterials: j.data || [], originalMaterialsLoaded: true, originalMaterialsLoading: false });
  } catch(e) {
    setState({ originalMaterialsLoading: false });
  }
  render();
}

function _toggleMaterial(id) {
  const sel = S.originalMaterialsSelected || [];
  const has = sel.includes(id);
  setState({ originalMaterialsSelected: has ? sel.filter(x=>x!==id) : [...sel, id] });
  render();
}

function _toggleMaterialLearn(id) {
  const sel = S.originalMaterialsSelected || [];
  const has = sel.includes(id);
  const newSel = has ? sel.filter(x=>x!==id) : sel.length<4 ? [...sel, id] : sel;
  setState({ originalMaterialsSelected: newSel });
  render();
}

async function deleteMaterial(id) {
  if (!confirm('确认删除这条素材？')) return;
  await api.del(`/original/materials/${id}`);
  setState({
    originalMaterials: (S.originalMaterials||[]).filter(m=>m.id!==id),
    originalMaterialsSelected: (S.originalMaterialsSelected||[]).filter(x=>x!==id)
  });
  render();
}

async function saveMaterialText() {
  const title = (document.getElementById('mat-title')?.value || S.originalExtractTitle || '').trim();
  const content = (document.getElementById('mat-content')?.value || S.originalExtractContent || '').trim();
  if (!content) return;
  const j = await api.post('/original/materials', { title: title||null, rawContent: content, sourceType: 'text' });
  if (j.code === 200) {
    setState({ originalView:'materials', originalExtractContent:'', originalExtractTitle:'' });
    await loadMaterials();
  } else {
    alert(j.msg || '保存失败');
  }
}

async function extractMaterialUrl() {
  const url = (document.getElementById('mat-url')?.value || S.originalExtractUrl || '').trim();
  if (!url) return;
  setState({ originalExtractUrlLoading: true, originalExtractUrlResult: null });
  render();
  try {
    const j = await api.post('/original/learning/extract', { url, type: 'video' });
    if (j.code===200 && j.data?.items?.[0]) {
      const v = j.data.items[0];
      setState({ originalExtractUrlResult: { title: v.desc||'', script: v.script||'', sourceUrl: url }, originalExtractUrlLoading: false });
    } else {
      alert(j.msg || '提取失败');
      setState({ originalExtractUrlLoading: false });
    }
  } catch(e) {
    alert('提取出错：'+e.message);
    setState({ originalExtractUrlLoading: false });
  }
  render();
}

async function saveMaterialFromUrl() {
  const result = S.originalExtractUrlResult;
  if (!result) return;
  const content = (document.getElementById('mat-url-content')?.value || result.script || '').trim();
  const j = await api.post('/original/materials', { title: result.title||null, rawContent: content, sourceUrl: result.sourceUrl, sourceType: 'video' });
  if (j.code === 200) {
    setState({ originalView:'materials', originalExtractUrlResult:null, originalExtractUrl:'' });
    await loadMaterials();
  } else {
    alert(j.msg || '保存失败');
  }
}

// 从素材库选中条目 → 直接进入学习分析
async function learnFromMaterials() {
  const sel = S.originalMaterialsSelected || [];
  if (!sel.length) return;
  setState({ originalView:'learning', originalLearningPhase:'input', originalLearningResult:null });
  render();
  await analyzeFromMaterials();
}

async function analyzeFromMaterials() {
  const sel = S.originalMaterialsSelected || [];
  if (!sel.length) return;
  const scope = S.originalLearningScope || 'global';
  setState({ originalLearningLoading: true, originalLearningResult: null });
  render();
  try {
    const j = await api.post('/original/learning/analyze', { materialIds: sel, scope });
    if (j.code===200) {
      setState({ originalLearningResult: j.data, originalLearningPhase:'result', originalLearningLoading:false });
    } else {
      alert(j.msg || '分析失败');
      setState({ originalLearningLoading: false });
    }
  } catch(e) {
    alert('分析出错：'+e.message);
    setState({ originalLearningLoading: false });
  }
  render();
}

// 阶段一：提取原文（单视频→完整原文；账号→视频列表供勾选）
async function extractOriginalLearning() {
  const urlEl = document.getElementById('learning-url-input');
  const url = (urlEl ? urlEl.value : S.originalLearningUrl).trim();
  if (!url) { showToast('请粘贴链接'); return; }
  if (S.originalLearningLoading) return;
  setState({ originalLearningLoading: true, originalLearningUrl: url, originalLearningResult: null, originalLearningItems: [] });
  render();
  try {
    const r = await api.post('/original/learning/extract', {
      url,
      type: S.originalLearningType,
    });
    if (r.code === 200 && (r.data.items || []).length) {
      setState({
        originalLearningItems: r.data.items,
        originalLearningPhase: 'select',
        originalLearningLoading: false,
      });
    } else {
      setState({ originalLearningLoading: false });
      showAlert(r.msg || '未提取到内容', '没取到原文');
    }
  } catch { setState({ originalLearningLoading: false }); showToast('网络错误'); }
  render();
}

// 学习中心进度定时器
const _LEARN_STEPS = [
  { label: '获取口播原文…',      pct: 15, speed: 3.0 },
  { label: 'AI 逐句标注角色…',   pct: 40, speed: 1.5 },
  { label: '提炼人设·选题逻辑…', pct: 60, speed: 0.9 },
  { label: '拆解结构骨架与节奏…',pct: 78, speed: 0.7 },
  { label: '整理复刻规律蓝图…',  pct: 92, speed: 0.4 },
];
let _learnProgressTimer = null;
let _learnPct = 0;
let _learnStepIdx = 0;
function _startLearnProgress() {
  _learnPct = 0; _learnStepIdx = 0;
  setState({ originalLearningProgress: 0, originalLearningProgressLabel: _LEARN_STEPS[0].label });
  if (_learnProgressTimer) clearInterval(_learnProgressTimer);
  _learnProgressTimer = setInterval(() => {
    const step = _LEARN_STEPS[_learnStepIdx] || _LEARN_STEPS[_LEARN_STEPS.length - 1];
    _learnPct = Math.min(_learnPct + step.speed, step.pct);
    if (_learnPct >= step.pct && _learnStepIdx < _LEARN_STEPS.length - 1) _learnStepIdx++;
    const label = (_LEARN_STEPS[_learnStepIdx] || step).label;
    setState({ originalLearningProgress: Math.round(_learnPct), originalLearningProgressLabel: label });
    render();
  }, 1000);
}
function _stopLearnProgress(done) {
  if (_learnProgressTimer) { clearInterval(_learnProgressTimer); _learnProgressTimer = null; }
  if (done) setState({ originalLearningProgress: 100, originalLearningProgressLabel: '拆解完成 ✓' });
}

// 阶段二：对选中的原文做逐句深拆
async function analyzeOriginalLearning() {
  if (S.originalLearningLoading) return;
  const type = S.originalLearningType;
  const allItems = S.originalLearningItems || [];
  const picked = type === 'video' ? allItems.slice(0, 1) : allItems.filter(it => it.selected).slice(0, 4);
  if (!picked.length) { showToast('请先选择要学习的视频'); return; }

  setState({ originalLearningLoading: true, originalLearningResult: null, originalLearningPhase: 'result', originalLearningProgress: 0, originalLearningProgressLabel: '' });
  _startLearnProgress();
  render();
  try {
    const r = await api.post('/original/learning/analyze', {
      type,
      scope: S.originalLearningScope,
      items: picked.map(it => ({ awemeId: it.awemeId, desc: it.desc, likes: it.likes, script: it.script || '' })),
    });
    if (r.code === 200 && (r.data.videos || []).length) {
      const data = r.data;
      data.rules = (data.rules || []).map(rule => ({ ...rule, checked: rule.checked !== false }));
      _stopLearnProgress(true);
      setState({ originalLearningResult: data, originalLearningLoading: false });
    } else {
      _stopLearnProgress(false);
      setState({ originalLearningLoading: false, originalLearningPhase: 'select' });
      showAlert(r.msg || '拆解失败', '拆解未成功');
    }
  } catch {
    _stopLearnProgress(false);
    setState({ originalLearningLoading: false });
    showToast('网络错误');
  }
  render();
}

// 阶段三：把选中的规律融合进 Skill 工作流
async function writeOriginalLearning() {
  if (S.originalLearningWriting) return;
  const result = S.originalLearningResult;
  const selected = (result && Array.isArray(result.rules)) ? result.rules.filter(r => r.checked) : [];
  if (selected.length === 0) { showToast('请至少选择一条'); return; }
  const scope = S.originalLearningScope || 'global';
  setState({ originalLearningWriting: true });
  render();
  try {
    const projectId = scope === 'project' && S.originalProject ? S.originalProject.id : null;
    const r = await api.post('/original/learning/write', {
      insights: selected.map(s => ({ text: s.text, freq: s.freq })),
      scope,
      projectId,
    });
    setState({ originalLearningWriting: false });
    if (r.code === 200) {
      if (r.data && r.data.skill) setState({ originalSkill: r.data.skill });
      setState({
        originalLearningResult: null,
        originalLearningUrl: '',
        originalLearningItems: [],
        originalLearningPhase: 'input',
      });
      showToast(scope === 'global' ? `已融合 ${selected.length} 条进 Skill ✓` : `已记录 ${selected.length} 条（本项目）`);
    } else {
      showToast(r.msg || '写入失败');
    }
  } catch {
    setState({ originalLearningWriting: false });
    showToast('网络错误');
  }
  render();
}

function formatRelTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff/60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff/3600000) + '小时前';
    if (diff < 2592000000) return Math.floor(diff/86400000) + '天前';
    return d.toLocaleDateString('zh-CN', { month:'numeric', day:'numeric' });
  } catch { return ''; }
}

// ===== 口播工坊（进阶服务）=====
function _wsCopyText(it) {
  if (!it) return '';
  if (typeof it === 'string') return it;
  if (typeof it.result === 'string') return it.result;
  return (it.result && (it.result.content || it.result.result)) || it.input || '';
}
function _wsRelTime(raw) {
  if (!raw) return '';
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return '';
  const d = Date.now() - t, day = 24 * 3600 * 1000;
  if (d < 60000) return '刚刚';
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
  if (d < day) return Math.floor(d / 3600000) + ' 小时前';
  if (d < 2 * day) return '昨天';
  return new Date(t).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}
