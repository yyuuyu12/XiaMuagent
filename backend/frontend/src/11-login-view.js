function tLogin() {
  return `<div class="login-page">
    <div class="logo-area">
      <div class="logo-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="#FF6B35"><path d="M12 2C10 5.5 8 7.5 8 10.5c0 1 .25 2 .75 2.8C7.5 12.1 7 10.5 7 9c-2 2.5-3 4.5-3 6.5A8 8 0 0 0 20 15c0-2-.75-3.7-2-5 0 0-.4 1.2-1.5 1.7C17 10.2 16.5 7 12 2z"/></svg></div>
      <span class="logo-title">爆款文案工坊</span>
      <span class="logo-sub">AI驱动 · 一键生成爆款内容</span>
    </div>
    <div class="form-card">
      <div class="mode-switch">
        <div class="mode-btn ${S.authMode==='sms'?'mode-active':''}" onclick="setAuthMode('sms')">验证码登录</div>
        <div class="mode-btn ${S.authMode==='pwd'?'mode-active':''}" onclick="setAuthMode('pwd')">密码登录</div>
      </div>
      <div class="field-group">
        <span class="field-label">手机号</span>
        <div class="input-wrap">
          <span class="input-prefix">+86</span>
          <input id="f-phone" class="lf-input" type="tel" maxlength="11" placeholder="请输入手机号"
            value="${esc(S.phone)}" oninput="S.phone=this.value"/>
        </div>
      </div>
      ${S.authMode==='sms'?`
      <div class="field-group">
        <span class="field-label">验证码</span>
        <div class="input-wrap">
          <input id="smsCodeInput" class="lf-input" type="tel" maxlength="6" placeholder="6位验证码" inputmode="numeric" pattern="[0-9]*"
            value="${esc(S.smsCode)}" oninput="S.smsCode=this.value" onkeydown="if(event.key==='Enter')handleSmsLogin()" style="flex:1"/>
          <div class="sms-send-btn ${S.smsCountdown>0||S.loading?'sms-send-disabled':''}" onclick="handleSendSms()">
            ${S.smsCountdown>0?`${S.smsCountdown}s后重发`:S.smsSent?'重新发送':'获取验证码'}
          </div>
        </div>
      </div>
      ${S.authErr?`<span class="err-msg">${esc(S.authErr)}</span>`:''}
      <div class="submit-btn ${S.loading?'submit-disabled':''}" onclick="handleSmsLogin()">
        ${S.loading?'请稍候...':'登录 / 注册'}
      </div>
      `:`
      <div class="field-group">
        <span class="field-label">密码</span>
        <input id="f-pwd" class="lf-input" type="password" placeholder="请输入密码"
          value="${esc(S.password)}" oninput="S.password=this.value" onkeydown="if(event.key==='Enter')handleAuth()"/>
      </div>
      ${S.authErr?`<span class="err-msg">${esc(S.authErr)}</span>`:''}
      <div class="submit-btn ${S.loading?'submit-disabled':''}" onclick="handleAuth()">
        ${S.loading?'请稍候...':'登录'}
      </div>
      `}
    </div>
    <div class="footer-tip"><span class="footer-text">登录即表示同意用户协议和隐私政策</span></div>
  </div>`;
}

// ===== 授权码底部弹层 =====
function tAuthCodeSheet() {
  const u = S.userInfo;
  const activated = u && u.auth_expires_at;
  return `<div class="auth-sheet-mask" onclick="setState({showAuthCodeSheet:false});render()">
    <div class="auth-sheet" onclick="event.stopPropagation()">
      <div class="auth-sheet-handle" onclick="setState({showAuthCodeSheet:false});render()"></div>
      <div class="auth-sheet-head">
        <span class="auth-sheet-title">填写授权码</span>
        <span class="auth-sheet-close" onclick="setState({showAuthCodeSheet:false});render()">✕</span>
      </div>
      ${activated ? `
        <div style="text-align:center;padding:24px 0 32px">
          <div style="width:52px;height:52px;background:#EDFAF4;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div style="font-size:16px;font-weight:700;color:#1A1814;margin-bottom:6px">已激活</div>
          <div style="font-size:13px;color:#6B6860">有效期至 ${esc(u.auth_expires_at)}</div>
          <div style="font-size:13px;color:#6B6860;margin-top:4px">每日可用 ${u.daily_limit} 次</div>
        </div>
      ` : `
        <div class="auth-sheet-scroll" style="padding-bottom:32px">
          <span class="auth-sheet-sub">输入授权码后可解锁更多每日使用次数</span>
          <div class="field-group" style="margin-top:16px">
            <div class="input-wrap">
              <input class="lf-input" type="text" placeholder="请输入授权码（字母+数字）" style="padding-left:14px;text-transform:uppercase"
                value="${esc(S.authCodeInput)}" oninput="S.authCodeInput=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')handleActivateCode()"/>
            </div>
          </div>
          ${S.authCodeMsg?`<span class="err-msg ${S.authCodeOk?'':'err-msg'}" style="${S.authCodeOk?'color:#10B981;background:rgba(16,185,129,.08)':''}">${esc(S.authCodeMsg)}</span>`:''}
          <div class="submit-btn ${S.authCodeLoading||!S.authCodeInput.trim()?'submit-disabled':''}" style="margin-top:12px" onclick="handleActivateCode()">
            ${S.authCodeLoading?'激活中...':'立即激活'}
          </div>
        </div>
      `}
    </div>
  </div>`;
}

