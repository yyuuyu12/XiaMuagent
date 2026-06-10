async function enterOriginal() {
  if (!getToken()) { setState({ showAuthSheet: true }); render(); return; }
  setState({ currentTab: 'original', originalView: 'home', originalLoading: true });
  render();
  try {
    const [rSkill, rProj, rPending] = await Promise.all([
      api.get('/original/skill'),
      api.get('/original/projects'),
      api.get('/original/skill/pending'),
    ]);
    setState({
      originalSkill: rSkill.code === 200 ? rSkill.data : null,
      originalProjects: rProj.code === 200 ? rProj.data : [],
      originalPending: rPending.code === 200 ? (rPending.data || []) : [],
      originalLoading: false,
    });
  } catch { setState({ originalLoading: false }); }
  render();
}

function tOriginal() {
  const v = S.originalView;
  if (v === 'skill')     return tOriginalSkill();
  if (v === 'learning')  return tOriginalLearning();
  if (v === 'materials') return tOriginalMaterials();
  if (v === 'extract')   return tOriginalExtract();
  if (v === 'new')       return tOriginalNew();
  if (v === 'chat')      return tOriginalChat();
  return tOriginalHome();
}

// 待确认规则来源标签
function _pendingSourceLabel(sourceType) {
  if (sourceType === 'diff') return '来自你的定稿修改';
  if (sourceType === 'feedback') return '来自对话反馈';
  return '来自自动学习';
}

// 顶部"学习提议"卡片：展示 AI 待确认学到的写法，逐条采纳/忽略
function _tOriginalPendingCard() {
  const pending = S.originalPending || [];
  if (!pending.length) return '';
  const open = S.originalPendingOpen;
  const header = `<div onclick="setState({originalPendingOpen:${!open}});render()" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:18px">✨</span>
      <span style="font-size:14px;font-weight:700;color:#92400E">我从你的反馈/修改中学到了 ${pending.length} 条新写法</span>
    </div>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${open?90:0}deg);transition:transform .2s">
      <polyline points="9 18 15 12 9 6"/></svg>
  </div>`;
  const items = open ? pending.map(p => `
    <div style="background:#fff;border:1px solid #FDE68A;border-radius:12px;padding:12px 13px;margin-top:10px">
      <div style="font-size:13.5px;color:#1A1614;line-height:1.5">${esc(p.text || '')}</div>
      <div style="font-size:11px;color:#B45309;margin-top:6px">${esc(_pendingSourceLabel(p.sourceType))}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button onclick="confirmPendingRule(${p.idx})" style="flex:1;background:#F5602A;color:#fff;border:none;border-radius:9px;padding:8px 0;font-size:13px;font-weight:600;cursor:pointer">采纳</button>
        <button onclick="dismissPendingRule(${p.idx})" style="flex:1;background:#fff;color:#9E9890;border:1px solid #E5E0D8;border-radius:9px;padding:8px 0;font-size:13px;font-weight:600;cursor:pointer">忽略</button>
      </div>
    </div>`).join('') : '';
  return `<div style="margin:0 16px 14px;background:linear-gradient(135deg,#FFFBEB,#FEF3C7);border:1px solid #FCD34D;border-radius:18px;padding:14px 16px">
    ${header}
    ${items}
  </div>`;
}

// 采纳一条待确认规则 → 移入「自动学习」分组，刷新 skill + pending
async function confirmPendingRule(idx) {
  try {
    const r = await api.post('/original/skill/pending/' + idx + '/confirm', {});
    if (r.code === 200) {
      const rPending = await api.get('/original/skill/pending');
      setState({
        originalSkill: r.data || S.originalSkill,
        originalPending: rPending.code === 200 ? (rPending.data || []) : [],
      });
      showToast('已采纳，纳入你的 Skill');
    } else {
      showToast(r.msg || '操作失败');
    }
  } catch { showToast('网络错误'); }
  render();
}

