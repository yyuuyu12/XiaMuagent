function tProfile() {
  if (S.profileView === 'edit') return tProfileEdit();
  if (S.profileView === 'voices') return tVoiceManager();
  const u = S.userInfo;
  const loggedIn = !!getToken();
  const hasImg = u && u.avatar_image;
  const showPhone = S.appH5 && S.appH5.showProfilePhone;
  const showAcc = S.appH5 && S.appH5.showAccountType;
  const hasAuthRows = u && u.role !== 'admin' && (u.daily_limit || 5) < 999;
  const showAccountSection = u && (showAcc || hasAuthRows);
  if (!loggedIn) {
    return `<div class="tab-page">
      <div class="profile-hero">
        <div class="profile-hero-top">
          <div class="avatar-lg avatar-type-0" onclick="openAuthSheet()">
            ${tPresetAvatar(0)}
          </div>
          <div class="profile-hero-mid">
            <span class="profile-name" style="cursor:default">未登录</span>
            <span class="profile-guest-hint">登录后可保存创作记录、查看历史与次数</span>
          </div>
        </div>
        <div class="profile-guest-cta" onclick="openAuthSheet()">登录 / 注册</div>
      </div>
      <div class="profile-history-entry" onclick="openHistoryPage('clone')">
        <div>
          <div class="title">任务中心</div>
          <div class="sub">查看灵感我的任务与克隆记录</div>
        </div>
        <div style="color:#A8A49C;font-size:18px">›</div>
      </div>
      <div style="height:20px"></div>
    </div>`;
  }
  return `<div class="tab-page">
    <div class="profile-hero">
      <div class="profile-hero-top">
        <div class="avatar-lg avatar-type-${S.userAvatar}">
          ${hasImg ? `<img class="avatar-lg-img" src="${esc(u.avatar_image)}" alt=""/>` : tPresetAvatar(S.userAvatar)}
        </div>
        <div class="profile-hero-mid">
          <span class="profile-name">${esc(S.userName)}</span>
          ${showPhone && S.userPhone && !S.userPhone.startsWith('wx_') ? `<span class="profile-phone-inline">+86 ${esc(S.userPhone)}</span>` : ''}
        </div>
        <div class="profile-edit-entry" onclick="openProfileEdit()">编辑资料</div>
      </div>
      ${u?`<div class="usage-stats">
        <div class="stat-item"><span class="stat-num">${u.used_today||0}</span><span class="stat-label">今日已用</span></div>
        <div class="stat-divider"></div>
        <div class="stat-item"><span class="stat-num ${u.role!=='admin'&&u.daily_limit<999&&u.remaining<=0?'stat-empty':''}">${u.role==='admin'||u.daily_limit>=999?'∞':u.remaining}</span><span class="stat-label">今日剩余</span></div>
        <div class="stat-divider"></div>
        <div class="stat-item"><span class="stat-num">${u.role==='admin'||u.daily_limit>=999?'∞':(u.daily_limit||5)}</span><span class="stat-label">每日上限</span></div>
      </div>`:''}
    </div>
    ${showAccountSection?`<div class="profile-section">
      <span class="profile-section-title">账号状态</span>
      ${showAcc ? `<div class="profile-row"><span class="profile-key">账号类型</span><span class="profile-val">${u.role==='admin'?'管理员':'免费版'}</span></div>` : ''}
      ${hasAuthRows?`
        <div class="profile-row"><span class="profile-key">授权状态</span>
          <span class="profile-val ${u.auth_expires_at?'val-green':''}">${u.auth_expires_at?'✓ 已授权':'未授权'}</span></div>
        ${u.auth_expires_at?`<div class="profile-row"><span class="profile-key">授权到期</span><span class="profile-val">${esc(u.auth_expires_at)}</span></div>`:''}
      `:''}
    </div>`:''}
    <div class="profile-menu-list">
      <div class="profile-menu-item" onclick="openHistoryFromProfile()">
        <div class="profile-menu-icon pmi-blue">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        </div>
        <div class="profile-menu-body">
          <span class="profile-menu-title">我的任务</span>
          <span class="profile-menu-sub">灵感生成 · 文案克隆记录</span>
        </div>
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none" class="profile-menu-arrow"><path d="M1 1L6 6L1 11" stroke="#C8C4BB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="profile-menu-item" onclick="setState({showAuthCodeSheet:true,authCodeInput:'',authCodeMsg:''});render()">
        <div class="profile-menu-icon pmi-green">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 00-8 0v2"/><line x1="12" y1="12" x2="12" y2="16"/><circle cx="12" cy="12" r="1" fill="#10B981"/></svg>
        </div>
        <div class="profile-menu-body">
          <span class="profile-menu-title">填写授权码</span>
          ${u&&u.auth_expires_at?`<span class="profile-menu-sub" style="color:#10B981">已激活 · 到期 ${esc(u.auth_expires_at)}</span>`:`<span class="profile-menu-sub">激活后获得更多每日次数</span>`}
        </div>
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none" class="profile-menu-arrow"><path d="M1 1L6 6L1 11" stroke="#C8C4BB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="profile-menu-item" onclick="setState({profileView:'voices'});render()">
        <div class="profile-menu-icon" style="background:#FFF1E8">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </div>
        <div class="profile-menu-body">
          <span class="profile-menu-title">声音管理</span>
          <span class="profile-menu-sub">上传 · 录制 · 管理我的克隆声音</span>
        </div>
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none" class="profile-menu-arrow"><path d="M1 1L6 6L1 11" stroke="#C8C4BB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="profile-menu-item" onclick="openAvatarMgmt('manage')">
        <div class="profile-menu-icon" style="background:#F0FFF4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        </div>
        <div class="profile-menu-body">
          <span class="profile-menu-title">数字人管理</span>
          <span class="profile-menu-sub">上传 · 管理我的形象视频</span>
        </div>
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none" class="profile-menu-arrow"><path d="M1 1L6 6L1 11" stroke="#C8C4BB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="profile-menu-item" onclick="setState({showSetPwdSheet:true,pwdOld:'',pwdNew:'',pwdNew2:'',pwdErr:'',pwdOk:false});render()">
        <div class="profile-menu-icon pmi-gray">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B6860" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        </div>
        <div class="profile-menu-body">
          <span class="profile-menu-title">${u?.has_password?'修改密码':'设置密码'}</span>
          <span class="profile-menu-sub">${u?.has_password?'定期更换密码更安全':'设置后可用密码登录'}</span>
        </div>
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none" class="profile-menu-arrow"><path d="M1 1L6 6L1 11" stroke="#C8C4BB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    </div>
    <div class="logout-btn" onclick="handleLogout()">退出登录</div>
    <div style="height:20px"></div>
  </div>`;
}

