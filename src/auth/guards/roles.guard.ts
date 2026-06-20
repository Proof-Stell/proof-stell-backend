import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UserRole } from '../constants';

/**
 * Role-based access guard.
 *
 * Accepts both shapes on the request user object so it works with the existing
 * JWT payload (which sets `role: 'admin'` singular) and any module that
 * decorates the request with a richer `roles: Role[]` array:
 *
 *   user.role === role ||               // JWT payload shape
 *   user.roles?.includes(role)          // modules that populate roles[]
 *
 * The guard fails closed when metadata is set but no role in the user object
 * matches, and it remains a pass-through when no @Roles() metadata is
 * attached to the handler/class.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      return false;
    }

    const userRoles = Array.isArray(user.roles) ? user.roles : [];
    const singularRole = typeof user.role === 'string' ? user.role : undefined;

    return requiredRoles.some(
      (role) => userRoles.includes(role) || singularRole === role,
    );
  }
}
