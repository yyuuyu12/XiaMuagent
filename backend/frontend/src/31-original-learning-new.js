function tOriginalMaterials() {
  const mats = S.originalMaterials || [];
  const loading = S.originalMaterialsLoading;
  const sel = S.originalMaterialsSelected || [];
  const selSet = new Set(sel);

  const typeIcon = t => t === 'video'
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F5602A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`
    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

  const formatDate = d => {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getMonth()+1}月${dt.getDate()}日`;
  };

  const cards = mats.length === 0 && !loading
    ? `<div style="text-align:center;padding:40px 20px;color:#B0AA9F;font-size:14px;line-height:1.8">还没有素材<br><span style="font-size:12px">添加竞品文案或视频原文，长期积累</span></div>`
    : mats.map(m => {
        const checked = selSet.has(m.id);
        return `<div onclick="_toggleMaterial(${m.id})" style="margin:0 16px 10px;background:#fff;border-radius:14px;padding:13px 14px;border:1.5px solid ${checked?'#4F46E5':'#F0EDE8'};cursor:pointer;-webkit-tap-highlight-color:transparent;display:flex;align-items:flex-start;gap:10px">
          <div style="width:20px;height:20px;border-radius:6px;border:2px solid ${checked?'#4F46E5':'#D8D2C9'};background:${checked?'#4F46E5':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;transition:all .15s">
            ${checked?'<svg width="10" height="8" viewBox="0 0 12 10" fill="none"><path d="M1 5l3.5 3.5L11 1" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>':''}
          </div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              ${typeIcon(m.source_type)}
              <span style="font-size:13.5px;font-weight:600;color:#1A1614;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">${esc(m.title)}</span>
            </div>
            <div style="font-size:12px;color:#9E9890;line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc((m.preview||'').replace(/\n/g,' '))}</div>
            <div style="font-size:11px;color:#C0B8B0;margin-top:5px">${formatDate(m.created_at)} · ${Math.round((m.content_len||0)/300)}分钟素材</div>
          </div>
          <button type="button" onclick="event.stopPropagation();deleteMaterial(${m.id})" style="border:none;background:none;padding:4px;cursor:pointer;opacity:0.45;flex-shrink:0">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6E6860" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/></svg>
          </button>
        </div>`;
      }).join('');

  const selCount = sel.length;

  return `<div style="background:#F7F5F1;min-height:100%;padding:14px 0 100px">
    ${loading ? `<div style="text-align:center;padding:32px;color:#B0AA9F;font-size:13px">加载中…</div>` : cards}
    <!-- 底部操作栏 -->
    <div style="position:fixed;bottom:0;left:0;right:0;max-width:430px;margin:0 auto;background:#fff;border-top:1px solid #F0EDE8;padding:12px 16px;display:flex;gap:10px;z-index:200">
      <button type="button" onclick="setState({originalView:'extract',originalExtractTab:'text',originalExtractTitle:'',originalExtractContent:'',originalExtractUrl:'',originalExtractUrlResult:null});render()"
        style="flex:1;padding:12px 0;border:1.5px solid #4F46E5;border-radius:14px;background:#fff;color:#4F46E5;font-size:14px;font-weight:700;cursor:pointer">
        ＋ 添加素材
      </button>
      <button type="button" ${selCount===0?'disabled':''} onclick="learnFromMaterials()"
        style="flex:1;padding:12px 0;border:none;border-radius:14px;background:${selCount===0?'#E8E4DF':'linear-gradient(135deg,#FF8040,#F5602A)'};color:${selCount===0?'#B0AA9F':'#fff'};font-size:14px;font-weight:700;cursor:${selCount===0?'default':'pointer'}">
        ${selCount>0?`学习已选 ${selCount} 条`:'选择素材学习'}
      </button>
    </div>
  </div>`;
}

