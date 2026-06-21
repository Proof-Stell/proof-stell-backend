import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SettingsService } from '../../settings/settings.service';
import { Role } from '../enums/role.enum';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private settingsService: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const maintenanceModeEnabled =
      await this.settingsService.getMaintenanceMode();

    if (!maintenanceModeEnabled) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user && user.role === Role.ADMIN) {
      return true;
    }

    const maintenanceSetting =
      await this.settingsService.getSetting('maintenanceMode');
    const message =
      maintenanceSetting?.message ||
      'The platform is currently under maintenance. Please try again later.';

    throw new HttpException(message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
