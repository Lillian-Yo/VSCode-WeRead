"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsPanel = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const outputPath_1 = require("../utils/outputPath");
class SettingsPanel {
    static show(extensionUri) {
        if (SettingsPanel.currentPanel) {
            SettingsPanel.currentPanel.reveal(vscode.ViewColumn.One);
            return;
        }
        const panel = vscode.window.createWebviewPanel('wereadSettingsPanel', '微信读书设置', vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [extensionUri],
        });
        const instance = new SettingsPanel(panel);
        instance.initialize();
    }
    constructor(panel) {
        this.panel = panel;
        this.validating = false;
    }
    initialize() {
        SettingsPanel.currentPanel = this.panel;
        this.panel.webview.html = this.renderHtml();
        this.panel.onDidDispose(() => {
            if (SettingsPanel.currentPanel === this.panel) {
                SettingsPanel.currentPanel = undefined;
            }
        });
        this.panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'ready':
                    await this.postState();
                    break;
                case 'chooseFolder':
                    await this.chooseFolderAndValidate();
                    break;
                case 'toggleManualInput':
                    await this.updateConfig('pathInputMode', message.payload === 'manual' ? 'manual' : 'picker');
                    await this.postState();
                    break;
                case 'pathInputChanged':
                    await this.validateAndPersist(String(message.payload || ''), true);
                    await this.postState();
                    break;
                case 'retryValidation':
                    await this.validateAndPersist(String(message.payload || ''), false);
                    await this.postState();
                    break;
                case 'toggleAutoSync':
                    await this.updateConfig('autoSync', !!message.payload);
                    await this.postState();
                    break;
                case 'syncIntervalChanged':
                    if (message.payload === '12h' || message.payload === '24h' || message.payload === '72h') {
                        await this.updateConfig('syncInterval', message.payload);
                        await this.postState();
                    }
                    break;
                case 'openSystemPrivacy':
                    await vscode.env.openExternal(vscode.Uri.parse('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'));
                    break;
            }
        });
    }
    async chooseFolderAndValidate() {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: '选择笔记目录',
        });
        if (!result?.length) {
            return;
        }
        await this.validateAndPersist(result[0].fsPath, false);
        await this.postState();
    }
    async validateAndPersist(rawPath, silentWhenCreateDeclined) {
        this.validating = true;
        await this.postState();
        try {
            const normalizedPath = path.normalize((0, outputPath_1.normalizeOutputPath)(rawPath || ''));
            if (!normalizedPath.trim()) {
                await this.failValidation('路径不能为空');
                return;
            }
            const ensureResult = await this.ensureExistsOrCreate(normalizedPath, silentWhenCreateDeclined);
            if (!ensureResult.ok) {
                await this.failValidation(ensureResult.reason);
                return;
            }
            await fs.promises.access(normalizedPath, fs.constants.R_OK);
            await fs.promises.access(normalizedPath, fs.constants.W_OK);
            await this.updateConfig('outputPath', normalizedPath);
            await this.updateConfig('lastValidationStatus', 'passed');
            await this.updateConfig('lastValidationFailReason', '');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error || '路径校验失败');
            await this.failValidation(this.toReadableReason(message));
        }
        finally {
            this.validating = false;
        }
    }
    async ensureExistsOrCreate(normalizedPath, silentWhenCreateDeclined) {
        try {
            const stat = await fs.promises.stat(normalizedPath);
            if (!stat.isDirectory()) {
                return { ok: false, reason: `路径不是目录：${normalizedPath}` };
            }
            return { ok: true, reason: '' };
        }
        catch (error) {
            const code = error.code;
            if (code !== 'ENOENT') {
                return { ok: false, reason: this.toReadableReason(String(error?.message || error)) };
            }
            const choice = await vscode.window.showWarningMessage(`目录不存在，是否自动创建？\n${normalizedPath}`, { modal: true }, '创建', '取消');
            if (choice !== '创建') {
                return {
                    ok: false,
                    reason: silentWhenCreateDeclined ? '目录不存在，请选择现有目录或点击重试创建' : '目录不存在，用户取消创建',
                };
            }
            await fs.promises.mkdir(normalizedPath, { recursive: true });
            return { ok: true, reason: '' };
        }
    }
    async failValidation(reason) {
        await this.updateConfig('lastValidationStatus', 'failed');
        await this.updateConfig('lastValidationFailReason', reason);
    }
    toReadableReason(message) {
        if (message.includes('EACCES') || message.includes('EPERM')) {
            return '目录权限不足，请在系统隐私/磁盘权限中授权 VS Code 访问该目录';
        }
        if (message.includes('ENOENT')) {
            return '目录不存在，无法访问';
        }
        return message || '路径校验失败';
    }
    async postState() {
        const state = await this.getState();
        this.panel.webview.postMessage({
            type: 'state',
            payload: state,
        });
    }
    async getState() {
        const config = vscode.workspace.getConfiguration('weread');
        const mode = config.get('pathInputMode', 'picker');
        const outputPath = config.get('outputPath', '');
        const autoSync = config.get('autoSync', true);
        const syncInterval = config.get('syncInterval', '24h');
        const lastValidationStatus = config.get('lastValidationStatus', 'failed');
        const lastValidationFailReason = config.get('lastValidationFailReason', '');
        return {
            mode,
            outputPath,
            autoSync,
            syncInterval,
            lastValidationStatus,
            lastValidationFailReason,
            validating: this.validating,
        };
    }
    async updateConfig(key, value) {
        const config = vscode.workspace.getConfiguration('weread');
        await config.update(key, value, true);
    }
    renderHtml() {
        return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>微信读书设置</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: var(--vscode-font-family); padding: 16px; }
    .section { margin-bottom: 18px; }
    .row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .sync-toggle { margin-bottom: 8px; }
    .sync-interval { margin-top: 8px; }
    input[type="text"], select { width: 100%; padding: 6px 8px; box-sizing: border-box; }
    button { padding: 4px 10px; }
    .error-bar {
      margin-top: 10px;
      border: 1px solid var(--vscode-errorForeground);
      background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent);
      color: var(--vscode-editor-foreground);
      padding: 8px;
      border-radius: 4px;
    }
    .status { margin-top: 8px; font-size: 12px; }
    .muted { color: var(--vscode-descriptionForeground); }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="section">
    <h3>自定义存储路径</h3>
    <label><input id="modePicker" type="radio" name="mode" value="picker" checked /> 文件夹选择弹窗（默认）</label>
    <label style="margin-left: 12px;"><input id="modeManual" type="radio" name="mode" value="manual" /> 手动输入路径</label>
    <div class="row">
      <button id="chooseBtn">选择文件夹</button>
    </div>
    <div id="manualRow" class="row hidden">
      <input id="pathInput" type="text" placeholder="/Users/you/Documents/VSCode_weread" />
    </div>
    <div id="status" class="status"></div>
    <div id="errorBar" class="error-bar hidden">
      <div id="errorText"></div>
      <div class="row">
        <button id="openPrivacy">打开系统隐私/磁盘权限设置</button>
        <button id="retryBtn">重试</button>
      </div>
    </div>
  </div>

  <div class="section">
    <h3>自动同步</h3>
    <div class="sync-toggle">
      <label><input id="autoSync" type="checkbox" /> 开启自动同步</label>
    </div>
    <div id="syncIntervalRow" class="sync-interval">
      <label>自动同步间隔</label>
      <select id="syncInterval">
        <option value="12h">12h</option>
        <option value="24h">24h</option>
        <option value="72h">72h</option>
      </select>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const modePicker = document.getElementById('modePicker');
    const modeManual = document.getElementById('modeManual');
    const chooseBtn = document.getElementById('chooseBtn');
    const manualRow = document.getElementById('manualRow');
    const pathInput = document.getElementById('pathInput');
    const status = document.getElementById('status');
    const errorBar = document.getElementById('errorBar');
    const errorText = document.getElementById('errorText');
    const retryBtn = document.getElementById('retryBtn');
    const openPrivacy = document.getElementById('openPrivacy');
    const autoSync = document.getElementById('autoSync');
    const syncInterval = document.getElementById('syncInterval');
    const syncIntervalRow = document.getElementById('syncIntervalRow');
    let debounceTimer = undefined;

    function send(type, payload) {
      vscode.postMessage({ type, payload });
    }

    modePicker.addEventListener('change', () => send('toggleManualInput', 'picker'));
    modeManual.addEventListener('change', () => send('toggleManualInput', 'manual'));
    chooseBtn.addEventListener('click', () => send('chooseFolder'));
    retryBtn.addEventListener('click', () => send('retryValidation', pathInput.value));
    openPrivacy.addEventListener('click', () => send('openSystemPrivacy'));
    autoSync.addEventListener('change', () => send('toggleAutoSync', autoSync.checked));
    syncInterval.addEventListener('change', () => send('syncIntervalChanged', syncInterval.value));
    pathInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => send('pathInputChanged', pathInput.value), 250);
    });

    window.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.type !== 'state') return;
      const state = message.payload;
      modePicker.checked = state.mode === 'picker';
      modeManual.checked = state.mode === 'manual';
      manualRow.classList.toggle('hidden', state.mode !== 'manual');
      chooseBtn.disabled = state.mode !== 'picker' || state.validating;
      pathInput.disabled = state.mode !== 'manual' || state.validating;
      pathInput.value = state.outputPath || '';
      autoSync.checked = !!state.autoSync;
      syncInterval.value = state.syncInterval || '24h';
      syncIntervalRow.classList.toggle('hidden', !state.autoSync);
      syncInterval.disabled = !state.autoSync;

      const ok = state.lastValidationStatus === 'passed';
      const reason = state.lastValidationFailReason || '';
      status.innerHTML = ok
        ? '<span>✅ 校验通过</span>'
        : '<span>❌ 校验失败</span>' + (reason ? ' <span class="muted">(' + reason + ')</span>' : '');
      errorText.textContent = reason || '目录访问失败，请检查系统权限';
      errorBar.classList.toggle('hidden', ok);
    });

    send('ready');
  </script>
</body>
</html>`;
    }
}
exports.SettingsPanel = SettingsPanel;
//# sourceMappingURL=settingsPanel.js.map