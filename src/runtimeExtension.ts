/**
 * 微信读书 VSCode 插件运行时入口
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { getConfiguredOutputPath, normalizeOutputPath, validateOutputPathReadable, validateOutputPathWritable, getDataSourceMode } from './utils';
import { getConfig } from './config/config';
import { collectCollapsibleIds, syncBookshelfCollapsedContext } from './providers/treeToggleState';
import { logBookshelfToggle } from './logging/bookshelfToggleLog';

type Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

type CollapsibleStateProvider = vscode.TreeDataProvider<vscode.TreeItem> & {
  getCollapseMode?: () => 'default' | 'allCollapsed' | 'allExpanded';
  clearCollapseMode?: () => void;
};

class DeferredBookshelfProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private delegate?: CollapsibleStateProvider;
  private delegateSubscription?: vscode.Disposable;

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (this.delegate) {
      return (await this.delegate.getChildren(element)) ?? [];
    }

    if (element) {
      return [];
    }

    const item = new vscode.TreeItem('书架加载中...');
    item.description = '插件正在后台初始化';
    item.contextValue = 'weread.loading';
    return [item];
  }

  getCollapseMode(): 'default' | 'allCollapsed' | 'allExpanded' {
    return this.delegate?.getCollapseMode?.() || 'default';
  }

  clearCollapseMode(): void {
    this.delegate?.clearCollapseMode?.();
  }

  setDelegate(provider: CollapsibleStateProvider): void {
    this.delegateSubscription?.dispose();
    this.delegate = provider;
    this.delegateSubscription = provider.onDidChangeTreeData?.(() => this.refresh());
    this.refresh();
  }

  refresh(): void {
    this.emitter.fire();
  }

  dispose(): void {
    this.delegateSubscription?.dispose();
    this.emitter.dispose();
  }
}

class BookshelfCollapseTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private knownCollapsible = new Set<string>();
  private expanded = new Set<string>();
  private recomputeTimer?: NodeJS.Timeout;

  constructor(
    private readonly provider: vscode.TreeDataProvider<vscode.TreeItem>,
    private readonly treeView: vscode.TreeView<vscode.TreeItem>
  ) {
    this.disposables.push(
      this.treeView.onDidExpandElement((event) => {
        this.clearProviderCollapseMode();
        if (event.element.id) {
          this.expanded.add(event.element.id);
        }
        void this.publish();
      }),
      this.treeView.onDidCollapseElement((event) => {
        this.clearProviderCollapseMode();
        if (event.element.id) {
          this.expanded.delete(event.element.id);
        }
        void this.publish();
      }),
      this.provider.onDidChangeTreeData?.(() => this.scheduleRecompute()) ?? new vscode.Disposable(() => undefined)
    );
    this.scheduleRecompute();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    if (this.recomputeTimer) {
      clearTimeout(this.recomputeTimer);
      this.recomputeTimer = undefined;
    }
  }

  private scheduleRecompute(): void {
    if (this.recomputeTimer) {
      clearTimeout(this.recomputeTimer);
    }
    this.recomputeTimer = setTimeout(() => {
      this.recomputeTimer = undefined;
      void this.rebuildKnownCollapsible();
    }, 80);
  }

  private async rebuildKnownCollapsible(): Promise<void> {
    const root = (await this.provider.getChildren()) || [];
    const childrenByRoot = new Map<string, readonly vscode.TreeItem[]>();
    for (const item of root) {
      if (!item.id || item.collapsibleState === vscode.TreeItemCollapsibleState.None) {
        continue;
      }
      const children = (await this.provider.getChildren(item)) || [];
      childrenByRoot.set(item.id, children);
    }
    this.knownCollapsible = collectCollapsibleIds(root, childrenByRoot);
    this.expanded = new Set(Array.from(this.expanded).filter((id) => this.knownCollapsible.has(id)));
    await this.publish();
  }

  private async publish(): Promise<void> {
    const collapseMode = this.getProviderCollapseMode();
    if (collapseMode === 'allCollapsed') {
      logBookshelfToggle('tracker publish forced allCollapsed');
      await syncBookshelfCollapsedContext(true, 'tracker:allCollapsed');
      return;
    }
    if (collapseMode === 'allExpanded') {
      logBookshelfToggle('tracker publish forced allExpanded');
      await syncBookshelfCollapsedContext(false, 'tracker:allExpanded');
      return;
    }
    const hasCollapsible = this.knownCollapsible.size > 0;
    const allCollapsed = hasCollapsible
      ? Array.from(this.knownCollapsible).every((id) => !this.expanded.has(id))
      : true;
    logBookshelfToggle(
      `tracker publish computed collapsed=${allCollapsed} known=${this.knownCollapsible.size} expanded=${this.expanded.size}`
    );
    await syncBookshelfCollapsedContext(allCollapsed, 'tracker:computed');
  }

  private getProviderCollapseMode(): 'default' | 'allCollapsed' | 'allExpanded' {
    const candidate = this.provider as CollapsibleStateProvider;
    return candidate.getCollapseMode?.() || 'default';
  }

  private clearProviderCollapseMode(): void {
    const candidate = this.provider as CollapsibleStateProvider;
    candidate.clearCollapseMode?.();
  }
}

let schedulerServiceRef: { start(): void; stop(): void; dispose(): void } | undefined;
let acceptedOutputPath: string | undefined;
let suppressOutputPathWatch = false;
let outputPathSwitching = false;
let preconfirmedOutputPath: string | undefined;
let suppressValidationSummaryWatch = false;
let lastValidationSummaryReadonly = 'passed';

export function markOutputPathSwitchPreconfirmed(nextPath: string | undefined): void {
  preconfirmedOutputPath = nextPath ? normalizeOutputPath(nextPath) : undefined;
}

export async function activateRuntime(context: vscode.ExtensionContext, log: Logger): Promise<void> {
  acceptedOutputPath = getConfiguredOutputPath();
  lastValidationSummaryReadonly = vscode.workspace.getConfiguration('weread').get<string>('lastValidationSummary', 'passed');
  const deferredProvider = new DeferredBookshelfProvider();
  context.subscriptions.push(deferredProvider);

  const treeView = vscode.window.createTreeView('weread.bookshelf', {
    treeDataProvider: deferredProvider,
    canSelectMany: true,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);
  context.subscriptions.push(new BookshelfCollapseTracker(deferredProvider, treeView));

  void vscode.commands.executeCommand('setContext', 'weread:loggedIn', false);
  void vscode.commands.executeCommand('setContext', 'weread:bookshelfFilterActive', false);
  void syncBookshelfCollapsedContext(false, 'activate:init');

  log.info('[Activation] 占位视图已注册');
  void initializeRealExtension(context, deferredProvider, treeView, log);
}

async function initializeRealExtension(
  context: vscode.ExtensionContext,
  deferredProvider: DeferredBookshelfProvider,
  treeView: vscode.TreeView<vscode.TreeItem>,
  log: Logger
): Promise<void> {
  const activateStart = Date.now();

  try {
    log.info('[Activation] 开始后台加载业务模块');

    const [
      cookieModule,
      authModule,
      accountMetaModule,
      accountMigrationModule,
      storageModule,
      syncModule,
      localDataModule,
      schedulerModule,
      providerModule,
      commandModule,
      bookDetailModule,
      insightsModule,
      noteRoamingModule,
    ] = await Promise.all([
      import('./auth/cookieManager'),
      import('./auth/authManager'),
      import('./services/accountMetaManager'),
      import('./services/accountMigrationService'),
      import('./services/storageService'),
      import('./services/syncService'),
      import('./services/localDataService'),
      import('./services/schedulerService'),
      import('./providers'),
      import('./commands'),
      import('./views/bookDetail'),
      import('./views/insightsDashboard'),
      import('./views/noteRoamingView'),
    ]);

    log.info('[Activation] 业务模块加载完成');

    const bookshelfProvider = providerModule.createBookshelfProvider();
    const loginProvider = providerModule.createLoginProvider();
    deferredProvider.setDelegate(bookshelfProvider);

    const cookieManager = cookieModule.initializeCookieManager(context);
    accountMetaModule.initializeAccountMetaManager(context);
    accountMigrationModule.initializeAccountMigrationService(context);
    const storageService = storageModule.initializeStorageService(context);
    const localDataService = localDataModule.getLocalDataService();
    const authManager = authModule.initializeAuthManager(cookieManager);
    context.subscriptions.push(authManager);
    try {
      const multiAccountEnabled = getConfig().multiAccountEnabled !== false;
      if (multiAccountEnabled) {
        const migrationService = accountMigrationModule.getAccountMigrationService();
        const needMigration = await migrationService.checkNeedMigration();
        if (needMigration) {
          const migrated = await migrationService.migrateSingleToMultiAccount();
          if (!migrated.success) {
            log.warn(`[Activation] 多账号迁移失败: ${migrated.error || '未知错误'}`);
          } else {
            log.info(`[Activation] 多账号迁移完成: ${migrated.accountId}`);
          }
        }
      } else {
        log.warn('[Activation] 多账号模式已关闭，跳过自动迁移');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`[Activation] 多账号迁移检查异常: ${message}`);
    }
    syncModule.initializeSyncService(storageService);
    schedulerServiceRef = schedulerModule.initializeSchedulerService();
    context.subscriptions.push(schedulerServiceRef);
    bookDetailModule.initializeBookDetailView(context.extensionUri);
    const insightsDashboardView = insightsModule.initializeInsightsDashboardView(context.extensionUri);
    const noteRoamingView = noteRoamingModule.initializeNoteRoamingView(context.extensionUri);
    const syncLoginUi = async (isLoggedIn: boolean): Promise<void> => {
      await vscode.commands.executeCommand('setContext', 'weread:loggedIn', isLoggedIn);
      log.info(`[Activation] 登录状态变化: ${isLoggedIn}`);
      bookshelfProvider.setLoggedIn(isLoggedIn);
      loginProvider.refresh();
      bookshelfProvider.refresh();
      await insightsDashboardView.refreshIfVisible();
      await noteRoamingView.refreshIfVisible();
    };

    void cookieManager
      .isLoggedIn()
      .then((hasLocalCookies: boolean) => {
        bookshelfProvider.setLoggedIn(hasLocalCookies);
        return vscode.commands.executeCommand('setContext', 'weread:loggedIn', hasLocalCookies);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log.warn(`[Activation] 初始登录状态设置失败: ${message}`);
      });

    commandModule.registerCommands(context, { bookshelfTreeView: treeView });
    log.info('[Activation] 正式命令注册完成');

    context.subscriptions.push(
      authManager.onDidChangeLoginState(async (isLoggedIn: boolean) => {
        await syncLoginUi(isLoggedIn);
        if (isLoggedIn) {
          startAutoSync(schedulerServiceRef, log);
        } else {
          schedulerServiceRef?.stop();
          void localDataService
            .reloadFromConfiguredPath()
            .then(() => {
              return syncLoginUi(false);
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              log.warn(`[Activation] 登出后本地数据重载失败: ${message}`);
            });
        }
      })
    );
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('weread.categoryMode') || e.affectsConfiguration('weread.language')) {
          bookshelfProvider.refresh();
          loginProvider.refresh();
        }
        if (e.affectsConfiguration('weread.outputPath')) {
          void handleOutputPathSwitch(
            localDataService,
            bookshelfProvider,
            insightsDashboardView,
            log
          );
        }
        if (e.affectsConfiguration('weread.lastValidationSummary')) {
          void enforceValidationSummaryReadonly();
        }
      })
    );

    bookshelfProvider.refresh();
    log.info(`[Activation] 扩展已就绪 (${Date.now() - activateStart}ms)`);

    void bootstrapInBackground(
      cookieManager,
      storageService,
      localDataService,
      authManager,
      schedulerServiceRef,
      loginProvider,
      bookshelfProvider,
      log
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`[Activation] 后台初始化失败: ${message}`);
    deferredProvider.refresh();
    vscode.window.showErrorMessage(`微信读书插件初始化失败: ${message}`);
  }
}

async function handleOutputPathSwitch(
  localDataService: { reloadFromConfiguredPath(): Promise<unknown> },
  bookshelfProvider: { refresh(): void },
  insightsDashboardView: { refreshIfVisible(): Promise<void> },
  log: Logger
): Promise<void> {
  if (suppressOutputPathWatch || outputPathSwitching) {
    return;
  }
  outputPathSwitching = true;

  const config = vscode.workspace.getConfiguration('weread');
  const raw = config.get<string>('outputPath', '');
  const nextPath = raw.trim() ? normalizeOutputPath(raw) : undefined;
  const previousPath = acceptedOutputPath;
  const skipPreviewConfirm = (preconfirmedOutputPath || '') === (nextPath || '');
  preconfirmedOutputPath = undefined;

  try {
    if (getDataSourceMode() === 'dual') {
      await localDataService.reloadFromConfiguredPath();
      acceptedOutputPath = nextPath;
      bookshelfProvider.refresh();
      await insightsDashboardView.refreshIfVisible();
      return;
    }

    if ((nextPath || '') === (previousPath || '')) {
      return;
    }

    if (!nextPath) {
      const choice = await vscode.window.showWarningMessage(
        '检测到笔记目录被清空。为避免误清空书架数据，是否回退到上一个目录？',
        { modal: true },
        '回退到上一个目录',
        '继续切换为空目录'
      );
      if (choice !== '继续切换为空目录') {
        await rollbackOutputPath(previousPath);
        return;
      }

      await localDataService.reloadFromConfiguredPath();
      acceptedOutputPath = undefined;
      bookshelfProvider.refresh();
      await insightsDashboardView.refreshIfVisible();
      return;
    }

    try {
      await fs.promises.stat(nextPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        const create = await vscode.window.showWarningMessage(
          `目录不存在，是否自动创建？\n${nextPath}`,
          { modal: true },
          '创建',
          '取消'
        );
        if (create !== '创建') {
          await updateValidationStatus('failed', '用户取消创建目录');
          await rollbackOutputPath(previousPath);
          return;
        }
        await fs.promises.mkdir(nextPath, { recursive: true });
      } else {
        throw error;
      }
    }

    const [readable, writable] = await Promise.all([
      validateOutputPathReadable(nextPath),
      validateOutputPathWritable(nextPath),
    ]);
    if (!readable.ok || !writable.ok) {
      const reason = readable.reason || writable.reason || '目标目录不可读或不可写';
      await updateValidationStatus('failed', reason);
      vscode.window.showErrorMessage(`目录切换失败：${reason}`);
      await rollbackOutputPath(previousPath);
      return;
    }

    const { getIndexService } = await import('./services/indexService');
    const preview = await getIndexService().previewFromOutputPath(nextPath);
    const summary = `扫描到 ${preview.snapshot.books.length} 本书，失败 ${preview.snapshot.errors.length} 个文件。`;
    const confirmLabel = preview.snapshot.books.length === 0
      ? '确认切换为空书架'
      : '确认切换目录';
    if (!skipPreviewConfirm) {
      const confirm = await vscode.window.showWarningMessage(
        `即将切换到目录：${nextPath}\n${summary}`,
        { modal: true },
        confirmLabel,
        '回退到上一个目录'
      );

      if (confirm !== confirmLabel) {
        await rollbackOutputPath(previousPath);
        return;
      }
    }

    await getIndexService().persistBuildResult(preview);
    acceptedOutputPath = nextPath;
    await updateValidationStatus('passed', '');
    bookshelfProvider.refresh();
    await insightsDashboardView.refreshIfVisible();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[Activation] outputPath 两阶段切换失败: ${message}`);
    await updateValidationStatus('failed', message);
    vscode.window.showErrorMessage(`目录切换失败：${message}`);
    await rollbackOutputPath(previousPath);
  } finally {
    outputPathSwitching = false;
  }
}

async function updateValidationStatus(status: 'passed' | 'failed', reason: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('weread');
  await config.update('lastValidationStatus', status, true);
  await config.update('lastValidationFailReason', reason, true);
  const summary = status === 'passed' ? 'passed' : `failed: ${reason || '未知原因'}`;
  suppressValidationSummaryWatch = true;
  try {
    await config.update('lastValidationSummary', summary, true);
    lastValidationSummaryReadonly = summary;
  } finally {
    suppressValidationSummaryWatch = false;
  }
}

async function enforceValidationSummaryReadonly(): Promise<void> {
  if (suppressValidationSummaryWatch) {
    return;
  }
  const config = vscode.workspace.getConfiguration('weread');
  const current = config.get<string>('lastValidationSummary', '');
  if (current === lastValidationSummaryReadonly) {
    return;
  }
  suppressValidationSummaryWatch = true;
  try {
    await config.update('lastValidationSummary', lastValidationSummaryReadonly, true);
    vscode.window.showWarningMessage('Weread: Last Validation Summary 为系统只读字段，已恢复为最近一次真实校验结果。');
  } finally {
    suppressValidationSummaryWatch = false;
  }
}

async function rollbackOutputPath(previousPath: string | undefined): Promise<void> {
  suppressOutputPathWatch = true;
  try {
    const config = vscode.workspace.getConfiguration('weread');
    const inspected = config.inspect<string>('outputPath');
    const targets: vscode.ConfigurationTarget[] = [vscode.ConfigurationTarget.Global];
    if (inspected?.workspaceValue !== undefined || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)) {
      targets.push(vscode.ConfigurationTarget.Workspace);
    }
    if (inspected?.workspaceFolderValue !== undefined) {
      targets.push(vscode.ConfigurationTarget.WorkspaceFolder);
    }
    for (const target of targets) {
      await config.update('outputPath', previousPath || '', target);
    }
  } finally {
    suppressOutputPathWatch = false;
  }
}

function startAutoSync(schedulerService: { start(): void } | undefined, log: Logger): void {
  const config = getConfigLocal();
  if (!config.autoSync || !schedulerService) {
    return;
  }
  schedulerService.start();
  log.info(`[Activation] 自动同步已启动，间隔: ${config.syncInterval}`);
}

async function bootstrapInBackground(
  cookieManager: { initialize(): Promise<void>; isLoggedIn(): Promise<boolean> },
  storageService: { initialize(): Promise<void> },
  localDataService: { reloadFromConfiguredPath(): Promise<unknown> },
  authManager: { checkLoginStatus(): Promise<boolean> },
  schedulerService: { stop(): void; start(): void } | undefined,
  loginProvider: { refresh(): void },
  bookshelfProvider: { refresh(): void; setLoggedIn(loggedIn: boolean): void },
  log: Logger
): Promise<void> {
  const start = Date.now();
  log.info('[Activation] 后台数据初始化开始');

  await runActivationStepLocal(
    'cookieManager.initialize',
    () => cookieManager.initialize(),
    log,
    2000
  );
  await runActivationStepLocal(
    'storageService.initialize',
    () => storageService.initialize(),
    log,
    2000
  );

  try {
    log.info('[Activation] Step start: localDataService.reloadFromConfiguredPath');
    const localReloadStart = Date.now();
    await localDataService.reloadFromConfiguredPath();
    bookshelfProvider.refresh();
    log.info(`[Activation] Step success: localDataService.reloadFromConfiguredPath (${Date.now() - localReloadStart}ms)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[Activation] Step failed: localDataService.reloadFromConfiguredPath - ${message}`);
  }

  let hasLocalCookies = false;
  try {
    hasLocalCookies = await withTimeoutLocal(
      () => cookieManager.isLoggedIn(),
      1200,
      '[Activation] 检查本地 Cookie 超时'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[Activation] 跳过本地 Cookie 状态检查: ${message}`);
  }

  await vscode.commands.executeCommand('setContext', 'weread:loggedIn', hasLocalCookies);
  bookshelfProvider.setLoggedIn(hasLocalCookies);
  loginProvider.refresh();
  bookshelfProvider.refresh();

  try {
    const verifiedLogin = await withTimeoutLocal(
      () => authManager.checkLoginStatus(),
      6000,
      '[Activation] 校验登录状态超时'
    );
    await vscode.commands.executeCommand('setContext', 'weread:loggedIn', verifiedLogin);
    bookshelfProvider.setLoggedIn(verifiedLogin);
    if (verifiedLogin) {
      startAutoSync(schedulerService, log);
    } else {
      schedulerService?.stop();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[Activation] 登录状态校验失败，保留当前可用状态: ${message}`);
  }

  loginProvider.refresh();
  bookshelfProvider.refresh();
  log.info(`[Activation] 后台数据初始化完成 (${Date.now() - start}ms)`);
}

export function deactivateRuntime(): void {
  schedulerServiceRef?.stop();
}

function getConfigLocal(): { autoSync: boolean; syncInterval: '12h' | '24h' | '72h' } {
  const config = vscode.workspace.getConfiguration('weread');
  return {
    autoSync: config.get<boolean>('autoSync', true),
    syncInterval: config.get<'12h' | '24h' | '72h'>('syncInterval', '24h'),
  };
}

async function withTimeoutLocal<T>(
  task: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function runActivationStepLocal(
  stepName: string,
  step: () => Promise<void>,
  log: Logger,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  log.info(`[Activation] Step start: ${stepName}`);
  try {
    await withTimeoutLocal(
      step,
      timeoutMs,
      `[Activation] Step timeout: ${stepName} (${timeoutMs}ms)`
    );
    log.info(`[Activation] Step success: ${stepName} (${Date.now() - start}ms)`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[Activation] Step failed: ${stepName} (${Date.now() - start}ms) - ${message}`);
    return false;
  }
}
