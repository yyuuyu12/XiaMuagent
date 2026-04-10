// pages/login/login.ts
import { api, setToken, setUser } from '../../utils/api';

Page({
  data: {
    isRegMode: false,
    phone: '',
    password: '',
    authErr: '',
    loading: false,
    wxLoading: false,
  },

  setLoginMode() { this.setData({ isRegMode: false, authErr: '' }); },
  setRegMode() { this.setData({ isRegMode: true, authErr: '' }); },
  onPhoneInput(e: any) { this.setData({ phone: e.detail.value }); },
  onPasswordInput(e: any) { this.setData({ password: e.detail.value }); },

  // ===== 手机号登录/注册 =====
  async handleAuth() {
    const { phone, password, isRegMode, loading } = this.data;
    if (loading) return;
    if (!phone || !password) { this.setData({ authErr: '请输入手机号和密码' }); return; }
    if (!/^1[3-9]\d{9}$/.test(phone)) { this.setData({ authErr: '手机号格式不正确' }); return; }
    if (password.length < 6) { this.setData({ authErr: '密码至少6位' }); return; }

    this.setData({ loading: true, authErr: '' });
    try {
      const path = isRegMode ? '/auth/register' : '/auth/login';
      const r: any = await api.post(path, { phone, password });
      if (r.code === 200) {
        this.onLoginSuccess(r.data);
      } else {
        this.setData({ authErr: r.msg || '操作失败，请重试' });
      }
    } catch {
      this.setData({ authErr: '网络错误，请稍后重试' });
    }
    this.setData({ loading: false });
  },

  // ===== 微信一键登录 =====
  handleWxLogin() {
    if (this.data.wxLoading) return;
    this.setData({ wxLoading: true, authErr: '' });

    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          this.setData({ authErr: '微信授权失败，请重试', wxLoading: false });
          return;
        }
        // 尝试获取用户昵称（用户可能拒绝）
        wx.getUserProfile({
          desc: '用于展示你的昵称',
          success: (profileRes) => {
            const nickname =
              profileRes &&
              (profileRes as any).userInfo &&
              (profileRes as any).userInfo.nickName
                ? (profileRes as any).userInfo.nickName
                : '';
            this.doWxLogin(loginRes.code, nickname);
          },
          fail: () => {
            // 用户拒绝授权昵称，仍然登录
            this.doWxLogin(loginRes.code, '');
          }
        });
      },
      fail: () => {
        this.setData({ authErr: '微信登录失败，请重试', wxLoading: false });
      }
    });
  },

  async doWxLogin(code: string, nickname: string) {
    try {
      const r: any = await api.post('/auth/wx-login', { code, nickname });
      if (r.code === 200) {
        this.onLoginSuccess(r.data);
      } else {
        this.setData({ authErr: r.msg || '微信登录失败，请重试', wxLoading: false });
      }
    } catch {
      this.setData({ authErr: '网络错误，请稍后重试', wxLoading: false });
    }
  },

  // ===== 登录成功统一处理 =====
  onLoginSuccess(data: any) {
    setToken(data.token);
    setUser(data.user);
    wx.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => {
      wx.redirectTo({ url: '/pages/index/index' });
    }, 800);
    this.setData({ loading: false, wxLoading: false });
  },
});
