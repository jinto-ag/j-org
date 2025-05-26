// multitenancy.ts
import type { NextFunction, Request, Response } from '@tinyhttp/app';

import { UnauthorizedError } from './errors.js';
import type { Item, User } from './types.js';

export type MultitenancyConfig = {
  superAdminRole?: string; // Role that can access all tenants (default: "super_admin")
};

export class MultitenancyManager {
  private config: MultitenancyConfig;

  constructor(config: MultitenancyConfig = {}) {
    this.config = {
      superAdminRole: config.superAdminRole || 'super_admin',
    };
  }

  /**
   * Middleware to enforce tenant scoping on requests.
   * Adds tenant scoping to req.multitenancy for downstream use.
   */
  public enforceTenantScope = async (
    req: Request & { user: User; multitenancy: Record<string, any> },
    res: Response,
    next: NextFunction
  ) => {
    const user = req.user as User | undefined;
    if (!user) {
      return next(new UnauthorizedError('User not authenticated'));
    }

    const isSuperAdmin = await this.isSuperAdmin(user);
    req.multitenancy = {
      tenantId: user.tenant_id,
      isSuperAdmin,
      scopeItems: (items: Item[]) =>
        isSuperAdmin
          ? items.filter(item => !item.is_deleted)
          : items.filter(
              item => item.tenant_id === user.tenant_id && !item.is_deleted
            ),
      checkItemAccess: (item: Item) => {
        if (isSuperAdmin) return true;
        if (item.tenant_id !== user.tenant_id) {
          throw new UnauthorizedError(
            `Access denied: Item belongs to tenant "${item.tenant_id}", not "${user.tenant_id}"`
          );
        }
        return true;
      },
    };

    next();
  };

  /**
   * Check if a user has super admin privileges.
   */
  public async isSuperAdmin(user: User): Promise<boolean> {
    // For now, assume super admin is tied to a role or tenant_id
    // Later, integrate with Casbin in authorization.ts
    return (
      user.tenant_id === 'system' ||
      (user as any).roles?.includes(this.config.superAdminRole)
    );
  }

  /**
   * Filter items based on tenant scope for a given user.
   */
  public scopeItems(items: Item[], user: User, includeDeleted = true): Item[] {
    const isSuperAdmin = this.isSuperAdmin(user);
    return isSuperAdmin
      ? items.filter(item => includeDeleted || !item.is_deleted)
      : items.filter(
          item =>
            item.tenant_id === user.tenant_id &&
            (includeDeleted || !item.is_deleted)
        );
  }
}

export const multitenancyMiddleware = (config?: MultitenancyConfig) => {
  const manager = new MultitenancyManager(config);
  return manager.enforceTenantScope;
};