// 忽略一条待确认规则 → 删除
async function dismissPendingRule(idx) {
  try {
    const r = await api.post('/original/skill/pending/' + idx + '/dismiss', {});
    if (r.code === 200) {
      const rPending = await api.get('/original/skill/pending');
      setState({ originalPending: rPending.code === 200 ? (rPending.data || []) : [] });
      showToast('已忽略');
    } else {
      showToast(r.msg || '操作失败');
    }
  } catch { showToast('网络错误'); }
  render();
}

// 整理自动学习记录（compact free_text）
async function compactOriginalSkill() {
  if (S.originalCompacting) return;
  setState({ originalCompacting: true });
  render();
  try {
    const r = await api.post('/original/skill/compact', {});
    if (r.code === 200) {
      const rSkill = await api.get('/original/skill');
      setState({
        originalSkill: rSkill.code === 200 ? rSkill.data : S.originalSkill,
        originalSkillFreeTextDraft: null,
        originalCompacting: false,
      });
      showToast(r.msg || '整理完成');
    } else {
      setState({ originalCompacting: false });
      showToast(r.msg || '整理失败');
    }
  } catch { setState({ originalCompacting: false }); showToast('网络错误'); }
  render();
}

function tOriginalHome() {
  const skill = S.originalSkill;
  const projects = S.originalProjects || [];
  const ver = (skill && skill.version) ? skill.version : 'v1.0';
  const ruleCount = skill ? Object.values(skill.rules||{}).reduce((n,arr)=>n+(arr||[]).length, 0) : 0;
  const kwCount = skill ? (skill.keywords||[]).length : 0;
  const fbCount = skill ? (skill.forbidden||[]).length : 0;

  let lastNote = '开始对话或学习，逐步沉淀你的专属规律';
  if (skill && ruleCount > 0) {
    const allRules = Object.values(skill.rules||{}).flat();
    const last = allRules[allRules.length - 1];
    if (last && last.text) lastNote = `最近更新：${esc(last.source || '同步')} · 「${esc(last.text.slice(0,12))}${last.text.length>12?'…':''}」`;
  }

  const stat = (n, label) => `<div style="font-size:12px;color:rgba(255,255,255,0.75);display:flex;align-items:center;gap:5px"><div style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.5)"></div>${n} ${label}</div>`;

  const projectCards = projects.map(p => {
    const isFinal = p.status === 'final';
    return `<div class="card" onclick="openOriginalProject(${p.id})" style="padding:15px 16px;cursor:pointer;-webkit-tap-highlight-color:transparent">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:38px;height:38px;border-radius:11px;background:${isFinal?'#F0FDF4':'#FFF3E8'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${isFinal?'#059669':'#F5602A'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:600;color:#1A1614;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.title)}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
            <span style="font-size:11px;color:#B0AA9F">${formatRelTime(p.updated_at)}</span>
            <span style="font-size:11px;color:#B0AA9F">· ${p.turns||0} 轮</span>
          </div>
        </div>
        <span style="flex-shrink:0;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:${isFinal?'#F0FDF4':'#FFF3E8'};color:${isFinal?'#059669':'#F5602A'}">${isFinal?'已定稿':'草稿'}</span>
      </div>
    </div>`;
  }).join('');

  return `<div style="background:#F7F5F1;min-height:100%;padding:14px 0 24px">
    ${_tOriginalPendingCard()}
    <!-- Skill 卡（品牌橙） -->
    <div onclick="setState({originalView:'skill',originalSkillFreeTextDraft:null,originalSkillHistoryOpen:false});render()" style="margin:0 16px 14px;background:linear-gradient(135deg,#FF7A35,#F5602A);border-radius:22px;padding:18px 20px;cursor:pointer;position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent;box-shadow:0 8px 28px rgba(245,96,42,0.28)">
      <div style="position:absolute;top:-30px;right:-20px;width:130px;height:130px;border-radius:50%;background:rgba(255,255,255,0.08)"></div>
      <div style="position:absolute;bottom:-20px;left:60px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.05)"></div>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;position:relative">
        <div>
          <div style="font-size:10.5px;color:rgba(255,255,255,0.6);letter-spacing:0.5px;margin-bottom:5px">全局唯一 · 蒸馏的你自己</div>
          <div style="font-size:18px;font-weight:700;color:#fff">我的 Skill</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;font-weight:700;color:#fff;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.35);padding:3px 9px;border-radius:8px">${esc(ver)}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
      <div style="display:flex;gap:14px;margin-bottom:12px;position:relative">
        ${stat(ruleCount,'条规则')}${stat(kwCount,'个高频词')}${stat(fbCount,'条禁区')}
      </div>
      <div style="border-top:1px solid rgba(255,255,255,0.15);padding-top:11px;font-size:11.5px;color:rgba(255,255,255,0.55);position:relative">${lastNote}</div>
    </div>

    <!-- 素材库 + 学习中心 双入口 -->
    <div style="margin:0 16px 18px;display:flex;gap:10px">
      <div onclick="setState({originalView:'materials'});loadMaterials();render()" style="flex:1;background:#FAF7F3;border:1.5px dashed #E8D8C4;border-radius:16px;padding:13px 12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;-webkit-tap-highlight-color:transparent">
        <div style="width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#EEF2FF,#C7D2FE);display:flex;align-items:center;justify-content:center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
        </div>
        <div style="text-align:center">
          <div style="font-size:13px;font-weight:700;color:#1A1614">素材库</div>
          <div style="font-size:11px;color:#9E9890;margin-top:2px">存竞品原文</div>
        </div>
      </div>
      <div onclick="setState({originalView:'learning',originalLearningResult:null,originalMaterialsSelected:[],originalLearningPhase:'input'});loadMaterials();render()" style="flex:1;background:#FAF7F3;border:1.5px dashed #E8D8C4;border-radius:16px;padding:13px 12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;-webkit-tap-highlight-color:transparent">
        <div style="width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#FFF0E6,#FFD9C0);display:flex;align-items:center;justify-content:center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#F5602A"><path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2z"/></svg>
        </div>
        <div style="text-align:center">
          <div style="font-size:13px;font-weight:700;color:#1A1614">学习中心</div>
          <div style="font-size:11px;color:#9E9890;margin-top:2px">选素材·学规律</div>
        </div>
      </div>
    </div>

    <!-- 智能选题 -->
    ${_tOriginalTopics()}

    <!-- 我的项目 -->
    <div style="padding:0 22px 12px;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:17px;font-weight:700;color:#1A1614;letter-spacing:-0.3px">我的项目</span>
      <span style="font-size:13px;color:#9E9890">${projects.length} 个</span>
    </div>
    <div style="padding:0 16px;display:flex;flex-direction:column;gap:10px">
      <div onclick="setState({originalView:'new',originalNewTitle:'',originalNewBrief:'',originalNewDuration:'1min',originalNewStyle:'informative',originalNewPlatform:'douyin'});render()" style="border:1.5px dashed #D8D2C9;border-radius:14px;padding:14px 18px;cursor:pointer;display:flex;align-items:center;gap:10px;-webkit-tap-highlight-color:transparent">
        <div style="width:32px;height:32px;border-radius:10px;background:#FFF3E8;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F5602A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </div>
        <span style="font-size:14px;font-weight:600;color:#F5602A">新建项目</span>
      </div>
      ${S.originalLoading
        ? `<div style="text-align:center;padding:24px 0;color:#B0AA9F;font-size:14px">加载中…</div>`
        : projectCards}
    </div>
  </div>`;
}