const SYS_VOICES_DEF = [
  { id:'xiaoxiao', name:'温柔女声' },
  { id:'yunjian',  name:'磁性男声' },
  { id:'xiaoyi',   name:'活泼女声' },
  { id:'yunxi',    name:'阳光男声' },
];
function emoLabel(e) { return {neutral:'自然',happy:'开心',excited:'激动',sad:'忧郁',calm:'平静'}[e]||e; }

function tVoiceManager() {
  const myVoices = S.myVoices || [];
  const isRecording = S.recordingState === 'recording';

  const sysRows = SYS_VOICES_DEF.map(v => `
    <div class="vm-voice-row">
      <div class="vm-voice-avatar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F97316" stroke-width="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/></svg>
      </div>
      <div style="flex:1">
        <div class="vm-voice-name">${v.name}</div>
        <div class="vm-voice-sub">系统音色</div>
      </div>
    </div>`).join('');

  const playingId = S.vmPlayingId || '';
  const PLAY_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="#F97316"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  const PAUSE_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="#F97316"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

  const myRows = myVoices.length === 0
    ? `<div style="font-size:13px;color:#A8A49C;padding:14px 0;text-align:center">暂无克隆声音，点击下方按钮添加</div>`
    : myVoices.map(v => {
      const isPlaying = playingId === v.id;
      return `
      <div class="vm-voice-row">
        <div class="vm-voice-avatar" style="background:#FFF1E8;cursor:pointer" onclick="playMyVoice('${v.id}')">
          ${isPlaying ? PAUSE_ICON : PLAY_ICON}
        </div>
        <div style="flex:1">
          <div class="vm-voice-name">${esc(v.name)}</div>
          <div class="vm-voice-sub">我的声音 · ${emoLabel(v.emotion)}${isPlaying ? ' · <span style="color:#F97316">播放中</span>' : ''}</div>
        </div>
        <div class="vm-del-btn" onclick="deleteMyVoice('${v.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </div>
      </div>`;
    }).join('');

  const addTip = `<div style="background:#FFF7ED;border-radius:8px;padding:10px 12px;margin-top:10px;font-size:12px;color:#92400E;line-height:1.6">
    <b>最佳效果：</b>录制 10~30 秒，语速自然、环境安静、普通话清晰。过短或过长都会影响克隆质量和合成速度。
  </div>`;

  const addUI = isRecording ? `
    <div style="background:#FEF2F2;border-radius:12px;padding:14px;margin-top:12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div class="rec-dot"></div>
        <span style="font-size:14px;font-weight:600;color:#EF4444">录音中</span>
        <span style="font-size:14px;color:#EF4444;font-weight:600;margin-left:auto" id="recTimer">${formatRecTime(S.recordingSeconds)}</span>
      </div>
      <div class="path-a-progress-bar" style="margin-bottom:12px">
        <div class="path-a-progress-fill" style="width:${Math.min(100,S.recordingSeconds/30*100)}%;background:#EF4444"></div>
      </div>
      <div class="rec-stop-btn" onclick="stopMicRecording()">松开停止录音</div>
    </div>` : `
    <div style="display:flex;gap:10px;margin-top:12px">
      <input type="file" id="vmAudioInput" accept="audio/*,.m4a,.caf,.aac,.mp3,.wav,.ogg,.opus,.flac" style="display:none" onchange="handleVMUpload(event)"/>
      <div style="flex:1;background:#F7F6F2;border:1.5px solid #E8E4DC;border-radius:10px;padding:12px;text-align:center;cursor:pointer" onclick="document.getElementById('vmAudioInput').click()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" style="margin-bottom:4px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <div style="font-size:13px;color:#6B7280;margin-top:2px">上传文件</div>
      </div>
      <div style="flex:1;background:#FFF1E8;border:1.5px solid #FDBA74;border-radius:10px;padding:12px;text-align:center;cursor:pointer" onclick="startMicRecording()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F97316" stroke-width="2" style="margin-bottom:4px"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
        <div style="font-size:13px;color:#F97316;margin-top:2px">麦克风录制</div>
      </div>
    </div>`;

  return `<div class="tab-page">
    <div class="section-card">
      <div class="section-label" style="margin-bottom:12px">系统音色</div>
      ${sysRows}
    </div>
    <div class="section-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div class="section-label" style="margin-bottom:0">我的声音 <span style="font-size:12px;color:#A8A49C;font-weight:400">${myVoices.length}/8</span></div>
      </div>
      ${myRows}
      ${myVoices.length < 8 ? addTip + addUI : `<div style="font-size:12px;color:#A8A49C;text-align:center;margin-top:10px">最多保存8个声音</div>`}
    </div>
    <div style="height:20px"></div>
  </div>`;
}

