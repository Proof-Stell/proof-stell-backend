import { Reflector } from '@nestjs/core';
import { AuditLog } from '../audit-log.decorator';
import { AUDIT_LOG_KEY } from '../../interceptors/audit-log.interceptor';

describe('@AuditLog decorator', () => {
  it('attaches action metadata under AUDIT_LOG_KEY on the decorated handler', () => {
    class Target {
      @AuditLog({ actionType: 'USER_CREATED', resource: 'users' })
      handler() {}
    }

    const metadata = Reflect.getMetadata(
      AUDIT_LOG_KEY,
      Target.prototype.handler,
    );
    expect(metadata).toEqual({
      actionType: 'USER_CREATED',
      resource: 'users',
    });
  });

  it('is also readable via the Reflector (the production read path)', () => {
    class Target {
      @AuditLog({
        actionType: 'EXPORT_CSV',
        resource: 'admin',
        includeParams: true,
      })
      handler() {}
    }

    const reflector = new Reflector();
    const meta = reflector.get(AUDIT_LOG_KEY, Target.prototype.handler);
    expect(meta).toEqual({
      actionType: 'EXPORT_CSV',
      resource: 'admin',
      includeParams: true,
    });
  });
});