/* ─── 添加素材页面 ─── */
function tOriginalExtract() {
  const tab = S.originalExtractTab || 'text';
  const title = S.originalExtractTitle || '';
  const content = S.originalExtractContent || '';
  const url = S.originalExtractUrl || '';
  const urlLoading = S.originalExtractUrlLoading;
  const urlResult = S.originalExtractUrlResult;

  const seg = (active, label, action) => `<div onclick="${action}" style="flex:1;text-align:center;padding:9px 0;border-radius:11px;font-size:13px;font-weight:${active?700:500};cursor:pointer;background:${active?'#fff':'transparent'};color:${active?'#1A1614':'#9E9890'};box-shadow:${active?'0 2px 8px rgba(0,0,0,0.08)':'none'};-webkit-tap-highlight-color:transparent">${label}</div>`;

  const textTab = `<div style="padding:0 16px">
    <div style="margin-bottom:10px">
      <div style="font-size:12px;color:#9E9890;margin-bottom:6px;font-weight:600">素材标题（可选）</div>
      <input id="mat-title" type="text" value="${esc(title)}" oninput="setState({originalExtractTitle:this.value})"
        placeholder="例如：某博主·副业选题" maxlength="80"
        style="width:100%;box-sizing:border-box;padding:10px 13px;border:1.5px solid #EDE9E3;border-radius:12px;font-size:14px;background:#fff;outline:none;font-family:inherit">
    </div>
    <div style="margin-bottom:16px">
      <div style="font-size:12px;color:#9E9890;margin-bottom:6px;font-weight:600">粘贴原文 *</div>
      <textarea id="mat-content" oninput="setState({originalExtractContent:this.value})"
        placeholder="把竞品视频的口播原文、文案文字粘贴到这里…"
        style="width:100%;box-sizing:border-box;padding:12px 13px;border:1.5px solid ${content?'#4F46E5':'#EDE9E3'};border-radius:12px;font-size:14px;color:#1A1614;background:#fff;outline:none;resize:none;height:200px;line-height:1.7;font-family:inherit">${esc(content)}</textarea>
    </div>
    <button type="button" ${!content.trim()?'disabled':''} onclick="saveMaterialText()"
      style="width:100%;padding:14px 0;border:none;border-radius:16px;background:${content.trim()?'linear-gradient(135deg,#6366F1,#4F46E5)':'#E8E4DF'};color:${content.trim()?'#fff':'#B0AA9F'};font-size:15px;font-weight:700;cursor:${content.trim()?'pointer':'default'}">
      保存到素材库
    </button>
  </div>`;

  const urlExtracted = urlResult ? `<div style="margin-bottom:14px;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:12px;padding:13px">
    <div style="font-size:12px;font-weight:700;color:#0369A1;margin-bottom:8px">提取到的原文（可编辑后保存）</div>
    <textarea id="mat-url-content" style="width:100%;box-sizing:border-box;padding:0;border:none;outline:none;font-size:13px;color:#1A1614;background:transparent;resize:none;height:160px;line-height:1.7;font-family:inherit">${esc(urlResult.script)}</textarea>
  </div>
  <button type="button" onclick="saveMaterialFromUrl()"
    style="width:100%;padding:13px 0;border:none;border-radius:14px;background:linear-gradient(135deg,#6366F1,#4F46E5);color:#fff;font-size:14px;font-weight:700;cursor:pointer">
    保存到素材库
  </button>` : '';

  const urlTab = `<div style="padding:0 16px">
    <div style="margin-bottom:12px">
      <div style="font-size:12px;color:#9E9890;margin-bottom:6px;font-weight:600">视频链接</div>
      <textarea id="mat-url" oninput="setState({originalExtractUrl:this.value})"
        placeholder="粘贴抖音视频链接…"
        style="width:100%;box-sizing:border-box;padding:11px 13px;border:1.5px solid ${url?'#4F46E5':'#EDE9E3'};border-radius:12px;font-size:14px;color:#1A1614;background:#fff;outline:none;resize:none;height:70px;line-height:1.6;font-family:inherit">${esc(url)}</textarea>
    </div>
    <button type="button" ${(!url.trim()||urlLoading)?'disabled':''} onclick="extractMaterialUrl()"
      style="width:100%;padding:13px 0;border:none;border-radius:14px;background:${url.trim()&&!urlLoading?'linear-gradient(135deg,#FF8040,#F5602A)':'#E8E4DF'};color:${url.trim()&&!urlLoading?'#fff':'#B0AA9F'};font-size:14px;font-weight:700;cursor:${url.trim()&&!urlLoading?'pointer':'default'};margin-bottom:14px">
      ${urlLoading?'提取中…':'提取原文'}
    </button>
    ${urlExtracted}
  </div>`;

  return `<div style="background:#F7F5F1;min-height:100%;padding:14px 0 40px">
    <div style="display:flex;background:#EDE9E3;border-radius:13px;padding:3px;margin:0 16px 16px">
      ${seg(tab==='text','粘贴文字',"setState({originalExtractTab:'text',originalExtractUrlResult:null});render()")}
      ${seg(tab==='url','视频链接',"setState({originalExtractTab:'url',originalExtractUrlResult:null});render()")}
    </div>
    ${tab==='text' ? textTab : urlTab}
  </div>`;
}

