import { Global, Module } from '@nestjs/common';
import { AuditLogModule } from './modules/audit-log.module';

/**
 * Global audit module.
 *
 * AuditLogModule (under ./modules) owns the AuditLog repository registration,
 * the AuditLogService, and the AuditLogInterceptor. Wrapping it here and
 * exposing it as @Global means the interceptor and service can be referenced
 * via @UseInterceptors(AuditLogInterceptor) / constructor injection from any
 * other module without re-importing the provider list.
 *
 * Note: previously this file was a stub (@Module({})) which meant the
 * @AuditLog decorator was effectively dead at runtime in any module that did
 * not re-register AuditLogModule itself.
 */
@Global()
@Module({
  imports: [AuditLogModule],
  exports: [AuditLogModule],
})
export class AuditModule {}