function tOriginalSkill() {
  const skill = S.originalSkill;
  if (!skill) return `<div style="background:#FAF9F6;min-height:100%;padding:40px 16px;text-align:center;color:#B0AA9F;font-size:14px">暂无数据</div>`;

  const saving = S.originalSkillSaving;
  const historyOpen = S.originalSkillHistoryOpen;
  const history = skill.freeTextHistory || [];

  // 草稿：null 表示未初始化，自动从 freeText 填充
  const draft = S.originalSkillFreeTextDraft !== null ? S.originalSkillFreeTextDraft : (skill.freeText || '');

  // 历史记录底部弹窗
  const historySheet = historyOpen ? `
    <div onclick="if(event.target===this)setState({originalSkillHistoryOpen:false});render()" style="position:fixed;inset:0;z-index:9200;background:rgba(26,22,20,0.5);display:flex;align-items:flex-end;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)">
      <div style="background:#fff;border-radius:22px 22px 0 0;width:100%;max-height:75vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 -4px 24px rgba(0,0,0,0.14)">
        <div style="padding:18px 20px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #F0EDE8;flex-shrink:0">
          <span style="font-size:15px;font-weight:700;color:#1A1614">历史记录</span>
          <button onclick="setState({originalSkillHistoryOpen:false});render()" style="background:none;border:none;color:#B0AA9F;font-size:22px;cursor:pointer;line-height:1;padding:0 4px">×</button>
        </div>
        <div style="overflow-y:auto;flex:1;padding:12px 0 24px">
          ${history.length === 0
            ? `<div style="padding:32px;text-align:center;color:#B0AA9F;font-size:14px">暂无历史记录<br><span style="font-size:12px">每次保存前的内容会自动存档</span></div>`
            : history.map((h, i) => {
                const preview = (h.text || '').replace(/\n/g, ' ').slice(0, 60);
                const d = new Date(h.savedAt);
                const label = `${d.getMonth()+1}月${d.getDate()}日 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                return `<div onclick="_skillRestoreHistory(${i})" style="padding:12px 20px;cursor:pointer;border-bottom:1px solid #F8F5F0;-webkit-tap-highlight-color:transparent;active:background:#FFF8F2">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                    <span style="font-size:13px;font-weight:600;color:#1A1614">${label}</span>
                    <span style="font-size:12px;color:#F5602A;font-weight:600">还原</span>
                  </div>
                  <div style="font-size:12px;color:#9E9890;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(preview) || '（空）'}</div>
                </div>`;
              }).join('')}
        </div>
      </div>
    </div>` : '';

  const compacting = S.originalCompacting;
  return `<div style="background:#FAF9F6;min-height:100%;padding:8px 0 32px">
    <div style="padding:0 16px 6px;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div style="font-size:12px;color:#B0AA9F;line-height:1.6;flex:1">Markdown / 纯文本，AI 创作时优先读取。</div>
      <button onclick="compactOriginalSkill()" ${compacting?'disabled':''} style="flex-shrink:0;background:#FFF3E8;color:${compacting?'#C9A98C':'#F5602A'};border:1px solid #FBD9BE;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:600;cursor:${compacting?'default':'pointer'};-webkit-tap-highlight-color:transparent;white-space:nowrap">
        ${compacting ? '整理中…' : '整理自动学习记录'}
      </button>
    </div>
    <div style="padding:0 16px 80px">
      <textarea id="_skill_free_ta"
        oninput="setState({originalSkillFreeTextDraft:this.value})"
        style="width:100%;min-height:calc(100vh - 200px);border:1.5px solid #EDE9E3;border-radius:16px;padding:16px;font-size:14px;color:#1A1614;line-height:1.85;font-family:inherit;resize:none;box-sizing:border-box;outline:none;background:#fff"
        placeholder="自由写，支持 Markdown 格式：

