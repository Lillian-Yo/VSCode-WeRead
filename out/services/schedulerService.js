"use strict";
/**
 * 定时任务调度服务
 * 管理自动同步的定时任务
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
exports.getSchedulerService = exports.initializeSchedulerService = exports.SchedulerService = void 0;
const vscode = __importStar(require("vscode"));
const syncService_1 = require("./syncService");
const config_1 = require("../config/config");
class SchedulerService {
    static intervalToMs(interval) {
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
        this.isRunning = false;
        this._onDidStartAutoSync = new vscode.EventEmitter();
        this._onDidStopAutoSync = new vscode.EventEmitter();
        this.onDidStartAutoSync = this._onDidStartAutoSync.event;
        this.onDidStopAutoSync = this._onDidStopAutoSync.event;
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
    start() {
        if (this.isRunning) {
            return;
        }
        const config = (0, config_1.getConfig)();
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
    stop() {
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
    restart() {
        this.stop();
        this.start();
    }
    /**
     * 执行同步
     */
    async runSync() {
        try {
            console.log('[Scheduler] 执行自动同步...');
            const syncService = (0, syncService_1.getSyncService)();
            // 使用增量同步
            const result = await syncService.incrementalSync();
            if (result.success) {
                console.log(`[Scheduler][account:${result.accountId || 'unknown'}] 自动同步完成: ${result.syncedBooks} 本书, ${result.syncedNotes} 条笔记`);
            }
            else {
                console.error(`[Scheduler][account:${result.accountId || 'unknown'}] 自动同步失败:`, result.error);
            }
        }
        catch (error) {
            console.error('[Scheduler] 自动同步异常:', error);
        }
    }
    /**
     * 是否正在运行
     */
    isActive() {
        return this.isRunning;
    }
    /**
     * 获取下次同步时间
     */
    getNextSyncTime() {
        if (!this.isRunning) {
            return undefined;
        }
        const config = (0, config_1.getConfig)();
        const intervalMs = SchedulerService.intervalToMs(config.syncInterval);
        return new Date(Date.now() + intervalMs);
    }
    /**
     * 清理资源
     */
    dispose() {
        this.stop();
        this._onDidStartAutoSync.dispose();
        this._onDidStopAutoSync.dispose();
    }
}
exports.SchedulerService = SchedulerService;
let schedulerServiceInstance;
function initializeSchedulerService() {
    schedulerServiceInstance = new SchedulerService();
    return schedulerServiceInstance;
}
exports.initializeSchedulerService = initializeSchedulerService;
function getSchedulerService() {
    if (!schedulerServiceInstance) {
        schedulerServiceInstance = new SchedulerService();
    }
    return schedulerServiceInstance;
}
exports.getSchedulerService = getSchedulerService;
//# sourceMappingURL=schedulerService.js.map