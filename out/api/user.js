"use strict";
/**
 * 用户相关 API
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserProfileByWebApi = exports.checkLoginStatus = exports.getUserProfile = void 0;
const client_1 = require("./client");
const fetchFn = globalThis.fetch;
/**
 * 获取用户信息
 */
async function getUserProfile() {
    const response = await client_1.apiClient.get('/user/profile');
    return {
        userId: response.user.userId,
        name: response.user.name,
        avatar: response.user.avatar,
        isLogin: true,
    };
}
exports.getUserProfile = getUserProfile;
/**
 * 检查登录状态
 */
async function checkLoginStatus() {
    try {
        const notebook = await client_1.apiClient.get('https://weread.qq.com/api/user/notebook');
        if (Array.isArray(notebook?.books)) {
            return true;
        }
    }
    catch { }
    try {
        const cookies = client_1.apiClient.getCookies();
        const session = extractSessionFromCookies(cookies);
        if (session) {
            const userInfo = await fetchUserInfo(session.vid, session.skey);
            const user = userInfo?.user || userInfo?.data || userInfo;
            return !!(user?.userId || user?.userVid);
        }
    }
    catch { }
    return false;
}
exports.checkLoginStatus = checkLoginStatus;
async function getUserProfileByWebApi() {
    try {
        const cookies = client_1.apiClient.getCookies();
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
    }
    catch {
        return undefined;
    }
}
exports.getUserProfileByWebApi = getUserProfileByWebApi;
async function fetchUserInfo(vid, skey) {
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
function extractSessionFromCookies(cookies) {
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
function safeDecodeCookieValue(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
//# sourceMappingURL=user.js.map