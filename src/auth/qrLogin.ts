/**
 * 二维码登录流程
 */

import * as vscode from 'vscode';
import { apiClient } from '../api';
import { CookieManager } from './cookieManager';
import { AccountId } from '../types/account';
import { getAccountMetaManager } from '../services/accountMetaManager';

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

export interface QRLoginState {
  isScanning: boolean;
  isConfirmed: boolean;
  isSuccess: boolean;
  error?: string;
}

export class QRLoginManager {
  private cookieManager: CookieManager;
  private webviewPanel: vscode.WebviewPanel | undefined;
  private protocolRunId = 0;

  constructor(cookieManager: CookieManager) {
    this.cookieManager = cookieManager;
  }

  /**
   * 默认登录入口：让用户选择方案
   */
  async startLogin(options?: { targetAccountId?: AccountId }): Promise<boolean> {
    const picked = await vscode.window.showQuickPick(
      [
        {
          label: '粘贴 Cookie 登录页面',
          description: '仅输入 wr_vid 与 wr_skey',
          value: 'cookie',
        },
        {
          label: '网页协议扫码登录',
          description: '在 VSCode 全屏打开微信读书官网',
          value: 'protocol',
        },
      ],
      {
        placeHolder: '选择登录方案',
      }
    );

    if (!picked) {
      return false;
    }

    if (picked.value === 'protocol') {
      return this.startProtocolLogin(options);
    }

    return this.startCookieLogin(options);
  }

  /**
   * 方案A：网页登录协议扫码登录
   * 直接在 VSCode 全屏打开微信读书官网，避免插件内模拟登录引发风控提示
   */
  async startProtocolLogin(options?: { targetAccountId?: AccountId }): Promise<boolean> {
    this.protocolRunId += 1;
    const runId = this.protocolRunId;

    try {
      const uid = await this.getLoginUid();
      if (!this.isProtocolRunActive(runId)) {
        return false;
      }

      const loginUrl = this.buildProtocolQrPageUrl(uid);
      this.openProtocolLoginPanel(loginUrl, runId);
      this.postStatus('loading', '请使用微信扫描二维码，并在手机确认登录');

      const authToken = await this.waitForLoginConfirm(uid, runId);
      if (!authToken || !this.isProtocolRunActive(runId)) {
        this.dispose();
        return false;
      }

      const cookieString = this.buildCookieString(authToken.vid, authToken.skey);
      const success = await this.handleLoginSuccess(cookieString, authToken.vid, authToken.skey, {
        token: authToken.token,
        refreshToken: authToken.refreshToken,
        session: authToken.session,
        expiresAt: authToken.expiresAt,
      }, options);
      if (success) {
        this.postStatus('success', '登录成功，正在关闭二维码页面...');
        this.webviewPanel?.webview.postMessage({ command: 'successAndClose', text: '登录成功，正在进入书架...' });
        await this.sleep(700);
        this.dispose();
        await vscode.commands.executeCommand('workbench.view.extension.weread-explorer');
      }
      return success;
    } catch (error) {
      const message = error instanceof Error ? error.message : '协议扫码登录失败';
      this.postStatus('error', `登录失败：${message}`);
      vscode.window.showErrorMessage(`登录失败: ${message}`);
      this.dispose();
      return false;
    }
  }

