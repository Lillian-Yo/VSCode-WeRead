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
exports.openTemplateEditor = exports.TemplateEditorPanel = void 0;
const vscode = __importStar(require("vscode"));
const config_1 = require("../config/config");
const templateService_1 = require("../services/templateService");
const models_1 = require("../models");
/**
 * 模板编辑器 WebView 面板
 */
class TemplateEditorPanel {
    constructor(context, panel) {
        this.disposables = [];
        this.context = context;
        this.panel = panel;
        // 设置 WebView 内容
        this.updateWebview();
        // 监听消息
        this.panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'saveTemplate':
                    await this.saveTemplate(message.template);
                    break;
                case 'saveFileNameTemplate':
                    await this.saveFileNameTemplate(message.template);
                    break;
                case 'previewTemplate':
                    await this.previewTemplate(message.template);
                    break;
                case 'resetTemplate':
                    await this.resetTemplate();
                    break;
                case 'getDefaultTemplate':
                    this.panel.webview.postMessage({
                        command: 'setDefaultTemplate',
                        template: this.getDefaultTemplate(),
                    });
                    break;
            }
        }, null, this.disposables);
        // 面板关闭时清理
        this.panel.onDidDispose(() => {
            this.dispose();
        }, null, this.disposables);
    }
    /**
     * 创建或显示面板
     */
    static createOrShow(context) {
        const column = vscode.ViewColumn.One;
        if (TemplateEditorPanel.currentPanel) {
            TemplateEditorPanel.currentPanel.panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel('wereadTemplateEditor', '微信读书 - 模板编辑器', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [],
        });
        TemplateEditorPanel.currentPanel = new TemplateEditorPanel(context, panel);
    }
    /**
     * 更新 WebView 内容
     */
    updateWebview() {
        const config = (0, config_1.getConfig)();
        const currentTemplate = config.noteTemplate || '';
        const currentFileNameTemplate = config.fileNameTemplate || '{{title}}';
        this.panel.webview.html = this.getHtmlContent(currentTemplate, currentFileNameTemplate);
    }
    /**
     * 保存模板
     */
    async saveTemplate(template) {
        try {
            const templateService = (0, templateService_1.getTemplateService)();
            const validation = templateService.validateTemplate(template);
            if (!validation.valid) {
                vscode.window.showErrorMessage(`模板校验失败: ${validation.error}`);
                return;
            }
            await vscode.workspace
                .getConfiguration('weread')
                .update('noteTemplate', template, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('模板已保存');
        }
        catch (error) {
            vscode.window.showErrorMessage('保存模板失败: ' + error);
        }
    }
    /**
     * 保存文件名模板
     */
    async saveFileNameTemplate(template) {
        try {
            await vscode.workspace
                .getConfiguration('weread')
                .update('fileNameTemplate', template, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('文件名模板已保存');
        }
        catch (error) {
            vscode.window.showErrorMessage('保存文件名模板失败: ' + error);
        }
    }
    /**
     * 预览模板
     */
    async previewTemplate(template) {
        const templateService = (0, templateService_1.getTemplateService)();
        const validation = templateService.validateTemplate(template);
        if (!validation.valid) {
            vscode.window.showErrorMessage(`模板校验失败: ${validation.error}`);
            return;
        }
        const mockBook = {
            bookId: 'preview-book',
            title: '示例：深入浅出 TypeScript',
            author: '示例作者',
            cover: '',
            isbn: '978-7-111-11111-1',
            publisher: '示例出版社',
            progress: 56,
            readingStatus: models_1.ReadingStatus.Reading,
            highlightCount: 2,
            noteCount: 2,
        };
        const mockNotes = [
            {
                noteId: 'n1',
                bookId: 'preview-book',
                chapterUid: 1,
                chapterTitle: '第一章 入门',
                type: 1,
                highlightText: 'TypeScript 可以在编译阶段捕获大量潜在错误。',
                thoughtText: '非常适合中大型项目。',
                createTime: Math.floor(Date.now() / 1000),
            },
            {
                noteId: 'n2',
                bookId: 'preview-book',
                chapterUid: 2,
                chapterTitle: '第二章 类型系统',
                type: 1,
                highlightText: '联合类型和泛型是 TS 的核心能力。',
                createTime: Math.floor(Date.now() / 1000),
            },
        ];
        const preview = templateService.render(mockBook, mockNotes);
        this.panel.webview.postMessage({
            command: 'setPreview',
            preview,
        });
    }
    /**
     * 重置模板
     */
    async resetTemplate() {
        const defaultTemplate = this.getDefaultTemplate();
        await vscode.workspace
            .getConfiguration('weread')
            .update('noteTemplate', '', vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('已重置为默认模板');
        this.panel.webview.postMessage({
            command: 'setTemplate',
            template: defaultTemplate,
        });
    }
    /**
     * 获取默认模板
     */
    getDefaultTemplate() {
        return `---
bookId: {{bookId}}
title: {{title}}
author: {{author}}
cover: {{cover}}
---

# {{title}}

## 书籍信息
- **作者**: {{author}}
- **出版社**: {{publisher}}
- **ISBN**: {{isbn}}
- **阅读进度**: {{progress}}%

## 读书笔记

{% for chapter in chapters %}
### {{chapter.title}}

{% for note in chapter.notes %}
> {{note.highlightText}}

{% if note.thoughtText %}
💭 {{note.thoughtText}}
{% endif %}

{% endfor %}
{% endfor %}

## 书评

{{bookReview}}`;
    }
    /**
     * 获取 HTML 内容
     */
    getHtmlContent(currentTemplate, currentFileNameTemplate) {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>模板编辑器</title>
  <style>
    * {
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      padding: 20px;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      line-height: 1.6;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    
    h1 {
      margin-bottom: 8px;
      font-size: 24px;
    }
    
    .subtitle {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 24px;
    }
    
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 20px;
    }
    
    .tab {
      padding: 10px 20px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    
    .tab:hover {
      background-color: var(--vscode-list-hoverBackground);
    }
    
    .tab.active {
      border-bottom-color: var(--vscode-focusBorder);
      color: var(--vscode-focusBorder);
    }
    
    .tab-content {
      display: none;
    }
    
    .tab-content.active {
      display: block;
    }
    
    .editor-container {
      display: flex;
      gap: 20px;
    }
    
    .editor-section {
      flex: 1;
    }
    
    .sidebar {
      width: 280px;
      flex-shrink: 0;
    }
    
    .panel {
      background-color: var(--vscode-panel-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    
    .panel-title {
      font-weight: 600;
      margin-bottom: 12px;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
    }
    
    textarea {
      width: 100%;
      min-height: 400px;
      font-family: 'Fira Code', 'Consolas', monospace;
      font-size: 14px;
      line-height: 1.6;
      padding: 12px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      resize: vertical;
      tab-size: 2;
    }
    
    textarea:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    
    input[type="text"] {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: 'Fira Code', 'Consolas', monospace;
    }
    
    input[type="text"]:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    
    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s;
      margin-right: 8px;
      margin-bottom: 8px;
    }
    
    .btn-primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    
    .btn-primary:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    
    .btn-secondary {
      background-color: var(--vscode-secondaryButton-background);
      color: var(--vscode-secondaryButton-foreground);
    }
    
    .btn-secondary:hover {
      background-color: var(--vscode-secondaryButton-hoverBackground);
    }
    
    .variable-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    
    .variable-item {
      padding: 6px 8px;
      margin-bottom: 4px;
      background-color: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
      font-family: 'Fira Code', monospace;
      font-size: 12px;
      cursor: pointer;
      transition: background-color 0.2s;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .variable-item:hover {
      background-color: var(--vscode-list-hoverBackground);
    }
    
    .variable-name {
      color: var(--vscode-symbolIcon-variableForeground);
    }
    
    .variable-desc {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    
    .tag {
      display: inline-block;
      padding: 2px 6px;
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 3px;
      font-size: 10px;
      margin-left: 4px;
    }
    
    .help-text {
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
      margin-top: 8px;
    }
    
    .example-box {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border-radius: 4px;
      margin-top: 12px;
      font-family: 'Fira Code', monospace;
      font-size: 12px;
      overflow-x: auto;
    }
    
    .example-box pre {
      margin: 0;
      white-space: pre-wrap;
    }
    
    .toolbar {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    
    .template-preview {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 16px;
      border-radius: 4px;
      margin-top: 16px;
      font-family: 'Fira Code', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      overflow-x: auto;
      max-height: 300px;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📝 模板编辑器</h1>
    <p class="subtitle">自定义微信读书笔记导出格式</p>
    
    <div class="tabs">
      <div class="tab active" data-tab="content">内容模板</div>
      <div class="tab" data-tab="filename">文件名模板</div>
    </div>
    
    <!-- 内容模板标签页 -->
    <div class="tab-content active" id="content-tab">
      <div class="editor-container">
        <div class="editor-section">
          <div class="toolbar">
            <button class="btn btn-primary" id="save-content-btn">💾 保存模板</button>
            <button class="btn btn-secondary" id="preview-btn">👁️ 预览</button>
            <button class="btn btn-secondary" id="reset-btn">🔄 重置默认</button>
          </div>
          <textarea id="template-editor" placeholder="在此输入模板...">${this.escapeHtml(currentTemplate)}</textarea>
          <p class="help-text">使用 Nunjucks 模板语法。点击右侧变量可插入到光标位置。</p>
        </div>
        
        <div class="sidebar">
          <div class="panel">
            <div class="panel-title">📚 书籍变量</div>
            <ul class="variable-list">
              <li class="variable-item" data-variable="{{title}}">
                <span class="variable-name">{{title}}</span>
                <span class="variable-desc">书名</span>
              </li>
              <li class="variable-item" data-variable="{{author}}">
                <span class="variable-name">{{author}}</span>
                <span class="variable-desc">作者</span>
              </li>
              <li class="variable-item" data-variable="{{publisher}}">
                <span class="variable-name">{{publisher}}</span>
                <span class="variable-desc">出版社</span>
              </li>
              <li class="variable-item" data-variable="{{isbn}}">
                <span class="variable-name">{{isbn}}</span>
                <span class="variable-desc">ISBN</span>
              </li>
              <li class="variable-item" data-variable="{{cover}}">
                <span class="variable-name">{{cover}}</span>
                <span class="variable-desc">封面URL</span>
              </li>
              <li class="variable-item" data-variable="{{progress}}">
                <span class="variable-name">{{progress}}</span>
                <span class="variable-desc">阅读进度</span>
              </li>
              <li class="variable-item" data-variable="{{category}}">
                <span class="variable-name">{{category}}</span>
                <span class="variable-desc">分类</span>
              </li>
            </ul>
          </div>
          
          <div class="panel">
            <div class="panel-title">📖 章节变量</div>
            <ul class="variable-list">
              <li class="variable-item" data-variable="{% for chapter in chapters %}\n{% endfor %}">
                <span class="variable-name">chapters</span>
                <span class="tag">循环</span>
              </li>
              <li class="variable-item" data-variable="{{chapter.title}}">
                <span class="variable-name">{{chapter.title}}</span>
                <span class="variable-desc">章节标题</span>
              </li>
              <li class="variable-item" data-variable="{{chapter.notes}}">
                <span class="variable-name">{{chapter.notes}}</span>
                <span class="variable-desc">章节笔记</span>
              </li>
            </ul>
          </div>
          
          <div class="panel">
            <div class="panel-title">📝 笔记变量</div>
            <ul class="variable-list">
              <li class="variable-item" data-variable="{% for note in chapter.notes %}\n{% endfor %}">
                <span class="variable-name">notes</span>
                <span class="tag">循环</span>
              </li>
              <li class="variable-item" data-variable="{{note.highlightText}}">
                <span class="variable-name">{{note.highlightText}}</span>
                <span class="variable-desc">划线内容</span>
              </li>
              <li class="variable-item" data-variable="{{note.thoughtText}}">
                <span class="variable-name">{{note.thoughtText}}</span>
                <span class="variable-desc">想法</span>
              </li>
              <li class="variable-item" data-variable="{{note.createTime}}">
                <span class="variable-name">{{note.createTime}}</span>
                <span class="variable-desc">创建时间</span>
              </li>
            </ul>
          </div>
          
          <div class="panel">
            <div class="panel-title">🔧 控制语法</div>
            <ul class="variable-list">
              <li class="variable-item" data-variable="{% if condition %}\n{% endif %}">
                <span class="variable-name">if/endif</span>
                <span class="tag">条件</span>
              </li>
              <li class="variable-item" data-variable="{{ variable | default('默认值') }}">
                <span class="variable-name">default</span>
                <span class="tag">过滤器</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
      
      <div id="preview-container" style="display: none;">
        <h3>预览</h3>
        <div class="template-preview" id="preview-content"></div>
      </div>
    </div>
    
    <!-- 文件名模板标签页 -->
    <div class="tab-content" id="filename-tab">
      <div class="panel" style="max-width: 600px;">
        <div class="panel-title">📁 文件名模板</div>
        <p class="help-text">定义导出文件的命名格式</p>
        <input type="text" id="filename-input" value="${this.escapeHtml(currentFileNameTemplate)}" placeholder="{{title}} - {{author}}">
        <p class="help-text">可用变量: {{title}}, {{author}}, {{isbn}}, {{category}}</p>
        <div style="margin-top: 16px;">
          <button class="btn btn-primary" id="save-filename-btn">💾 保存</button>
        </div>
        <div class="example-box">
          <strong>示例:</strong><br>
          模板: {{title}} - {{author}}.md<br>
          结果: 深入浅出Node.js - 朴灵.md
        </div>
      </div>
    </div>
  </div>
  
  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      
      // 标签页切换
      const tabs = document.querySelectorAll('.tab');
      const tabContents = document.querySelectorAll('.tab-content');
      
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          const targetTab = tab.dataset.tab;
          
          tabs.forEach(t => t.classList.remove('active'));
          tabContents.forEach(c => c.classList.remove('active'));
          
          tab.classList.add('active');
          document.getElementById(targetTab + '-tab').classList.add('active');
        });
      });
      
      // 变量插入
      const variableItems = document.querySelectorAll('.variable-item');
      const editor = document.getElementById('template-editor');
      
      variableItems.forEach(item => {
        item.addEventListener('click', () => {
          const variable = item.dataset.variable;
          const start = editor.selectionStart;
          const end = editor.selectionEnd;
          const value = editor.value;
          
          editor.value = value.substring(0, start) + variable + value.substring(end);
          editor.focus();
          editor.setSelectionRange(start + variable.length, start + variable.length);
        });
      });
      
      // 保存内容模板
      document.getElementById('save-content-btn').addEventListener('click', () => {
        const template = editor.value;
        vscode.postMessage({
          command: 'saveTemplate',
          template: template
        });
      });
      
      // 保存文件名模板
      document.getElementById('save-filename-btn').addEventListener('click', () => {
        const template = document.getElementById('filename-input').value;
        vscode.postMessage({
          command: 'saveFileNameTemplate',
          template: template
        });
      });
      
      // 预览
      document.getElementById('preview-btn').addEventListener('click', () => {
        const template = editor.value;
        vscode.postMessage({
          command: 'previewTemplate',
          template: template
        });
      });
      
      // 重置
      document.getElementById('reset-btn').addEventListener('click', () => {
        vscode.postMessage({
          command: 'resetTemplate'
        });
      });
      
      // 接收消息
      window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.command) {
          case 'setTemplate':
            editor.value = message.template;
            break;
          case 'setPreview':
            document.getElementById('preview-container').style.display = 'block';
            document.getElementById('preview-content').textContent = message.preview || '';
            break;
        }
      });
      
      // 初始化时获取默认模板
      vscode.postMessage({
        command: 'getDefaultTemplate'
      });
    })();
  </script>
</body>
</html>`;
    }
    /**
     * HTML 转义
     */
    escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    /**
     * 清理资源
     */
    dispose() {
        TemplateEditorPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
exports.TemplateEditorPanel = TemplateEditorPanel;
/**
 * 打开模板编辑器
 */
function openTemplateEditor(context) {
    TemplateEditorPanel.createOrShow(context);
}
exports.openTemplateEditor = openTemplateEditor;
//# sourceMappingURL=settings.js.map