function tProfileEdit() {
  const u = S.userInfo;
  const hasImg = u && u.avatar_image;
  return `<div class="tab-page profile-edit-page">
    <div class="profile-section">
      <span class="profile-section-title">头像</span>
      <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:8px">
        <div class="avatar-lg avatar-type-${S.userAvatar}" style="width:72px;height:72px">
          ${hasImg ? `<img class="avatar-lg-img" src="${esc(u.avatar_image)}" alt=""/>` : tPresetAvatar(S.userAvatar)}
        </div>
        <input type="file" id="f-avatar-file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="onAvatarFile(event)"/>
        <div class="btn-secondary" style="margin-top:10px;padding:0 16px;border-radius:999px;font-size:13px;text-align:center;display:inline-flex;align-items:center;justify-content:center;height:34px;line-height:34px;min-width:128px" onclick="document.getElementById('f-avatar-file').click()">上传本地图片</div>
      </div>
      <span class="profile-section-title" style="margin-top:4px">预设头像</span>
      <div class="avatar-options">
        ${[0,1,2,3,4,5,6,7].map(i=>`
          <div class="avatar-option ${S.userAvatar===i && !hasImg ? 'avatar-option-active' : ''}" onclick="selectAvatar(${i})">
            <div class="avatar-opt-circle avatar-type-${i}">${tPresetAvatar(i)}</div>
          </div>`).join('')}
      </div>
    </div>
    <div class="profile-section">
      <span class="profile-field-label">昵称</span>
      <input class="field-input" id="f-profile-nick" placeholder="2–20 个字" maxlength="20"
        value="${esc(S.nicknameEditInput)}" oninput="S.nicknameEditInput=this.value"/>
    </div>
    <div class="profile-section">
      <span class="profile-field-label">手机号</span>
      <input type="text" class="field-input profile-phone-muted" readonly tabindex="-1" aria-readonly="true"
        value="${esc(u && u.phone && !String(u.phone).startsWith('wx_') ? '+86 ' + maskPhone(u.phone) : (u && u.phone ? u.phone : '—'))}" />
      <p class="profile-field-hint">手机号不可修改。换绑请联系管理员或客服。</p>
    </div>
    <div class="profile-section">
      <span class="profile-field-label">默认店铺名称（选填）</span>
      <input class="field-input" id="f-profile-brand" placeholder="如：老王二手车" maxlength="50"
        value="${esc(S.userInfo&&S.userInfo.brand_name||'')}" oninput="if(S.userInfo)S.userInfo.brand_name=this.value"/>
      <p class="profile-field-hint">生成文案时自动预填，无需每次重复输入</p>
    </div>
    <div class="btn-primary" style="margin-top:4px" onclick="saveProfileEdit()">保存资料</div>
  </div>`;
}

