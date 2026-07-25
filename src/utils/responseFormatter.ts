import { Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: {
    code?: string;
    details?: any;
  };
  timestamp: string;
}

export class ApiResponseFormatter {
  /**
   * Sends a standardized success HTTP response.
   */
  static success<T>(res: Response, data: T, message?: string, statusCode: number = 200): void {
    const response: ApiResponse<T> = {
      success: true,
      ...(message ? { message } : {}),
      data,
      timestamp: new Date().toISOString(),
    };
    res.status(statusCode).json(response);
  }

  /**
   * Sends a standardized error HTTP response.
   */
  static error(res: Response, message: string, statusCode: number = 500, details?: any, code?: string): void {
    const response: ApiResponse = {
      success: false,
      message,
      error: {
        code: code || `ERR_${statusCode}`,
        ...(details ? { details } : {}),
      },
      timestamp: new Date().toISOString(),
    };
    res.status(statusCode).json(response);
  }
}