// ===== AUTH BOTTOM SHEET =====
function tAuthSheet() {
  return `<div class="auth-sheet-mask" onclick="closeAuthSheet()">
    <div class="auth-sheet" onclick="event.stopPropagation()">
      <div class="auth-sheet-handle" onclick="closeAuthSheet()" title="关闭"></div>
      <div class="auth-sheet-head">
        <span class="auth-sheet-title">登录 / 注册</span>
        <span class="auth-sheet-close" onclick="closeAuthSheet()">✕</span>
      </div>
      <span class="auth-sheet-sub">登录后可保存创作记录、同步历史并使用 AI 生成</span>
      <div class="auth-sheet-scroll">
        <div class="form-card form-card-sheet">
          <div class="mode-switch">
            <div class="mode-btn ${S.authMode==='sms'?'mode-active':''}" onclick="setAuthMode('sms')">验证码登录</div>
            <div class="mode-btn ${S.authMode==='pwd'?'mode-active':''}" onclick="setAuthMode('pwd')">密码登录</div>
          </div>
          <div class="field-group">
            <span class="field-label">手机号</span>
            <div class="input-wrap">
              <span class="input-prefix">+86</span>
              <input class="lf-input" type="tel" maxlength="11" placeholder="请输入手机号"
                value="${esc(S.phone)}" oninput="S.phone=this.value"/>
            </div>
          </div>
          ${S.authMode==='sms'?`
          <div class="field-group">
            <span class="field-label">验证码</span>
            <div class="input-wrap">
              <input id="smsCodeInput" class="lf-input" type="tel" maxlength="6" placeholder="6位验证码" inputmode="numeric" pattern="[0-9]*"
                value="${esc(S.smsCode)}" oninput="S.smsCode=this.value" onkeydown="if(event.key==='Enter')handleSmsLogin()" style="flex:1;padding-left:14px"/>
              <div class="sms-send-btn ${S.smsCountdown>0||S.loading?'sms-send-disabled':''}" onclick="handleSendSms()">
                ${S.smsCountdown>0?`${S.smsCountdown}s后重发`:S.smsSent?'重新发送':'获取验证码'}
              </div>
            </div>
          </div>
          ${S.authErr?`<span class="err-msg">${esc(S.authErr)}</span>`:''}
          <div class="submit-btn ${S.loading?'submit-disabled':''}" onclick="handleSmsLogin()">
            ${S.loading?'请稍候...':'登录 / 注册'}
          </div>
          `:`
          <div class="field-group">
            <span class="field-label">密码</span>
            <input class="lf-input" type="password" placeholder="请输入密码"
              value="${esc(S.password)}" oninput="S.password=this.value" onkeydown="if(event.key==='Enter')handleAuth()"/>
          </div>
          ${S.authErr?`<span class="err-msg">${esc(S.authErr)}</span>`:''}
          <div class="submit-btn ${S.loading?'submit-disabled':''}" onclick="handleAuth()">
            ${S.loading?'请稍候...':'登录'}
          </div>
          `}
        </div>
        <div class="footer-tip"><span class="footer-text">登录即表示同意用户协议和隐私政策</span></div>
      </div>
    </div>
  </div>`;
}

// ===== MAIN TEMPLATE =====
function tMain() {
  return `<div class="app-wrap">
    ${tTopBar()}
    <div class="page-content">${tTabContent()}</div>
    ${tBottomTab()}
    ${S.showPayModal?tPayModal():''}
    ${S.nicknamePrompt?tNicknamePrompt():''}
    ${S.avatarCropOpen?tAvatarCropModal():''}
    ${S.showAuthSheet?tAuthSheet():''}
    ${S.showAuthCodeSheet?tAuthCodeSheet():''}
    ${S.showAvatarMgmt?tAvatarMgmt():''}
    ${S.avatarSavePrompt?tAvatarSavePrompt():''}
    ${S.showSetPwdSheet?tSetPasswordSheet():''}
    ${S.selectedAgent?tAgentDetailOverlay():''}
    ${tPremiumGate()}
  </div>`;
}

