import { createCache } from 'cache-manager';
import { CacheableMemory } from 'cacheable';
import { kebabCase } from 'change-case';
import { singularize } from 'inflection';
import { Keyv } from 'keyv';

import { DataOperationsManager } from './data-operations-manager.js';
import { DataPersistenceManager } from './data-persistence-manager.js';
import { JsonCrudManager } from './json-crud-manager.js';
import { ModelRelationsManager } from './model-relations-manager.js';
import type { MultitenancyManager } from './multitenancy.js';
import type {
  ActivityLog,
  Data,
  Item,
  LogicalFilter,
  Pagination,
  PaginationOptions,
  SingleFilter,
  SortCondition,
  Tenant,
  User,
} from './types.js';
import { hashPassword, pluralize } from './utils.js';

export class DataService {
  private crudManager!: JsonCrudManager;
  private multitenancy: MultitenancyManager;
  private persistenceManager: DataPersistenceManager;
  private operationsManager!: DataOperationsManager;
  private relationsManager!: ModelRelationsManager;
  private cache: ReturnType<typeof createCache>;
  private systemUser!: User;
  private defaultTenant!: Tenant;
  private defaultSystemUser = {
    id: 'system',
    username: 'system',
    email: 'self@system.com',
    is_active: true,
    created_by_id: 'system',
    updated_by_id: 'system',
  };
  private initialized: Promise<void>;

  constructor(
    filePath: string,
    cacheTTL = 300,
    multitenancy: MultitenancyManager
  ) {
    this.persistenceManager = new DataPersistenceManager(filePath);
    this.multitenancy = multitenancy;
    this.cache = createCache({
      ttl: cacheTTL,
      stores: [
        new Keyv({
          store: new CacheableMemory({ ttl: 60000, lruSize: 5000 }),
        }),
      ],
    });
    this.initialized = this.initializeData();
  }

  private async initializeData() {
    const initialData = await this.persistenceManager.loadData();
    this.crudManager = new JsonCrudManager(initialData);
    this.operationsManager = new DataOperationsManager(initialData);
    this.relationsManager = new ModelRelationsManager();
    this.relationsManager.detectRelationships(initialData);
    await this.initializeSystemEntities(initialData);
  }

  private async initializeSystemEntities(data: Data) {
    await this.initializeDefaultTenant(data);
    await this.initializeSystemUser(data);
  }

  private async initializeDefaultTenant(data: Data) {
    if (!data.tenants) {
      data.tenants = [];
    }

    let defaultTenant = data.tenants.find(
      tenant => tenant.name === 'Default'
    ) as unknown as Tenant | undefined;

    if (!defaultTenant) {
      const now = new Date().toISOString();
      defaultTenant = {
        id: 'system',
        name: 'Default',
        domain: 'http://www.default.com',
        uuid: 'e175f242-3cc7-55b9-9e74-458abf274b97',
        created_at: now,
        updated_at: now,
        created_by_id: 'system',
        updated_by_id: 'system',
        deleted_by_id: null,
        deleted_at: null,
      };
      data.tenants.push(defaultTenant);

      await this.addActivity(
        {
          type: 'create',
          title: 'Created Tenant',
          description: 'Created the default tenant',
          related_entity_type: 'tenants',
          related_entity_id: defaultTenant.id,
        },
        { ...this.defaultSystemUser, tenant_id: defaultTenant.id } as User
      );
      await this.persistenceManager.saveData(data);
    }

    this.defaultTenant = defaultTenant;
  }

  private async initializeSystemUser(data: Data) {
    if (!data.users) {
      data.users = [];
    }

    let systemUser = data.users.find(
      user => user.username === 'system'
    ) as User;

    if (!systemUser) {
      const now = new Date().toISOString();
      systemUser = {
        ...this.defaultSystemUser,
        password: await hashPassword('systemPassword123!'),
        tenant_id: this.defaultTenant.id,
        created_at: now,
        updated_at: now,
        deleted_by_id: null,
        deleted_at: null,
      };
      data.users.push(systemUser);
      await this.persistenceManager.saveData(data);
    }

    this.systemUser = systemUser;
  }

  /**
   * Helper to remove sensitive fields (e.g. password) from the result.
   */
  private sanitizeResult(entityName: string, item: Item): Item {
    const normalizedEntity = kebabCase(singularize(entityName));
    if (normalizedEntity === 'user' && item && 'password' in item) {
      const { password, ...rest } = item;
      return rest;
    }
    return item;
  }

  public async create(
    entityName: string,
    item: Omit<Item, 'id'>,
    user: User = this.systemUser,
    addActivity = true
  ): Promise<Item> {
    if ('password' in item) {
      item.password = await hashPassword(item.password);
    }

    const newItem = this.crudManager.create(
      entityName,
      item,
      user,
      addActivity
    );
    await this.persistData();
    await this.invalidateCache(entityName);
    return this.sanitizeResult(entityName, newItem);
  }

  public async update(
    entityName: string,
    id: string,
    updates: Partial<Item>,
    user: User = this.systemUser
  ): Promise<Item> {
    if ('password' in updates) {
      updates.password = await hashPassword(updates.password);
    }

    const updatedItem = this.crudManager.update(entityName, id, updates, user);
    await this.persistData();
    await this.invalidateCache(entityName);
    return this.sanitizeResult(entityName, updatedItem);
  }