function tSetPasswordSheet() {
  const hasPwd = S.userInfo?.has_password;
  const phone = S.userInfo?.phone || '';
  const maskedPhone = phone && !phone.startsWith('wx_') ? maskPhone(phone) : '';
  const close = "setState({showSetPwdSheet:false,pwdSmsCode:'',pwdSmsSent:false,pwdSmsCountdown:0,pwdErr:'',pwdNew:'',pwdNew2:''});render()";
  return `<div class="auth-sheet-mask" onclick="${close}">
    <div class="auth-sheet" onclick="event.stopPropagation()">
      <div class="auth-sheet-handle" onclick="${close}"></div>
      <div class="auth-sheet-head">
        <span class="auth-sheet-title">${hasPwd?'修改密码':'设置密码'}</span>
        <span class="auth-sheet-close" onclick="${close}">✕</span>
      </div>
      <div class="auth-sheet-scroll" style="padding-bottom:32px">
        ${hasPwd?`
        <div style="font-size:13px;color:#6B6860;margin-bottom:14px">将向 <span style="color:#1A1814;font-weight:600">+86 ${esc(maskedPhone)}</span> 发送验证码以确认身份</div>
        <div class="field-group">
          <span class="field-label">验证码</span>
          <div class="input-wrap">
            <input class="lf-input" type="number" maxlength="6" placeholder="6位验证码"
              value="${esc(S.pwdSmsCode)}" oninput="S.pwdSmsCode=this.value" style="flex:1;padding-left:14px"/>
            <div class="sms-send-btn ${S.pwdSmsCountdown>0||S.pwdLoading?'sms-send-disabled':''}" onclick="handleSendPwdSms()">
              ${S.pwdSmsCountdown>0?`${S.pwdSmsCountdown}s后重发`:S.pwdSmsSent?'重新发送':'获取验证码'}
            </div>
          </div>
        </div>`:''}
        <div class="field-group">
          <span class="field-label">新密码</span>
          <input class="lf-input" type="password" placeholder="至少6位"
            value="${esc(S.pwdNew)}" oninput="S.pwdNew=this.value"/>
        </div>
        <div class="field-group">
          <span class="field-label">确认新密码</span>
          <input class="lf-input" type="password" placeholder="再次输入新密码"
            value="${esc(S.pwdNew2)}" oninput="S.pwdNew2=this.value" onkeydown="if(event.key==='Enter')handleSetPassword()"/>
        </div>
        ${S.pwdErr?`<span class="err-msg">${esc(S.pwdErr)}</span>`:''}
        <div class="submit-btn ${S.pwdLoading?'submit-disabled':''}" style="margin-top:4px" onclick="handleSetPassword()">
          ${S.pwdLoading?'请稍候...':(hasPwd?'确认修改':'设置密码')}
        </div>
      </div>
    </div>
  </div>`;
}

