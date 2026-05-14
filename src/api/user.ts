/**
 * 用户相关 API
 */

import { apiClient } from './client';

const fetchFn = (globalThis as any).fetch as (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
  }
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface UserProfile {
  userId: string;
  name: string;
  avatar: string;
  isLogin: boolean;
}

/**
 * 获取用户信息
 */
export async function getUserProfile(): Promise<UserProfile> {
  const response = await apiClient.get<{
    user: {
      userId: string;
      name: string;
      avatar: string;
    };
  }>('/user/profile');

  return {
    userId: response.user.userId,
    name: response.user.name,
    avatar: response.user.avatar,
    isLogin: true,
  };
}

/**
 * 检查登录状态
 */
export async function checkLoginStatus(): Promise<boolean> {
  try {
    const notebook = await apiClient.get<any>('https://weread.qq.com/api/user/notebook');
    if (Array.isArray(notebook?.books)) {
      return true;
    }
  } catch {}

  try {
    const cookies = apiClient.getCookies();
    const session = extractSessionFromCookies(cookies);
    if (session) {
      const userInfo = await fetchUserInfo(session.vid, session.skey);
      const user = userInfo?.user || userInfo?.data || userInfo;
      return !!(user?.userId || user?.userVid);
    }
  } catch {}

  return false;
}

export async function getUserProfileByWebApi(): Promise<UserProfile | undefined> {
  try {
    const cookies = apiClient.getCookies();
    const session = extractSessionFromCookies(cookies);
    if (!session) {
      return undefined;
    }

    const response = await fetchUserInfo(session.vid, session.skey);
    const user = response?.user || response?.data || response;
    if (!user) {
      return undefined;
    }
    return {
      userId: String(user.userId || user.userVid || ''),
      name: String(user.name || user.nick || user.nickname || '微信读书用户'),
      avatar: String(user.avatar || user.avatarUrl || ''),
      isLogin: true,
    };
  } catch {
    return undefined;
  }
}

async function fetchUserInfo(vid: string, skey: string): Promise<any> {
  const url = new URL('https://weread.qq.com/api/userInfo');
  url.searchParams.set('userVid', vid);
  const response = await fetchFn(url.toString(), {
    method: 'GET',
    headers: {
      'x-vid': vid,
      'x-skey': skey,
    },
  });
  const rawText = await response.text();
  return rawText ? JSON.parse(rawText) : undefined;
}

function extractSessionFromCookies(
  cookies: string
): { vid: string; skey: string } | undefined {
  if (!cookies) {
    return undefined;
  }
  const vidMatch = cookies.match(/(?:^|;\s*)wr_vid=([^;]+)/);
  const skeyMatch = cookies.match(/(?:^|;\s*)wr_skey=([^;]+)/);
  if (!vidMatch || !skeyMatch) {
    return undefined;
  }
  return {
    vid: safeDecodeCookieValue(vidMatch[1]),
    skey: safeDecodeCookieValue(skeyMatch[1]),
  };
}

function safeDecodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
