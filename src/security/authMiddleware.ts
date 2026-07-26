import { Request, Response, NextFunction } from 'express';
import { AccessKeyService } from '@/security/accessKeyService';
import { ApiResponseFormatter } from '@/utils/responseFormatter';
import { logger } from '@/utils/logger';

/**
 * Webhook Authentication Middleware
 * 
 * Validates incoming HTTP requests to webhook endpoints by inspecting the `accesskey` header.
 * Ensures that only authorized monitoring systems (Sentry, Slack, CI/CD pipelines) can trigger
 * automated debugging jobs or interact with the agent.
 */
export const validateWebhookAccessKey = (req: Request, res: Response, next: NextFunction): void => {
  // Allow health checks to pass without authentication for load balancer liveness probes
  if (req.path === '/health' || req.path === '/api/v1/webhooks/health') {
    return next();
  }

  // Extract access key from headers (case-insensitive in Express, but we check common variations)
  const headerVal = req.headers['accesskey'] || req.headers['x-access-key'] || req.headers['x-aegis-access-key'];
  
  if (!AccessKeyService.validateKey(headerVal)) {
    const attemptedKey = Array.isArray(headerVal) ? headerVal[0] : (headerVal || 'NONE');
    const maskedKey = attemptedKey === 'NONE' ? 'NONE' : `${attemptedKey.substring(0, 6)}...`;
    
    logger.warn(`[AuthMiddleware] Unauthorized webhook request blocked on ${req.method} ${req.path} (Provided Key: ${maskedKey})`);
    
    ApiResponseFormatter.error(
      res,
      'Unauthorized: Valid webhook access key required in "accesskey" header',
      401,
      'Missing or invalid access key credential',
      'ERR_UNAUTHORIZED'
    );
    return;
  }

  // Key is valid, proceed to next handler
  next();
};
