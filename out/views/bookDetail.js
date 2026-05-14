"use strict";
/**
 * 书籍详情页服务
 */
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
exports.getBookDetailView = exports.initializeBookDetailView = exports.BookDetailView = void 0;
const vscode = __importStar(require("vscode"));
const storageService_1 = require("../services/storageService");
const webviewManager_1 = require("./webviewManager");
class BookDetailView {
    constructor(extensionUri) {
        this.webviewManager = (0, webviewManager_1.initializeWebviewManager)(extensionUri);
    }
    /**
     * 显示书籍详情
     */
    show(book) {
        const panel = this.webviewManager.create({
            title: `《${book.title}》`,
            column: vscode.ViewColumn.One,
        });
        // 获取笔记数据
        const storageService = (0, storageService_1.getStorageService)();
        const notes = storageService.getNotes(book.bookId);
        // 生成 HTML
        const html = this.generateHtml(book, notes);
        this.webviewManager.setContent(html);
        // 注册消息处理器
        this.webviewManager.onMessage('refresh', () => {
            this.refresh(book);
        });
        this.webviewManager.onMessage('scrollToChapter', (data) => {
            // 处理章节跳转
            console.log('Scroll to chapter:', data.chapterTitle);
        });
    }
    /**
     * 刷新页面
     */
    refresh(book) {
        const storageService = (0, storageService_1.getStorageService)();
        const notes = storageService.getNotes(book.bookId);
        const html = this.generateHtml(book, notes);
        this.webviewManager.setContent(html);
    }
    /**
     * 生成 HTML 内容
     */
    generateHtml(book, notes) {
        const groupedNotes = this.groupNotesByChapter(notes);
        const chapters = this.extractChapters(notes);
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${book.title}</title>
  <style>
    ${this.getStyles()}
  </style>
</head>
<body>
  <div class="container">
    <aside class="chapter-sidebar">
      ${this.renderChapterTree(chapters, groupedNotes)}
    </aside>
    <main class="main-content">
      ${this.renderHeader(book)}
      ${this.renderNotes(groupedNotes)}
    </main>
  </div>
  
  <script>
    ${this.getScripts()}
  </script>
</body>
</html>`;
    }
    /**
     * 按章节分组笔记
     */
    groupNotesByChapter(notes) {
        const grouped = new Map();
        for (const note of notes) {
            const chapterTitle = note.chapterTitle || '未分类';
            if (!grouped.has(chapterTitle)) {
                grouped.set(chapterTitle, []);
            }
            grouped.get(chapterTitle).push(note);
        }
        return grouped;
    }
    /**
     * 提取章节信息
     */
    extractChapters(notes) {
        const chapterMap = new Map();
        for (const note of notes) {
            const chapterTitle = note.chapterTitle || '未分类';
            if (!chapterMap.has(chapterTitle)) {
                chapterMap.set(chapterTitle, {
                    chapterUid: note.chapterUid || 0,
                    title: chapterTitle,
                    chapterIdx: 0,
                    level: 1,
                });
            }
        }
        return Array.from(chapterMap.values());
    }
    /**
     * 渲染章节树
     */
    renderChapterTree(chapters, groupedNotes) {
        if (chapters.length === 0) {
            return '<div class="sidebar-empty">暂无章节</div>';
        }
        let html = `
    <div class="sidebar-header">
      <h3>📑 章节导航</h3>
      <span class="chapter-count">${chapters.length} 章</span>
    </div>
    <nav class="chapter-tree">
      <ul class="chapter-list">`;
        for (const chapter of chapters) {
            const noteCount = groupedNotes.get(chapter.title)?.length || 0;
            const chapterId = this.escapeHtml(chapter.title).replace(/\s+/g, '-');
            html += `
        <li class="chapter-item" data-chapter="${chapterId}">
          <a href="#chapter-${chapterId}" class="chapter-link" onclick="scrollToChapter('${chapterId}')">
            <span class="chapter-title-text">${this.escapeHtml(chapter.title)}</span>
            <span class="note-badge">${noteCount}</span>
          </a>
        </li>`;
        }
        html += `
      </ul>
    </nav>`;
        return html;
    }
    /**
     * 渲染头部
     */
    renderHeader(book) {
        return `
    <header class="book-header">
      <div class="book-cover">
        <img src="${book.cover}" alt="${book.title}" onerror="this.style.display='none'">
      </div>
      <div class="book-info">
        <h1 class="book-title">${book.title}</h1>
        <p class="book-author">${book.author}</p>
        ${book.publisher ? `<p class="book-publisher">${book.publisher}</p>` : ''}
        <div class="book-meta">
          <span class="reading-progress">阅读进度: ${book.progress}%</span>
          <span class="note-count">笔记: ${book.noteCount} 条</span>
          <span class="highlight-count">划线: ${book.highlightCount} 条</span>
        </div>
        <div class="book-actions">
          <button class="btn btn-secondary" onclick="refreshNotes()">刷新</button>
        </div>
      </div>
    </header>`;
    }
    /**
     * 渲染笔记列表
     */
    renderNotes(groupedNotes) {
        if (groupedNotes.size === 0) {
            return '<div class="empty-notes">暂无笔记</div>';
        }
        let html = '<div class="notes-container">';
        for (const [chapterTitle, notes] of groupedNotes) {
            const chapterId = this.escapeHtml(chapterTitle).replace(/\s+/g, '-');
            html += `
      <section class="chapter" id="chapter-${chapterId}">
        <h2 class="chapter-title" onclick="toggleChapter('${chapterId}')">
          <span class="chapter-toggle">▾</span>
          <span class="chapter-anchor">#</span>
          ${chapterTitle}
          <span class="chapter-note-count">${notes.length} 条笔记</span>
        </h2>
        <div class="notes-list" id="notes-${chapterId}">
          ${notes.map((note) => this.renderNote(note)).join('')}
        </div>
      </section>`;
        }
        html += '</div>';
        return html;
    }
    /**
     * 渲染单个笔记
     */
    renderNote(note) {
        const highlightHtml = note.highlightText
            ? `<blockquote class="highlight">${this.escapeHtml(note.highlightText)}</blockquote>`
            : '';
        const thoughtHtml = note.thoughtText
            ? `<div class="thought">
          <span class="thought-icon">💭</span>
          <span class="thought-text">${this.escapeHtml(note.thoughtText)}</span>
        </div>`
            : '';
        const timeHtml = note.createTime
            ? `<div class="note-time">${new Date(note.createTime * 1000).toLocaleString()}</div>`
            : '';
        return `
    <div class="note-item" data-note-id="${note.noteId}">
      ${highlightHtml}
      ${thoughtHtml}
      ${timeHtml}
    </div>`;
    }
    /**
     * 转义 HTML 特殊字符
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
     * 获取样式
     */
    getStyles() {
        return `
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      line-height: 1.6;
    }

