const API_BASE = 'http://106.14.151.37/api';

export function getToken(): string {
  return wx.getStorageSync('wf_token') || '';
}

export function setToken(token: string): void {
  wx.setStorageSync('wf_token', token);
}

export function clearAuth(): void {
  wx.removeStorageSync('wf_token');
  wx.removeStorageSync('wf_user');
}

export function getUser(): any {
  return wx.getStorageSync('wf_user') || null;
}

export function setUser(user: any): void {
  wx.setStorageSync('wf_user', user);
}

export function request<T = any>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  data?: any
): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = getToken();
    wx.request({
      url: API_BASE + path,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      success(res: any) {
        resolve(res.data as T);
      },
      fail(err: any) {
        reject(err);
      }
    });
  });
}

export const api = {
  get: (path: string) => request('GET', path),
  post: (path: string, data?: any) => request('POST', path, data),
  put: (path: string, data?: any) => request('PUT', path, data),
  del: (path: string) => request('DELETE', path),
};