function tOriginalLearning() {
  const phase = S.originalLearningPhase || 'input';
  const items = S.originalLearningItems || [];
  const result = S.originalLearningResult;
  const loading = S.originalLearningLoading;
  const type = S.originalLearningType || 'account';
  const scope = S.originalLearningScope || 'global';
  const url = S.originalLearningUrl || '';

  const seg = (active, label, action) => `<div onclick="${action}" style="flex:1;text-align:center;padding:9px 0;border-radius:11px;font-size:13px;font-weight:${active?700:500};cursor:pointer;transition:all .2s;background:${active?'#fff':'transparent'};color:${active?'#1A1614':'#9E9890'};box-shadow:${active?'0 2px 8px rgba(0,0,0,0.08)':'none'};-webkit-tap-highlight-color:transparent">${label}</div>`;


  /* ═══ 阶段一：从素材库选择 ═══ */
  if (phase === 'input') {
    const mats = S.originalMaterials || [];
    const sel = S.originalMaterialsSelected || [];
    const selSet = new Set(sel);
    const matsLoading = S.originalMaterialsLoading;

    const matCards = mats.length === 0 && !matsLoading
      ? `<div style="text-align:center;padding:32px 20px;color:#B0AA9F;font-size:13px;line-height:1.8">
           素材库为空，请先<br>
           <span onclick="setState({originalView:'extract',originalExtractTab:'text',originalExtractTitle:'',originalExtractContent:'',originalExtractUrl:'',originalExtractUrlResult:null});render()" style="color:#4F46E5;font-weight:700;cursor:pointer">添加素材</span>
         </div>`
      : mats.map(m => {
          const checked = selSet.has(m.id);
          return `<div onclick="_toggleMaterialLearn(${m.id})" style="margin:0 16px 8px;background:#fff;border-radius:13px;padding:12px 13px;border:1.5px solid ${checked?'#F5602A':'#F0EDE8'};cursor:pointer;display:flex;align-items:flex-start;gap:10px;-webkit-tap-highlight-color:transparent">
            <div style="width:18px;height:18px;border-radius:5px;border:2px solid ${checked?'#F5602A':'#D8D2C9'};background:${checked?'#F5602A':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
              ${checked?'<svg width="10" height="8" viewBox="0 0 12 10" fill="none"><path d="M1 5l3.5 3.5L11 1" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>':''}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px;font-weight:600;color:#1A1614;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.title)}</div>
              <div style="font-size:11.5px;color:#9E9890;margin-top:3px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden">${esc((m.preview||'').replace(/\n/g,' '))}</div>
            </div>
          </div>`;
        }).join('');

    const selCount = sel.length;
    const canLearn = selCount > 0 && !loading;

    return `<div style="background:#F7F5F1;min-height:100%;padding:14px 0 100px">
      <div style="display:flex;background:#EDE9E3;border-radius:13px;padding:3px;margin:0 16px 12px">
        ${seg(scope==='global','写入全局 Skill',"setState({originalLearningScope:'global'});render()")}
        ${seg(scope==='project','仅用于本项目',"setState({originalLearningScope:'project'});render()")}
      </div>
      <div style="margin:0 16px 14px;padding:9px 13px;background:${scope==='global'?'#FFF3E8':'#F0FDF4'};border-radius:12px;font-size:12px;color:${scope==='global'?'#9A3D0C':'#065F46'};line-height:1.6">
        ${scope==='global'?'学到的规律会融合进 Skill 工作流，对所有项目长期生效':'学到的规律仅用于当前项目，不改变全局 Skill'}
      </div>
      <div style="margin:0 16px 10px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:13px;font-weight:700;color:#1A1614">选择要学习的素材（最多4条）</div>
        <span onclick="setState({originalView:'extract',originalExtractTab:'text',originalExtractTitle:'',originalExtractContent:'',originalExtractUrl:'',originalExtractUrlResult:null});render()" style="font-size:12px;color:#4F46E5;font-weight:700;cursor:pointer">＋ 添加素材</span>
      </div>
      ${matsLoading ? `<div style="text-align:center;padding:24px;color:#B0AA9F;font-size:13px">加载中…</div>` : matCards}
      <div style="position:fixed;bottom:0;left:0;right:0;max-width:430px;margin:0 auto;background:#fff;border-top:1px solid #F0EDE8;padding:12px 16px;z-index:200">
        <button type="button" ${canLearn?'':'disabled'} onclick="analyzeFromMaterials()"
          style="width:100%;padding:14px 0;border:none;border-radius:16px;background:${canLearn?'linear-gradient(135deg,#FF8040,#F5602A)':'#E8E4DF'};color:${canLearn?'#fff':'#B0AA9F'};font-size:15px;font-weight:700;cursor:${canLearn?'pointer':'default'}">
          ${loading ? '拆解中，稍等…' : selCount>0 ? `开始学习（已选 ${selCount} 条）` : '请选择素材'}
        </button>
      </div>
    </div>`;
  }

  /* ═══ 阶段二：选择要学习的原文 ═══ */
  if (phase === 'select') {
    let body = '';
    if (type === 'video') {
      const v = items[0];
      body = v ? `
        <div style="background:#fff;border-radius:16px;padding:16px;margin:0 22px 16px;border:1px solid #F0EDE8">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-size:13.5px;font-weight:700;color:#1A1614;flex:1;line-height:1.4">${esc(v.desc||'未命名视频')}</span>
            <span style="font-size:11px;color:#B0AA9F;flex-shrink:0">赞${v.likes||0}·约${v.estSec||'?'}秒</span>
          </div>
          <div style="font-size:11.5px;font-weight:700;color:#9E6B3A;margin-bottom:7px">提取到的原文</div>
          <div style="background:#FAF8F5;border-radius:10px;padding:13px;font-size:13.5px;color:#2A241E;line-height:1.85;max-height:260px;overflow-y:auto">${esc(v.script||'')}</div>
        </div>` : `<div style="text-align:center;padding:24px;color:#B0AA9F">未提取到原文</div>`;
    } else {
      const selCount = items.filter(it => it.selected).length;
      body = `
        <div style="margin:0 22px 8px;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:13px;font-weight:700;color:#1A1614">勾选要学习的视频</div>
          <span style="font-size:12px;color:#B0AA9F">已选 ${selCount}（最多拆解 4 条）</span>
        </div>
        <div style="margin:0 22px 16px;display:flex;flex-direction:column;gap:8px">
          ${items.map((it, idx) => `
            <div onclick="_toggleLearnItem(${idx})" style="background:${it.selected?'#FFF8F3':'#fff'};border-radius:12px;padding:12px 13px;border:1.5px solid ${it.selected?'#F5602A':'#F0EDE8'};cursor:pointer;display:flex;align-items:flex-start;gap:10px;-webkit-tap-highlight-color:transparent">
              <div style="width:18px;height:18px;border-radius:5px;border:2px solid ${it.selected?'#F5602A':'#D8D2C9'};background:${it.selected?'#F5602A':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
                ${it.selected?'<svg width="10" height="8" viewBox="0 0 12 10" fill="none"><path d="M1 5l3.5 3.5L11 1" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>':''}
              </div>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;color:#1A1614;line-height:1.5">${esc(it.desc||'未命名视频')}</div>
                <div style="font-size:11px;color:#B0AA9F;margin-top:3px">赞 ${it.likes||0}</div>
              </div>
            </div>`).join('')}
        </div>`;
    }
    const selCount = type === 'video' ? (items.length ? 1 : 0) : items.filter(it => it.selected).length;
    const canGo = selCount > 0 && !loading;
    return `<div style="background:#F7F5F1;min-height:100%;padding:14px 0 28px">
      ${body}
      <button type="button" ${canGo?'':'disabled'} onclick="analyzeOriginalLearning()"
              style="width:calc(100% - 44px);margin:0 22px;padding:14px 0;border:none;border-radius:16px;background:${canGo?'linear-gradient(135deg,#FF8040,#F5602A)':'#E8E4DF'};color:${canGo?'#fff':'#B0AA9F'};font-size:15px;font-weight:700;cursor:${canGo?'pointer':'default'}">
        ${loading ? '逐句拆解中…' : (type==='video' ? '开始逐句拆解' : `逐句拆解选中（${selCount}）`)}
      </button>
    </div>`;
  }

  /* ═══ 阶段三：拆解结果 ═══ */
  let resultBlock = '';
  if (loading) {
    const pct = S.originalLearningProgress || 0;
    const stepLabel = S.originalLearningProgressLabel || '准备中…';
    const STEPS_DISPLAY = ['获取口播原文','AI 逐句标注','提炼人设·选题','拆解结构骨架','整理规律蓝图'];
    const stepsDots = STEPS_DISPLAY.map((s,i) => {
      const done = pct >= [15,40,60,78,92][i];
      return `<div style="display:flex;align-items:center;gap:7px;padding:5px 0">
        <div style="width:16px;height:16px;border-radius:50%;flex-shrink:0;background:${done?'#F5602A':'#EDE9E3'};display:flex;align-items:center;justify-content:center">
          ${done?'<svg width="9" height="7" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>':''}
        </div>
        <span style="font-size:12.5px;color:${done?'#1A1614':'#B0AA9F'};font-weight:${done?600:400}">${s}</span>
      </div>`;
    }).join('');
    resultBlock = `
      <div style="padding:28px 0 12px">
        <div style="text-align:center;font-size:14px;font-weight:700;color:#1A1614;margin-bottom:20px">${esc(stepLabel)}</div>
        <div style="background:#EDE9E3;border-radius:100px;height:7px;overflow:hidden;margin:0 4px 6px">
          <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#FF8040,#F5602A);border-radius:100px;transition:width 1s linear"></div>
        </div>
        <div style="text-align:right;font-size:11px;color:#B0AA9F;margin-bottom:22px">${pct}%</div>
        <div style="background:#fff;border-radius:14px;padding:14px 16px;border:1px solid #F0EDE8">
          ${stepsDots}
        </div>
        <div style="text-align:center;font-size:11.5px;color:#B0AA9F;margin-top:16px">越细越慢，通常需要 30–90 秒</div>
      </div>`;
  } else if (!result || !(result.videos || []).length) {
    resultBlock = `<div style="text-align:center;padding:24px 0;color:#B0AA9F;font-size:14px">未提炼到有效分析</div>`;
  } else {
    const videos = result.videos || [];
    const rules = result.rules || [];
    const checkedCount = rules.filter(r => r.checked).length;
    const multi = videos.length > 1;

    // 角色图例
    const legend = `
      <div style="display:flex;flex-wrap:wrap;gap:7px;margin:0 0 12px">
        ${['hook','turn','point','example','cta'].map(role => {
          const m = LEARN_ROLE_META[role];
          return `<span style="font-size:11px;font-weight:600;color:${m.color};background:${m.bg};border-radius:6px;padding:2px 8px">${m.label}</span>`;
        }).join('')}
      </div>`;

    const videoCards = videos.map(v => _renderLearnVideo(v, multi)).join('');

    // 按维度分组展示，让规律读起来像一套从头到尾的复刻蓝图
    const DIM_ORDER = ['人设｜身份','选题｜主题','时长｜节奏','结构｜骨架','开头钩子','中段展开','转折反转','结尾收束','其他'];
    const dimKey = (d) => {
      const s = String(d || '其他');
      const hit = DIM_ORDER.find(k => s.indexOf(k) >= 0 || k.indexOf(s) >= 0 || k.replace(/[｜]/g,'').indexOf(s.replace(/[｜|]/g,'')) >= 0);
      return hit || s;
    };
    const ruleGroups = {};
    rules.forEach((item, idx) => {
      const g = dimKey(item.dim);
      (ruleGroups[g] = ruleGroups[g] || []).push({ item, idx });
    });
    const orderedGroups = [
      ...DIM_ORDER.filter(g => ruleGroups[g]),
      ...Object.keys(ruleGroups).filter(g => !DIM_ORDER.includes(g)),
    ];
    const renderRuleCard = ({ item, idx }) => `
      <div onclick="S.originalLearningResult.rules[${idx}].checked=!S.originalLearningResult.rules[${idx}].checked;render()"
           style="background:${item.checked?'#FFF8F3':'#FAF8F5'};border-radius:11px;padding:12px 13px;border:1.5px solid ${item.checked?'#F5602A':'transparent'};cursor:pointer;display:flex;align-items:flex-start;gap:10px;-webkit-tap-highlight-color:transparent">
        <div style="width:18px;height:18px;border-radius:5px;border:2px solid ${item.checked?'#F5602A':'#D8D2C9'};background:${item.checked?'#F5602A':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px">
          ${item.checked?'<svg width="10" height="8" viewBox="0 0 12 10" fill="none"><path d="M1 5l3.5 3.5L11 1" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>':''}
        </div>
        <div style="flex:1">
          <div style="font-size:13px;color:#1A1614;line-height:1.65">${esc(item.text)}</div>
          ${item.freq?`<div style="font-size:11px;color:#B0AA9F;margin-top:3px">${esc(item.freq)}</div>`:''}
        </div>
      </div>`;
    const rulesBlock = rules.length ? `
      <div style="background:#fff;border-radius:16px;padding:16px;margin-bottom:16px;border:1px solid #F0EDE8">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="font-size:13px;font-weight:700;color:#1A1614">可写入规律（${rules.length} 条）</div>
          <span style="font-size:12px;color:#B0AA9F">已选 ${checkedCount} 条</span>
        </div>
        <div style="font-size:11px;color:#B0AA9F;line-height:1.5;margin-bottom:12px">覆盖人设·选题·节奏·结构·开头·展开·反转·结尾，拿着这套规律换个选题即可复刻同质量内容</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          ${orderedGroups.map(g => `
            <div>
              <div style="font-size:11.5px;font-weight:700;color:#9E6B3A;margin-bottom:7px;display:flex;align-items:center;gap:6px">
                <span style="width:3px;height:12px;background:#F5602A;border-radius:2px"></span>${esc(g)}
              </div>
              <div style="display:flex;flex-direction:column;gap:8px">
                ${ruleGroups[g].map(renderRuleCard).join('')}
              </div>
            </div>`).join('')}
        </div>
      </div>
      <button type="button" ${(checkedCount===0||S.originalLearningWriting)?'disabled':''} onclick="writeOriginalLearning()"
              style="width:100%;padding:13px 0;border:none;border-radius:16px;background:${(checkedCount===0||S.originalLearningWriting)?'#E8E4DF':'linear-gradient(135deg,#FF8040,#F5602A)'};color:${(checkedCount===0||S.originalLearningWriting)?'#B0AA9F':'#fff'};font-size:15px;font-weight:700;cursor:${(checkedCount===0||S.originalLearningWriting)?'default':'pointer'};display:flex;align-items:center;justify-content:center;gap:8px">
        ${S.originalLearningWriting
          ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-dasharray="40 20"/></svg>AI 融合中，请稍候…`
          : (scope==='global'?`融合进 Skill（${checkedCount} 条）`:`用于本项目（${checkedCount} 条）`)}
      </button>` : '';

    resultBlock = `${legend}${videoCards}${rulesBlock}`;
  }

  return `<div style="background:#F7F5F1;min-height:100%;padding:14px 0 28px">
    <div style="padding:0 22px">${resultBlock}</div>
  </div>`;
}

// ── 智能选题渲染 ──────────────────────────────────────────
function _tOriginalTopics() {
  const topics = S.originalTopics || [];
  const loading = S.originalTopicsLoading;
  const STYLE_LABEL = { informative:'干货', story:'故事', contrast:'对比', twist:'反转' };
  const DUR_LABEL = { '30s':'30s', '1min':'1分钟', '3min':'3分钟' };
  const STYLE_COLOR = { informative:'#1D4ED8,#3B82F6', story:'#059669,#10B981', contrast:'#7C3AED,#A78BFA', twist:'#BE185D,#EC4899' };

  const header = `<div style="padding:0 22px 10px;display:flex;align-items:center;justify-content:space-between">
    <span style="font-size:15px;font-weight:700;color:#1A1614">智能选题</span>
    <button onclick="loadOriginalTopics()" ${loading?'disabled':''} style="display:flex;align-items:center;gap:4px;background:none;border:none;font-size:12px;color:${loading?'#C0B8B0':'#F5602A'};cursor:${loading?'default':'pointer'};font-weight:600;padding:0;-webkit-tap-highlight-color:transparent">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="${loading?'animation:spin 1s linear infinite':''}"><path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${loading ? '生成中…' : (topics.length ? '换一批' : '生成选题')}
    </button>
  </div>`;

  if (!topics.length && !loading) {
    return `<div style="margin-bottom:18px">
      ${header}
      <div style="margin:0 16px;background:#fff;border-radius:16px;padding:20px;border:1.5px dashed #E8E4DC;text-align:center">
        <div style="font-size:13px;color:#B0AA9F;line-height:1.7">根据你的 Skill 和学习记录<br>AI 帮你生成个性化选题</div>
        <button onclick="loadOriginalTopics()" style="margin-top:12px;padding:9px 28px;border:none;border-radius:24px;background:linear-gradient(135deg,#FF8040,#F5602A);color:#fff;font-size:14px;font-weight:700;cursor:pointer">生成选题 →</button>
      </div>
    </div>`;
  }

  if (loading) {
    return `<div style="margin-bottom:18px">
      ${header}
      <div style="margin:0 16px;display:flex;flex-direction:column;gap:10px">
        ${[1,2,3,4].map(()=>`<div style="background:#fff;border-radius:14px;padding:16px;height:72px;animation:pulse 1.5s ease-in-out infinite;background:linear-gradient(90deg,#F4F1EC 25%,#EDE9E3 50%,#F4F1EC 75%);background-size:200% 100%"></div>`).join('')}
      </div>
    </div>`;
  }

  const cards = topics.map((t, i) => {
    const [c1, c2] = (STYLE_COLOR[t.style] || '2563EB,3B82F6').split(',');
    return `<div onclick="pickOriginalTopic(${i})" style="background:#fff;border-radius:14px;padding:14px 16px;cursor:pointer;-webkit-tap-highlight-color:transparent;active:background:#FFF8F2;border:1px solid #F0EDE8">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#${c1},#${c2});display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;color:#1A1614;line-height:1.5;margin-bottom:4px">${esc(t.title)}</div>
          <div style="font-size:12px;color:#9E9890;line-height:1.5;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(t.angle)}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:10px">
        <span style="font-size:11px;background:linear-gradient(135deg,#${c1}18,#${c2}18);color:#${c1};border-radius:6px;padding:2px 8px;font-weight:600">${STYLE_LABEL[t.style]||t.style}</span>
        <span style="font-size:11px;background:#F4F1EC;color:#9E9890;border-radius:6px;padding:2px 8px">${DUR_LABEL[t.duration]||t.duration}</span>
        <span style="font-size:11px;color:#B0AA9F;margin-left:auto">${esc(t.reason||'')}</span>
        <span style="font-size:12px;color:#F5602A;font-weight:600;flex-shrink:0">选 →</span>
      </div>
    </div>`;
  }).join('');

  return `<div style="margin-bottom:18px">
    ${header}
    <div style="margin:0 16px;display:flex;flex-direction:column;gap:10px">${cards}</div>
  </div>`;
}

async function loadOriginalTopics() {
  if (S.originalTopicsLoading) return;
  setState({ originalTopicsLoading: true });
  render();
  try {
    const r = await api.post('/original/suggest-topics', {});
    if (r.code === 200) {
      setState({ originalTopics: r.data, originalTopicsLoading: false });
    } else {
      setState({ originalTopicsLoading: false });
      showToast(r.msg || '选题生成失败');
    }
  } catch { setState({ originalTopicsLoading: false }); showToast('网络错误'); }
  render();
}

function pickOriginalTopic(idx) {
  const t = (S.originalTopics || [])[idx];
  if (!t) return;
  setState({
    originalView: 'new',
    originalNewTitle: t.title,
    originalNewBrief: t.angle || '',
    originalNewDuration: t.duration || '1min',
    originalNewStyle: t.style || 'informative',
    originalNewPlatform: 'douyin',
  });
  render();
}

function tOriginalNew() {
  const skill = S.originalSkill;
  const loading = S.originalLoading;
  const ver = (skill && skill.version) ? skill.version : 'v1.0';
  const ruleCount = skill ? Object.values(skill.rules || {}).flat().length + (skill.freeText ? 1 : 0) : 0;
  const title = S.originalNewTitle || '';
  const brief = S.originalNewBrief || '';
  const dur = S.originalNewDuration || '1min';
  const style = S.originalNewStyle || 'informative';
  const platform = S.originalNewPlatform || 'douyin';
  const canCreate = !!title.trim() && !loading;

  // 分段选择器
  const seg3 = (opts, val, stateKey) => `
    <div style="display:flex;background:#F4F1EC;border-radius:10px;padding:3px;gap:2px">
      ${opts.map(([v,label]) => `<button onclick="setState({${stateKey}:'${v}'});render()" style="flex:1;padding:7px 0;border:none;border-radius:7px;font-size:12.5px;font-weight:${val===v?700:500};background:${val===v?'#fff':'transparent'};color:${val===v?'#1A1614':'#9E9890'};cursor:pointer;box-shadow:${val===v?'0 1px 4px rgba(0,0,0,0.1)':'none'};transition:all .15s;-webkit-tap-highlight-color:transparent">${label}</button>`).join('')}
    </div>`;

  return `<div style="background:#F7F5F1;min-height:100%;padding:0 0 32px">
    <!-- 标题 -->
    <div style="background:#fff;border-radius:20px;box-shadow:0 4px 16px rgba(0,0,0,0.05);margin:0 16px 12px;padding:16px">
      <div style="font-size:12px;color:#9E9890;margin-bottom:8px">视频主题（这条视频在讲什么）</div>
      <input type="text" id="orig-new-title" oninput="S.originalNewTitle=this.value;_origNewUnderline()"
        value="${esc(title)}" placeholder="例如：我用3天做了个AI工具"
        style="width:100%;border:none;outline:none;font-size:15.5px;font-weight:600;color:#1A1614;background:transparent;font-family:inherit;padding:4px 0;box-sizing:border-box" />
      <div id="orig-new-title-line" style="height:2px;background:${title?'#F5602A':'#F0EDE8'};margin-top:8px;border-radius:1px;transition:background .2s"></div>
    </div>
    <!-- 核心观点 -->
    <div style="background:#fff;border-radius:20px;box-shadow:0 4px 16px rgba(0,0,0,0.05);margin:0 16px 12px;padding:16px">
      <div style="font-size:12px;color:#9E9890;margin-bottom:8px">选题角度 / 核心观点（可选）</div>
      <textarea id="orig-new-brief" oninput="S.originalNewBrief=this.value;_origNewUnderline()"
        placeholder="例如：普通人也能用 AI 把 40% 的重复运营工作自动化…"
        style="width:100%;border:none;outline:none;font-size:14px;color:#1A1614;background:transparent;font-family:inherit;resize:none;height:58px;line-height:1.65;box-sizing:border-box">${esc(brief)}</textarea>
      <div id="orig-new-brief-line" style="height:2px;background:${brief?'#F5602A':'#F0EDE8'};margin-top:6px;border-radius:1px;transition:background .2s"></div>
    </div>
    <!-- 目标时长 -->
    <div style="background:#fff;border-radius:20px;box-shadow:0 4px 16px rgba(0,0,0,0.05);margin:0 16px 12px;padding:16px">
      <div style="font-size:12px;color:#9E9890;margin-bottom:10px">目标时长</div>
      ${seg3([['30s','30 秒'],['1min','1 分钟'],['3min','3 分钟']], dur, 'originalNewDuration')}
    </div>
    <!-- 视频风格 -->
    <div style="background:#fff;border-radius:20px;box-shadow:0 4px 16px rgba(0,0,0,0.05);margin:0 16px 12px;padding:16px">
      <div style="font-size:12px;color:#9E9890;margin-bottom:10px">视频风格</div>
      ${seg3([['informative','干货'],['story','故事'],['contrast','对比'],['twist','反转']], style, 'originalNewStyle')}
    </div>
    <!-- 目标平台 -->
    <div style="background:#fff;border-radius:20px;box-shadow:0 4px 16px rgba(0,0,0,0.05);margin:0 16px 12px;padding:16px">
      <div style="font-size:12px;color:#9E9890;margin-bottom:10px">目标平台</div>
      ${seg3([['douyin','抖音'],['shipinhao','视频号'],['xiaohongshu','小红书']], platform, 'originalNewPlatform')}
    </div>
    <!-- 创作模式 -->
    <div style="background:#fff;border-radius:20px;box-shadow:0 4px 16px rgba(0,0,0,0.05);margin:0 16px 16px;padding:16px">
      <div style="font-size:12px;color:#9E9890;margin-bottom:10px">创作模式</div>
      <div style="display:flex;gap:10px">
        ${[['true','分步打磨','方向→粗纲→细纲→剧本，逐步确认'],['false','直接成稿','一次对话直接出完整口播']].map(([v,t,d])=>{
          const on = String(S.originalNewStaged !== false) === v;
          return `<div onclick="setState({originalNewStaged:${v}});render()" style="flex:1;padding:12px;border:1.5px solid ${on?'#F5602A':'#EDE9E3'};background:${on?'#FFF7F2':'#fff'};border-radius:13px;cursor:pointer">
            <div style="font-size:13.5px;font-weight:700;color:${on?'#F5602A':'#1A1614'};display:flex;align-items:center;gap:5px">${on?'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F5602A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>':''}${t}</div>
            <div style="font-size:11px;color:#9E9890;margin-top:4px;line-height:1.45">${d}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
    ${skill ? `
      <div style="background:#fff;border-radius:20px;box-shadow:0 4px 16px rgba(0,0,0,0.05);margin:0 16px 20px;padding:13px 16px;display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#FFF0E6,#FFD9C0);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F5602A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:#1A1614">自动加载 Skill ${esc(ver)}</div>
          <div style="font-size:11px;color:#9E9890;margin-top:1px">${ruleCount > 0 ? `${ruleCount} 条规则已就绪` : '无规则，纯对话创作'}</div>
        </div>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>` : '<div style="height:10px"></div>'}
    <button type="button" id="orig-new-btn" ${canCreate?'':'disabled'} onclick="createOriginalProject()"
            style="width:calc(100% - 32px);margin:0 16px;padding:15px 0;border:none;border-radius:16px;background:${canCreate?'linear-gradient(135deg,#FF8040,#F5602A)':'#E8E4DF'};color:${canCreate?'#fff':'#B0AA9F'};font-size:16px;font-weight:700;cursor:${canCreate?'pointer':'default'}">
      ${loading ? '创建中…' : '开始创作 →'}
    </button>
  </div>`;
}

function _origNewUnderline() {
  const t = (S.originalNewTitle || '').trim();
  const b = (S.originalNewBrief || '').trim();
  const tl = document.getElementById('orig-new-title-line');
  const bl = document.getElementById('orig-new-brief-line');
  const btn = document.getElementById('orig-new-btn');
  if (tl) tl.style.background = t ? '#F5602A' : '#F0EDE8';
  if (bl) bl.style.background = b ? '#F5602A' : '#F0EDE8';
  if (btn) {
    const ok = !!t;
    btn.disabled = !ok;
    btn.style.background = ok ? 'linear-gradient(135deg,#FF8040,#F5602A)' : '#E8E4DF';
    btn.style.color = ok ? '#fff' : '#B0AA9F';
    btn.style.cursor = ok ? 'pointer' : 'default';
  }
}