    .container {
      display: flex;
      min-height: 100vh;
    }

    /* 侧边栏章节导航 */
    .chapter-sidebar {
      width: 260px;
      flex-shrink: 0;
      background: var(--vscode-sideBar-background);
      border-right: 1px solid var(--vscode-panel-border);
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      overflow-y: auto;
      padding: 16px 0;
    }

    .sidebar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 16px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 12px;
    }

    .sidebar-header h3 {
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-sideBarTitle-foreground);
    }

    .chapter-count {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-badge-background);
      padding: 2px 8px;
      border-radius: 10px;
    }

    .sidebar-empty {
      padding: 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
    }

    .chapter-tree {
      padding: 0 8px;
    }

    .chapter-list {
      list-style: none;
    }

    .chapter-item {
      margin-bottom: 2px;
    }

    .chapter-link {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      border-radius: 6px;
      text-decoration: none;
      color: var(--vscode-sideBar-foreground);
      font-size: 13px;
      transition: all 0.2s;
      cursor: pointer;
    }

    .chapter-link:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .chapter-link.active {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .chapter-title-text {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-right: 8px;
    }

    .note-badge {
      font-size: 11px;
      padding: 2px 6px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 10px;
      flex-shrink: 0;
    }

    /* 主内容区 */
    .main-content {
      flex: 1;
      margin-left: 260px;
      padding: 20px;
      max-width: 900px;
    }

    .book-header {
      display: flex;
      gap: 24px;
      padding: 24px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 12px;
      margin-bottom: 32px;
    }

    .book-cover {
      flex-shrink: 0;
      width: 120px;
      height: 160px;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .book-cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .book-info {
      flex: 1;
    }

    .book-title {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--vscode-editor-foreground);
    }

    .book-author {
      font-size: 16px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }

    .book-publisher {
      font-size: 14px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
    }

    .book-meta {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      font-size: 14px;
      color: var(--vscode-descriptionForeground);
    }

    .book-actions {
      display: flex;
      gap: 12px;
    }

    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .btn-secondary {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
    }

    .btn-secondary:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .empty-notes {
      text-align: center;
      padding: 60px 20px;
      color: var(--vscode-descriptionForeground);
      font-size: 16px;
    }

    .chapter {
      margin-bottom: 32px;
      scroll-margin-top: 20px;
    }

    .chapter-title {
      font-size: 18px;
      font-weight: 600;
      padding: 12px 16px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      margin-bottom: 16px;
      color: var(--vscode-editor-foreground);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .chapter-anchor {
      color: var(--vscode-textLink-foreground);
      opacity: 0.5;
      cursor: pointer;
    }

    .chapter-toggle {
      font-size: 12px;
      opacity: 0.8;
      width: 14px;
      text-align: center;
      transition: transform 0.2s;
    }

    .chapter.collapsed .chapter-toggle {
      transform: rotate(-90deg);
    }

    .chapter-anchor:hover {
      opacity: 1;
    }

    .chapter-note-count {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      font-weight: normal;
      margin-left: auto;
    }

    .notes-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .note-item {
      padding: 16px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      border-left: 4px solid var(--vscode-focusBorder);
    }

    .highlight {
      font-size: 15px;
      line-height: 1.8;
      color: var(--vscode-editor-foreground);
      padding: 12px;
      background: var(--vscode-editor-background);
      border-radius: 6px;
      margin-bottom: 12px;
      border-left: 3px solid var(--vscode-textLink-foreground);
      font-style: italic;
    }

    .highlight::before {
      content: '"';
      font-size: 24px;
      color: var(--vscode-textLink-foreground);
      margin-right: 4px;
    }

    .thought {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 0;
    }

    .thought-icon {
      font-size: 16px;
      flex-shrink: 0;
    }

    .thought-text {
      font-size: 14px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.6;
    }

    .note-time {
      font-size: 12px;
      color: var(--vscode-disabledForeground);
      margin-top: 8px;
      text-align: right;
    }

    /* 滚动条样式 */
    .chapter-sidebar::-webkit-scrollbar {
      width: 8px;
    }

    .chapter-sidebar::-webkit-scrollbar-track {
      background: transparent;
    }

    .chapter-sidebar::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 4px;
    }

    .chapter-sidebar::-webkit-scrollbar-thumb:hover {
      background: var(--vscode-scrollbarSlider-hoverBackground);
    }

    /* 响应式 */
    @media (max-width: 768px) {
      .chapter-sidebar {
        display: none;
      }
      
      .main-content {
        margin-left: 0;
      }
    }
    `;
    }
    /**
     * 获取脚本
     */
    getScripts() {
        return `
    const vscode = acquireVsCodeApi();

    function refreshNotes() {
      vscode.postMessage({ command: 'refresh' });
    }

    function scrollToChapter(chapterId) {
      const element = document.getElementById('chapter-' + chapterId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        // 更新侧边栏激活状态
        document.querySelectorAll('.chapter-link').forEach(link => {
          link.classList.remove('active');
        });
        document.querySelector('[data-chapter="' + chapterId + '"] .chapter-link')?.classList.add('active');
      }
      
      vscode.postMessage({ 
        command: 'scrollToChapter', 
        chapterTitle: chapterId 
      });
    }

    function toggleChapter(chapterId) {
      const chapter = document.getElementById('chapter-' + chapterId);
      const notes = document.getElementById('notes-' + chapterId);
      if (!chapter || !notes) {
        return;
      }
      const collapsed = chapter.classList.toggle('collapsed');
      notes.style.display = collapsed ? 'none' : 'flex';
    }

    // 监听滚动，高亮当前章节
    let currentChapter = null;
    const chapters = document.querySelectorAll('.chapter');
    
    window.addEventListener('scroll', () => {
      const scrollPos = window.scrollY + 100;
      
      chapters.forEach(chapter => {
        const top = chapter.offsetTop;
        const bottom = top + chapter.offsetHeight;
        
        if (scrollPos >= top && scrollPos < bottom) {
          const chapterId = chapter.id.replace('chapter-', '');
          if (currentChapter !== chapterId) {
            currentChapter = chapterId;
            
            document.querySelectorAll('.chapter-link').forEach(link => {
              link.classList.remove('active');
            });
            document.querySelector('[data-chapter="' + chapterId + '"] .chapter-link')?.classList.add('active');
          }
        }
      });
    });
    `;
    }
}
exports.BookDetailView = BookDetailView;
let bookDetailViewInstance;
function initializeBookDetailView(extensionUri) {
    bookDetailViewInstance = new BookDetailView(extensionUri);
    return bookDetailViewInstance;
}
exports.initializeBookDetailView = initializeBookDetailView;
function getBookDetailView() {
    if (!bookDetailViewInstance) {
        throw new Error('BookDetailView not initialized');
    }
    return bookDetailViewInstance;
}
exports.getBookDetailView = getBookDetailView;
//# sourceMappingURL=bookDetail.js.map