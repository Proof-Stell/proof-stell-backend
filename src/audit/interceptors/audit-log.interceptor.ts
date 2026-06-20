import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { AuditLogService } from '../services/audit-log.service';
import type { Request } from 'express';

export const AUDIT_LOG_KEY = 'auditLog';

export interface AuditLogMetadata {
  actionType: string;
  resource?: string;
  includeBody?: boolean;
  includeParams?: boolean;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditMetadata = this.reflector.get<AuditLogMetadata>(
      AUDIT_LOG_KEY,
      context.getHandler(),
    );

    if (!auditMetadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as any; // Assuming user is attached to request

    // The JWT subject is usually exposed as `sub` (AuthGuard sets
    // `request.user = jwt payload`). Some auth pipelines expose it as `id`
    // instead, so accept either; fall through silently when neither is set
    // (e.g. unauthenticated probe routes that nevertheless carry @AuditLog).
    const userId: string | undefined = user?.id ?? user?.sub;

    if (!userId) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap((response) => {
        this.logAction(
          auditMetadata,
          request,
          userId,
          'SUCCESS',
          response,
          Date.now() - startTime,
        );
      }),
      catchError((error) => {
        this.logAction(
          auditMetadata,
          request,
          userId,
          'ERROR',
          { error: error.message },
          Date.now() - startTime,
        );
        throw error;
      }),
    );
  }

  private async logAction(
    metadata: AuditLogMetadata,
    request: Request,
    userId: string,
    result: 'SUCCESS' | 'ERROR',
    responseData: any,
    duration: number,
  ) {
    try {
      const logMetadata: Record<string, any> = {
        method: request.method,
        url: request.url,
        duration,
        result,
      };

      if (metadata.includeParams && request.params) {
        logMetadata.params = request.params;
      }

      if (metadata.includeBody && request.body) {
        // Sanitize sensitive data
        const sanitizedBody = this.sanitizeData(request.body);
        logMetadata.requestBody = sanitizedBody;
      }

      if (result === 'SUCCESS' && responseData) {
        logMetadata.responseSize = JSON.stringify(responseData).length;
      }

      await this.auditLogService.logAction({
        actionType: metadata.actionType,
        userId,
        metadata: logMetadata,
        ipAddress: this.getClientIp(request),
        userAgent: request.headers['user-agent'],
        resource: metadata.resource,
        result,
      });
    } catch (error) {
      // Log error but don't throw to avoid breaking the main request
      console.error('Failed to create audit log:', error);
    }
  }

  private sanitizeData(data: any): any {
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'key',
      'authorization',
    ];

    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const sanitized = { ...data };

    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  private getClientIp(request: Request): string {
    return ((request.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      request.headers['x-real-ip'] ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      'unknown') as string;
  }
}
