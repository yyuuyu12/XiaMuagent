function tExtract() {
  const sb = tCloneStepBar();

  // 路由到步骤3-6
  if (S.extractStep === 3 || S.extractStep === 'tts_gen') return tCloneStep3(sb);
  if (S.extractStep === 4 || S.extractStep === 'avatar_gen') return tCloneStep4(sb);
  if (S.extractStep === 5) return tCloneStep5(sb);
  if (S.extractStep === 6) return tCloneStep6(sb);

  // 正在提取文案（进度条）
  if (S.extractStep === 'cloning') {
    const task = S.cloneTaskData;
    const progress = task?.progress || 0;
    const thinking = task?.thinking || '正在初始化...';
    return `${sb}<div class="tab-page">
      <div class="input-card" style="text-align:center;padding:32px 20px">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:14px"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8"/></svg>
        <div style="font-size:15px;font-weight:600;color:#1A1814;margin-bottom:6px">正在提取文案</div>
        <div style="font-size:12px;color:#A8A49C;margin-bottom:16px">预计需要 1~2 分钟，请稍候</div>
        <div class="path-a-progress-bar" style="margin-bottom:10px"><div class="path-a-progress-fill" style="width:${progress}%"></div></div>
        <div style="font-size:13px;color:#6B6860;min-height:20px">${esc(thinking)}</div>
      </div>
      <div class="btn-action-sec" style="margin-top:8px" onclick="resetExtract()">取消</div>
    </div>`;
  }

  // 提取完成，用户查看并决定是否改写
  if (S.extractStep === 'review') {
    return `${sb}<div class="tab-page">
      <div style="font-size:12px;color:#A8A49C;margin-bottom:8px">识别出的原始文案（可编辑）</div>
      <div class="result-card">
        <textarea class="editable-script-textarea" id="f-extracted-script" oninput="S.extractedScript=this.value">${esc(S.extractedScript)}</textarea>
        <div class="result-action-bottom">
          <div class="copy-btn" onclick="copyExtracted()">${S.copiedId==='extracted'?'✓ 已复制':'复制原文'}</div>
        </div>
      </div>
      ${S.extractErr?`<span class="err-text">${esc(S.extractErr)}</span>`:''}
      ${tCloneActions(
        { text: '开始AI改写 →', onclick: 'handleCloneRewrite()', disabled: !S.extractedScript.trim() },
        [{ text: '重新输入', onclick: 'resetExtract()' }]
      )}
    </div>`;
  }

  // AI 改写进行中
  if (S.extractStep === 'rewriting') {
    const task = S.cloneTaskData;
    const progress = task?.progress || 60;
    const thinking = task?.thinking || '正在AI改写文案...';
    return `${sb}<div class="tab-page">
      <div class="input-card" style="text-align:center;padding:32px 20px">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#FF6B35" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:14px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <div style="font-size:15px;font-weight:600;color:#1A1814;margin-bottom:6px">AI 改写中</div>
        <div style="font-size:12px;color:#A8A49C;margin-bottom:16px">通常只需 20~30 秒</div>
        <div class="path-a-progress-bar" style="margin-bottom:10px"><div class="path-a-progress-fill" style="width:${progress}%"></div></div>
        <div style="font-size:13px;color:#6B6860;min-height:20px">${esc(thinking)}</div>
      </div>
    </div>`;
  }

  // 改写完成，展示结果 — 步骤2
  if (S.extractStep === 2) {
    const hasRewrite = !!(S.rewrittenScript || '').trim();
    const hasSource = !!(S.extractedScript || '').trim();
    const sourceExpanded = !!S.rewriteSourceExpanded;
    return `${sb}<div class="tab-page">
      <div class="rewrite-source-compact">
        <div class="rewrite-source-head">
          <span class="rewrite-source-title">原文参考</span>
          <span class="rewrite-source-toggle" onclick="setState({rewriteSourceExpanded:${sourceExpanded ? 'false' : 'true'}});render()">${sourceExpanded ? '收起' : '查看/修改'}</span>
        </div>
        ${sourceExpanded ? `
          <textarea class="editable-script-textarea" id="f-extracted-script-v2" oninput="S.extractedScript=this.value;syncRewriteActions()">${esc(S.extractedScript)}</textarea>
          <div class="result-action-bottom">
            <div class="copy-btn" onclick="copyExtracted()">${S.copiedId==='extracted'?'✓ 已复制':'复制原文'}</div>
          </div>
        ` : `<div class="rewrite-source-preview">${esc(S.extractedScript || '暂无原文')}</div>`}
      </div>
      <div class="result-card result-highlight">
        <div class="result-header-row"><span class="result-label">AI改写结果（可编辑）</span></div>
        <div class="thin-divider"></div>
        <textarea class="editable-script-textarea" id="f-rewritten-script" oninput="S.rewrittenScript=this.value;syncRewriteActions()">${esc(S.rewrittenScript)}</textarea>
        <div class="result-action-bottom">
          <div class="copy-btn copy-btn-strong ${!hasRewrite?'btn-disabled':''}" id="copy-rewritten-btn" onclick="copyRewritten()">${S.copiedId==='rewritten'?'✓ 已复制':'复制改写文案'}</div>
        </div>
      </div>
      ${S.extractErr?`<span class="err-text">${esc(S.extractErr)}</span>`:''}
      ${tCloneActions(
        { id: 'clone-step3-btn', text: S.premium ? '下一步：语音合成 →' : '进入口播工坊', onclick: 'goToCloneStep3()', disabled: !hasRewrite },
        [{ id: 'clone-rerewrite-btn', text: '重新改写', onclick: 'handleCloneRewrite()', disabled: !hasSource }]
      )}
      ${!S.premium && hasRewrite ? `<div style="text-align:center;font-size:12px;color:#9E9890;margin-top:8px">语音合成·数字人·字幕成片需<span onclick="showPremiumGate()" style="color:#F5762A;font-weight:600;cursor:pointer">开通进阶版</span></div>` : ''}
    </div>`;
  }

  // 默认：输入链接
  return `${sb}<div class="tab-page">
    <div class="platform-tabs">
      <div class="platform-tab platform-tab-active">抖音</div>
      <div class="platform-tab platform-tab-disabled">快手<span class="coming-soon-badge">即将上线</span></div>
      <div class="platform-tab platform-tab-disabled">小红书<span class="coming-soon-badge">即将上线</span></div>
    </div>
    <div class="input-card">
      <span class="input-label">粘贴抖音视频链接或分享文字</span>
      <div class="url-input-wrap">
        <textarea class="url-textarea-v2" id="f-url" placeholder="例如：https://v.douyin.com/xxx 或直接粘贴分享文字..."
          oninput="S.videoUrl=this.value;var b=document.getElementById('start-clone-btn');if(b)b.className='btn-primary'+(this.value.trim()?'':' btn-disabled')">${esc(S.videoUrl)}</textarea>
        <div class="paste-btn" onclick="pasteFromClipboard()">粘贴</div>
      </div>
      ${S.extractErr?`<span class="err-text">${esc(S.extractErr)}</span>`:''}
      ${S.extractRawErr?`<div style="font-size:10px;color:#B4B2A9;margin-top:4px;word-break:break-all">原始错误：${esc(S.extractRawErr)}</div>`:''}
      ${S.extractLoading
        ? `<div class="btn-primary btn-disabled">⏳ 提交中...</div>`
        : `<div id="start-clone-btn" class="btn-primary ${!S.videoUrl.trim()?'btn-disabled':''}" onclick="handleExtract()">开始克隆</div>`}
    </div>
    <div class="tip-card-v2">
      <span class="tip-line">1. 在抖音找到想参考的视频，点击分享复制链接</span>
      <span class="tip-line">2. 粘贴到上方，点击开始克隆</span>
      <span class="tip-line">3. 语音提取完成后可以查看并一键AI改写</span>
    </div>
  </div>`;
}

