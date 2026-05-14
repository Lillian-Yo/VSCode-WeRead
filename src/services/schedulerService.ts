/**
 * 定时任务调度服务
 * 管理自动同步的定时任务
 */

import * as vscode from 'vscode';
import { getSyncService } from './syncService';
import { getConfig } from '../config/config';

export class SchedulerService {
  private timer: NodeJS.Timeout | undefined;
  private isRunning = false;
  private _onDidStartAutoSync = new vscode.EventEmitter<void>();
  private _onDidStopAutoSync = new vscode.EventEmitter<void>();

  public readonly onDidStartAutoSync = this._onDidStartAutoSync.event;
  public readonly onDidStopAutoSync = this._onDidStopAutoSync.event;

  private static intervalToMs(interval: '12h' | '24h' | '72h'): number {
    switch (interval) {
      case '12h':
        return 12 * 60 * 60 * 1000;
      case '72h':
        return 72 * 60 * 60 * 1000;
      case '24h':
      default:
        return 24 * 60 * 60 * 1000;
    }
  }

  constructor() {
    // 监听配置变化
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('weread.autoSync') || e.affectsConfiguration('weread.syncInterval')) {
        this.restart();
      }
    });
  }

  /**
   * 启动定时任务
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    const config = getConfig();
    if (!config.autoSync) {
      return;
    }

    const intervalMs = SchedulerService.intervalToMs(config.syncInterval);

    console.log(`[Scheduler] 启动自动同步，间隔: ${config.syncInterval}`);

    // 立即执行一次
    this.runSync();

    // 设置定时器
    this.timer = setInterval(() => {
      this.runSync();
    }, intervalMs);

    this.isRunning = true;
    this._onDidStartAutoSync.fire();
  }

  /**
   * 停止定时任务
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.isRunning = false;
    this._onDidStopAutoSync.fire();
    console.log('[Scheduler] 停止自动同步');
  }

  /**
   * 重启定时任务
   */
  restart(): void {
    this.stop();
    this.start();
  }

  /**
   * 执行同步
   */
  private async runSync(): Promise<void> {
    try {
      console.log('[Scheduler] 执行自动同步...');
      const syncService = getSyncService();

      // 使用增量同步
      const result = await syncService.incrementalSync();

      if (result.success) {
        console.log(
          `[Scheduler][account:${result.accountId || 'unknown'}] 自动同步完成: ${result.syncedBooks} 本书, ${result.syncedNotes} 条笔记`
        );
      } else {
        console.error(`[Scheduler][account:${result.accountId || 'unknown'}] 自动同步失败:`, result.error);
      }
    } catch (error) {
      console.error('[Scheduler] 自动同步异常:', error);
    }
  }

  /**
   * 是否正在运行
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * 获取下次同步时间
   */
  getNextSyncTime(): Date | undefined {
    if (!this.isRunning) {
      return undefined;
    }

    const config = getConfig();
    const intervalMs = SchedulerService.intervalToMs(config.syncInterval);
    return new Date(Date.now() + intervalMs);
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.stop();
    this._onDidStartAutoSync.dispose();
    this._onDidStopAutoSync.dispose();
  }
}

let schedulerServiceInstance: SchedulerService | undefined;

export function initializeSchedulerService(): SchedulerService {
  schedulerServiceInstance = new SchedulerService();
  return schedulerServiceInstance;
}

export function getSchedulerService(): SchedulerService {
  if (!schedulerServiceInstance) {
    schedulerServiceInstance = new SchedulerService();
  }
  return schedulerServiceInstance;
}
