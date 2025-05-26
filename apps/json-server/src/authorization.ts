// authorization.ts
import type { NextFunction, Request, Response } from '@tinyhttp/app';
import { newEnforcer, newModel, type Enforcer } from 'casbin';

import { UnauthorizedError } from './errors.js';
import type { JsonDataManager } from './json-data-manager.js';
import type { User } from './types.js';

// Define Casbin model as a string
const casbinModel = `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act, eft

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
m = g(r.sub, p.sub) && r.obj == p.obj && r.act == p.act || g(r.sub, "super_admin")
`;

export type AuthorizationConfig = {
  dataManager: JsonDataManager;
  superAdminRole?: string;
};

export class AuthorizationManager {
  private enforcer: Enforcer | null = null;
  private dataManager: JsonDataManager;
  private superAdminRole: string;
  private initialized = false;
  private initializationPromise: Promise<Enforcer> | null = null;

  constructor(config: AuthorizationConfig) {
    this.dataManager = config.dataManager;
    this.superAdminRole = config.superAdminRole ?? 'super_admin';
  }

  private async initializeEnforcer(): Promise<Enforcer> {
    const model = newModel();
    const lines = casbinModel.trim().split('\n');
    let currentSection = '';
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
        currentSection = trimmedLine.slice(1, -1);
      } else if (trimmedLine && currentSection) {
        const [key, value] = trimmedLine.split('=').map(part => part.trim());
        model.addDef(currentSection, key, value);
      }
    }

    this.enforcer = await newEnforcer(model);

    try {
      const userRoles = await this.dataManager.list('user-roles', {
        user: this.dataManager.getSystemUser(),
      });
      const permissions = await this.dataManager.list('permissions', {
        user: this.dataManager.getSystemUser(),
      });
      const rolePermissions = await this.dataManager.list('role-permissions', {
        user: this.dataManager.getSystemUser(),
      });
      const userPermissions = await this.dataManager.list('user-permissions', {
        user: this.dataManager.getSystemUser(),
      });

      for (const ur of userRoles.data) {
        await this.enforcer.addGroupingPolicy(ur.user_id, ur.role_id);
      }

      for (const rp of rolePermissions.data) {
        const perm = permissions.data.find(p => p.id === rp.permission_id);
        if (perm) {
          await this.enforcer.addPolicy(
            rp.role_id,
            perm.subject,
            perm.action,
            perm.inverted ? 'deny' : 'allow'
          );
        }
      }

      for (const up of userPermissions.data) {
        const perm = permissions.data.find(p => p.id === up.permission_id);
        if (perm) {
          await this.enforcer.addPolicy(
            up.user_id,
            perm.subject,
            perm.action,
            perm.inverted ? 'deny' : 'allow'
          );
        }
      }
    } catch (error) {
      console.error('Error loading policy:', error);
      throw error;
    }

    return this.enforcer;
  }

  private async init() {
    if (!this.initialized) {
      this.initializationPromise ??= this.initializeEnforcer();
      await this.initializationPromise;
      this.initialized = true;
    }
  }

  public enforceABAC = async (
    req: Request & { user?: User; method: string },
    _res: Response,
    next: NextFunction
  ) => {
    await this.init();
    const user = req.user as User | null;
    if (!this.enforcer) {
      return next(
        new UnauthorizedError('Authorization system not initialized')
      );
    }

    if (!user) {
      return next(new UnauthorizedError('User not authenticated'));
    }

    const isSuperAdmin = await this.isSuperAdmin(user);
    if (isSuperAdmin) {
      return next();
    }

    const entity = req.params.entity || 'global';
    const action = this.getActionFromMethod(req.method);

    const allowed = await this.enforcer.enforce(user.id, entity, action);
    if (!allowed) {
      return next(
        new UnauthorizedError(
          `Access denied: Insufficient permissions for ${action} on ${entity}`
        )
      );
    }

    next();
  };

  public async can(
    user: User,
    action: string,
    subject: string
  ): Promise<boolean> {
    await this.init();
    if (!this.enforcer) {
      throw new UnauthorizedError('Authorization system not initialized');
    }
    return (
      (await this.isSuperAdmin(user)) ||
      this.enforcer.enforce(user.id, subject, action)
    );
  }

  private async isSuperAdmin(user: User): Promise<boolean> {
    await this.init();
    const userRoles = await this.dataManager.list('user-roles', {
      filter: [{ field: 'user_id', operator: 'eq', value: user.id }],
      user: this.dataManager.getSystemUser(),
    });
    return (
      userRoles.data.some(ur => ur.role_id === this.superAdminRole) ||
      user.tenant_id === 'system'
    );
  }

  private getActionFromMethod(method: string): string {
    switch (method) {
      case 'GET':
        return 'read';
      case 'POST':
        return 'create';
      case 'PUT':
      case 'PATCH':
        return 'update';
      case 'DELETE':
        return 'delete';
      default:
        return 'unknown';
    }
  }
}

export const authorizationMiddleware = (config: AuthorizationConfig) => {
  const manager = new AuthorizationManager(config);
  return manager.enforceABAC;
};
