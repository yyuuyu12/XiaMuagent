// pages/index/index.ts - 爆款文案工坊主页面
import { api, getToken, getUser, setUser, clearAuth } from '../../utils/api';

const EXAMPLES = [
  { hook: "家人们谁懂啊！这个收纳神器我真的哭了...", tags: ["家居收纳", "好物推荐"], likes: "12.3w" },
  { hook: "被骂了也要说！这个护肤步骤千万别再做了...", tags: ["护肤技巧", "避坑指南"], likes: "9.8w" },
  { hook: "姐妹们冲！这个穿搭公式再不学就晚了...", tags: ["穿搭技巧", "通勤穿搭"], likes: "7.2w" },
];

Page({
  data: {
    currentTab: 'home' as string,

    // 用户
    userName: '用户',
    userPhone: '',
    userInfo: null as any,
    userAvatar: 0,

    // 首页
    examples: EXAMPLES,

    // 提取改写
    videoUrl: '',
    extractStep: 0,
    extractedScript: '',
    rewrittenScript: '',
    extractLoading: false,
    extractErr: '',
    copiedId: '' as string,

    // 灵感生成
    industries: [] as any[],
    selectedIndustryId: null as any,
    selectedIndustryName: '',
    customTrack: '',
    inspireScripts: [] as any[],
    inspireLoading: false,
    inspireErr: '',
    expandedScript: null as number | null,
    matchedIndustry: '',
    showHistory: false,
    inspireHistory: [] as any[],
    historyLoaded: false,
    historyExpanded: null as number | null,

    // 我的
    showAvatarPicker: false,
    authCodeInput: '',
    authCodeMsg: '',
    authCodeOk: true,
    authCodeLoading: false,

    // VIP
    selectedPlan: 'month' as string,
    selectedPayment: 'wechat' as string,
    memberPlans: {} as any,
    showPayModal: false,
    currentPlanPrice: '--' as string | number,
  },

  // wx.request task，用于中断灵感生成
  _inspireTask: null as any,

  onLoad() {
    this.checkAuth();
  },

  onShow() {
    const token = getToken();
    if (!token) {
      wx.redirectTo({ url: '/pages/login/login' });
    }
  },

  // ===== 鉴权 =====
  checkAuth() {
    const token = getToken();
    if (!token) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    const user = getUser();
    if (user) {
      this.setData({
        userName: user.nickname || '用户',
        userPhone: user.phone || '',
        userAvatar: user.avatar || 0,
      });
    }
    this.fetchMe();
    this.loadIndustries();
  },

  async fetchMe() {
    try {
      const r: any = await api.get('/auth/me');
      if (r.code === 200) {
        this.setData({ userInfo: r.data, userName: r.data.nickname || '用户' });
      } else if (r.code === 401) {
        clearAuth();
        wx.redirectTo({ url: '/pages/login/login' });
      }
    } catch {}
  },

  async loadIndustries() {
    try {
      const r: any = await api.get('/config/industries');
      if (r.code === 200) {
        this.setData({ industries: r.data || [] });
      }
    } catch {}
  },

  // ===== Tab =====
  onTabTap(e: any) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
    if (tab === 'profile') this.fetchMe();
    if (tab === 'vip') this.loadMemberPlans();
  },

  goProfile() {
    this.setData({ currentTab: 'profile' });
    this.fetchMe();
  },

  goVip() {
    this.setData({ currentTab: 'vip' });
    this.loadMemberPlans();
  },

  goBack() { this.setData({ currentTab: 'home' }); },
  switchToExtract() { this.setData({ currentTab: 'extract' }); },
  switchToInspire() { this.setData({ currentTab: 'inspire' }); },

  // ===== 提取改写 =====
  onVideoUrlInput(e: any) { this.setData({ videoUrl: e.detail.value }); },

  handleExtract() {
    const { videoUrl, extractLoading } = this.data;
    if (!videoUrl.trim() || extractLoading) return;
    this.setData({ extractLoading: true, extractErr: '' });
    const token = getToken();
    wx.request({
      url: 'http://106.14.151.37/api/video/douyin-to-text',
      method: 'POST',
      data: { url: videoUrl.trim() },
      timeout: 300000,
      header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      success: (res: any) => {
        const r = res.data as any;
        if (r.code === 200) {
          this.setData({ extractedScript: r.data.script, extractStep: 1 });
        } else {
          this.setData({ extractErr: r.msg || '提取失败，请检查链接是否正确' });
        }
      },
      fail: () => {
        this.setData({ extractErr: '网络超时，视频转录约需1-2分钟，请重试' });
      },
      complete: () => {
        this.setData({ extractLoading: false });
      }
    });
  },

  async handleRewrite() {
    const { extractedScript, extractLoading } = this.data;
    if (!extractedScript || extractLoading) return;
    this.setData({ extractLoading: true, extractErr: '' });
    try {
      const r: any = await api.post('/ai/rewrite', { text: extractedScript });
      if (r.code === 200) {
        this.setData({ rewrittenScript: r.data.result, extractStep: 2 });
        this.fetchMe();
      } else {
        this.setData({ extractErr: r.msg || 'AI改写失败' });
      }
    } catch {
      this.setData({ extractErr: '网络错误，请稍后重试' });
    }
    this.setData({ extractLoading: false });
  },

  rewriteAgain() {
    this.setData({ extractStep: 1, rewrittenScript: '', extractErr: '' });
    this.handleRewrite();
  },

  resetExtract() {
    this.setData({ extractStep: 0, videoUrl: '', extractedScript: '', rewrittenScript: '', extractErr: '' });
  },

  copyExtracted() {
    wx.setClipboardData({
      data: this.data.extractedScript,
      success: () => {
        this.setData({ copiedId: 'extracted' });
        setTimeout(() => this.setData({ copiedId: '' }), 1500);
      }
    });
  },

  copyRewritten() {
    wx.setClipboardData({
      data: this.data.rewrittenScript,
      success: () => {
        this.setData({ copiedId: 'rewritten' });
        setTimeout(() => this.setData({ copiedId: '' }), 1500);
      }
    });
  },

  // ===== 灵感生成 =====
  selectIndustry(e: any) {
    const { id, name } = e.currentTarget.dataset;
    if (this.data.selectedIndustryId === id) {
      this.setData({ selectedIndustryId: null, selectedIndustryName: '' });
    } else {
      this.setData({ selectedIndustryId: id, selectedIndustryName: name, customTrack: '' });
    }
  },

  onCustomTrackInput(e: any) {
    this.setData({ customTrack: e.detail.value, selectedIndustryId: null, selectedIndustryName: '' });
  },

  // Fix #6: 使用 wx.request task 支持中断
  handleInspire() {
    const { selectedIndustryId, selectedIndustryName, customTrack, inspireLoading } = this.data;
    const activeTrack = customTrack.trim() || selectedIndustryName;
    if (!activeTrack || inspireLoading) return;

    this.setData({ inspireLoading: true, inspireErr: '', inspireScripts: [], matchedIndustry: '' });

    const token = getToken();
    const body = selectedIndustryId
      ? { track: selectedIndustryName, industryId: selectedIndustryId }
      : { track: customTrack.trim() };

    const task = wx.request({
      url: 'http://106.14.151.37/api/ai/inspire',
      method: 'POST',
      data: body,
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      success: (res: any) => {
        const r = res.data as any;
        if (r.code === 200) {
          this.setData({
            inspireScripts: r.data.scripts || [],
            matchedIndustry: r.data.matchedIndustry || '',
            expandedScript: null,
          });
          this.fetchMe();
        } else {
          this.setData({ inspireErr: r.msg || '生成失败，请重试' });
        }
      },
      fail: () => {
        this.setData({ inspireErr: '网络错误，请稍后重试' });
      },
      complete: () => {
        this.setData({ inspireLoading: false });
        this._inspireTask = null;
      }
    });
    this._inspireTask = task;
  },

  // Fix #6: 停止生成
  stopInspire() {
    if (this._inspireTask) {
      this._inspireTask.abort();
      this._inspireTask = null;
      this.setData({ inspireLoading: false });
    }
  },

  resetInspire() {
    this.setData({
      inspireScripts: [],
      selectedIndustryId: null,
      selectedIndustryName: '',
      customTrack: '',
      matchedIndustry: '',
      expandedScript: null,
      inspireErr: '',
    });
  },

  toggleScript(e: any) {
    const index = e.currentTarget.dataset.index;
    this.setData({ expandedScript: this.data.expandedScript === index ? null : index });
  },

  copyInspireItem(e: any) {
    const index = e.currentTarget.dataset.index;
    const script = this.data.inspireScripts[index];
    wx.setClipboardData({
      data: script ? (script.content || script.hook) : '',
      success: () => {
        this.setData({ copiedId: `inspire_${index}` });
        setTimeout(() => this.setData({ copiedId: '' }), 1500);
      }
    });
  },

  async handleExpand(e: any) {
    const index = e.currentTarget.dataset.index;
    const script = this.data.inspireScripts[index];
    const { selectedIndustryName, customTrack } = this.data;
    this.setData({ inspireLoading: true, inspireErr: '' });
    try {
      const r: any = await api.post('/ai/inspire-expand', {
        hook: script.hook,
        content: script.content,
        track: customTrack.trim() || selectedIndustryName,
      });
      if (r.code === 200) {
        this.setData({ inspireScripts: [...(r.data.scripts || []), ...this.data.inspireScripts], expandedScript: 0 });
        this.fetchMe();
      } else {
        this.setData({ inspireErr: r.msg || '扩写失败' });
      }
    } catch {
      this.setData({ inspireErr: '网络错误' });
    }
    this.setData({ inspireLoading: false });
  },

  toggleHistory() {
    const { showHistory, historyLoaded } = this.data;
    if (!showHistory && !historyLoaded) this.loadHistory();
    this.setData({ showHistory: !showHistory });
  },

  async loadHistory() {
    try {
      const r: any = await api.get('/history?type=inspire');
      if (r.code === 200) {
        this.setData({ inspireHistory: r.data || [], historyLoaded: true });
      }
    } catch {}
  },

  // Fix #5: 清空历史
  clearHistory() {
    wx.showModal({
      title: '清空历史',
      content: '确定清空所有历史记录吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.del('/history?type=inspire');
            this.setData({ inspireHistory: [], historyLoaded: false });
            wx.showToast({ title: '已清空', icon: 'success' });
          } catch {
            wx.showToast({ title: '操作失败', icon: 'error' });
          }
        }
      }
    });
  },

  toggleHistoryItem(e: any) {
    const index = e.currentTarget.dataset.index;
    this.setData({ historyExpanded: this.data.historyExpanded === index ? null : index });
  },

  copyHistoryItem(e: any) {
    const { hook, content } = e.currentTarget.dataset;
    wx.setClipboardData({
      data: content || hook || '',
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  // ===== 我的 =====

  // Fix #3: 头像选择
  toggleAvatarPicker() {
    this.setData({ showAvatarPicker: !this.data.showAvatarPicker });
  },

  async selectAvatar(e: any) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ userAvatar: index, showAvatarPicker: false });
    try {
      await api.post('/auth/update-avatar', { avatar: index });
      const user = getUser() || {};
      setUser({ ...user, avatar: index });
      if (this.data.userInfo) {
        this.setData({ userInfo: { ...this.data.userInfo, avatar: index } });
      }
    } catch {}
  },

  onAuthCodeInput(e: any) { this.setData({ authCodeInput: e.detail.value }); },

  async handleActivateCode() {
    const { authCodeInput, authCodeLoading } = this.data;
    if (!authCodeInput.trim() || authCodeLoading) return;
    this.setData({ authCodeLoading: true, authCodeMsg: '' });
    try {
      const r: any = await api.post('/auth/activate-code', { code: authCodeInput.trim() });
      if (r.code === 200) {
        this.setData({ authCodeMsg: r.msg || '激活成功！', authCodeOk: true, authCodeInput: '' });
        this.fetchMe();
      } else {
        this.setData({ authCodeMsg: r.msg || '激活失败', authCodeOk: false });
      }
    } catch {
      this.setData({ authCodeMsg: '网络错误，请稍后重试', authCodeOk: false });
    }
    this.setData({ authCodeLoading: false });
  },

  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          clearAuth();
          wx.redirectTo({ url: '/pages/login/login' });
        }
      }
    });
  },

  // ===== VIP =====
  async loadMemberPlans() {
    try {
      const r: any = await api.get('/config/member-plans');
      if (r.code === 200) {
        this.setData({ memberPlans: r.data });
        this.updatePlanPrice(this.data.selectedPlan, r.data);
      }
    } catch {}
  },

  selectPlan(e: any) {
    const plan = e.currentTarget.dataset.plan;
    this.setData({ selectedPlan: plan });
    this.updatePlanPrice(plan, this.data.memberPlans);
  },

  updatePlanPrice(plan: string, plans: any) {
    const map: Record<string, string> = {
      day: 'member_plan_day_price',
      week: 'member_plan_week_price',
      month: 'member_plan_month_price',
      forever: 'member_plan_forever_price',
    };
    const price = plans[map[plan]] || '--';
    this.setData({ currentPlanPrice: price });
  },

  selectPayment(e: any) {
    this.setData({ selectedPayment: e.currentTarget.dataset.method });
  },

  handlePay() {
    this.setData({ showPayModal: true });
  },

  closePayModal() {
    this.setData({ showPayModal: false });
  },

  noop() {},
});