function tTopBar() {
  const t = S.currentTab;
  if (t === 'profile' && S.profileView === 'edit') {
    return `<div class="top-bar top-bar-sub">
      <button type="button" class="back-btn" onclick="goProfileEditBack()" aria-label="返回"><svg width="9" height="15" viewBox="0 0 9 15" fill="none"><path d="M7.5 1.5L2 7.5L7.5 13.5" stroke="#1A1814" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <span class="sub-page-title">编辑资料</span>
      <div style="width:36px;flex-shrink:0"></div>
    </div>`;
  }
  if (t === 'profile' && S.profileView === 'voices') {
    return `<div class="top-bar top-bar-sub">
      <button type="button" class="back-btn" onclick="setState({profileView:'main'});render()" aria-label="返回"><svg width="9" height="15" viewBox="0 0 9 15" fill="none"><path d="M7.5 1.5L2 7.5L7.5 13.5" stroke="#1A1814" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <span class="sub-page-title">声音管理</span>
      <div style="width:36px;flex-shrink:0"></div>
    </div>`;
  }
  if (t === 'home' || t === 'profile' || t === 'agents') {
    const loginHint = !getToken() ? `<span class="top-bar-login" onclick="openAuthSheet()">登录</span>` : '';
    return `<div class="top-bar"><span class="app-name">爆款文案工坊</span>${loginHint}</div>`;
  }
  // 口播工坊：工作台模式有特殊顶栏
  if (t === 'workshop') {
    if (S.premium && S.workshopView === 'bench') {
      return `<div class="top-bar top-bar-sub">
        <button type="button" class="back-btn" onclick="exitWorkshopBench()" aria-label="返回"><svg width="9" height="15" viewBox="0 0 9 15" fill="none"><path d="M7.5 1.5L2 7.5L7.5 13.5" stroke="#1A1814" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <span class="sub-page-title">口播工坊</span>
        <button type="button" onclick="exitWorkshopBench()" style="background:none;border:none;padding:4px 8px;font-size:12px;color:#9E9890;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent">退出</button>
      </div>`;
    }
    if (!S.premium && S.workshopView === 'activate') {
      return `<div class="top-bar top-bar-sub">
        <button type="button" class="back-btn" onclick="setState({workshopView:'intro'});render()" aria-label="返回"><svg width="9" height="15" viewBox="0 0 9 15" fill="none"><path d="M7.5 1.5L2 7.5L7.5 13.5" stroke="#1A1814" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <span class="sub-page-title">开通进阶版</span>
        <div style="width:36px;flex-shrink:0"></div>
      </div>`;
    }
    const loginHint2 = !getToken() ? `<span class="top-bar-login" onclick="openAuthSheet()">登录</span>` : '';
    return `<div class="top-bar"><span class="app-name">爆款文案工坊</span>${loginHint2}</div>`;
  }
  // 动态计算子页面标题和返回动作
  let title = '';
  let backAction = "setState({currentTab:'home'});loadTasks();render()";

  if (t === 'inspire') {
    if (S.inspireMode === 'analyze') {
      title = '对标拆解';
      if (S.pathAState === 'videos') {
        backAction = "setState({pathAState:'input',pathAErr:''});render()";
      } else if (S.pathAState === 'started') {
        backAction = S.inspireFromHome
          ? "stopPathAPolling();setState({currentTab:'home',inspireMode:null,inspireFromHome:false,pathAState:'input',pathATaskData:null});loadTasks();render()"
          : "stopPathAPolling();setState({inspireMode:null,pathAState:'input',pathATaskData:null});render()";
      } else {
        backAction = S.inspireFromHome
          ? "setState({currentTab:'home',inspireMode:null,inspireFromHome:false});loadTasks();render()"
          : "setState({inspireMode:null});render()";
      }
    } else if (S.inspireMode === 'industry') {
      title = '行业生成';
      backAction = "setState({inspireMode:null});render()";
    } else if (S.inspireMode === 'featured') {
      title = (S.featuredPage === 'content' && S.featuredIndustry) ? S.featuredIndustry : '选择更符合你的行业';
      if (S.featuredPage === 'content') {
        backAction = "setState({featuredPage:'select',featuredSelectedIdx:null,featuredDetailIdx:null});render()";
      } else {
        backAction = S.inspireFromHome
          ? "if(_featuredRefreshTimer){clearInterval(_featuredRefreshTimer);_featuredRefreshTimer=null;}setState({currentTab:'home',inspireMode:null,inspireFromHome:false,featuredPage:'select',featuredDetailIdx:null});loadTasks();render()"
          : "if(_featuredRefreshTimer){clearInterval(_featuredRefreshTimer);_featuredRefreshTimer=null;}setState({inspireMode:null,featuredPage:'select',featuredDetailIdx:null});render()";
      }
    } else {
      title = '灵感发现';
    }
  } else if (t === 'history') {
    if (S.tasksView === 'detail' && S.viewingTask) {
      title = S.viewingTask.title || '任务详情';
      if (S.tasksDetailFromHome) {
        backAction = "setState({tasksView:'list',viewingTask:null,tasksDetailFromHome:false,currentTab:'home'});render()";
      } else {
        backAction = "setState({tasksView:'list',viewingTask:null});render()";
      }
    } else {
      title = '我的任务';
      if (S.historyFromProfile) backAction = "setState({currentTab:'profile',historyFromProfile:false});render()";
    }
  } else if (t === 'extract') {
    title = '爆款文案克隆';
    if (S.extractFromHistory) backAction = "stopClonePoller();setState({currentTab:'history',extractFromHistory:false});render()";
  } else if (t === 'vip') {
    title = '开通会员';
    backAction = `setState({currentTab:S.prevTab||'home'});render()`;
  } else if (t === 'original') {
    // 原创工坊：统一的子页头
    const v = S.originalView;
    const ver = (S.originalSkill && S.originalSkill.version) ? S.originalSkill.version : 'v1.0';
    if (v === 'chat' && S.originalProject) {
      const p = S.originalProject;
      return `<div class="top-bar top-bar-sub">
        <button type="button" class="back-btn" onclick="setState({originalView:'home'});render()" aria-label="返回"><svg width="9" height="15" viewBox="0 0 9 15" fill="none"><path d="M7.5 1.5L2 7.5L7.5 13.5" stroke="#1A1814" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <div style="text-align:center;overflow:hidden">
          <div style="font-size:15px;font-weight:700;color:#1A1614;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">${esc(p.title)}</div>
          <div style="font-size:11px;color:#9E9890;margin-top:1px">Skill ${esc(ver)} · ${p.turns||0} 轮</div>
        </div>
        <div style="width:36px;flex-shrink:0"></div>
      </div>`;
    }
    const titles = { skill: '我的 Skill', learning: '学习中心', materials: '素材库', extract: '添加素材', new: '新建项目', home: '原创工坊' };
    const back = v === 'home' ? "setState({currentTab:'home'});render()" : "setState({originalView:'home'});render()";
    const rightSlotOrig = v === 'skill'
      ? `<button onclick="_skillOpenHistory()" style="width:36px;height:36px;border:none;background:none;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#9E9890;-webkit-tap-highlight-color:transparent" title="历史记录"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 8v4l3 3M3.05 11A9 9 0 1 0 4 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v4h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
      : `<div style="width:36px;flex-shrink:0"></div>`;
    return `<div class="top-bar top-bar-sub">
      <button type="button" class="back-btn" onclick="${back}" aria-label="返回"><svg width="9" height="15" viewBox="0 0 9 15" fill="none"><path d="M7.5 1.5L2 7.5L7.5 13.5" stroke="#1A1814" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <span class="sub-page-title">${titles[v] || '原创工坊'}</span>
      ${rightSlotOrig}
    </div>`;
  }

  const isDeepSub = !!(S.inspireMode || (t === 'history' && S.tasksView === 'detail'));
  const loginHint = !getToken() ? `<span class="top-bar-login" onclick="openAuthSheet()">登录</span>` : '<div style="width:36px;flex-shrink:0"></div>';
  // extract tab 右上角固定显示"重新开始"按钮
  const rightSlot = (t === 'extract')
    ? `<button type="button" onclick="resetCloneWorkspace();render()" style="background:none;border:none;padding:4px 8px;font-size:12px;color:#9E9890;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent">清空内容</button>`
    : (isDeepSub ? '<div style="width:36px;flex-shrink:0"></div>' : loginHint);
  return `<div class="top-bar top-bar-sub">
    <button type="button" class="back-btn" onclick="${backAction}" aria-label="返回"><svg width="9" height="15" viewBox="0 0 9 15" fill="none"><path d="M7.5 1.5L2 7.5L7.5 13.5" stroke="#1A1814" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <span class="sub-page-title">${esc(title)}</span>
    ${rightSlot}
  </div>`;
}
