/**
 * 错误类型定义
 * 统一错误分类和处理
 */

export enum ErrorCode {
  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',

  // 认证错误
  AUTH_ERROR = 'AUTH_ERROR',
  LOGIN_EXPIRED = 'LOGIN_EXPIRED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',

  // API 错误
  API_ERROR = 'API_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',

  // 数据错误
  DATA_ERROR = 'DATA_ERROR',
  SYNC_ERROR = 'SYNC_ERROR',
  EXPORT_ERROR = 'EXPORT_ERROR',

  // 文件错误
  FILE_ERROR = 'FILE_ERROR',
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  NOT_FOUND_ERROR = 'NOT_FOUND_ERROR',

  // 未知错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export const WEREAD_ERROR_CODES = {
  outputPathNotFound: 'WR-FS-001',
  outputPathPermissionDenied: 'WR-FS-002',
  fileWriteFailed: 'WR-FS-003',
  fileParseFailed: 'WR-INDEX-001',
  fileStatFailed: 'WR-INDEX-002',
  indexBuildFailed: 'WR-INDEX-003',
  unknown: 'WR-COMMON-001',
} as const;

export type WeReadStableErrorCode = typeof WEREAD_ERROR_CODES[keyof typeof WEREAD_ERROR_CODES];

export function formatErrorWithCode(stableCode: string, message: string): string {
  return `[${stableCode}] ${message}`;
}

export interface ErrorDetail {
  code: ErrorCode;
  message: string;
  originalError?: Error;
  retryable?: boolean;
}

export class WeReadError extends Error {
  public readonly code: ErrorCode;
  public readonly retryable: boolean;
  public readonly originalError?: Error;

  constructor(detail: ErrorDetail) {
    super(detail.message);
    this.name = 'WeReadError';
    this.code = detail.code;
    this.retryable = detail.retryable ?? false;
    this.originalError = detail.originalError;
  }

  /**
   * 创建网络错误
   */
  static networkError(message: string, originalError?: Error): WeReadError {
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
  static loginExpired(): WeReadError {
    return new WeReadError({
      code: ErrorCode.LOGIN_EXPIRED,
      message: '登录已过期，请重新登录',
      retryable: false,
    });
  }

  /**
   * 创建同步错误
   */
  static syncError(message: string, originalError?: Error): WeReadError {
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
  static exportError(message: string, originalError?: Error): WeReadError {
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
  static fileError(message: string, originalError?: Error): WeReadError {
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
  static fromHttpStatus(status: number, message?: string): WeReadError {
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

/**
 * 解析错误
 */
export function parseError(error: unknown): WeReadError {
  if (error instanceof WeReadError) {
    return error;
  }

  if (error instanceof Error) {
    // 网络错误
    if (
      error.message.includes('network') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ENOTFOUND')
    ) {
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
