/**
 * 阅读洞察看板视图
 */

import * as vscode from 'vscode';
import { getAnalyticsService, InsightsFilter } from '../services/analyticsService';
import { getExportService } from '../services/exportService';
import { getCookieManager } from '../auth';
import { getAccountMetaManager } from '../services/accountMetaManager';

export class InsightsDashboardView {
  private static currentPanel: vscode.WebviewPanel | undefined;
  private lastFilter: InsightsFilter = {
    days: 0,
    category: '',
    finishedOnly: false,
    noteType: 'all',
    trendGranularity: 'day',
  };

  constructor(private readonly extensionUri: vscode.Uri) {}

  async show(): Promise<void> {
    if (InsightsDashboardView.currentPanel) {
      InsightsDashboardView.currentPanel.reveal(vscode.ViewColumn.One);
      await this.pushData(this.lastFilter);
      return;
    }

    const panel = vscode.window.createWebviewPanel('wereadInsights', '阅读洞察面板', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.extensionUri],
    });
    InsightsDashboardView.currentPanel = panel;

    panel.onDidDispose(() => {
      InsightsDashboardView.currentPanel = undefined;
    });

    panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.command === 'loadData') {
        const filter = this.normalizeFilter(message?.filter);
        this.lastFilter = filter;
        await this.pushData(filter);
      }
      if (message?.command === 'openBookDetail') {
        const bookId = String(message?.bookId || '');
        if (!bookId) {
          return;
        }
        await vscode.commands.executeCommand('weread.openBookDetail', bookId);
      }
      if (message?.command === 'exportReport') {
        const filter = this.normalizeFilter(message?.filter);
        const accountId = this.getActiveAccountId();
        const loaded = await getAnalyticsService().getDashboardDataResilient(filter, accountId, {
          retries: 2,
          retryDelayMs: 300,
        });
        const data = loaded.data;
        const result = await getExportService().exportInsightsReport(data);
        if (!result.success || !result.filePath) {
          vscode.window.showErrorMessage(`导出阅读洞察失败（账号：${accountId || 'unknown'}）：${result.error || '未知错误'}`);
          return;
        }
        vscode.window.showInformationMessage(`阅读洞察月报已导出：${result.filePath}`);
        await getExportService().openExportedFile(result.filePath);
      }
    });

    panel.webview.html = this.renderShellHtml(panel.webview);
    await this.pushData(this.lastFilter);
  }

  async refreshIfVisible(): Promise<void> {
    if (!InsightsDashboardView.currentPanel) {
      return;
    }
    await this.pushData(this.lastFilter);
  }

  private normalizeFilter(filter: unknown): InsightsFilter {
    const payload = (filter ?? {}) as Partial<InsightsFilter>;
    const days =
      payload.days === 0 || String(payload.days) === '0'
        ? 0
        : Number(payload.days) || 0;
    return {
      days,
      category: typeof payload.category === 'string' ? payload.category : '',
      finishedOnly: !!payload.finishedOnly,
      noteType: payload.noteType || 'all',
      trendGranularity: payload.trendGranularity === 'week' ? 'week' : 'day',
    };
  }

  private async pushData(filter: InsightsFilter): Promise<void> {
    const panel = InsightsDashboardView.currentPanel;
    if (!panel) {
      return;
    }
    const account = this.getActiveAccountPresentation();
    await panel.webview.postMessage({
      command: 'setLoading',
      filter,
      account,
    });
    try {
      const result = await getAnalyticsService().getDashboardDataResilient(filter, this.getActiveAccountId(), {
        retries: 2,
        retryDelayMs: 350,
      });
      const statusText = result.degraded
        ? `已降级到${result.source === 'storage' ? '本地存储' : '缓存'}数据（账号：${account.displayName || account.accountId || 'unknown'}）`
        : `已从索引加载数据（账号：${account.displayName || account.accountId || 'unknown'}）`;
      await panel.webview.postMessage({
        command: 'renderData',
        data: result.data,
        account,
      });
      await panel.webview.postMessage({
        command: 'setStatus',
        text: statusText,
        degraded: result.degraded,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '未知错误');
      console.error(
        `[Insights][account:${account.accountId || 'default'}] 面板数据加载失败：${message}`
      );
      await panel.webview.postMessage({
        command: 'renderData',
        data: getAnalyticsService().getDashboardData(filter, this.getActiveAccountId()),
        account,
      });
      await panel.webview.postMessage({
        command: 'setStatus',
        text: `洞察数据加载失败（账号：${account.displayName || account.accountId || 'unknown'}）：${message}`,
        degraded: true,
      });
    }
  }

  private getActiveAccountId(): string | undefined {
    const fromCookie = getCookieManager().getActiveAccountId();
    if (fromCookie) {
      return fromCookie;
    }
    const fromMeta = getAccountMetaManager().getActiveAccountId();
    if (fromMeta) {
      return fromMeta;
    }
    return getAccountMetaManager().listAccounts()[0]?.accountId;
  }

  private getActiveAccountPresentation(): { accountId?: string; displayName?: string } {
    const accountId = this.getActiveAccountId();
    if (!accountId) {
      return {};
    }
    const profile = getAccountMetaManager().listAccounts().find((item) => item.accountId === accountId);
    return {
      accountId,
      displayName: profile?.displayName || accountId,
    };
  }

  private renderShellHtml(webview: vscode.Webview): string {
    const nonce = buildNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>阅读洞察面板</title>
  <style>
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .container {
      padding: 0 10px 20px;
    }
    .header {
      display: flex;
      justify-content: flex-start;
      align-items: center;
      margin-bottom: 16px;
      padding: 12px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--vscode-editor-background);
    }
    .filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .filters > * {
      box-sizing: border-box;
      width: 120px;
      min-width: 120px;
    }
    .filter-btn {
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-button-secondaryBackground, var(--vscode-editor-inactiveSelectionBackground));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border-radius: 6px;
      padding: 6px 12px;
      cursor: pointer;
      text-align: center;
    }
    .filter-btn.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    .filter-select {
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 6px;
      padding: 5px 8px;
    }
    .filter-checkbox {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 12px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 6px;
      padding: 5px 8px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    }
    .card-title {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }
    .card-value {
      font-size: 22px;
      font-weight: 600;
    }
    .sections {
      display: grid;
      grid-template-columns: 1.1fr 1fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    .section-title {
      margin: 0 0 10px;
      font-size: 14px;
    }
    .trend-wrap {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 10px;
      background: var(--vscode-editor-background);
    }
    .trend-legend {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .legend-btn {
      border: 1px solid var(--vscode-input-border);
      border-radius: 999px;
      background: var(--vscode-button-secondaryBackground, var(--vscode-editor-inactiveSelectionBackground));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      padding: 3px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .legend-btn.active {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .legend-btn.inactive {
      opacity: 0.6;
    }
    .trend-chart {
      width: 100%;
      min-height: 180px;
      position: relative;
    }
    .chart-tooltip {
      position: absolute;
      pointer-events: none;
      z-index: 2;
      background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border));
      color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 12px;
      white-space: nowrap;
      display: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    }
    .table {
      width: 100%;
      border-collapse: collapse;
    }
    .table th,
    .table td {
      border-bottom: 1px solid var(--vscode-panel-border);
      text-align: left;
      font-size: 12px;
      padding: 6px 2px;
      vertical-align: top;
    }
    .table th {
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
    }
    .timeline {
      max-height: 260px;
      overflow: auto;
    }
    .heatmap-grid {
      display: grid;
      grid-template-columns: repeat(24, minmax(0, 1fr));
      gap: 2px;
      margin-top: 8px;
    }
    .heatmap-cell {
      height: 10px;
      border-radius: 2px;
      background: var(--vscode-panel-border);
    }
    .bars {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .bar-item {
      display: grid;
      grid-template-columns: 120px 1fr 80px;
      gap: 8px;
      align-items: center;
      font-size: 12px;
    }
    .bar-track {
      height: 8px;
      border-radius: 999px;
      background: var(--vscode-panel-border);
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: var(--vscode-charts-blue, #4f8cff);
    }
    .scatter-chart {
      width: 100%;
      min-height: 220px;
      position: relative;
    }
    .timeline-item {
      border-left: 2px solid var(--vscode-charts-green, #3fb950);
      padding: 6px 0 8px 10px;
      margin-bottom: 8px;
    }
    .timeline-meta {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .timeline-text {
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      padding: 8px 0;
    }
    .status-banner {
      margin-bottom: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--vscode-panel-border);
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      display: none;
    }
    .status-banner.visible {
      display: block;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="filters">
        <select id="daysFilter" class="filter-select">
          <option value="0">全部数据</option>
          <option value="7">最近7天</option>
          <option value="30">最近30天</option>
          <option value="90">最近90天</option>
        </select>
        <select id="categoryFilter" class="filter-select">
          <option value="all">全部分类</option>
        </select>
        <select id="noteTypeFilter" class="filter-select">
          <option value="all">全部笔记类型</option>
          <option value="highlight">仅划线</option>
          <option value="thought">仅想法</option>
          <option value="chapter">仅章节笔记</option>
          <option value="review">仅书评</option>
        </select>
        <select id="trendGranularityFilter" class="filter-select">
          <option value="day">按天趋势</option>
          <option value="week">按周趋势</option>
        </select>
        <label class="filter-checkbox">
          <input id="finishedOnlyFilter" type="checkbox">
          仅完读
        </label>
        <button id="exportReportBtn" class="filter-btn">导出月报</button>
      </div>
    </div>

    <div id="statusBanner" class="status-banner visible">正在加载阅读洞察数据...</div>

    <div id="kpi" class="kpi-grid"></div>

    <div class="sections">
      <div class="card">
        <h3 class="section-title">阅读趋势（阅读活跃 / 笔记产出）</h3>
        <div class="trend-wrap">
          <div class="trend-legend">
            <button class="legend-btn active" id="legendNotes" data-series="notes">笔记产出</button>
            <button class="legend-btn active" id="legendActive" data-series="active">阅读活跃</button>
          </div>
          <div id="trend" class="trend-chart"></div>
        </div>
      </div>
      <div class="card">
        <h3 class="section-title">高价值书籍 Top10</h3>
        <div id="topBooks"></div>
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">最近笔记时间线</h3>
      <div id="timeline" class="timeline"></div>
    </div>

    <div class="sections" style="margin-top: 12px;">
      <div class="card">
        <h3 class="section-title">活跃时段热力图（7x24）</h3>
        <div id="heatmap"></div>
      </div>
      <div class="card">
        <h3 class="section-title">分类主题占比（按笔记量）</h3>
        <div id="categoryShare"></div>
      </div>
    </div>

    <div class="sections" style="margin-top: 12px;">
      <div class="card">
        <h3 class="section-title">偏好作者云图</h3>
        <div id="authorCloud" style="min-height: 220px; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; padding: 16px; gap: 12px;"></div>
      </div>
      <div class="card">
        <h3 class="section-title" style="display: flex; justify-content: space-between; align-items: center;">
          阅读偏好雷达图
          <div style="font-size: 12px; font-weight: normal;">
            <button class="legend-btn active" id="radarLevel1">一级分类</button>
            <button class="legend-btn inactive" id="radarLevel2">二级分类</button>
          </div>
        </h3>
        <div id="categoryRadar" style="min-height: 220px; position: relative;"></div>
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">书籍散点分析（阅读时长 vs 笔记密度）</h3>
      <div id="scatter" class="scatter-chart"></div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = {
      filter: { days: 0, category: 'all', finishedOnly: false, noteType: 'all', trendGranularity: 'day' },
      data: null,
      trendVisible: { notes: true, active: true },
      loading: false,
      status: { text: '', degraded: false }
    };

    function loadData() {
      setLoadingState(true, state.filter);
      vscode.postMessage({ command: 'loadData', filter: state.filter });
    }

    function initDaysFilter() {
      const daysSelect = document.getElementById('daysFilter');
      daysSelect.addEventListener('change', () => {
        state.filter.days = Number(daysSelect.value || 0);
        loadData();
      });
    }

    function initTrendLegend() {
      const buttons = document.querySelectorAll('.legend-btn');
      buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const series = btn.dataset.series;
          if (series !== 'notes' && series !== 'active') {
            return;
          }
          state.trendVisible[series] = !state.trendVisible[series];
          btn.classList.toggle('active', state.trendVisible[series]);
          btn.classList.toggle('inactive', !state.trendVisible[series]);
          renderTrend(state.data ? state.data.trend : []);
        });
      });
    }

    function initSelectFilters() {
      const categorySelect = document.getElementById('categoryFilter');
      const noteTypeSelect = document.getElementById('noteTypeFilter');
      const trendGranularitySelect = document.getElementById('trendGranularityFilter');
      const finishedOnlyCheck = document.getElementById('finishedOnlyFilter');

      categorySelect.addEventListener('change', () => {
        state.filter.category = categorySelect.value;
        loadData();
      });
      noteTypeSelect.addEventListener('change', () => {
        state.filter.noteType = noteTypeSelect.value;
        loadData();
      });
      trendGranularitySelect.addEventListener('change', () => {
        state.filter.trendGranularity = trendGranularitySelect.value === 'week' ? 'week' : 'day';
        loadData();
      });
      finishedOnlyCheck.addEventListener('change', () => {
        state.filter.finishedOnly = !!finishedOnlyCheck.checked;
        loadData();
      });
    }

    function initExportButton() {
      const exportBtn = document.getElementById('exportReportBtn');
      exportBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'exportReport', filter: state.filter });
      });
    }

    function renderCategoryOptions(categories, selectedValue) {
      const select = document.getElementById('categoryFilter');
      const merged = Array.from(new Set(['未分类'].concat(categories || [])));
      const options = ['<option value="all">全部分类</option>']
        .concat(merged.map((item) => (
          '<option value="' + escapeHtml(item) + '">' + escapeHtml(item) + '</option>'
        )));
      select.innerHTML = options.join('');
      select.value = selectedValue || 'all';
    }

    function renderKpi(kpis) {
      const wrap = document.getElementById('kpi');
      const cards = [
        ['活跃天数', kpis.activeDays + ' 天'],
        ['最长连续', kpis.longestStreakDays + ' 天'],
        ['笔记总数', String(kpis.totalNotes)],
        ['笔记密度', kpis.noteDensityPer100Pages + ' /100页'],
        ['深度笔记占比', kpis.deepNoteRatio + '%'],
        ['平均完成率', kpis.averageCompletionRate + '%'],
        ['平均每本笔记数', String(kpis.averageNotesPerBook)]
      ];
      wrap.innerHTML = cards.map(([title, value]) => (
        '<div class="card"><div class="card-title">' + escapeHtml(title) + '</div><div class="card-value">' + escapeHtml(value) + '</div></div>'
      )).join('');
    }

    function renderTrend(trend) {
      const el = document.getElementById('trend');
      if (!trend || trend.length === 0) {
        el.innerHTML = '<div class="empty">' + buildEmptyText('当前筛选范围暂无笔记数据') + '</div>';
        return;
      }
      if (!state.trendVisible.notes && !state.trendVisible.active) {
        el.innerHTML = '<div class="empty">请至少开启一个图例系列</div>';
        return;
      }

      const width = 680;
      const height = 190;
      const padding = { top: 10, right: 8, bottom: 24, left: 28 };
      const chartW = width - padding.left - padding.right;
      const chartH = height - padding.top - padding.bottom;
      const notesValues = trend.map((item) => item.notesCount);
      const activeValues = trend.map((item) => item.touchedBooks);
      const visibleValues = []
        .concat(state.trendVisible.notes ? notesValues : [])
        .concat(state.trendVisible.active ? activeValues : []);
      const maxY = Math.max(...visibleValues, 1);

      function toPoint(index, value) {
        const x = padding.left + (trend.length <= 1 ? chartW / 2 : (index / (trend.length - 1)) * chartW);
        const y = padding.top + chartH - (value / maxY) * chartH;
        return { x, y };
      }

      function buildPath(values) {
        return values
          .map((value, index) => {
            const point = toPoint(index, value);
            return (index === 0 ? 'M' : 'L') + point.x.toFixed(2) + ' ' + point.y.toFixed(2);
          })
          .join(' ');
      }

      function buildDots(values, color, label, series) {
        return values
          .map((value, index) => {
            const point = toPoint(index, value);
            const item = trend[index];
            const title = escapeHtml(item.date + ' · ' + label + ' ' + value);
            return '<circle class="trend-dot" data-series="' + series + '" data-date="' + escapeHtml(item.date) + '" data-value="' + value + '" data-label="' + escapeHtml(label) + '" cx="' + point.x.toFixed(2) + '" cy="' + point.y.toFixed(2) + '" r="2.5" fill="' + color + '"><title>' + title + '</title></circle>';
          })
          .join('');
      }

      const grid = [0, 0.25, 0.5, 0.75, 1]
        .map((ratio) => {
          const y = (padding.top + chartH - ratio * chartH).toFixed(2);
          return '<line x1="' + padding.left + '" y1="' + y + '" x2="' + (padding.left + chartW) + '" y2="' + y + '" stroke="var(--vscode-panel-border)" stroke-width="1" opacity="0.4" />';
        })
        .join('');

      const xLabels = trend
        .map((item, index) => {
          if (!(index === 0 || index === trend.length - 1 || index % Math.max(1, Math.round(trend.length / 4)) === 0)) {
            return '';
          }
          const point = toPoint(index, 0);
          return '<text x="' + point.x.toFixed(2) + '" y="' + (height - 6) + '" fill="var(--vscode-descriptionForeground)" font-size="10" text-anchor="middle">' + escapeHtml(item.date.slice(5)) + '</text>';
        })
        .join('');

      const notesLine = state.trendVisible.notes
        ? '<path d="' + buildPath(notesValues) + '" fill="none" stroke="var(--vscode-charts-blue, #4f8cff)" stroke-width="2" />'
            + buildDots(notesValues, 'var(--vscode-charts-blue, #4f8cff)', '笔记产出', 'notes')
        : '';
      const activeLine = state.trendVisible.active
        ? '<path d="' + buildPath(activeValues) + '" fill="none" stroke="var(--vscode-charts-green, #3fb950)" stroke-width="2" />'
            + buildDots(activeValues, 'var(--vscode-charts-green, #3fb950)', '阅读活跃', 'active')
        : '';

      el.innerHTML =
        '<div class="chart-tooltip" id="trendTooltip"></div>' +
        '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '">' +
          grid +
          notesLine +
          activeLine +
          xLabels +
        '</svg>';

      const tooltip = document.getElementById('trendTooltip');
      el.querySelectorAll('.trend-dot').forEach((dot) => {
        dot.addEventListener('mouseenter', () => {
          const date = dot.getAttribute('data-date') || '';
          const label = dot.getAttribute('data-label') || '';
          const value = dot.getAttribute('data-value') || '0';
          tooltip.textContent = date + ' · ' + label + ': ' + value;
          tooltip.style.display = 'block';
        });
        dot.addEventListener('mousemove', (event) => {
          const rect = el.getBoundingClientRect();
          tooltip.style.left = Math.max(0, event.clientX - rect.left + 10) + 'px';
          tooltip.style.top = Math.max(0, event.clientY - rect.top - 28) + 'px';
        });
        dot.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
      });
    }

    function renderTopBooks(books) {
      const el = document.getElementById('topBooks');
      if (!books || books.length === 0) {
        el.innerHTML = '<div class="empty">' + buildEmptyText('当前筛选范围暂无可排名书籍') + '</div>';
        return;
      }
      const rows = books.map((book) => (
        '<tr>' +
          '<td><a href="#" class="book-link" data-book-id="' + escapeHtml(book.bookId) + '">' + escapeHtml(book.title) + '</a></td>' +
          '<td>' + escapeHtml(String(book.notesCount)) + '</td>' +
          '<td>' + escapeHtml(book.completionRate + '%') + '</td>' +
          '<td>' + escapeHtml(book.deepNoteRatio + '%') + '</td>' +
          '<td>' + escapeHtml(String(book.valueScore)) + '</td>' +
        '</tr>'
      )).join('');

      el.innerHTML =
        '<table class="table">' +
          '<thead><tr><th>书籍</th><th>笔记</th><th>完成率</th><th>深度占比 <span title="深度占比 = 深度笔记数量 / 总笔记数量&#10;深度笔记定义：想法字数≥50 或 划线字数≥100" style="cursor:help;color:var(--vscode-descriptionForeground);font-size:11px;font-weight:normal;">ⓘ</span></th><th>价值分 <span title="综合评分 (0-100)&#10;= 笔记产出分(权重50%) + 深度占比(权重30%) + 完成率(权重20%)&#10;*笔记产出分: 单本最多20条笔记即达满分" style="cursor:help;color:var(--vscode-descriptionForeground);font-size:11px;font-weight:normal;">ⓘ</span></th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>';

      el.querySelectorAll('.book-link').forEach((link) => {
        link.addEventListener('click', (event) => {
          event.preventDefault();
          const bookId = link.getAttribute('data-book-id');
          if (!bookId) {
            return;
          }
          vscode.postMessage({ command: 'openBookDetail', bookId });
        });
      });
    }

    function renderTimeline(list) {
      const el = document.getElementById('timeline');
      if (!list || list.length === 0) {
        el.innerHTML = '<div class="empty">' + buildEmptyText('当前筛选范围暂无笔记动态') + '</div>';
        return;
      }
      el.innerHTML = list.map((item) => {
        const time = formatDate(item.createdAt);
        const text = [item.highlightText, item.thoughtText].filter(Boolean).join('\\n');
        return (
          '<div class="timeline-item">' +
            '<div class="timeline-meta">' + escapeHtml(time + ' · ' + item.bookTitle + ' · ' + item.noteType + ' · ' + item.chapterTitle) + '</div>' +
            '<div class="timeline-text">' + escapeHtml(text || '（无文本内容）') + '</div>' +
          '</div>'
        );
      }).join('');
    }

    function renderHeatmap(cells) {
      const el = document.getElementById('heatmap');
      if (!cells || cells.length === 0) {
        el.innerHTML = '<div class="empty">' + buildEmptyText('暂无活跃时段数据') + '</div>';
        return;
      }
      const max = Math.max(...cells.map((item) => item.value), 1);
      const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
      const rows = [];
      for (let day = 0; day < 7; day++) {
        const rowCells = [];
        for (let hour = 0; hour < 24; hour++) {
          const cell = cells.find((item) => item.weekDay === day && item.hour === hour) || { value: 0 };
          const alpha = cell.value <= 0 ? 0.08 : Math.max(0.14, cell.value / max);
          rowCells.push(
            '<div class="heatmap-cell" style="background: rgba(79,140,255,' + alpha.toFixed(2) + ')" title="周' + dayLabels[day] + ' ' + hour + ':00 · ' + cell.value + '"></div>'
          );
        }
        rows.push(
          '<div style="display:grid;grid-template-columns:24px 1fr;gap:8px;align-items:center;margin-bottom:4px;">'
            + '<div style="font-size:11px;color:var(--vscode-descriptionForeground)">周' + dayLabels[day] + '</div>'
            + '<div class="heatmap-grid">' + rowCells.join('') + '</div>'
          + '</div>'
        );
      }
      
      const axisHtml = 
        '<div style="display:grid;grid-template-columns:24px 1fr;gap:8px;align-items:center;margin-top:4px;">'
          + '<div></div>'
          + '<div style="position:relative;height:14px;font-size:10px;color:var(--vscode-descriptionForeground)">'
            + '<span style="position:absolute;left:0%;transform:translateX(0%);">0:00</span>'
            + '<span style="position:absolute;left:25%;transform:translateX(-50%);">6:00</span>'
            + '<span style="position:absolute;left:50%;transform:translateX(-50%);">12:00</span>'
            + '<span style="position:absolute;left:75%;transform:translateX(-50%);">18:00</span>'
            + '<span style="position:absolute;left:100%;transform:translateX(-100%);">24:00</span>'
          + '</div>'
        + '</div>';

      el.innerHTML = '<div class="chart-tooltip" id="heatmapTooltip"></div>' + rows.join('') + axisHtml;
      const tooltip = document.getElementById('heatmapTooltip');
      el.querySelectorAll('.heatmap-cell').forEach((cell) => {
        cell.addEventListener('mouseenter', () => {
          const title = cell.getAttribute('title') || '';
          tooltip.textContent = title;
          tooltip.style.display = 'block';
        });
        cell.addEventListener('mousemove', (event) => {
          const rect = el.getBoundingClientRect();
          tooltip.style.left = Math.max(0, event.clientX - rect.left + 10) + 'px';
          tooltip.style.top = Math.max(0, event.clientY - rect.top - 28) + 'px';
        });
        cell.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
      });
    }

    function renderCategoryShare(list) {
      const el = document.getElementById('categoryShare');
      if (!list || list.length === 0) {
        el.innerHTML = '<div class="empty">' + buildEmptyText('暂无分类占比数据') + '</div>';
        return;
      }
      
      const total = list.reduce((sum, item) => sum + item.notesCount, 0);
      if (total === 0) {
        el.innerHTML = '<div class="empty">' + buildEmptyText('暂无分类笔记占比数据') + '</div>';
        return;
      }

      const percentages = list.map(item => Math.floor((item.notesCount / total) * 100));
      let currentSum = percentages.reduce((a, b) => a + b, 0);
      let remainders = list.map((item, i) => ({
        index: i,
        remainder: (item.notesCount / total) * 100 - percentages[i]
      }));
      
      remainders.sort((a, b) => b.remainder - a.remainder);
      
      for (let i = 0; i < 100 - currentSum; i++) {
        percentages[remainders[i].index]++;
      }

      const max = Math.max(...list.map((item) => item.notesCount), 1);
      el.innerHTML = '<div class="bars">' + list.map((item, i) => (
        '<div class="bar-item">'
          + '<div title="' + escapeHtml(item.category) + '" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(item.category) + '</div>'
          + '<div class="bar-track"><div class="bar-fill" style="width:' + percentages[i] + '%"></div></div>'
          + '<div style="text-align:right;color:var(--vscode-descriptionForeground)">' + percentages[i] + '% (' + item.notesCount + ')</div>'
        + '</div>'
      )).join('') + '</div>';
    }

    function renderScatter(points) {
      const el = document.getElementById('scatter');
      if (!points || points.length === 0) {
        el.innerHTML = '<div class="empty">' + buildEmptyText('暂无可绘制散点数据') + '</div>';
        return;
      }
      const width = 760;
      const height = 250;
      const padding = { top: 10, right: 10, bottom: 26, left: 36 };
      const chartW = width - padding.left - padding.right;
      const chartH = height - padding.top - padding.bottom;
      const maxX = Math.max(...points.map((p) => p.readingTime), 1);
      const maxY = Math.max(...points.map((p) => p.noteDensity), 1);

      function mapX(value) {
        const ratio = maxX <= 0 ? 0.5 : (value / maxX);
        return padding.left + Math.max(0.03, ratio) * chartW;
      }
      function mapY(value) {
        const ratio = maxY <= 0 ? 0.5 : (value / maxY);
        return padding.top + chartH - Math.max(0.03, ratio) * chartH;
      }
      function pointColor(quadrant) {
        if (quadrant === 'high_value') return 'var(--vscode-charts-green, #3fb950)';
        if (quadrant === 'high_density') return 'var(--vscode-charts-yellow, #d29922)';
        if (quadrant === 'high_time') return 'var(--vscode-charts-blue, #4f8cff)';
        return 'var(--vscode-descriptionForeground)';
      }

      const xMid = mapX(maxX / 2);
      const yMid = mapY(maxY / 2);
      const bg = ''
        + '<rect x="' + padding.left + '" y="' + padding.top + '" width="' + (xMid - padding.left) + '" height="' + (yMid - padding.top) + '" fill="rgba(255,255,255,0.02)"></rect>'
        + '<rect x="' + xMid + '" y="' + padding.top + '" width="' + (padding.left + chartW - xMid) + '" height="' + (yMid - padding.top) + '" fill="rgba(63,185,80,0.08)"></rect>'
        + '<rect x="' + padding.left + '" y="' + yMid + '" width="' + (xMid - padding.left) + '" height="' + (padding.top + chartH - yMid) + '" fill="rgba(255,255,255,0.02)"></rect>'
        + '<rect x="' + xMid + '" y="' + yMid + '" width="' + (padding.left + chartW - xMid) + '" height="' + (padding.top + chartH - yMid) + '" fill="rgba(255,255,255,0.02)"></rect>';

      const dots = points.map((p) => {
        const x = mapX(p.readingTime).toFixed(2);
        const y = mapY(p.noteDensity).toFixed(2);
        const color = pointColor(p.quadrant);
        const title = escapeHtml(p.title + ' · 时长:' + p.readingTime + ' · 密度:' + p.noteDensity);
        return '<circle class="scatter-point" data-book-id="' + escapeHtml(p.bookId) + '" cx="' + x + '" cy="' + y + '" r="4" fill="' + color + '" style="cursor:pointer"><title>' + title + '</title></circle>';
      }).join('');

      const xTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const val = round2(maxX * ratio);
        const x = (padding.left + chartW * ratio).toFixed(2);
        return '<line x1="' + x + '" y1="' + (padding.top + chartH) + '" x2="' + x + '" y2="' + (padding.top + chartH + 4) + '" stroke="var(--vscode-panel-border)"></line>'
          + '<text x="' + x + '" y="' + (padding.top + chartH + 16) + '" fill="var(--vscode-descriptionForeground)" font-size="10" text-anchor="middle">' + val + '</text>';
      }).join('');
      const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const val = round2(maxY * ratio);
        const y = (padding.top + chartH - chartH * ratio).toFixed(2);
        return '<line x1="' + (padding.left - 4) + '" y1="' + y + '" x2="' + padding.left + '" y2="' + y + '" stroke="var(--vscode-panel-border)"></line>'
          + '<text x="' + (padding.left - 6) + '" y="' + (Number(y) + 3) + '" fill="var(--vscode-descriptionForeground)" font-size="10" text-anchor="end">' + val + '</text>';
      }).join('');

      el.innerHTML =
        '<div class="chart-tooltip" id="scatterTooltip"></div>' +
        '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '">'
          + bg
          + '<line x1="' + padding.left + '" y1="' + (padding.top + chartH) + '" x2="' + (padding.left + chartW) + '" y2="' + (padding.top + chartH) + '" stroke="var(--vscode-panel-border)"></line>'
          + '<line x1="' + padding.left + '" y1="' + padding.top + '" x2="' + padding.left + '" y2="' + (padding.top + chartH) + '" stroke="var(--vscode-panel-border)"></line>'
          + xTicks
          + yTicks
          + '<line x1="' + xMid + '" y1="' + padding.top + '" x2="' + xMid + '" y2="' + (padding.top + chartH) + '" stroke="var(--vscode-panel-border)" stroke-dasharray="3 3"></line>'
          + '<line x1="' + padding.left + '" y1="' + yMid + '" x2="' + (padding.left + chartW) + '" y2="' + yMid + '" stroke="var(--vscode-panel-border)" stroke-dasharray="3 3"></line>'
          + '<text x="' + (padding.left + chartW - 70) + '" y="' + (padding.top + 14) + '" fill="var(--vscode-charts-green, #3fb950)" font-size="11">高价值区</text>'
          + dots
          + '<text x="' + (padding.left + chartW - 76) + '" y="' + (height - 6) + '" fill="var(--vscode-descriptionForeground)" font-size="10">阅读时长(min)</text>'
          + '<text x="' + (padding.left + 2) + '" y="' + (padding.top + 10) + '" fill="var(--vscode-descriptionForeground)" font-size="10">笔记密度</text>'
        + '</svg>';

      const scatterTooltip = document.getElementById('scatterTooltip');
      el.querySelectorAll('.scatter-point').forEach((node) => {
        node.addEventListener('mouseenter', () => {
          const title = node.querySelector('title');
          scatterTooltip.textContent = title ? title.textContent : '';
          scatterTooltip.style.display = 'block';
        });
        node.addEventListener('mousemove', (event) => {
          const rect = el.getBoundingClientRect();
          scatterTooltip.style.left = Math.max(0, event.clientX - rect.left + 10) + 'px';
          scatterTooltip.style.top = Math.max(0, event.clientY - rect.top - 28) + 'px';
        });
        node.addEventListener('mouseleave', () => {
          scatterTooltip.style.display = 'none';
        });
        node.addEventListener('click', () => {
          const bookId = node.getAttribute('data-book-id');
          if (!bookId) {
            return;
          }
          vscode.postMessage({ command: 'openBookDetail', bookId });
        });
      });
    }

    function renderAuthorCloud(list) {
      const el = document.getElementById('authorCloud');
      if (!list || list.length === 0) {
        el.innerHTML = '<div class="empty">' + buildEmptyText('暂无作者数据') + '</div>';
        return;
      }
      const maxCount = Math.max(...list.map(item => item.count));
      const minCount = Math.min(...list.map(item => item.count));
      
      const html = list.map(item => {
        // font size between 12px and 32px
        const size = minCount === maxCount ? 16 : 12 + ((item.count - minCount) / (maxCount - minCount)) * 20;
        const opacity = minCount === maxCount ? 0.8 : 0.4 + ((item.count - minCount) / (maxCount - minCount)) * 0.6;
        return '<span style="font-size: ' + size.toFixed(1) + 'px; opacity: ' + opacity.toFixed(2) + '; color: var(--vscode-charts-blue, #4f8cff); white-space: nowrap;" title="阅读 ' + item.count + ' 本">' + escapeHtml(item.author) + '</span>';
      }).join('');
      el.innerHTML = html;
    }

    let currentRadarLevel = 1;
    function renderCategoryRadar(list) {
      const el = document.getElementById('categoryRadar');
      if (!list || list.length === 0) {
        el.innerHTML = '<div class="empty">' + buildEmptyText('暂无分类数据') + '</div>';
        return;
      }
      
      // Filter list by level
      const level1List = list.filter(item => item.level === 1);
      const level2List = list.filter(item => item.level === 2);
      
      // Default logic: if level 1 < 4, use level 2
      if (currentRadarLevel === 1 && level1List.length < 4 && level2List.length >= 4) {
        currentRadarLevel = 2;
        document.getElementById('radarLevel1').classList.replace('active', 'inactive');
        document.getElementById('radarLevel2').classList.replace('inactive', 'active');
      }

      const drawRadar = (level) => {
        const renderList = level === 1 ? level1List : level2List;
        // Need at least 3 points for a polygon
        const radarList = renderList.length < 3 ? (level1List.length >= 3 ? level1List : list) : renderList;
        
        // Take top 8 categories to avoid overcrowding
        const topList = radarList.slice(0, 8);
        if (topList.length < 3) {
          el.innerHTML = '<div class="empty">分类数量不足，无法生成雷达图</div>';
          return;
        }

        const maxCount = Math.max(...topList.map(item => item.count), 1);
        const centerX = 150;
        const centerY = 110;
        const radius = 80;
        const angleStep = (Math.PI * 2) / topList.length;

        // Draw background polygons
        let bgHtml = '';
        for (let r = 0.2; r <= 1; r += 0.2) {
          const points = topList.map((_, i) => {
            const angle = i * angleStep - Math.PI / 2;
            const x = centerX + radius * r * Math.cos(angle);
            const y = centerY + radius * r * Math.sin(angle);
            return x.toFixed(2) + ',' + y.toFixed(2);
          }).join(' ');
          bgHtml += '<polygon points="' + points + '" fill="none" stroke="var(--vscode-panel-border)" stroke-width="1" opacity="0.5"></polygon>';
        }

        // Draw axes
        let axisHtml = topList.map((_, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);
          return '<line x1="' + centerX + '" y1="' + centerY + '" x2="' + x.toFixed(2) + '" y2="' + y.toFixed(2) + '" stroke="var(--vscode-panel-border)" stroke-width="1" opacity="0.5"></line>';
        }).join('');

        // Draw data polygon
        const dataPoints = topList.map((item, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const r = Math.max(0.1, item.count / maxCount);
          const x = centerX + radius * r * Math.cos(angle);
          const y = centerY + radius * r * Math.sin(angle);
          return x.toFixed(2) + ',' + y.toFixed(2);
        }).join(' ');
        
        const dataPolygon = '<polygon points="' + dataPoints + '" fill="rgba(79,140,255,0.2)" stroke="var(--vscode-charts-blue, #4f8cff)" stroke-width="2"></polygon>';

        // Draw dots and labels
        let dotsHtml = '';
        let labelsHtml = '';
        topList.forEach((item, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const r = Math.max(0.1, item.count / maxCount);
          const x = centerX + radius * r * Math.cos(angle);
          const y = centerY + radius * r * Math.sin(angle);
          dotsHtml += '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="3" fill="var(--vscode-charts-blue, #4f8cff)"><title>' + escapeHtml(item.category) + ': ' + item.count + '本</title></circle>';
          
          // Label positioning
          const labelR = radius + 15;
          const labelX = centerX + labelR * Math.cos(angle);
          const labelY = centerY + labelR * Math.sin(angle);
          
          let anchor = 'middle';
          if (Math.abs(Math.cos(angle)) > 0.1) {
            anchor = Math.cos(angle) > 0 ? 'start' : 'end';
          }
          
          labelsHtml += '<text x="' + labelX.toFixed(2) + '" y="' + labelY.toFixed(2) + '" fill="var(--vscode-descriptionForeground)" font-size="11" text-anchor="' + anchor + '" dominant-baseline="middle">' + escapeHtml(item.category) + '</text>';
        });

        el.innerHTML = '<svg width="100%" height="220" viewBox="0 0 300 220">'
          + bgHtml
          + axisHtml
          + dataPolygon
          + dotsHtml
          + labelsHtml
          + '</svg>';
      };

      drawRadar(currentRadarLevel);

      // Event listeners for toggle buttons
      const btn1 = document.getElementById('radarLevel1');
      const btn2 = document.getElementById('radarLevel2');
      
      // Need to replace clones to prevent multiple bindings if called repeatedly
      const newBtn1 = btn1.cloneNode(true);
      const newBtn2 = btn2.cloneNode(true);
      btn1.parentNode.replaceChild(newBtn1, btn1);
      btn2.parentNode.replaceChild(newBtn2, btn2);
      
      newBtn1.addEventListener('click', () => {
        if (currentRadarLevel !== 1) {
          currentRadarLevel = 1;
          newBtn1.classList.replace('inactive', 'active');
          newBtn2.classList.replace('active', 'inactive');
          drawRadar(1);
        }
      });
      newBtn2.addEventListener('click', () => {
        if (currentRadarLevel !== 2) {
          currentRadarLevel = 2;
          newBtn2.classList.replace('inactive', 'active');
          newBtn1.classList.replace('active', 'inactive');
          drawRadar(2);
        }
      });
    }

    function setLoadingState(loading, filter) {
      state.loading = !!loading;
      const banner = document.getElementById('statusBanner');
      if (!banner) {
        return;
      }
      const hasData = !!state.data;
      if (state.loading) {
        banner.textContent = '正在加载阅读洞察数据...';
        banner.classList.add('visible');
        return;
      }
      const currentFilter = filter || state.filter;
      const totalNotes = Number(state.data?.kpis?.totalNotes || 0);
      const totalBooks = Number((state.data?.topBooks || []).length);
      if (!hasData) {
        banner.textContent = '暂无阅读数据，请先同步书架或检查本地笔记目录。';
        banner.classList.add('visible');
        return;
      }
      if (totalNotes === 0) {
        banner.textContent = buildEmptyText('当前筛选下暂无阅读数据');
        banner.classList.add('visible');
        return;
      }
      const scopeText = currentFilter?.days === 0 ? '全部数据' : ('最近 ' + currentFilter.days + ' 天');
      banner.textContent = '已加载 ' + scopeText + ' 的阅读数据，共 ' + totalNotes + ' 条笔记'
        + (totalBooks > 0 ? '，覆盖 ' + totalBooks + ' 本重点书籍。' : '。');
      banner.classList.add('visible');
    }

    function setStatus(text, degraded) {
      state.status = { text: String(text || ''), degraded: !!degraded };
      const banner = document.getElementById('statusBanner');
      if (!banner || !text) {
        return;
      }
      banner.textContent = state.status.text;
      banner.classList.add('visible');
      banner.style.borderColor = degraded
        ? 'var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border))'
        : 'var(--vscode-panel-border)';
    }

    function buildEmptyText(baseText) {
      if (state.filter.days === 0) {
        return baseText + '，可先检查是否存在可解析的本地笔记。';
      }
      return baseText + '，可切换到“全部数据”查看历史记录。';
    }

    function formatDate(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleString();
    }

    function round2(value) {
      const n = Number(value || 0);
      if (!Number.isFinite(n)) {
        return 0;
      }
      return Math.round(n * 100) / 100;
    }

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function renderDashboard(data) {
      state.data = data;
      state.filter.days = data.filter.days === 0 ? 0 : (data.filter.days || 0);
      state.filter.category = data.filter.category || 'all';
      state.filter.noteType = data.filter.noteType || 'all';
      state.filter.trendGranularity = data.filter.trendGranularity === 'week' ? 'week' : 'day';
      state.filter.finishedOnly = !!data.filter.finishedOnly;

      renderCategoryOptions(data.availableCategories || [], state.filter.category);
      document.getElementById('daysFilter').value = String(state.filter.days);
      document.getElementById('noteTypeFilter').value = state.filter.noteType;
      document.getElementById('trendGranularityFilter').value = state.filter.trendGranularity;
      document.getElementById('finishedOnlyFilter').checked = state.filter.finishedOnly;
      document.querySelectorAll('.legend-btn').forEach((btn) => {
        const series = btn.dataset.series;
        const active = series === 'notes' ? !!state.trendVisible.notes : !!state.trendVisible.active;
        btn.classList.toggle('active', active);
        btn.classList.toggle('inactive', !active);
      });

      renderKpi(data.kpis);
      renderTrend(data.trend);
      renderHeatmap(data.heatmap);
      renderCategoryShare(data.categoryShare);
      renderScatter(data.scatter);
      renderTopBooks(data.topBooks);
      renderTimeline(data.timeline);
      renderAuthorCloud(data.authorCloud);
      renderCategoryRadar(data.categoryRadar);
      setLoadingState(false, data.filter);
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.command === 'setLoading') {
        setLoadingState(true, message.filter || state.filter);
        return;
      }
      if (message.command === 'renderData') {
        renderDashboard(message.data);
        return;
      }
      if (message.command === 'setStatus') {
        setStatus(message.text, message.degraded);
      }
    });

    initDaysFilter();
    initSelectFilters();
    initTrendLegend();
    initExportButton();
    loadData();
  </script>
</body>
</html>`;
  }
}

function buildNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

let insightsDashboardViewInstance: InsightsDashboardView | undefined;

export function initializeInsightsDashboardView(extensionUri: vscode.Uri): InsightsDashboardView {
  insightsDashboardViewInstance = new InsightsDashboardView(extensionUri);
  return insightsDashboardViewInstance;
}

export function getInsightsDashboardView(): InsightsDashboardView {
  if (!insightsDashboardViewInstance) {
    throw new Error('InsightsDashboardView not initialized');
  }
  return insightsDashboardViewInstance;
}