  /**
   * 方案B：粘贴 Cookie 登录（独立页面）
   */
  async startCookieLogin(options?: { targetAccountId?: AccountId }): Promise<boolean> {
    this.dispose();

    this.webviewPanel = vscode.window.createWebviewPanel(
      'wereadCookieLogin',
      '微信读书 - 粘贴 Cookie 登录',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.webviewPanel.webview.html = this.getCookieLoginHtml();
    this.postStatus('loading', '请填写 wr_vid 与 wr_skey 后点击“校验并登录”');
    const lastFields = await this.cookieManager.getLastCookieLoginFields();

    return new Promise((resolve) => {
      let done = false;
      const finish = (result: boolean) => {
        if (done) {
          return;
        }
        done = true;
        resolve(result);
      };

      this.webviewPanel?.onDidDispose(() => finish(false));

      this.webviewPanel?.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
          case 'ready':
            if (lastFields) {
              this.webviewPanel?.webview.postMessage({
                command: 'prefillCookieFields',
                wrVid: lastFields.wrVid,
                wrSkey: lastFields.wrSkey,
              });
            }
            break;
          case 'openOfficialSite':
            await vscode.env.openExternal(vscode.Uri.parse('https://weread.qq.com/'));
            this.postStatus('loading', '已打开官方网页，请完成登录后粘贴 Cookie');
            break;
          case 'loginWithCookie': {
            const wrVid = this.normalizeCookieValue(String(message.wrVid || ''), 'wr_vid');
            const wrSkey = this.normalizeCookieValue(String(message.wrSkey || ''), 'wr_skey');
            if (!wrVid || !wrSkey) {
              this.postStatus('error', '请填写 wr_vid 与 wr_skey');
              return;
            }
            const cookieInput = this.buildCookieString(wrVid, wrSkey);
            const success = await this.handleLoginSuccess(cookieInput, wrVid, wrSkey, {
              token: wrSkey,
              session: wrVid,
            }, options);
            if (success) {
              finish(true);
              this.dispose();
              return;
            }
            if (!done) {
              this.postStatus('error', 'Cookie 校验失败，请确认来自官方网页登录后再重试');
            }
            break;
          }
          case 'cancel':
            this.dispose();
            finish(false);
            break;
          default:
            break;
        }
      });
    });
  }

  private buildCookieString(vid: string, skey: string): string {
    // 注意：不做 encodeURIComponent，避免已编码值被二次编码导致服务端判定无效
    return `wr_vid=${vid}; wr_skey=${skey}`;
  }

  private buildProtocolQrPageUrl(uid: string): string {
    const confirmUrl = `https://weread.qq.com/web/confirm?uid=${encodeURIComponent(uid)}`;
    return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=8&data=${encodeURIComponent(confirmUrl)}`;
  }

  private isProtocolRunActive(runId: number): boolean {
    return this.protocolRunId === runId;
  }

  private openProtocolLoginPanel(loginUrl: string, runId: number): void {
    this.dispose();
    this.webviewPanel = vscode.window.createWebviewPanel(
      'wereadProtocolLogin',
      '微信读书 - 扫码登录',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );
    const panel = this.webviewPanel;
    panel.webview.html = this.getProtocolLoginHtml(loginUrl);
    panel.onDidDispose(() => {
      if (this.isProtocolRunActive(runId)) {
        this.protocolRunId += 1;
      }
      if (this.webviewPanel === panel) {
        this.webviewPanel = undefined;
      }
    });
    panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.command === 'cancel') {
        if (this.isProtocolRunActive(runId)) {
          this.protocolRunId += 1;
        }
        this.dispose();
        return;
      }
      if (message?.command === 'openOfficialSite') {
        await vscode.env.openExternal(vscode.Uri.parse('https://weread.qq.com/'));
      }
    });
  }

  private async getLoginUid(): Promise<string> {
    const data = await this.fetchJson<{ uid?: string }>('https://weread.qq.com/api/auth/getLoginUid');
    const uid = data?.uid;
    if (!uid) {
      throw new Error('未获取到登录 UID');
    }
    return uid;
  }

  private async waitForLoginConfirm(
    uid: string,
    runId: number
  ): Promise<{
    vid: string;
    skey: string;
    token?: string;
    refreshToken?: string;
    session?: string;
    expiresAt?: number;
  } | null> {
    const timeoutAt = Date.now() + 5 * 60 * 1000;
    let otp = '';

    while (Date.now() < timeoutAt && this.isProtocolRunActive(runId)) {
      const result = await this.getLoginInfo(uid, otp);
      this.emitProtocolProgress(result?.logicCode);

      if (result?.succeed && result.accessToken && result.webLoginVid) {
        const expiresRaw = Number(result.expireAt || result.expireTime || 0) || 0;
        const expiresAt = expiresRaw > 0 ? (expiresRaw < 1_000_000_000_000 ? expiresRaw * 1000 : expiresRaw) : undefined;
        return {
          vid: String(result.webLoginVid),
          skey: String(result.accessToken),
          token: String(result.accessToken),
          refreshToken: result.refreshToken ? String(result.refreshToken) : undefined,
          session: result.session ? String(result.session) : String(result.webLoginVid),
          expiresAt,
        };
      }

      switch (result?.logicCode) {
        case 'NEED_OTP': {
          const input = await vscode.window.showInputBox({
            title: '请输入微信读书验证码',
            prompt: '手机端提示验证码后，请输入 6 位验证码',
            placeHolder: '6位验证码',
            ignoreFocusOut: true,
          });
          if (!input) {
            return null;
          }
          otp = input.trim();
          break;
        }
        case 'OTP_NOT_MATCH':
          otp = '';
          vscode.window.showWarningMessage('验证码错误，请重新输入');
          break;
        case 'OTP_EXPIRED':
        case 'LOGIN_TIMEOUT':
          vscode.window.showWarningMessage('二维码已过期，请重新发起扫码登录');
          return null;
        default:
          await this.sleep(1500);
          break;
      }
    }

    return null;
  }

  private async getLoginInfo(
    uid: string,
    otp: string
  ): Promise<{
    succeed?: boolean;
    logicCode?: string;
    accessToken?: string;
    refreshToken?: string;
    session?: string;
    expireAt?: number | string;
    expireTime?: number | string;
    webLoginVid?: number | string;
  }> {
    const url = new URL('https://weread.qq.com/api/auth/getLoginInfo');
    url.searchParams.set('uid', uid);
    url.searchParams.set('otp', otp);
    return (
      (await this.fetchJson<{
        succeed?: boolean;
        logicCode?: string;
        accessToken?: string;
        refreshToken?: string;
        session?: string;
        expireAt?: number | string;
        expireTime?: number | string;
        webLoginVid?: number | string;
      }>(url.toString())) || {}
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private emitProtocolProgress(logicCode?: string): void {
    switch (logicCode) {
      case 'SCAN_SUCCESS':
      case 'SCANNED':
        this.postStatus('loading', '已扫码，请在手机上确认登录');
        break;
      case 'CONFIRMED':
      case 'LOGIN_CONFIRM':
        this.postStatus('loading', '已确认，正在同步登录状态...');
        break;
      case 'LOGIN_TIMEOUT':
      case 'OTP_EXPIRED':
        this.postStatus('error', '二维码已过期，请重新发起扫码登录');
        break;
      default:
        this.postStatus('loading', '等待扫码中...');
        break;
    }
  }

  private normalizeCookieValue(input: string, key: 'wr_vid' | 'wr_skey'): string {
    let value = input.trim();
    value = value.replace(new RegExp(`^${key}\\s*=\\s*`, 'i'), '');
    value = value.replace(/[;,\s]+$/, '');
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value.trim();
  }

  private async getUserProfileByToken(vid: string, skey: string): Promise<{
    userId: string;
    name: string;
    avatar: string;
  }> {
    const url = new URL('https://weread.qq.com/api/userInfo');
    url.searchParams.set('userVid', vid);
    const data =
      (await this.fetchJson<any>(url.toString(), {
        'x-vid': vid,
        'x-skey': skey,
      })) || {};
    const user = data.user || data.data || data;
    return {
      userId: String(user.userId || user.userVid || vid),
      name: String(user.name || user.nick || user.nickname || '微信读书用户'),
      avatar: String(user.avatar || user.avatarUrl || ''),
    };
  }

  private postStatus(type: 'loading' | 'error' | 'success', text: string): void {
    this.webviewPanel?.webview.postMessage({
      command: 'status',
      type,
      text,
    });
  }

  private async fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T | undefined> {
    const response = await fetchFn(url, {
      method: 'GET',
      headers,
    });
    const rawText = await response.text();
    return rawText ? (JSON.parse(rawText) as T) : undefined;
  }

  /**
   * 处理登录成功
   */
  private async handleLoginSuccess(
    cookies: string,
    vid?: string,
    skey?: string,
    authPayload?: {
      token?: string;
      refreshToken?: string;
      session?: string;
      expiresAt?: number;
    },
    options?: { targetAccountId?: AccountId }
  ): Promise<boolean> {
    try {
      let userProfile: { userId: string; name: string; avatar: string };
      if (vid && skey) {
        try {
          userProfile = await this.getUserProfileByToken(vid, skey);
        } catch {
          // 降级到旧接口，兼容部分网络环境
          userProfile = await this.getUserProfile(cookies);
        }
      } else {
        userProfile = await this.getUserProfile(cookies);
      }

      const resolvedAccountId = String(userProfile.userId || vid || '').trim();
      if (!resolvedAccountId) {
        throw new Error('登录成功但未识别账号 ID');
      }
      const targetAccountId = String(options?.targetAccountId || '').trim();
      if (targetAccountId && targetAccountId !== resolvedAccountId) {
        const confirm = await vscode.window.showWarningMessage(
          `目标账号与实际登录账号不一致（目标: ${targetAccountId}，实际: ${resolvedAccountId}），是否继续写入实际账号？`,
          { modal: true },
          '继续'
        );
        if (confirm !== '继续') {
          return false;
        }
      }

      await this.cookieManager.setActiveAccountId(resolvedAccountId);
      await this.cookieManager.saveCookiesForAccount(resolvedAccountId, cookies);
      await this.cookieManager.saveSimpleBrowserAuthForAccount(resolvedAccountId, {
        cookies,
        token: authPayload?.token || skey,
        refreshToken: authPayload?.refreshToken,
        session: authPayload?.session || vid,
        expiresAt: authPayload?.expiresAt,
      });
      await getAccountMetaManager().addAccount({
        accountId: resolvedAccountId,
        userId: userProfile.userId || resolvedAccountId,
        wrVid: vid,
        displayName: userProfile.name || '微信读书用户',
        avatar: userProfile.avatar,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      });
      await getAccountMetaManager().setActiveAccountId(resolvedAccountId);

      await this.cookieManager.saveUserInfo({
        userId: userProfile.userId,
        name: userProfile.name,
        avatar: userProfile.avatar,
      });

      if (vid && skey) {
        await this.cookieManager.saveLastCookieLoginFields({
          wrVid: vid,
          wrSkey: skey,
        });
      }
      vscode.window.showInformationMessage(`登录成功！欢迎 ${userProfile.name}`);
      return true;
    } catch (error) {
      this.handleLoginFailed(error instanceof Error ? error.message : '登录失败');
      return false;
    }
  }

  /**
   * 处理登录失败
   */
  private handleLoginFailed(error: string): void {
    vscode.window.showErrorMessage(`登录失败: ${error}`);
  }

  /**
   * 获取用户信息
   */
  private async getUserProfile(cookies: string): Promise<{
    userId: string;
    name: string;
    avatar: string;
  }> {
    // 临时设置 Cookie 获取用户信息
    apiClient.setCookies(cookies);

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
    };
  }

  /**
   * 获取二维码登录页面的 HTML
   */
  private getCookieLoginHtml(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>微信读书登录</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      padding: 20px;
    }
    
    .container {
      max-width: 520px;
      margin: 0 auto;
    }

    h1 {
      font-size: 22px;
      margin-bottom: 6px;
    }
    
    .subtitle {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 18px;
      font-size: 14px;
    }

    .safe-wrap {
      width: 100%;
      min-height: 180px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      background: var(--vscode-editor-background);
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;
      padding: 16px;
      text-align: center;
    }

    .protocol-frame {
      width: 100%;
      height: 360px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background: #fff;
    }
    
    .tips {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.6;
      margin-bottom: 14px;
    }
    
    .tips strong {
      color: var(--vscode-textLink-foreground);
    }
    
    .actions {
      margin-top: 8px;
      display: flex;
      gap: 12px;
      justify-content: center;
    }
    
    button {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    
    .status {
      margin-top: 16px;
      padding: 12px;
      border-radius: 8px;
      font-size: 13px;
      display: none;
    }
    
    .status.success {
      display: block;
      background: var(--vscode-testing-iconPassed);
      color: #fff;
    }
    
    .status.error {
      display: block;
      background: var(--vscode-testing-iconFailed);
      color: #fff;
    }
    
    .status.loading {
      display: block;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    
    .cookie-input {
      width: 100%;
      height: 38px;
      border-radius: 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 0 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      margin-bottom: 10px;
    }

    .safe-title {
      font-size: 15px;
      font-weight: 600;
    }

    .safe-desc {
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
    }

    .guide {
      margin-top: 14px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
      background: var(--vscode-editor-background);
    }

    .guide h3 {
      font-size: 14px;
      margin-bottom: 8px;
    }

    .guide-step {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin: 6px 0;
      line-height: 1.6;
    }

    .guide-shot {
      margin-top: 8px;
      padding: 8px;
      border-radius: 6px;
      background: var(--vscode-textCodeBlock-background);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>微信读书 - 粘贴 Cookie 登录</h1>
    <p class="subtitle">请填写 wr_vid 与 wr_skey（仅这两个字段）</p>
    
    <div class="safe-wrap">
      <div class="safe-title">提示</div>
      <div class="safe-desc">若还没登录，请先打开微信读书官网完成扫码登录后再复制字段</div>
      <div class="actions">
        <button class="btn-secondary" onclick="openOfficialSite()">打开官网首页</button>
      </div>
    </div>

    <input class="cookie-input" id="wrSkeyInput" type="text" placeholder="请输入 wr_skey">
    <input class="cookie-input" id="wrVidInput" type="text" placeholder="请输入 wr_vid">
    
    <div class="status" id="status"></div>

    <div class="actions">
      <button class="btn-primary" onclick="loginWithCookie()">校验并登录</button>
      <button class="btn-secondary" onclick="cancel()">取消</button>
    </div>

    <div class="guide">
      <h3>如何获取 Cookie</h3>
      <div class="guide-step">1. 点击“打开官网首页”并在系统浏览器完成微信扫码登录。</div>
      <div class="guide-step">2. 登录成功后按 <code>F12</code> 打开开发者工具，切到 <code>Application</code>（或“应用”）面板。</div>
      <div class="guide-step">3. 在左侧找到 <code>Cookies -&gt; https://weread.qq.com</code>，确认存在 <code>wr_vid</code> 与 <code>wr_skey</code>。</div>
      <div class="guide-step">4. 分别复制 <code>wr_vid</code> 与 <code>wr_skey</code> 的值，粘贴到上方两个输入框，点击“校验并登录”。</div>
      <div class="guide-shot">示意图：
浏览器开发者工具
└─ Application / 应用
   └─ Storage / 存储
      └─ Cookies
         └─ https://weread.qq.com
            ├─ wr_vid=xxxx
            └─ wr_skey=xxxx</div>
    </div>
  
  <script>
    const vscode = acquireVsCodeApi();
    const wrVidInput = document.getElementById('wrVidInput');
    const wrSkeyInput = document.getElementById('wrSkeyInput');
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data?.command === 'status') {
        showStatus(data.type, data.text);
      } else if (data?.command === 'prefillCookieFields') {
        wrVidInput.value = data.wrVid || '';
        wrSkeyInput.value = data.wrSkey || '';
      }
    });
    vscode.postMessage({ command: 'ready' });

    function openOfficialSite() {
      vscode.postMessage({
        command: 'openOfficialSite'
      });
    }

    function cancel() {
      vscode.postMessage({
        command: 'cancel'
      });
    }

    function loginWithCookie() {
      const wrVid = wrVidInput.value.trim();
      const wrSkey = wrSkeyInput.value.trim();
      if (!wrVid || !wrSkey) {
        showStatus('error', '请填写 wr_vid 与 wr_skey');
        return;
      }
      vscode.postMessage({
        command: 'loginWithCookie',
        wrVid,
        wrSkey
      });
      showStatus('loading', '正在校验登录信息...');
    }

    function showStatus(type, message) {
      const status = document.getElementById('status');
      status.className = 'status ' + type;
      status.textContent = message;
    }
  </script>
</body>
</html>`;
  }

  private getProtocolLoginHtml(loginUrl: string): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>微信读书扫码登录</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .container {
      max-width: 520px;
      margin: 0 auto;
      text-align: center;
    }
    .panel {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 14px;
      padding: 20px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      transition: opacity 0.25s ease, transform 0.25s ease;
    }
    .panel.success {
      opacity: 0.72;
      transform: scale(0.98);
    }
    .title {
      font-size: 22px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .desc {
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
      line-height: 1.7;
      margin-bottom: 16px;
    }
    .qr {
      width: 320px;
      height: 320px;
      border-radius: 12px;
      background: #fff;
      padding: 10px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.12);
      max-width: 100%;
    }
    .status {
      margin-top: 16px;
      padding: 12px;
      border-radius: 10px;
      font-size: 13px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      min-height: 42px;
      transition: all 0.2s ease;
    }
    .status.success {
      background: var(--vscode-testing-iconPassed);
      color: #fff;
    }
    .status.error {
      background: var(--vscode-testing-iconFailed);
      color: #fff;
    }
    .actions {
      margin-top: 16px;
      display: flex;
      gap: 12px;
      justify-content: center;
    }
    button {
      border: none;
      border-radius: 8px;
      padding: 10px 18px;
      cursor: pointer;
    }
    .primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="panel" id="panel">
      <div class="title">微信读书扫码登录</div>
      <div class="desc">请使用微信扫描下方二维码，并在手机端确认登录。登录成功后此页面会自动关闭。</div>
      <img class="qr" src="${loginUrl}" alt="微信读书登录二维码" />
      <div class="status loading" id="status">等待扫码中...</div>
      <div class="actions">
        <button class="secondary" onclick="openOfficialSite()">打开官网</button>
        <button class="primary" onclick="cancel()">取消</button>
      </div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const status = document.getElementById('status');
    const panel = document.getElementById('panel');
    window.addEventListener('message', (event) => {
      const data = event.data || {};
      if (data.command === 'status') {
        status.className = 'status ' + (data.type || 'loading');
        status.textContent = data.text || '';
      }
      if (data.command === 'successAndClose') {
        status.className = 'status success';
        status.textContent = data.text || '登录成功';
        panel.classList.add('success');
      }
    });
    function cancel() { vscode.postMessage({ command: 'cancel' }); }
    function openOfficialSite() { vscode.postMessage({ command: 'openOfficialSite' }); }
  </script>
</body>
</html>`;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    const panel = this.webviewPanel;
    this.webviewPanel = undefined;
    panel?.dispose();
  }
}
