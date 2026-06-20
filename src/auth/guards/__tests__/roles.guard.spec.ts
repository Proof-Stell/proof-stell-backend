import { Test, type TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const buildContext = (user: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('is a pass-through when no @Roles() metadata is attached', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    expect(guard.canActivate(buildContext({ role: 'player' }))).toBe(true);
  });

  it('fails closed when the request has no user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    expect(guard.canActivate(buildContext(undefined))).toBe(false);
  });

  describe('with array-shaped `user.roles` (modules that populate roles)', () => {
    it('admits a user whose roles list overlaps @Roles()', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

      expect(
        guard.canActivate(
          buildContext({ id: 'u1', roles: [Role.ADMIN, Role.PLAYER] }),
        ),
      ).toBe(true);
    });

    it('rejects a user whose roles list does not overlap @Roles()', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

      expect(
        guard.canActivate(buildContext({ id: 'u1', roles: [Role.PLAYER] })),
      ).toBe(false);
    });
  });

  describe('with singular `user.role` (JWT payload shape)', () => {
    it('admits a user whose `role` matches the required role', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

      expect(guard.canActivate(buildContext({ id: 'u1', role: 'admin' }))).toBe(
        true,
      );
    });

    it('rejects a user whose `role` does not match', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

      expect(
        guard.canActivate(buildContext({ id: 'u1', role: 'player' })),
      ).toBe(false);
    });
  });

  it('requires at least one role match across both shapes', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Role.ADMIN, Role.PLAYER]);

    expect(
      guard.canActivate(buildContext({ id: 'u1', role: 'player', roles: [] })),
    ).toBe(true);
    expect(guard.canActivate(buildContext({ id: 'u1', role: 'guest' }))).toBe(
      false,
    );
  });

  it('reads metadata from the handler first, then the class', () => {
    const spy = jest.spyOn(reflector, 'getAllAndOverride');

    class Foo {
      @Roles(Role.ADMIN)
      bar() {}
    }

    guard.canActivate({
      switchToHttp: () => ({ getRequest: () => ({ role: 'admin' }) }),
      getHandler: () => Foo.prototype.bar,
      getClass: () => Foo,
    } as unknown as ExecutionContext);

    expect(spy).toHaveBeenCalledWith(expect.any(String), [
      Foo.prototype.bar,
      Foo,
    ]);
  });
});