function tAvatarCropModal() {
  const percent = Number(S.avatarCropScale || 100);
  const userScale = Math.max(0.2, percent / 100);
  const meta = S.avatarCropMeta || { width: 220, height: 220 };
  const previewSize = 220;
  const base = Math.max(previewSize / meta.width, previewSize / meta.height);
  const sc = base * userScale;
  const tx = Number(S.avatarCropX || 0);
  const ty = Number(S.avatarCropY || 0);
  return `<div class="crop-modal-mask" onclick="if(event.target===event.currentTarget)cancelAvatarCrop()">
    <div class="crop-modal" onclick="event.stopPropagation()">
      <div class="crop-modal-title">头像预览</div>
      <div class="crop-preview-wrap"
        onpointerdown="startAvatarDrag(event)"
        onpointermove="moveAvatarDrag(event)"
        onpointerup="endAvatarDrag(event)"
        onpointercancel="endAvatarDrag(event)"
        onpointerleave="endAvatarDrag(event)">
        <img class="crop-preview-img" src="${esc(S.avatarCropDataUrl)}" alt="" draggable="false"
          style="transform:translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${sc});"/>
      </div>
      <div class="crop-slider-row">
        <span>缩小</span>
        <input class="crop-slider" type="range" min="20" max="220" step="1" value="${Math.round(percent)}" oninput="setAvatarCropScale(this.value)" />
        <span>${Math.round(percent)}%</span>
      </div>
      <p class="profile-field-hint" style="text-align:center;margin-bottom:12px">默认填满裁剪框（100%），可拖拽与缩放，裁剪比例固定 1:1</p>
      <div class="crop-modal-actions">
        <div class="btn-secondary" onclick="cancelAvatarCrop()">重选</div>
        <div class="btn-primary" onclick="confirmAvatarCrop()">确认使用</div>
      </div>
    </div>
  </div>`;
}

// ===== VIP =====
function tVip() {
  const p = S.memberPlans;
  const pm = { day:p.member_plan_day_price||'--', week:p.member_plan_week_price||'--', month:p.member_plan_month_price||'--', forever:p.member_plan_forever_price||'--' };
  const plans = [{key:'day',name:'日会员',dur:'1天'},{key:'week',name:'周会员',dur:'7天'},{key:'month',name:'月会员',dur:'30天',badge:'推荐'},{key:'forever',name:'永久会员',dur:'永久'}];
  return `<div class="tab-page">
    <div class="vip-hero">
      <div class="vip-hero-icon">
        <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="22" cy="22" r="22" fill="rgba(255,255,255,0.1)"/>
          <path d="M10 30h24M12 28l4-10 6 6 6-10 4 10" stroke="#FFD766" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="12" cy="28" r="2" fill="#FFD766"/>
          <circle cx="22" cy="18" r="2" fill="#FFD766"/>
          <circle cx="32" cy="28" r="2" fill="#FFD766"/>
        </svg>
      </div>
      <span class="vip-hero-title">解锁无限创作</span>
      <span class="vip-hero-sub">会员期间无次数限制，优先响应</span>
    </div>
    <span class="section-label">选择套餐</span>
    <div class="plan-grid">
      ${plans.map(pl=>`
        <div class="plan-card ${S.selectedPlan===pl.key?'plan-active':''}" onclick="selectPlan('${pl.key}')">
          ${pl.badge?`<div class="plan-badge">${pl.badge}</div>`:''}
          <span class="plan-name">${pl.name}</span>
          <span class="plan-duration">${pl.dur}</span>
          <span class="plan-price"><span class="plan-price-unit">¥</span><span class="plan-price-num">${pm[pl.key]}</span></span>
        </div>`).join('')}
    </div>
    <span class="section-label" style="margin-top:12px;display:block">支付方式</span>
    <div class="payment-row">
      <div class="payment-item ${S.selectedPayment==='wechat'?'payment-active':''}" onclick="selectPayment('wechat')">
        <div class="payment-icon"><img src="data:image/png;base64,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" width="40" height="40" style="border-radius:9px;display:block"></div>
        <span class="payment-name">微信支付</span>
      </div>
      <div class="payment-item ${S.selectedPayment==='alipay'?'payment-active':''}" onclick="selectPayment('alipay')">
        <div class="payment-icon"><img src="data:image/png;base64,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" width="40" height="40" style="border-radius:9px;display:block"></div>
        <span class="payment-name">支付宝</span>
      </div>
    </div>
    <div class="pay-btn" onclick="handlePay()">立即开通（¥${pm[S.selectedPlan]}）</div>
    <div style="height:20px"></div>
  </div>`;
}