  public async delete(
    entityName: string,
    id: string,
    user: User = this.systemUser
  ): Promise<boolean> {
    const result = this.crudManager.delete(entityName, id, user);
    await this.persistData();
    await this.invalidateCache(entityName);
    return result;
  }

  public async reset(
    user: User = this.systemUser,
    entity?: string
  ): Promise<boolean> {
    const result = this.crudManager.reset(user, entity);
    await this.persistData();
    await this.invalidateCache();
    return result;
  }

  public read(entityName: string, id: string): Item {
    const item = this.crudManager.read(entityName, id);
    return this.sanitizeResult(entityName, item);
  }

  public getByField(entityName: string, field: string, value: any): Item {
    return this.crudManager.getByField(entityName, field, value);
  }

  public async list(
    entityName: string,
    options: {
      pagination?: { current: number; pageSize: number };
      sort?: SortCondition[];
      filter?: (SingleFilter | LogicalFilter)[];
      embed?: string[];
      expand?: string[];
      user?: User;
      includeDeleted?: boolean;
    } = {}
  ): Promise<{ data: Item[]; pagination: Pagination }> {
    await this.initialized;
    const user = options.user ?? this.systemUser;
    let data = this.crudManager.getData()[pluralize(entityName)] || [];
    data = this.multitenancy.scopeItems(data, user, options.includeDeleted);

    if (options.filter) {
      data = this.operationsManager.applyFilter(data, options.filter);
    }

    if (options.sort) {
      data = this.operationsManager.applySort(data, options.sort);
    }

    const { data: paginatedData, pagination } =
      this.operationsManager.applyPagination(
        data,
        options.pagination ?? { current: 1, pageSize: 10 }
      );

    return {
      data: paginatedData.map(item => this.sanitizeResult(entityName, item)),
      pagination,
    };
  }

  public async search(
    query: string,
    options: {
      pagination?: PaginationOptions;
      sort?: SortCondition[];
      filter?: (SingleFilter | LogicalFilter)[];
      entity?: string | string[];
      user?: User;
    } = {}
  ): Promise<{ data: Record<string, Item[]>; pagination: Pagination }> {
    await this.initialized;
    const user = options.user ?? this.systemUser;
    const results: Record<string, Item[]> = {};
    const data = this.crudManager.getData();

    const processEntity = (entityKey: string, entityData: Item[]) => {
      let filteredData = this.multitenancy.scopeItems(entityData, user);
      if (options.filter) {
        filteredData = this.operationsManager.applyFilter(
          filteredData,
          options.filter
        );
      } else if (query) {
        filteredData = this.operationsManager.searchItems(filteredData, query);
      }
      if (filteredData.length > 0) {
        results[entityKey] = filteredData;
      }
    };

    if (options.entity) {
      const entities = Array.isArray(options.entity)
        ? options.entity
        : [options.entity];
      for (const entity of entities) {
        processEntity(pluralize(entity), data[pluralize(entity)] || []);
      }
    } else {
      for (const entityKey in data) {
        processEntity(entityKey, data[entityKey] || []);
      }
    }

    if (options.sort) {
      for (const key in results) {
        results[key] = this.operationsManager.applySort(
          results[key],
          options.sort
        );
      }
    }

    const flatResults = Object.values(results).flat();
    const { data: paginatedFlatData, pagination } =
      this.operationsManager.applyPagination(
        flatResults,
        options.pagination ?? { current: 1, pageSize: 10 }
      );

    const paginatedResults: Record<string, Item[]> = {};
    for (const key in results) {
      const entityPaginated = this.operationsManager.applyPagination(
        results[key],
        options.pagination ?? { current: 1, pageSize: 10 }
      ).data;
      paginatedResults[key] = entityPaginated.map(item =>
        this.sanitizeResult(key, item)
      );
    }

    return {
      data: paginatedResults,
      pagination,
    };
  }

  public async addNewEntityKey(
    entityName: string,
    user: User = this.systemUser
  ): Promise<void> {
    this.crudManager.addNewEntityKey(entityName, user);
    await this.persistData();
    await this.invalidateCache(entityName);
  }

  public async addActivity(
    activity: Partial<ActivityLog>,
    user: User
  ): Promise<void> {
    this.crudManager.createActivity(
      activity.type!,
      activity.title!,
      activity.description!,
      user,
      activity.related_entity_type!,
      activity.related_entity_id!
    );
    await this.persistData();
  }

  private async persistData(): Promise<void> {
    await this.persistenceManager.saveData(this.crudManager.getData());
  }

  private generateCacheKey(entityName: string, options: any): string {
    return `${entityName}:${JSON.stringify(options)}`;
  }

  public async invalidateCache(entityName?: string): Promise<void> {
    if (entityName) {
      await this.cache.del(entityName);
    } else {
      await this.cache.clear();
    }
  }

  public getSystemUser(): User {
    return { ...this.systemUser };
  }

  public getDefaultTenant(): Tenant {
    return { ...this.defaultTenant };
  }
}