// ===== 步骤3：语音合成 =====
function tCloneStep3(sb) {
  // 音频已存在 → 改写文案曾经有值（当前可能是 session 恢复途中临时为空），跳过拦截
  const hasAudio = !!(S.ttsAudioUrl || S.ttsAudioB64);
  // ★ cloneTaskLoading=true 时正在恢复 session，数据还没到位，不显示"请先改写"错误
  if (!(S.rewrittenScript || '').trim() && !hasAudio && !S.cloneTaskLoading) {
    return `${sb}<div class="tab-page">
      <div class="input-card" style="text-align:center;padding:26px 18px;margin-top:4px">
        <div style="font-size:15px;font-weight:700;color:#1A1814;margin-bottom:8px">请先完成文案改写</div>
        <div style="font-size:12px;color:#A8A49C;line-height:1.7;margin-bottom:16px">语音合成必须使用改写后的文案，避免直接拿提取原文进入后续流程。</div>
        <div class="btn-primary" onclick="goToCloneStep2()">回到改写步骤</div>
      </div>
    </div>`;
  }
  // session 恢复中：显示轻量加载态，防止空白闪烁
  if (S.cloneTaskLoading && !hasAudio && !(S.rewrittenScript || '').trim()) {
    return `${sb}<div class="tab-page">
      <div style="text-align:center;padding:80px 20px;color:#9E9890;font-size:14px">
        <div style="width:32px;height:32px;border:3px solid rgba(245,118,42,0.2);border-top-color:#F5762A;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 14px"></div>
        <div>加载中…</div>
      </div>
    </div>`;
  }
  // 合成中状态
  if (S.extractStep === 'tts_gen') {
    const ttsPct = S.ttsProgressPct || 5;
    return `${sb}<div class="tab-page">
      <div class="input-card" style="padding:28px 22px 22px;margin-top:4px">
        <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:20px">
          <div style="position:relative;margin-bottom:16px">
            <div style="width:72px;height:72px;border-radius:22px;background:linear-gradient(135deg,#FFF3E8,#FFE4CC);display:flex;align-items:center;justify-content:center;animation:iconPulse 2s ease-in-out infinite">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.5"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            </div>
            <div style="position:absolute;inset:-8px;border-radius:30px;border:2px solid rgba(245,118,42,0.12);animation:ripple 2s ease-out infinite"></div>
          </div>
          <div style="font-size:17px;font-weight:700;color:#1A1614;margin-bottom:5px">正在合成语音</div>
        </div>
        <div style="height:6px;background:#F0EDE8;border-radius:6px;overflow:hidden;margin-bottom:8px">
          <div data-tts-pct style="height:100%;width:${ttsPct}%;background:linear-gradient(90deg,#FF8040,#F5602A);border-radius:6px;transition:width 0.3s ease"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <div style="font-size:12px;color:#B0AA9F">正在处理中…</div>
          <div data-tts-pct-text style="font-size:13px;font-weight:700;color:#F5762A">${ttsPct}%</div>
        </div>
        <div class="gen-bg-divider"></div>
        <div class="gen-bg-block">
          <div class="gen-bg-title">后台继续，稍后查看</div>
          <div class="gen-bg-subtitle">完成后通知您，现在可以去逛逛，随时回来查看进展。</div>
          <div class="gen-bg-btn-home" onclick="goHomeBackground()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6E6860" stroke-width="1.8" stroke-linejoin="round"><path d="M5 12L12 5L19 12V20C19 20.55 18.55 21 18 21H15V16H9V21H6C5.45 21 5 20.55 5 20V12Z"/></svg>
            返回首页（后台继续生成）
          </div>
        </div>
      </div>
      <div class="gen-bg-stop-row">
        <button class="gen-bg-stop-btn" onclick="stopTTSGenerate()">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="#C8C3BC"><rect width="12" height="12" rx="2"/></svg>
          停止生成
        </button>
      </div>
      <style>@keyframes iconPulse{0%,100%{transform:scale(1)} 50%{transform:scale(1.07)}} @keyframes ripple{0%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(1.35)}}</style>
    </div>`;
  }

  // 系统音色
  const SYS_VOICES = [
    { id:'xiaoxiao', name:'温柔女声', tag:'系统' },
    { id:'yunjian',  name:'磁性男声', tag:'系统' },
    { id:'xiaoyi',   name:'活泼女声', tag:'系统' },
    { id:'yunxi',    name:'阳光男声', tag:'系统' },
  ];
  // 克隆声音库（从localStorage读取）
  const myVoices = S.myVoices || [];

  // 合并所有声音
  const allVoices = [
    ...SYS_VOICES.map(v => ({ ...v, isCustom: false })),
    ...myVoices.map(v => ({ id: 'my_' + v.id, name: v.name, tag: '我的', isCustom: true, emotion: v.emotion, audio_b64: v.audio_b64, _myId: v.id })),
  ];

  const voiceScrollHtml = allVoices.map(v => {
    const on = S.ttsVoice === v.id;
    const iconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`;
    return `<div class="voice-item voice-item-design ${on?'voice-item-active':''}" onclick="selectVoice('${v.id}')">
      <div class="voice-item-icon">${iconSvg}${on?`<span class="voice-selected-mark"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></span>`:''}</div>
      <span class="voice-item-name">${esc(v.name)}</span>
      ${on?`<span class="voice-item-selected-tag">已选</span>`:`<span class="voice-item-tag">${esc(v.tag)}</span>`}
    </div>`;
  }).join('');

  // 当选择我的声音时显示情绪选择 + 强度滑块
  const selectedMyVoice = myVoices.find(v => S.ttsVoice === 'my_' + v.id);
  const curEmo = S.ttsIndexEmotion || 'neutral';
  const curIntensity = S.ttsEmoIntensity != null ? S.ttsEmoIntensity : 5;
  const intensityPct = curIntensity / 10 * 100;
  const intensityBg = `linear-gradient(to right,#F97316 ${intensityPct}%,#E8E4DC ${intensityPct}%)`;
  const emotionSection = selectedMyVoice ? `
    <div class="section-card" style="background:#FFF8F3;border:1.5px solid #FFD5B8">
      <div class="section-label" style="margin-bottom:8px;color:#9A3412">情绪风格</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:${curEmo!=='neutral'?'14px':'0'}">
        ${[['neutral','自然',0],['happy','开心',3],['excited','激动',5],['sad','忧郁',4],['calm','平静',3]].map(([id,name,defInt])=>{
          const on = curEmo === id;
          // 切换情绪时同时重置到该情绪的默认强度
          return `<div onclick="setState({ttsIndexEmotion:'${id}'${id!=='neutral'?`,ttsEmoIntensity:S.ttsIndexEmotion==='${id}'?S.ttsEmoIntensity:${defInt}`:''}});document.querySelector('.emo-intensity-range')?.dispatchEvent(new Event('sync'))"
            style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid ${on?'#F97316':'#E8E4DC'};background:${on?'#FFF1E8':'#F7F6F2'};color:${on?'#9A3412':'#6B7280'}">${name}</div>`;
        }).join('')}
      </div>
      ${curEmo !== 'neutral' ? `
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:12px;color:#9A3412;font-weight:600">情绪强度</span>
          <span style="font-size:13px;font-weight:700;color:#F97316">${curIntensity} <span style="font-size:11px;color:#A8A49C;font-weight:400">/ 10</span></span>
        </div>
        <input type="range" min="0" max="10" step="1" value="${curIntensity}"
          style="width:100%;appearance:none;-webkit-appearance:none;height:4px;border-radius:2px;outline:none;cursor:pointer;background:${intensityBg}"
          oninput="onEmoIntensityInput(this)"/>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:#C4C0B8;margin-top:4px">
          <span>弱</span><span>强</span>
        </div>
      </div>` : ''}
    </div>` : '';

  const speedPct = Math.round((S.ttsSpeed - 0.5) / 1.5 * 100);
  const speedBg = `linear-gradient(to right,#FF6B35 ${speedPct}%,#E8E4DC ${speedPct}%)`;
  const speedPresets = [0.75, 1, 1.25, 1.5, 2];
  const speedPresetHtml = speedPresets.map(v => {
    const on = Math.abs(S.ttsSpeed - v) < 0.01;
    return `<div class="voice-speed-pill ${on?'voice-speed-pill-active':''}" onclick="setTTSSpeedPreset(${v})">${v === 1 ? '1x' : v + 'x'}</div>`;
  }).join('');
  const wave = Array.from({length: 28}, (_, i) => `<span style="animation-delay:${(i % 7) * 0.07}s"></span>`).join('');

  const audioSection = S.ttsAudioUrl ? `
    <div class="clone-voice-card voice-preview-card">
      <div class="audio-play-btn voice-preview-play" onclick="playTTSAudio()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </div>
      <div class="voice-preview-main">
        <div class="voice-preview-title">语音预览</div>
        <div class="voice-wave">${wave}</div>
      </div>
      <span class="voice-done-badge">✓ 合成完成${S.ttsDuration ? '　' + S.ttsDuration + 's' : ''}</span>
    </div>` : '';

  return `${sb}<div class="tab-page clone-voice-page">
    <div class="clone-voice-card">
      <div class="clone-voice-head">
        <div class="clone-voice-title">声音选择</div>
        <span class="clone-voice-manage" onclick="gotoVoiceManager()">管理声音 ›</span>
      </div>
      <div class="voice-scroll-row voice-scroll-design">${voiceScrollHtml}</div>
    </div>
    <div class="clone-voice-card voice-speed-card">
      <div class="clone-voice-head">
        <div class="clone-voice-title">语速调节</div>
        <span id="speedLabel" class="voice-speed-value">${S.ttsSpeed.toFixed(1)}x</span>
      </div>
      <input class="speed-slider voice-speed-slider" type="range" min="50" max="200" step="10" value="${Math.round(S.ttsSpeed*100)}"
        id="speedSlider" oninput="onSpeedInput(this.value)"
        style="background:${speedBg}" />
      <div class="voice-speed-meta"><span>0.5x 慢</span><span>快 2.0x</span></div>
      <div class="voice-speed-presets">${speedPresetHtml}</div>
    </div>
    ${emotionSection}
    ${audioSection}
    ${S.ttsErr?`<span class="err-text">${esc(S.ttsErr)}</span>`:''}
    ${S.ttsAudioUrl ? `
      ${tCloneActions(
        { text: '下一步：选择数字人 →', onclick: 'goToCloneStep4()' },
        [
          { text: '上一步', onclick: 'goToCloneStep2()' },
          { text: '重新合成', onclick: 'handleTTSGenerate()' }
        ]
      )}` : `
      ${tCloneActions(
        { text: '合成语音试听 →', onclick: 'handleTTSGenerate()', disabled: S.ttsGenerating },
        [{ text: '上一步', onclick: 'goToCloneStep2()' }]
      )}`}
  </div>`;
}

// ===== 步骤4：数字人 =====
function tCloneStep4(sb) {
  // 生成中
  if (S.extractStep === 'avatar_gen') {
    const avPct = S.avatarProgressPct || 20;
    return `${sb}<div class="tab-page">
      <div class="input-card" style="padding:28px 22px 22px;margin-top:4px">
        <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:20px">
          <div style="position:relative;margin-bottom:16px">
            <div style="width:72px;height:72px;border-radius:22px;background:linear-gradient(135deg,#FFF3E8,#FFE4CC);display:flex;align-items:center;justify-content:center;animation:iconPulse 2s ease-in-out infinite">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
            </div>
            <div style="position:absolute;inset:-8px;border-radius:30px;border:2px solid rgba(245,118,42,0.12);animation:ripple 2s ease-out infinite"></div>
          </div>
          <div style="font-size:17px;font-weight:700;color:#1A1614;margin-bottom:5px">正在生成数字人视频</div>
          <div style="font-size:13px;color:#9E9890">${esc(S.avatarProgressMsg||'GPU 渲染中，通常 1~3 分钟')}</div>
        </div>
        <div style="height:6px;background:#F0EDE8;border-radius:6px;overflow:hidden;margin-bottom:8px">
          <div style="height:100%;width:${avPct}%;background:linear-gradient(90deg,#FF8040,#F5602A);border-radius:6px;transition:width 0.3s ease"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <div style="font-size:12px;color:#B0AA9F">正在处理中…</div>
          <div style="font-size:13px;font-weight:700;color:#F5762A">${avPct}%</div>
        </div>
        <div class="gen-bg-divider"></div>
        <div class="gen-bg-block">
          <div class="gen-bg-title">后台继续，稍后查看</div>
          <div class="gen-bg-subtitle">完成后通知您，现在可以去逛逛，随时回来查看进展。</div>
          <div class="gen-bg-btn-home" onclick="goHomeBackground()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6E6860" stroke-width="1.8" stroke-linejoin="round"><path d="M5 12L12 5L19 12V20C19 20.55 18.55 21 18 21H15V16H9V21H6C5.45 21 5 20.55 5 20V12Z"/></svg>
            返回首页（后台继续生成）
          </div>
        </div>
      </div>
      <div class="gen-bg-stop-row">
        <button class="gen-bg-stop-btn" onclick="handleAvatarStop()">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="#C8C3BC"><rect width="12" height="12" rx="2"/></svg>
          停止生成
        </button>
      </div>
      <style>@keyframes iconPulse{0%,100%{transform:scale(1)} 50%{transform:scale(1.07)}} @keyframes ripple{0%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(1.35)}}</style>
    </div>`;
  }

  // 生成完成 — 显示视频
  if (S.avatarVideoUrl) {
    return `${sb}<div class="tab-page">
      <div style="display:flex;justify-content:center;padding:8px 0 4px">
        <div style="width:62%;position:relative">
          <div style="aspect-ratio:9/16;border-radius:24px;overflow:hidden;background:#000;box-shadow:0 12px 40px rgba(0,0,0,0.25)">
            <video src="${S.avatarVideoUrl}" controls playsinline preload="auto"
              style="width:100%;height:100%;object-fit:cover;display:block"></video>
          </div>
        </div>
      </div>
      <div style="text-align:center;margin-top:10px;font-size:13px;color:#059669;font-weight:600">✓ 数字人视频生成完成</div>
      ${S.avatarErr?`<div class="err-text">${esc(S.avatarErr)}</div>`:''}
      ${tCloneActions(
        { text: '下一步：后期制作 →', onclick: 'goToCloneStep5()' },
        [{ text: '重新选择数字人形象', onclick: 'resetAvatarSelection()' }]
      )}
    </div>`;
  }

  // 已完成但视频URL还在异步加载中（blob下载中），显示Loading
  if (S.avatarDoneTaskId && !S.avatarVideoUrl) {
    return `${sb}<div class="tab-page">
      <div style="text-align:center;padding:60px 20px;color:#9E9890;font-size:14px">
        <div style="width:44px;height:44px;border:3px solid rgba(245,118,42,0.2);border-top-color:#F5762A;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 20px"></div>
        <div style="margin-bottom:8px;color:#6B6560">视频加载中，请稍候…</div>
        <div style="color:#bbb;font-size:12px">视频通过本地网络传输，文件较大时需要一点时间</div>
      </div>
    </div>`;
  }

  // 懒加载数字人库
  if (!S.avatarMgmtLoading && !S._step4AvatarLoaded) {
    setState({ _step4AvatarLoaded: true });
    loadAvatarList();
  }

  const _AVATAR_GRADS = [
    'linear-gradient(145deg,#C9B8F0,#A898D8)',
    'linear-gradient(145deg,#F4C5A8,#E8A888)',
    'linear-gradient(145deg,#A8D4F4,#88B8E8)',
    'linear-gradient(145deg,#A8F0D0,#78D8B0)',
    'linear-gradient(145deg,#F4E8A8,#E0CF78)',
  ];
  const list = S.avatarMgmtList || [];

  // 构建形象卡片
  const avatarCardsHtml = S.avatarMgmtLoading
    ? `<div style="display:flex;align-items:center;gap:8px;padding:20px 4px;color:#A8A49C;font-size:13px">
        <div style="width:20px;height:20px;border:2px solid rgba(245,118,42,0.2);border-top-color:#F5762A;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>
        加载中…
       </div>`
    : list.map((av, i) => {
        const isSel = S.avatarLibKey === av.key;
        const bg = _AVATAR_GRADS[i % _AVATAR_GRADS.length];
        const avJson = JSON.stringify(av).replace(/\\/g,'\\\\').replace(/"/g,'&quot;');
        return `<div onclick="selectAvatarFromLib(JSON.parse(this.dataset.av))" data-av="${avJson}"
          style="flex-shrink:0;width:94px;cursor:pointer;-webkit-tap-highlight-color:transparent">
          <div style="position:relative;width:94px;height:126px;border-radius:16px;overflow:hidden;
            border:3px solid ${isSel?'#F5762A':'rgba(0,0,0,0)'}; outline:3px solid ${isSel?'rgba(245,118,42,0.15)':'rgba(0,0,0,0)'};
            box-shadow:${isSel?'0 6px 20px rgba(245,118,42,0.28)':'0 2px 10px rgba(0,0,0,0.10)'};
            transition:border-color 0.2s,box-shadow 0.2s">
            ${av.thumbnail
              ? `<img src="${av.thumbnail}" style="width:100%;height:100%;object-fit:cover;display:block"/>`
              : `<div style="width:100%;height:100%;background:${bg};display:flex;align-items:center;justify-content:center">
                   <svg width="42" height="42" viewBox="0 0 24 24" fill="rgba(255,255,255,0.75)" stroke="none"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8z"/></svg>
                 </div>`}
            <div style="position:absolute;top:8px;left:8px;background:rgba(0,0,0,0.42);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);border-radius:5px;padding:2px 7px;font-size:10px;color:#fff;font-weight:500">正脸</div>
            ${isSel ? `<div style="position:absolute;top:8px;right:8px;width:22px;height:22px;background:#F5762A;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(245,118,42,0.5)">
              <svg width="11" height="9" viewBox="0 0 11 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,4.5 4,7.5 10,1.5"/></svg>
            </div>` : ''}
          </div>
          <div style="text-align:center;margin-top:7px;font-size:12px;font-weight:${isSel?'700':'500'};color:${isSel?'#F5762A':'#4A4642'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 2px">
            ${esc(av.name)}
          </div>
        </div>`;
      }).join('');

  // 直接使用本地视频时的预览区
  const localSelectedBanner = (!S.avatarLibKey && S.avatarSrcVideoB64)
    ? `<div style="margin-top:12px">
        <video src="${S._avatarSrcBlobUrl||''}" controls playsinline
          style="width:100%;max-height:200px;border-radius:14px;background:#000;display:block;object-fit:contain"></video>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding:0 2px">
          <span style="font-size:12px;color:#A8A49C;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(S.avatarSrcVideoName||'本地视频')}</span>
          <span style="font-size:12px;color:#F5762A;font-weight:600;cursor:pointer;flex-shrink:0;margin-left:12px"
            onclick="setState({avatarSrcVideoB64:null,avatarSrcVideoName:'',_avatarSrcBlobUrl:null})">重新选择</span>
        </div>
      </div>`
    : '';

  // 添加本地视频入口（file input + 按钮）
  const addLocalBtn = `<input type="file" id="avatarVidInput2" accept="video/mp4,video/quicktime,video/mov,video/*" style="display:none" onchange="handleAvatarLocalSelect(event)"/>`;

  let avatarPickSection;
  if (!S.avatarMgmtLoading && list.length === 0) {
    // 无形象：已选视频时显示预览，未选时显示大按钮
    avatarPickSection = `${addLocalBtn}
      ${localSelectedBanner ||
        `<div onclick="document.getElementById('avatarVidInput2').click()"
          style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:26px 16px 20px;cursor:pointer;-webkit-tap-highlight-color:transparent">
          <div style="width:54px;height:54px;border-radius:50%;border:2px dashed #D4D0C8;display:flex;align-items:center;justify-content:center;background:#FAFAF8">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#B0AAA0" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </div>
          <div style="font-size:14px;font-weight:600;color:#6B6560">新增数字人形象</div>
          <div style="font-size:12px;color:#C4C0B8;text-align:center;line-height:1.6">建议 3~10 秒不说话正脸视频<br/>MP4 / MOV，正脸居中清晰</div>
        </div>`
      }`;
  } else {
    // 有形象：横排卡片 + 添加按钮
    avatarPickSection = `
      <div style="overflow-x:auto;display:flex;gap:12px;padding:4px 2px 10px;-webkit-overflow-scrolling:touch;scrollbar-width:none">
        ${avatarCardsHtml}
      </div>
      ${localSelectedBanner}
      ${addLocalBtn}
      <div onclick="document.getElementById('avatarVidInput2').click()"
        style="display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;border-radius:12px;border:1.5px dashed #DDD9D4;cursor:pointer;margin-top:8px;-webkit-tap-highlight-color:transparent">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A8A49C" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span style="font-size:13px;color:#A8A49C;font-weight:500">直接添加本地视频</span>
      </div>`;
  }

  const hasVideo = !!(S.avatarLibKey || S.avatarSrcVideoB64);

  return `${sb}<div class="tab-page">
    <div class="section-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
        <div>
          <div style="font-size:17px;font-weight:700;color:#1A1614;line-height:1.2">选择数字人</div>
          <div style="font-size:12px;color:#A8A49C;margin-top:3px">从我的数字人形象库中选择</div>
        </div>
        <span onclick="openAvatarMgmt('manage')" style="font-size:13px;color:#F5762A;cursor:pointer;font-weight:600;padding:2px 0;flex-shrink:0;margin-left:12px">全部管理 →</span>
      </div>
      ${avatarPickSection}
    </div>
    <div class="section-card">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0">
        <span style="font-size:14px;color:#1A1814">GFPGAN 面部增强</span>
        <div class="tog-sw ${S.avatarBeauty?'tog-sw-on':'tog-sw-off'}" onclick="setState({avatarBeauty:!S.avatarBeauty})">
          <div class="tog-sw-ball"></div>
        </div>
      </div>
      <div style="font-size:12px;color:#A8A49C">开启后画质更清晰，但生成速度约慢 30 秒</div>
    </div>
    ${S.avatarErr?`<div class="err-text" style="margin-bottom:10px">${esc(S.avatarErr)}</div>`:''}
    ${tCloneActions(
      { text: '开始生成数字人视频 →', onclick: 'handleAvatarGenerate()', disabled: (!S.ttsAudioUrl || !hasVideo || S.avatarGenerating) },
      [{ text: '上一步', onclick: 'setState({extractStep:3})' }]
    )}
    ${!S.ttsAudioUrl?`<div style="text-align:center;font-size:12px;color:#EF4444;margin-top:8px">请先完成步骤3语音合成</div>`:''}
  </div>`;
}

// ===== 步骤5：后期制作 =====
const SUBTITLE_TEMPLATES = [
  { id:'bilingual_douyin', name:'爆款大字', desc:'左下角双层中文', color:'#FFD700', ol:'#000000', size:46, ow:3, type:'bilingual_douyin' },
  { id:'douyin',   name:'双层抖音', desc:'爆款高级感', color:'#FFD700', ol:'#000000', size:44, ow:3,   type:'douyin' },
  { id:'classic',  name:'经典白字', desc:'百搭首选',   color:'#FFFFFF', ol:'#000000', size:44, ow:2.5 },
  { id:'variety',  name:'综艺黄字', desc:'活泼抢眼',   color:'#FFEE00', ol:'#000000', size:40, ow:3   },
  { id:'movie',    name:'电影字幕', desc:'沉稳专业',   color:'#F0F0F0', ol:'#111111', size:30, ow:1.5 },
  { id:'fresh',    name:'清新绿字', desc:'知识科普',   color:'#00E87A', ol:'#000000', size:34, ow:2   },
  { id:'vibrant',  name:'活力橙字', desc:'带货推荐',   color:'#FF6B35', ol:'#FFFFFF', size:38, ow:2   },
  { id:'minimal',  name:'极简白字', desc:'无描边简洁', color:'#FFFFFF', ol:'none',    size:34, ow:0   },
];

function applySubTemplate(id) {
  const t = SUBTITLE_TEMPLATES.find(x => x.id === id);
  if (!t) return;
  S.subTemplate = id; S.subColor = t.color; S.subOutlineColor = t.ol;
  S.subFontsize = t.size; S.subOutlineWidth = t.ow; S.subStyle = t.type || 'default';
  saveCloneSession(5);
  // 更新模板卡片选中状态（DOM-only，避免触发 render）
  document.querySelectorAll('[data-tpl-id]').forEach(el => {
    const active = el.dataset.tplId === id;
    el.style.border = `2.5px solid ${active ? '#F97316' : '#3A3630'}`;
    const chk = el.querySelector('[data-tpl-check]');
    if (chk) chk.style.display = active ? 'flex' : 'none';
  });
  // 更新字幕颜色 dots
  document.querySelectorAll('[data-color-dot]').forEach(el => {
    const isActive = el.dataset.colorDot === t.color;
    el.style.boxShadow = `0 0 0 ${isActive ? '3px #F97316' : '2px #D4D0C8'}`;
  });
  // 更新描边颜色 dots
  document.querySelectorAll('[data-ol-dot]').forEach(el => {
    const isActive = el.dataset.olDot === t.ol;
    el.style.boxShadow = `0 0 0 ${isActive ? '3px #F97316' : '2px #D4D0C8'}`;
    const label = el.querySelector('span');
    if (label) label.style.color = isActive ? '#F97316' : '#A8A49C';
  });
  // 更新字体大小滑动条
  const fsRange = document.querySelector('[data-fs-range]');
  if (fsRange) fsRange.value = t.size;
  const fsVal = document.querySelector('[data-fs-val]');
  if (fsVal) fsVal.textContent = t.size + '像素';
  // 更新描边粗细滑动条
  const owRange = document.querySelector('[data-ow-range]');
  if (owRange) owRange.value = t.ow;
  const owVal = document.querySelector('[data-ow-val]');
  if (owVal) owVal.textContent = t.ow;
}

function setSubColorDot(c) {
  S.subColor = c; S.subTemplate = 'custom';
  saveCloneSession(5);
  document.querySelectorAll('[data-color-dot]').forEach(el => {
    const isActive = el.dataset.colorDot === c;
    el.style.boxShadow = `0 0 0 ${isActive ? '3px #F97316' : '2px #D4D0C8'}`;
  });
}

function setSubOlDot(c) {
  S.subOutlineColor = c; S.subTemplate = 'custom';
  saveCloneSession(5);
  document.querySelectorAll('[data-ol-dot]').forEach(el => {
    const isActive = el.dataset.olDot === c;
    const firstDiv = el.querySelector('div');
    if (firstDiv) firstDiv.style.boxShadow = `0 0 0 ${isActive ? '3px #F97316' : '2px #D4D0C8'}`;
    const label = el.querySelector('span');
    if (label) label.style.color = isActive ? '#F97316' : '#A8A49C';
  });
}

function onSubFsInput(v) {
  S.subFontsize = +v; S.subTemplate = 'custom';
  const el = document.querySelector('[data-fs-val]');
  if (el) el.textContent = v + '像素';
}

function onSubOwInput(v) {
  S.subOutlineWidth = +v; S.subTemplate = 'custom';
  const el = document.querySelector('[data-ow-val]');
  if (el) el.textContent = v;
}

function closeTplModal() {
  document.getElementById('tpl-modal-overlay')?.remove();
  document.body.style.overflow = '';
}

function toggleAllTpl() {
  const cardsHtml = SUBTITLE_TEMPLATES.map(t => {
    const active = S.subTemplate === t.id;
    const shadow = t.ol === 'none' ? 'none'
      : `1px 1px 0 ${t.ol},-1px 1px 0 ${t.ol},1px -1px 0 ${t.ol},-1px -1px 0 ${t.ol}`;
    let previewHtml;
    if (t.type === 'bilingual_douyin' || t.type === 'douyin') {
      previewHtml = `<div style="font-size:13px;font-weight:900;color:#FFD700;text-shadow:1px 1px 0 #000,-1px 1px 0 #000">字幕示例</div>`;
    } else {
      previewHtml = `<div style="font-size:13px;font-weight:800;color:${t.color};text-shadow:${shadow}">字幕示例</div>`;
    }
    return `<div onclick="closeTplModal();applySubTemplate('${t.id}')"
      style="background:#2C2820;border-radius:10px;padding:10px 8px 8px;cursor:pointer;
             border:2.5px solid ${active ? '#F97316' : '#3A3630'};box-sizing:border-box">
      <div style="margin-bottom:6px">${previewHtml}</div>
      <div style="font-size:11px;color:${active?'#F97316':'#A8A49C'};font-weight:600">${t.name}</div>
      <div style="font-size:10px;color:#6B6860;margin-top:2px">${t.desc}</div>
    </div>`;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'tpl-modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;justify-content:flex-end';
  modal.innerHTML = `
    <div onclick="closeTplModal()" style="flex:1;background:rgba(0,0,0,0.45)"></div>
    <div style="background:#F7F5F1;border-radius:22px 22px 0 0;padding:20px 16px 32px;max-height:75vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <span style="font-size:16px;font-weight:700;color:#1A1614">全部模板</span>
        <span onclick="closeTplModal()" style="font-size:13px;color:#9E9890;cursor:pointer">关闭</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        ${cardsHtml}
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
}

function tCloneStep5(sb) {
  const videoSrc = S.postProcessedVideoUrl || S.avatarVideoUrl || '';
  const hasResult = !!S.postProcessedVideoUrl;

  // ─── 模板横滑行（最多显示 6 张，超出可滚动）─────────────────────
  const visibleTpls = SUBTITLE_TEMPLATES.slice(0, 6);
  const tplCards = visibleTpls.map(t => {
    const active = S.subTemplate === t.id;
    const shadow = t.ol === 'none' ? 'none'
      : `1px 1px 0 ${t.ol},-1px 1px 0 ${t.ol},1px -1px 0 ${t.ol},-1px -1px 0 ${t.ol}`;
    const checkMark = active ? `<div style="position:absolute;top:5px;right:5px;width:16px;height:16px;background:#F97316;border-radius:50%;display:flex;align-items:center;justify-content:center">
        <svg width="9" height="9" viewBox="0 0 10 8" fill="none"><path d="M1 4l2.5 2.5L9 1" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg></div>` : '';
    let previewHtml;
    if (t.type === 'bilingual_douyin') {
      previewHtml = `<div style="font-size:10px;font-weight:900;color:#fff;text-shadow:${`1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000`};line-height:1.1">能够</div>
        <div style="font-size:15px;font-weight:900;color:#FFD700;text-shadow:${`1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000`};line-height:1.1">好好过日子</div>`;
    } else if (t.type === 'douyin') {
      previewHtml = `<div style="font-size:9px;font-weight:700;color:#fff;text-shadow:${`1px 1px 0 #000,-1px 1px 0 #000`};line-height:1.2">能够</div>
        <div style="font-size:13px;font-weight:900;color:#FFD700;text-shadow:${`1px 1px 0 #000,-1px 1px 0 #000`};line-height:1.2">好好过日子</div>`;
    } else {
      previewHtml = `<div style="font-size:13px;font-weight:800;color:${t.color};text-shadow:${shadow};letter-spacing:.3px">字幕示例</div>`;
    }
    return `<div data-tpl-id="${t.id}" onclick="applySubTemplate('${t.id}')"
      style="flex-shrink:0;width:100px;background:#2C2820;border-radius:10px;padding:8px 8px 7px;cursor:pointer;
             border:2.5px solid ${active ? '#F97316' : '#3A3630'};position:relative;box-sizing:border-box">
      ${checkMark}
      <div style="margin-bottom:5px;min-height:34px;display:flex;flex-direction:column;justify-content:flex-end">${previewHtml}</div>
      <div style="font-size:10px;color:${active?'#F97316':'#A8A49C'};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.name}</div>
      <div style="font-size:9px;color:#6B6860;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.desc}</div>
    </div>`;
  }).join('');

  // ─── 颜色 dots ─────────────────────────────────────────────────
  const COLORS = ['#FFFFFF','#FFEE00','#00E87A','#FF6B35','#FF3B3B','#00BFFF'];
  const colorDots = COLORS.map(c => {
    const active = S.subColor === c;
    return `<div data-color-dot="${c}" onclick="setSubColorDot('${c}')"
      style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;flex-shrink:0;
             box-shadow:0 0 0 ${active?'3px #F97316':'2px #D4D0C8'};border:2px solid ${c==='#FFFFFF'?'#E0DDD8':'#fff'};transition:.15s"></div>`;
  }).join('');

  const OL_COLORS = [['#000000','黑'],['#FFFFFF','白'],['none','无']];
  const olDots = OL_COLORS.map(([c,label]) => {
    const active = S.subOutlineColor === c;
    const bg = c === 'none' ? 'repeating-linear-gradient(45deg,#ddd 0,#ddd 4px,#fff 4px,#fff 8px)' : c;
    return `<div data-ol-dot="${c}" onclick="setSubOlDot('${c}')" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer">
      <div style="width:26px;height:26px;border-radius:50%;background:${bg};box-shadow:0 0 0 ${active?'3px #F97316':'2px #D4D0C8'};border:2px solid #fff"></div>
      <span style="font-size:9px;color:${active?'#F97316':'#A8A49C'}">${label}</span>
    </div>`;
  }).join('');

  return `${sb}<div class="tab-page">

    ${videoSrc ? `<div style="display:flex;justify-content:center;padding:0 16px 0;margin-bottom:12px">
      <div style="width:55%;position:relative">
        <div style="aspect-ratio:9/16;border-radius:12px;overflow:hidden;background:#000;box-shadow:0 4px 20px rgba(0,0,0,0.3)">
          <video src="${videoSrc}" controls playsinline preload="auto" style="width:100%;height:100%;object-fit:cover;display:block"></video>
        </div>
        <div style="font-size:11px;color:${hasResult?'#059669':'#A8A49C'};text-align:center;margin-top:6px;font-weight:${hasResult?600:400}">
          ${hasResult ? '✓ 字幕已烧录' : '原始视频（未加字幕）'}
        </div>
      </div>
    </div>` : ''}

    <div class="section-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span class="section-label" style="margin:0">快速选择模板</span>
        <span onclick="toggleAllTpl()" style="font-size:12px;color:#F97316;font-weight:600;cursor:pointer;padding:2px 0">查看全部</span>
      </div>
      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;scrollbar-width:none">
        ${tplCards}
      </div>
    </div>

    <div class="section-card">
      <div class="section-label" style="margin-bottom:12px">自定义微调</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-size:13px;color:#6B6860">字幕颜色</span>
        <div style="display:flex;gap:7px;align-items:center">${colorDots}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <span style="font-size:13px;color:#6B6860">描边颜色</span>
        <div style="display:flex;gap:10px;align-items:center">${olDots}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <span style="font-size:12px;color:#6B6860">字体大小</span>
            <span data-fs-val style="font-size:12px;font-weight:600;color:#F97316">${S.subFontsize}像素</span>
          </div>
          <input type="range" min="24" max="48" step="4" value="${S.subFontsize}" data-fs-range
            style="width:100%;accent-color:#F97316"
            oninput="onSubFsInput(this.value)"/>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <span style="font-size:12px;color:#6B6860">描边粗细</span>
            <span data-ow-val style="font-size:12px;font-weight:600;color:#F97316">${S.subOutlineWidth}</span>
          </div>
          <input type="range" min="0" max="4" step="0.5" value="${S.subOutlineWidth}" data-ow-range
            style="width:100%;accent-color:#F97316"
            oninput="onSubOwInput(this.value)"/>
        </div>
      </div>
    </div>

    ${S.postProcessErr ? `<div class="err-text">${esc(S.postProcessErr)}</div>` : ''}
    ${S.postProcessing ? `
      <div class="input-card" style="padding:28px 22px 22px">
        <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:20px">
          <div style="position:relative;margin-bottom:16px">
            <div style="width:72px;height:72px;border-radius:22px;background:linear-gradient(135deg,#FFF3E8,#FFE4CC);display:flex;align-items:center;justify-content:center;animation:iconPulse 2s ease-in-out infinite">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#F5762A" stroke-width="1.5"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 11h4M6 14h8" stroke-linecap="round"/></svg>
            </div>
            <div style="position:absolute;inset:-8px;border-radius:30px;border:2px solid rgba(245,118,42,0.12);animation:ripple 2s ease-out infinite"></div>
          </div>
          <div style="font-size:17px;font-weight:700;color:#1A1614;margin-bottom:5px">正在烧录字幕</div>
          <div style="font-size:13px;color:#9E9890">约 30~60 秒</div>
        </div>
        <div style="height:6px;background:#F0EDE8;border-radius:6px;overflow:hidden;margin-bottom:8px">
          <div style="height:100%;width:${S.postProgressPct||5}%;background:linear-gradient(90deg,#FF8040,#F5602A);border-radius:6px;transition:width 0.3s ease"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <div style="font-size:12px;color:#B0AA9F">正在处理中…</div>
          <div style="font-size:13px;font-weight:700;color:#F5762A">${S.postProgressPct||5}%</div>
        </div>
        <div class="gen-bg-divider"></div>
        <div class="gen-bg-block">
          <div class="gen-bg-title">后台继续，稍后查看</div>
          <div class="gen-bg-subtitle">完成后通知您，现在可以去逛逛，随时回来查看进展。</div>
          <div class="gen-bg-btn-home" onclick="goHomeBackground()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6E6860" stroke-width="1.8" stroke-linejoin="round"><path d="M5 12L12 5L19 12V20C19 20.55 18.55 21 18 21H15V16H9V21H6C5.45 21 5 20.55 5 20V12Z"/></svg>
            返回首页（后台继续生成）
          </div>
        </div>
      </div>
      <div class="gen-bg-stop-row">
        <button class="gen-bg-stop-btn" onclick="setState({postProcessing:false,postProgressPct:0});render()">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="#C8C3BC"><rect width="12" height="12" rx="2"/></svg>
          停止生成
        </button>
      </div>
      <style>@keyframes iconPulse{0%,100%{transform:scale(1)} 50%{transform:scale(1.07)}} @keyframes ripple{0%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(1.35)}}</style>` : ''}

    ${hasResult
      ? tCloneActions(
          { text: '下一步：发布 →', onclick: 'goToCloneStep6()' },
          [
            { text: '上一步', onclick: 'goToCloneStep4()' },
            { text: S.postProcessing ? '处理中...' : '重新烧录', onclick: 'handlePostProcess()', disabled: S.postProcessing }
          ]
        )
      : tCloneActions(
          { text: S.postProcessing ? '处理中...' : '开始烧录字幕 →', onclick: 'handlePostProcess()', disabled: S.postProcessing },
          [{ text: '上一步', onclick: 'goToCloneStep4()' }]
        )
    }

  </div>`;
}

// ===== 步骤6：发布 =====
// 通用内容卡片（标题行 + 操作按钮 + 内容插槽）
function _pubCard({ label, meta, copyText, copyDone, onCopy, regenLoading, onRegen, children }) {
  const copyBtn = `<button onclick="${onCopy}" style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;background:${copyDone?'#FFF3E8':'#F7F5F1'};border:1px solid ${copyDone?'#F5762A':'transparent'};border-radius:10px;cursor:pointer;font-size:11px;font-weight:600;color:${copyDone?'#F5762A':'#5C5852'};font-family:inherit;transition:all .15s">
    ${copyDone
      ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 12L10 17L20 7" stroke="#F5762A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>${copyText==='下载'?'已下载':'已复制'}`
      : copyText === '下载'
        ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M12 4V15M12 15L7 10M12 15L17 10" stroke="#5C5852" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 18V19C4 19.55 4.45 20 5 20H19C19.55 20 20 19.55 20 19V18" stroke="#5C5852" stroke-width="1.8" stroke-linecap="round"/></svg>下载`
        : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="13" height="13" rx="2" stroke="#5C5852" stroke-width="1.8"/><path d="M16 8V5C16 3.89 15.11 3 14 3H5C3.89 3 3 3.89 3 5V14C3 15.11 3.89 16 5 16H8" stroke="#5C5852" stroke-width="1.8"/></svg>复制`
    }
  </button>`;
  const regenBtn = `<button onclick="${onRegen}" ${regenLoading?'disabled':''} style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;background:#F7F5F1;border:1px solid transparent;border-radius:10px;cursor:${regenLoading?'wait':'pointer'};font-size:11px;font-weight:600;color:#5C5852;font-family:inherit;opacity:${regenLoading?0.6:1};transition:all .15s">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style="animation:${regenLoading?'spin .8s linear infinite':'none'}"><path d="M4 12C4 7.58 7.58 4 12 4C14.5 4 16.74 5.15 18.21 6.94M20 12C20 16.42 16.42 20 12 20C9.5 20 7.26 18.85 5.79 17.06" stroke="#5C5852" stroke-width="1.8" stroke-linecap="round"/><path d="M18 3V7H14M6 21V17H10" stroke="#5C5852" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    ${regenLoading?'生成中':'重新生成'}
  </button>`;
  return `<div style="background:#fff;border-radius:20px;padding:14px 16px;margin-bottom:12px;box-shadow:0 2px 12px rgba(0,0,0,0.05);border:1px solid rgba(0,0,0,0.04)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="display:flex;align-items:baseline;gap:8px">
        <span style="font-size:13px;font-weight:700;color:#1A1614">${label}</span>
        <span style="font-size:11px;color:#B0AA9F">${meta||''}</span>
      </div>
      <div style="display:flex;gap:6px">${copyBtn}${regenBtn}</div>
    </div>
    ${children}
  </div>`;
}

function tCloneStep6(sb) {
  const tagsText = S.publishTags.length ? S.publishTags.map(t=>'#'+t).join(' ') : '';
  const titleVal = S.publishTitle || (S.rewrittenScript || S.extractedScript || '').slice(0, 28);
  const descVal  = S.publishDesc || '';

  // 封面卡片内容
  const coverContent = S.coverGenerating
    ? `<div style="display:flex;justify-content:center;padding:8px 0">
         <div style="width:160px;aspect-ratio:9/16;background:#F0EDE8;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px">
           <div style="width:30px;height:30px;border:3px solid #F5762A;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite"></div>
           <span style="font-size:12px;color:#F5762A">正在截取封面...</span>
         </div>
       </div>`
    : S.coverFrameUrl
      ? `<div style="display:flex;justify-content:center;padding:4px 0 2px">
           <img src="${S.coverFrameUrl}" style="width:160px;border-radius:14px;display:block;box-shadow:0 6px 20px rgba(0,0,0,0.18)"/>
         </div>
         <div style="display:flex;justify-content:center;gap:16px;margin-top:10px">
           <span style="font-size:12px;color:#F97316;cursor:pointer;font-weight:500" onclick="generateCover(S.coverSeekTime+2)">换一帧</span>
           <span style="font-size:12px;color:#9A9690;cursor:pointer" onclick="generateCover(S.coverSeekTime,true)">换文案</span>
         </div>`
      : `<div style="display:flex;justify-content:center;padding:8px 0">
           <div style="width:160px;aspect-ratio:9/16;background:#F7F6F2;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;border:2px dashed #E4E2DA" onclick="generateCover(1)">
             <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C4C0B8" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
             <span style="font-size:12px;color:#A8A49C">点击生成封面</span>
           </div>
         </div>`;

  const coverMeta = S.coverGenerating ? '生成中...' : S.coverFrameUrl ? '9:16 · 已生成' : '9:16';

  return `${sb}<div class="tab-page" style="padding:0 22px">

    ${_pubCard({
      label: '封面', meta: coverMeta,
      copyText: '下载', copyDone: S.coverDownloaded,
      onCopy: 'downloadCover()',
      regenLoading: S.coverGenerating,
      onRegen: 'generateCover(S.coverSeekTime+2)',
      children: coverContent
    })}

    ${_pubCard({
      label: '视频标题', meta: `${titleVal.length}/30`,
      copyText: '复制', copyDone: S.publishCopied === 'title',
      onCopy: "handlePublishCopy('title')",
      regenLoading: S.publishTitleLoading,
      onRegen: "handlePublishTitleGen('title')",
      children: `<div style="background:#F7F5F1;border-radius:10px;padding:10px 12px">
        <div contenteditable="true" id="pub-title-el"
          style="font-size:14px;color:#1A1814;line-height:1.6;outline:none;min-height:22px;font-weight:500"
          oninput="S.publishTitle=this.innerText">${esc(titleVal)}</div>
      </div>`
    })}

    ${_pubCard({
      label: '视频简介', meta: `${(descVal + (tagsText?' '+tagsText:'')).length}/300`,
      copyText: '复制', copyDone: S.publishCopied === 'desc',
      onCopy: "handlePublishCopy('desc')",
      regenLoading: S.publishDescLoading,
      onRegen: "handlePublishTitleGen('desc')",
      children: `<div style="background:#F7F5F1;border-radius:10px;padding:10px 12px">
        <div contenteditable="true" id="pub-desc-el"
          style="font-size:13px;color:#1A1814;line-height:1.7;outline:none;min-height:40px"
          oninput="S.publishDesc=this.innerText">${esc(descVal)}</div>
        ${tagsText
          ? `<div style="margin-top:8px;font-size:13px;color:#F5762A;line-height:1.8;word-break:break-all">${esc(tagsText)}</div>`
          : `<div style="margin-top:6px;font-size:12px;color:#C4C0B8">AI生成后自动填入话题标签</div>`}
      </div>`
    })}

    <!-- 法务提示 -->
    <div style="background:#ECFDF5;border-radius:12px;padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
      <span style="font-size:13px;color:#065F46;font-weight:500">AI法务审查通过，未检测到违规词</span>
    </div>

    <!-- 底部按钮 -->
    <button onclick="resetExtract();setState({currentTab:'home'});loadTasks();render()"
      style="width:100%;padding:16px;background:linear-gradient(135deg,#FF8040,#F5602A);color:#fff;border:none;border-radius:16px;font-size:16px;font-weight:700;font-family:inherit;cursor:pointer;box-shadow:0 6px 20px rgba(245,96,42,0.35);margin-bottom:10px">
      我已保存素材，回到首页
    </button>
    <button onclick="setState({extractStep:5})"
      style="width:100%;padding:13px;background:#fff;border:1.5px solid #F0EDE8;border-radius:16px;font-size:14px;font-weight:600;color:#9E9890;font-family:inherit;cursor:pointer;margin-bottom:24px">
      上一步
    </button>
  </div>`;
}

// ===== INSPIRE =====