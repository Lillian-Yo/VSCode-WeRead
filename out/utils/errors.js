"use strict";
/**
 * 错误类型定义
 * 统一错误分类和处理
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseError = exports.WeReadError = exports.formatErrorWithCode = exports.WEREAD_ERROR_CODES = exports.ErrorCode = void 0;
var ErrorCode;
(function (ErrorCode) {
    // 网络错误
    ErrorCode["NETWORK_ERROR"] = "NETWORK_ERROR";
    ErrorCode["TIMEOUT_ERROR"] = "TIMEOUT_ERROR";
    ErrorCode["CONNECTION_ERROR"] = "CONNECTION_ERROR";
    // 认证错误
    ErrorCode["AUTH_ERROR"] = "AUTH_ERROR";
    ErrorCode["LOGIN_EXPIRED"] = "LOGIN_EXPIRED";
    ErrorCode["INVALID_CREDENTIALS"] = "INVALID_CREDENTIALS";
    // API 错误
    ErrorCode["API_ERROR"] = "API_ERROR";
    ErrorCode["RATE_LIMIT_ERROR"] = "RATE_LIMIT_ERROR";
    ErrorCode["SERVER_ERROR"] = "SERVER_ERROR";
    // 数据错误
    ErrorCode["DATA_ERROR"] = "DATA_ERROR";
    ErrorCode["SYNC_ERROR"] = "SYNC_ERROR";
    ErrorCode["EXPORT_ERROR"] = "EXPORT_ERROR";
    // 文件错误
    ErrorCode["FILE_ERROR"] = "FILE_ERROR";
    ErrorCode["PERMISSION_ERROR"] = "PERMISSION_ERROR";
    ErrorCode["NOT_FOUND_ERROR"] = "NOT_FOUND_ERROR";
    // 未知错误
    ErrorCode["UNKNOWN_ERROR"] = "UNKNOWN_ERROR";
})(ErrorCode = exports.ErrorCode || (exports.ErrorCode = {}));
exports.WEREAD_ERROR_CODES = {
    outputPathNotFound: 'WR-FS-001',
    outputPathPermissionDenied: 'WR-FS-002',
    fileWriteFailed: 'WR-FS-003',
    fileParseFailed: 'WR-INDEX-001',
    fileStatFailed: 'WR-INDEX-002',
    indexBuildFailed: 'WR-INDEX-003',
    unknown: 'WR-COMMON-001',
};
function formatErrorWithCode(stableCode, message) {
    return `[${stableCode}] ${message}`;
}
exports.formatErrorWithCode = formatErrorWithCode;
class WeReadError extends Error {
    constructor(detail) {
        super(detail.message);
        this.name = 'WeReadError';
        this.code = detail.code;
        this.retryable = detail.retryable ?? false;
        this.originalError = detail.originalError;
    }
    /**
     * 创建网络错误
     */
    static networkError(message, originalError) {
        return new WeReadError({
            code: ErrorCode.NETWORK_ERROR,
            message: message || '网络连接失败，请检查网络设置',
            originalError,
            retryable: true,
        });
    }
    /**
     * 创建登录过期错误
     */
    static loginExpired() {
        return new WeReadError({
            code: ErrorCode.LOGIN_EXPIRED,
            message: '登录已过期，请重新登录',
            retryable: false,
        });
    }
    /**
     * 创建同步错误
     */
    static syncError(message, originalError) {
        return new WeReadError({
            code: ErrorCode.SYNC_ERROR,
            message: message || '同步失败',
            originalError,
            retryable: true,
        });
    }
    /**
     * 创建导出错误
     */
    static exportError(message, originalError) {
        return new WeReadError({
            code: ErrorCode.EXPORT_ERROR,
            message: message || '导出失败',
            originalError,
            retryable: false,
        });
    }
    /**
     * 创建文件错误
     */
    static fileError(message, originalError) {
        return new WeReadError({
            code: ErrorCode.FILE_ERROR,
            message: message || '文件操作失败',
            originalError,
            retryable: false,
        });
    }
    /**
     * 从 HTTP 状态码创建错误
     */
    static fromHttpStatus(status, message) {
        switch (status) {
            case 401:
                return WeReadError.loginExpired();
            case 403:
                return new WeReadError({
                    code: ErrorCode.AUTH_ERROR,
                    message: '没有权限访问该资源',
                    retryable: false,
                });
            case 404:
                return new WeReadError({
                    code: ErrorCode.NOT_FOUND_ERROR,
                    message: '请求的资源不存在',
                    retryable: false,
                });
            case 429:
                return new WeReadError({
                    code: ErrorCode.RATE_LIMIT_ERROR,
                    message: '请求过于频繁，请稍后再试',
                    retryable: true,
                });
            case 500:
            case 502:
            case 503:
            case 504:
                return new WeReadError({
                    code: ErrorCode.SERVER_ERROR,
                    message: '服务器错误，请稍后再试',
                    retryable: true,
                });
            default:
                return new WeReadError({
                    code: ErrorCode.UNKNOWN_ERROR,
                    message: message || `请求失败 (${status})`,
                    retryable: false,
                });
        }
    }
}
exports.WeReadError = WeReadError;
/**
 * 解析错误
 */
function parseError(error) {
    if (error instanceof WeReadError) {
        return error;
    }
    if (error instanceof Error) {
        // 网络错误
        if (error.message.includes('network') ||
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('ENOTFOUND')) {
            return WeReadError.networkError(error.message, error);
        }
        // 超时错误
        if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
            return new WeReadError({
                code: ErrorCode.TIMEOUT_ERROR,
                message: '请求超时，请检查网络连接',
                originalError: error,
                retryable: true,
            });
        }
        return new WeReadError({
            code: ErrorCode.UNKNOWN_ERROR,
            message: error.message,
            originalError: error,
            retryable: false,
        });
    }
    return new WeReadError({
        code: ErrorCode.UNKNOWN_ERROR,
        message: '发生未知错误',
        retryable: false,
    });
}
exports.parseError = parseError;
//# sourceMappingURL=errors.js.map