## 人设
我是一个…

## 开场钩子
- 用数字+反差做开头
- 前3秒必须抓住用户

## 内容结构
…

## 禁忌
- 不讲技术原理

## 验收标准
…">${esc(draft)}</textarea>
    </div>

    <!-- 底部固定保存栏 -->
    <div style="position:fixed;bottom:0;left:0;right:0;padding:10px 16px 24px;background:linear-gradient(to top,#FAF9F6 80%,rgba(250,249,246,0));pointer-events:none;z-index:100;display:flex;justify-content:center">
      <button onclick="_skillSaveFreeText()" ${saving?'disabled':''} style="pointer-events:all;padding:12px 48px;border:none;border-radius:50px;background:${saving?'#E8E4DF':'linear-gradient(135deg,#FF8040,#F5602A)'};color:${saving?'#B0AA9F':'#fff'};font-size:15px;font-weight:700;cursor:${saving?'default':'pointer'};letter-spacing:0.5px;box-shadow:0 4px 16px rgba(245,96,42,0.25);min-width:140px">
        ${saving ? '保存中…' : '保存'}
      </button>
    </div>

    ${historySheet}
  </div>`;
}

// ── 对话内快速记 Skill ──────────────────────────────────────────
function _openSkillQuick() {
  setState({ originalSkillQuickModal: { text: '', saving: false } });
  render();
  setTimeout(() => { const ta = document.getElementById('_skill_quick_ta'); if (ta) ta.focus(); }, 60);
}

async function _skillQuickSave() {
  const modal = S.originalSkillQuickModal;
  if (!modal || modal.saving) return;
  const text = (modal.text || '').trim();
  if (!text) { showToast('请输入规则内容'); return; }

  setState({ originalSkillQuickModal: { ...modal, saving: true } });
  render();

  try {
    // 把新内容追加到 freeText 末尾
    const skill = S.originalSkill;
    const existing = (skill && skill.freeText) || '';
    const separator = existing.trim() ? '\n\n' : '';
    const newFreeText = existing + separator + text;

    const r = await api.put('/original/skill', { freeText: newFreeText });
    if (r.code === 200) {
      setState({
        originalSkill: r.data,
        originalSkillQuickModal: null,
        originalSkillFreeTextDraft: null, // 重置草稿，下次进 Skill 页会重新读
      });
      showToast('已记入 Skill ✓');
    } else {
      setState({ originalSkillQuickModal: { ...modal, saving: false } });
      showToast(r.msg || '保存失败');
    }
  } catch {
    setState({ originalSkillQuickModal: { ...modal, saving: false } });
    showToast('网络错误');
  }
  render();
}

// ── Skill 自由编辑辅助函数 ──────────────────────────────────────────
async function _skillSaveFreeText() {
  const ta = document.getElementById('_skill_free_ta');
  const text = ta ? ta.value : (S.originalSkillFreeTextDraft || '');
  setState({ originalSkillSaving: true });
  render();
  try {
    const r = await api.put('/original/skill', { freeText: text });
    if (r.code === 200) {
      setState({ originalSkill: r.data, originalSkillSaving: false, originalSkillFreeTextDraft: text });
      showToast('已保存 ✓');
    } else {
      setState({ originalSkillSaving: false });
      showToast(r.msg || '保存失败');
    }
  } catch { setState({ originalSkillSaving: false }); showToast('网络错误'); }
  render();
}

function _skillOpenHistory() {
  setState({ originalSkillHistoryOpen: true });
  render();
}

function _skillRestoreHistory(idx) {
  const history = (S.originalSkill && S.originalSkill.freeTextHistory) || [];
  const entry = history[idx];
  if (!entry) return;
  setState({ originalSkillFreeTextDraft: entry.text, originalSkillHistoryOpen: false });
  render();
  showToast('已还原，记得点保存');
  setTimeout(() => { const ta = document.getElementById('_skill_free_ta'); if (ta) ta.focus(); }, 80);
}

// 逐句标注的角色配色
const LEARN_ROLE_META = {
  hook:       { label: '钩子', color: '#C2410C', bg: '#FFEAD9' },
  turn:       { label: '转折', color: '#BE185D', bg: '#FCE7F3' },
  point:      { label: '观点', color: '#1D4ED8', bg: '#E0EBFF' },
  example:    { label: '举例', color: '#0E7490', bg: '#D9F4F8' },
  cta:        { label: '引导', color: '#15803D', bg: '#DCFCE7' },
  background: { label: '铺垫', color: '#92744A', bg: '#F2ECE0' },
  normal:     { label: '过渡', color: '#6E6860', bg: 'transparent' },
};

// 渲染单条视频的「掰碎式」拆解卡
function _renderLearnVideo(v, showHeader) {
  const meta = (role) => LEARN_ROLE_META[role] || LEARN_ROLE_META.normal;
  const segs = v.segments || [];

  // 原文逐句高亮（关键句染色，过渡句保留原样）
  const annotated = segs.map(s => {
    const m = meta(s.role);
    if (s.role === 'normal' || s.role === 'background' || !s.role) return esc(s.text);
    return `<span style="background:${m.bg};color:${m.color};border-radius:4px;padding:1px 4px;font-weight:600">${esc(s.text)}</span>`;
  }).join('');

  // 逐句批注（只列有 note 的关键句）
  const noteItems = segs.filter(s => s.note && s.note.trim());
  const notesHtml = noteItems.length ? `
    <div style="margin-top:14px;display:flex;flex-direction:column;gap:10px">
      ${noteItems.map(s => {
        const m = meta(s.role);
        const quote = s.text.length > 40 ? s.text.slice(0, 40) + '…' : s.text;
        return `<div style="display:flex;gap:9px;align-items:flex-start">
          <span style="flex-shrink:0;font-size:11px;font-weight:700;color:${m.color};background:${m.bg==='transparent'?'#F2EFEA':m.bg};border-radius:6px;padding:2px 7px;margin-top:1px">${m.label}</span>
          <div style="flex:1">
            <div style="font-size:12px;color:#9E9890;line-height:1.5;margin-bottom:2px">"${esc(quote)}"</div>
            <div style="font-size:13px;color:#2A241E;line-height:1.6">${esc(s.note)}</div>
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  const header = showHeader ? `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <span style="font-size:13.5px;font-weight:700;color:#1A1614;flex:1;line-height:1.4">${esc(v.desc || '未命名视频')}</span>
      <span style="font-size:11px;color:#B0AA9F;flex-shrink:0">赞${v.likes||0}·约${v.estSec||'?'}秒</span>
    </div>` : '';

  return `
    <div style="background:#fff;border-radius:16px;padding:16px;margin-bottom:12px;border:1px solid #F0EDE8">
      ${header}
      ${v.summary ? `<div style="background:linear-gradient(135deg,#FFF3E8,#FDE8D4);border:1px solid #F8C8A0;border-radius:12px;padding:11px 13px;margin-bottom:12px">
        <div style="font-size:11px;color:#C2410C;font-weight:700;margin-bottom:3px;letter-spacing:.3px">💡 套路一句话</div>
        <div style="font-size:13.5px;color:#1A1614;line-height:1.55;font-weight:500">${esc(v.summary)}</div>
      </div>` : ''}
      ${(v.persona || v.topic || v.rhythm && v.rhythm !== '—' || v.structure) ? `
      <div style="background:#FBF6EF;border:1px solid #F0E6D8;border-radius:12px;padding:13px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:#9E6B3A;margin-bottom:9px;letter-spacing:.5px">复刻蓝图 · 反推还原</div>
        ${[
          ['人设', v.persona],
          ['选题主题', v.topic],
          ['时长节奏', v.rhythm && v.rhythm !== '—' ? v.rhythm : ''],
          ['结构骨架', v.structure],
        ].filter(([,val]) => val && val.trim()).map(([label, val]) => `
          <div style="display:flex;gap:9px;align-items:flex-start;margin-bottom:8px">
            <span style="flex-shrink:0;font-size:11px;font-weight:700;color:#9E6B3A;background:#F3E7D6;border-radius:6px;padding:2px 7px;margin-top:1px">${label}</span>
            <div style="flex:1;font-size:13px;color:#2A241E;line-height:1.65">${esc(val)}</div>
          </div>`).join('')}
      </div>` : ''}
      <div style="font-size:11.5px;font-weight:700;color:#9E6B3A;margin-bottom:7px">原文逐句拆解</div>
      <div style="background:#FAF8F5;border-radius:10px;padding:13px;font-size:14px;color:#2A241E;line-height:2.1">${annotated || '—'}</div>
      ${notesHtml}
    </div>`;
}

/* ─── 素材库列表 ─── */