function tPayModal() {
  const note = esc(S.memberPlans.member_note || '请添加客服微信咨询');
  return `<div class="pay-modal-mask" onclick="closePayModal()">
    <div class="pay-modal" onclick="event.stopPropagation()">
      <span class="pay-modal-icon">🚧</span>
      <span class="pay-modal-title">支付功能即将上线</span>
      <span class="pay-modal-note">${note}</span>
      <div class="pay-modal-btn" onclick="closePayModal()">我知道了</div>
    </div>
  </div>`;
}

// ===== LOGIN HANDLERS =====
function setLoginMode() { setState({ isRegMode: false, authErr: '' }); }
function setRegMode()   { setState({ isRegMode: true,  authErr: '' }); }
function setAuthMode(mode) { setState({ authMode: mode, authErr: '', smsCode: '', smsSent: false }); }

let smsCountdownTimer = null;
let pwdSmsCountdownTimer = null;
function startPwdSmsCountdown() {
  setState({ pwdSmsCountdown: 60 });
  if (pwdSmsCountdownTimer) clearInterval(pwdSmsCountdownTimer);
  pwdSmsCountdownTimer = setInterval(() => {
    const next = S.pwdSmsCountdown - 1;
    if (next <= 0) { clearInterval(pwdSmsCountdownTimer); pwdSmsCountdownTimer = null; setState({ pwdSmsCountdown: 0 }); }
    else setState({ pwdSmsCountdown: next });
  }, 1000);
}
async function handleSendPwdSms() {
  if (S.pwdSmsCountdown > 0 || S.pwdLoading) return;
  const phone = S.userInfo?.phone;
  if (!phone) return;
  setState({ pwdLoading: true, pwdErr: '' });
  try {
    const r = await api.post('/auth/send-sms', { phone });
    setState({ pwdLoading: false });
    if (r.code === 200) { setState({ pwdSmsSent: true }); startPwdSmsCountdown(); showToast('验证码已发送'); }
    else setState({ pwdErr: r.msg || '发送失败，请重试' });
  } catch { setState({ pwdLoading: false, pwdErr: '网络错误，请重试' }); }
}
function startSmsCountdown() {
  setState({ smsCountdown: 60 });
  if (smsCountdownTimer) clearInterval(smsCountdownTimer);
  smsCountdownTimer = setInterval(() => {
    const next = S.smsCountdown - 1;
    if (next <= 0) { clearInterval(smsCountdownTimer); smsCountdownTimer = null; setState({ smsCountdown: 0 }); }
    else setState({ smsCountdown: next });
  }, 1000);
}

async function handleSendSms() {
  if (S.smsCountdown > 0 || S.loading) return;
  const phone = S.phone.trim();
  if (!phone) { setState({ authErr: '请输入手机号' }); return; }
  if (!/^1[3-9]\d{9}$/.test(phone)) { setState({ authErr: '手机号格式不正确' }); return; }
  setState({ loading: true, authErr: '' });
  try {
    const r = await api.post('/auth/send-sms', { phone });
    setState({ loading: false });
    if (r.code === 200) { setState({ smsSent: true }); startSmsCountdown(); showToast('验证码已发送'); }
    else setState({ authErr: r.msg || '发送失败，请重试' });
  } catch { setState({ loading: false, authErr: '网络错误，请重试' }); }
}

