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
exports.t = void 0;
const vscode = __importStar(require("vscode"));
const messages = {
    'zh-CN': {
        common_unknown: '未知',
        common_cancel: '取消',
        common_notCategorized: '未分类',
        common_book: '本',
        bookshelf_empty: '书架为空',
        bookshelf_empty_desc: '快去微信读书添加书籍吧',
        bookshelf_login_hint: '未登录，点击登录微信读书',
        bookshelf_search_placeholder: '搜索书架（书名/作者/笔记）',
        bookshelf_search_clickInput: '点击输入关键词',
        bookshelf_search_clickClear: '点击清空 ✕',
        bookshelf_search_label: '搜索：{query}',
        bookshelf_search_notFound: '未找到匹配的书籍',
        bookshelf_search_desc: '搜索：{query}',
        bookshelf_search_desc_empty: '请尝试其他关键词',
        bookshelf_insights_entry: '阅读洞察面板',
        bookshelf_insights_entry_desc: '点击打开洞察分析',
        bookshelf_syncing: '正在同步...',
        bookshelf_initializing: '正在初始化微信读书插件...',
        bookshelf_publicAccount: '公众号',
        book_tooltip_category: '分类: {value}',
        book_tooltip_title: '书名: {value}',
        book_tooltip_author: '作者: {value}',
        book_tooltip_publisher: '出版社: {value}',
        book_tooltip_progress: '进度: {value}%',
        book_tooltip_highlight: '划线: {value} 条',
        book_tooltip_note: '笔记: {value} 条',
        auth_logout_success: '已退出登录',
        auth_require_login: '请先登录微信读书',
        auth_login_now: '立即登录',
        sync_not_logged_in_refreshed: '当前未登录，已按本地书架数据和分类设置刷新显示',
        sync_not_logged_in_refreshed_with_local: '当前未登录，已按本地书架数据刷新显示，共加载 {count} 本书，{notes} 条笔记',
        sync_not_logged_in_refreshed_empty: '当前未登录，未发现可用的本地书架数据，请检查导出目录配置',
        sync_title: '正在同步笔记',
        sync_progress: '书架 {book} · 笔记 {notes}{name}',
        sync_progress_refresh: '刷新书架并检查更新...',
        sync_done_no_update: '同步完成，本次没有发现新的笔记更新',
        sync_done_with_update: '同步完成！更新 {books} 本书，{notes} 条笔记',
        sync_failed: '同步失败: {error}',
        incremental_sync_title: '正在增量同步',
        login_required_short: '请先登录',
        incremental_done_latest: '所有笔记已是最新',
        incremental_done_with_update: '增量同步完成！更新 {books} 本书，{notes} 条笔记',
        open_book_not_found: '未找到书籍信息',
        open_book_missing_local: '本地未找到该书籍，请先同步书架',
        open_book_open_failed: '打开笔记失败：请先设置笔记保存路径（weread.outputPath）',
        search_notes_empty: '暂无笔记，请先同步',
        search_notes_placeholder: '搜索笔记内容...',
        search_bookshelf_empty: '书架为空，请先同步书架',
        search_bookshelf_title: '搜索书架（实时筛选）',
        search_bookshelf_prompt: '支持书名、作者、分类、出版社、笔记内容',
        search_filter_cleared: '已清除书架筛选',
        search_default_note: '笔记',
        search_unknown_book: '未知书籍',
        login_provider_protocol: '🌐 网页协议扫码登录',
        login_provider_cookie: '🍪 粘贴 Cookie 登录',
        login_provider_protocol_title: '网页协议扫码登录',
        login_provider_cookie_title: '粘贴 Cookie 登录',
    },
    'zh-TW': {
        common_unknown: '未知',
        common_cancel: '取消',
        common_notCategorized: '未分類',
        common_book: '本',
        bookshelf_empty: '書架為空',
        bookshelf_empty_desc: '快去微信讀書新增書籍吧',
        bookshelf_login_hint: '未登入，點擊登入微信讀書',
        bookshelf_search_placeholder: '搜尋書架（書名/作者/筆記）',
        bookshelf_search_clickInput: '點擊輸入關鍵字',
        bookshelf_search_clickClear: '點擊清除 ✕',
        bookshelf_search_label: '搜尋：{query}',
        bookshelf_search_notFound: '未找到匹配的書籍',
        bookshelf_search_desc: '搜尋：{query}',
        bookshelf_search_desc_empty: '請嘗試其他關鍵字',
        bookshelf_insights_entry: '閱讀洞察面板',
        bookshelf_insights_entry_desc: '點擊開啟洞察分析',
        bookshelf_syncing: '正在同步...',
        bookshelf_initializing: '正在初始化微信讀書外掛...',
        bookshelf_publicAccount: '公眾號',
        book_tooltip_category: '分類: {value}',
        book_tooltip_title: '書名: {value}',
        book_tooltip_author: '作者: {value}',
        book_tooltip_publisher: '出版社: {value}',
        book_tooltip_progress: '進度: {value}%',
        book_tooltip_highlight: '劃線: {value} 條',
        book_tooltip_note: '筆記: {value} 條',
        auth_logout_success: '已登出',
        auth_require_login: '請先登入微信讀書',
        auth_login_now: '立即登入',
        sync_not_logged_in_refreshed: '目前未登入，已依本地書架資料與分類設定刷新顯示',
        sync_not_logged_in_refreshed_with_local: '目前未登入，已依本地書架資料刷新顯示，共載入 {count} 本書，{notes} 條筆記',
        sync_not_logged_in_refreshed_empty: '目前未登入，未找到可用的本地書架資料，請檢查匯出目錄設定',
        sync_title: '正在同步筆記',
        sync_progress: '書架 {book} · 筆記 {notes}{name}',
        sync_progress_refresh: '刷新書架並檢查更新...',
        sync_done_no_update: '同步完成，本次沒有新的筆記更新',
        sync_done_with_update: '同步完成！更新 {books} 本書，{notes} 條筆記',
        sync_failed: '同步失敗: {error}',
        incremental_sync_title: '正在增量同步',
        login_required_short: '請先登入',
        incremental_done_latest: '所有筆記已是最新',
        incremental_done_with_update: '增量同步完成！更新 {books} 本書，{notes} 條筆記',
        open_book_not_found: '未找到書籍資訊',
        open_book_missing_local: '本地未找到該書籍，請先同步書架',
        open_book_open_failed: '打開筆記失敗：請先設定筆記保存路徑（weread.outputPath）',
        search_notes_empty: '暫無筆記，請先同步',
        search_notes_placeholder: '搜尋筆記內容...',
        search_bookshelf_empty: '書架為空，請先同步書架',
        search_bookshelf_title: '搜尋書架（即時篩選）',
        search_bookshelf_prompt: '支援書名、作者、分類、出版社、筆記內容',
        search_filter_cleared: '已清除書架篩選',
        search_default_note: '筆記',
        search_unknown_book: '未知書籍',
        login_provider_protocol: '🌐 網頁協議掃碼登入',
        login_provider_cookie: '🍪 貼上 Cookie 登入',
        login_provider_protocol_title: '網頁協議掃碼登入',
        login_provider_cookie_title: '貼上 Cookie 登入',
    },
    en: {
        common_unknown: 'Unknown',
        common_cancel: 'Cancel',
        common_notCategorized: 'Uncategorized',
        common_book: 'books',
        bookshelf_empty: 'Bookshelf is empty',
        bookshelf_empty_desc: 'Add books in WeRead first',
        bookshelf_login_hint: 'Not logged in. Click to log in to WeRead',
        bookshelf_search_placeholder: 'Search bookshelf (title/author/notes)',
        bookshelf_search_clickInput: 'Click to input keywords',
        bookshelf_search_clickClear: 'Click to clear ✕',
        bookshelf_search_label: 'Search: {query}',
        bookshelf_search_notFound: 'No matched books found',
        bookshelf_search_desc: 'Search: {query}',
        bookshelf_search_desc_empty: 'Try another keyword',
        bookshelf_insights_entry: 'Reading Insights',
        bookshelf_insights_entry_desc: 'Click to open insights dashboard',
        bookshelf_syncing: 'Syncing...',
        bookshelf_initializing: 'Initializing WeRead extension...',
        bookshelf_publicAccount: 'Official Accounts',
        book_tooltip_category: 'Category: {value}',
        book_tooltip_title: 'Title: {value}',
        book_tooltip_author: 'Author: {value}',
        book_tooltip_publisher: 'Publisher: {value}',
        book_tooltip_progress: 'Progress: {value}%',
        book_tooltip_highlight: 'Highlights: {value}',
        book_tooltip_note: 'Notes: {value}',
        auth_logout_success: 'Logged out',
        auth_require_login: 'Please log in to WeRead first',
        auth_login_now: 'Log In',
        sync_not_logged_in_refreshed: 'Not logged in. Refreshed by local bookshelf data and current category mode',
        sync_not_logged_in_refreshed_with_local: 'Not logged in. Refreshed from local bookshelf data and loaded {count} books, {notes} notes',
        sync_not_logged_in_refreshed_empty: 'Not logged in. No local bookshelf data found. Check the export path setting',
        sync_title: 'Syncing notes',
        sync_progress: 'Bookshelf {book} · Notes {notes}{name}',
        sync_progress_refresh: 'Refreshing bookshelf and checking updates...',
        sync_done_no_update: 'Sync completed. No new updates found',
        sync_done_with_update: 'Sync completed! Updated {books} books and {notes} notes',
        sync_failed: 'Sync failed: {error}',
        incremental_sync_title: 'Incremental syncing',
        login_required_short: 'Please log in first',
        incremental_done_latest: 'All notes are up to date',
        incremental_done_with_update: 'Incremental sync completed! Updated {books} books and {notes} notes',
        open_book_not_found: 'Book information not found',
        open_book_missing_local: 'Book not found locally. Please sync bookshelf first',
        open_book_open_failed: 'Failed to open notes: set weread.outputPath first',
        search_notes_empty: 'No notes yet. Sync first',
        search_notes_placeholder: 'Search notes...',
        search_bookshelf_empty: 'Bookshelf is empty. Sync bookshelf first',
        search_bookshelf_title: 'Search bookshelf (live filter)',
        search_bookshelf_prompt: 'Supports title, author, category, publisher, and note content',
        search_filter_cleared: 'Bookshelf filter cleared',
        search_default_note: 'Note',
        search_unknown_book: 'Unknown book',
        login_provider_protocol: '🌐 Web QR login',
        login_provider_cookie: '🍪 Paste Cookie login',
        login_provider_protocol_title: 'Web QR login',
        login_provider_cookie_title: 'Paste Cookie login',
    },
};
function getLanguage() {
    const value = vscode.workspace.getConfiguration('weread').get('language', 'zh-CN');
    if (value === 'zh-TW' || value === 'en') {
        return value;
    }
    return 'zh-CN';
}
function format(template, params) {
    if (!params) {
        return template;
    }
    return template.replace(/\{(\w+)\}/g, (_, key) => {
        return String(params[key] ?? `{${key}}`);
    });
}
function t(key, params) {
    const lang = getLanguage();
    const dict = messages[lang] ?? messages['zh-CN'];
    const fallback = messages['zh-CN'][key];
    const raw = dict[key] ?? fallback;
    return format(raw, params);
}
exports.t = t;
//# sourceMappingURL=index.js.map