async function handleSmsLogin() {
  const phone = S.phone.trim(), code = (document.getElementById('smsCodeInput')?.value || S.smsCode).trim();
  if (!phone) { setState({ authErr: '请输入手机号' }); return; }
  if (!code)  { setState({ authErr: '请输入验证码' }); return; }
  setState({ loading: true, authErr: '' });
  try {
    const r = await api.post('/auth/sms-login', { phone, code });
    if (r.code === 200) {
      setToken(r.data.token);
      setState({ loading: false, showAuthSheet: false, smsCode: '', smsSent: false, smsCountdown: 0, authErr: '', phone: '' });
      if (smsCountdownTimer) { clearInterval(smsCountdownTimer); smsCountdownTimer = null; }
      await fetchMe();
      loadTasks();
      showToast(r.data.isNew ? '注册成功，欢迎使用' : '登录成功');
    } else { setState({ loading: false, authErr: r.msg || '验证失败，请重试' }); }
  } catch { setState({ loading: false, authErr: '网络错误，请重试' }); }
}

async function handleSetPassword() {
  const { pwdSmsCode, pwdNew, pwdNew2 } = S;
  if (!pwdNew || pwdNew.length < 6) { setState({ pwdErr: '新密码至少6位' }); return; }
  if (pwdNew !== pwdNew2) { setState({ pwdErr: '两次输入的密码不一致' }); return; }
  if (S.userInfo?.has_password && !pwdSmsCode.trim()) { setState({ pwdErr: '请先获取并输入验证码' }); return; }
  setState({ pwdLoading: true, pwdErr: '' });
  try {
    const body = { new_password: pwdNew };
    if (S.userInfo?.has_password) body.sms_code = pwdSmsCode.trim();
    const r = await api.post('/auth/set-password', body);
    if (r.code === 200) {
      if (S.userInfo) setState({ userInfo: { ...S.userInfo, has_password: true } });
      setState({ pwdLoading: false, pwdNew: '', pwdNew2: '', pwdSmsCode: '', pwdSmsSent: false, pwdSmsCountdown: 0 });
      showToast('密码设置成功');
      setTimeout(() => setState({ showSetPwdSheet: false }), 800);
    } else { setState({ pwdLoading: false, pwdErr: r.msg || '操作失败' }); }
  } catch { setState({ pwdLoading: false, pwdErr: '网络错误，请重试' }); }
}

async function handleAuth() {
  if (S.loading) return;
  const phone = S.phone.trim(), pwd = S.password;
  if (!phone || !pwd)             { setState({ authErr: '请输入手机号和密码' }); return; }
  if (!/^1[3-9]\d{9}$/.test(phone)) { setState({ authErr: '手机号格式不正确' }); return; }
  if (pwd.length < 6)             { setState({ authErr: '密码至少6位' }); return; }
  setState({ loading: true, authErr: '' });
  try {
    const r = await api.post(S.isRegMode ? '/auth/register' : '/auth/login', { phone, password: pwd });
    if (r.code === 200) {
      setToken(r.data.token); setUser(r.data.user);
      showToast(S.isRegMode ? '注册成功' : '登录成功');
      if (S.showAuthSheet) {
        // 来自底部浮层登录
        setState({
          showAuthSheet: false,
          loading: false,
          authErr: '',
          userName: r.data.user.nickname || '创作者',
          userPhone: r.data.user.phone || '',
          userAvatar: r.data.user.avatar || 0,
        });
        fetchMe(); loadIndustries();
      } else {
        setTimeout(() => {
          Object.assign(S, {
            showAuthSheet: false, loading: false,
            userName: r.data.user.nickname || '创作者',
            userPhone: r.data.user.phone || '',
            userAvatar: r.data.user.avatar || 0,
          });
          render(); fetchMe(); loadIndustries();
        }, 600);
      }
    } else {
      setState({ authErr: r.msg || '操作失败，请重试', loading: false });
    }
  } catch { setState({ authErr: '网络错误，请稍后重试', loading: false }); }
}

// ===== NAV =====