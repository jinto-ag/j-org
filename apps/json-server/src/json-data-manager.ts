import { DataService } from './data-service.js';
import type { MultitenancyManager } from './multitenancy.js';
import type {
  ActivityLog,
  Item,
  LogicalFilter,
  Pagination,
  PaginationOptions,
  SingleFilter,
  SortCondition,
  Tenant,
  User,
} from './types.js';

export type JsonDataManagerConfig = {
  filePath: string;
  cacheTTL: number;
};

export class JsonDataManager {
  private static instance: JsonDataManager;
  private dataService: DataService;

  constructor(
    config: JsonDataManagerConfig,
    multitenancy: MultitenancyManager
  ) {
    this.dataService = new DataService(
      config.filePath,
      config.cacheTTL,
      multitenancy
    );
  }

  public static getInstance(
    config: JsonDataManagerConfig,
    multitenancy: MultitenancyManager
  ): JsonDataManager {
    if (!JsonDataManager.instance) {
      JsonDataManager.instance = new JsonDataManager(config, multitenancy);
    }
    return JsonDataManager.instance;
  }

  public async create(
    entityName: string,
    item: Omit<Item, 'id'>,
    user?: User,
    addActivity = true
  ): Promise<Item> {
    return await this.dataService.create(entityName, item, user, addActivity);
  }

  public async update(
    entityName: string,
    id: string,
    updates: Partial<Item>,
    user?: User
  ): Promise<Item> {
    return await this.dataService.update(entityName, id, updates, user);
  }

  public async delete(
    entityName: string,
    id: string,
    user?: User
  ): Promise<boolean> {
    return await this.dataService.delete(entityName, id, user);
  }

  public async reset(user?: User, entity?: string): Promise<boolean> {
    return await this.dataService.reset(user, entity);
  }

  public async addNewEntityKey(entityName: string, user: User): Promise<void> {
    await this.dataService.addNewEntityKey(entityName, user);
  }

  public async read(entityName: string, id: string): Promise<Item> {
    return await this.dataService.read(entityName, id);
  }

  public async addActivity(
    activity: Pick<
      ActivityLog,
      | 'type'
      | 'title'
      | 'description'
      | 'related_entity_type'
      | 'related_entity_id'
    >,
    user: User
  ): Promise<void> {
    return await this.dataService.addActivity(activity, user);
  }

  public getByField(
    entityName: string,
    field: string,
    value: any
  ): Item | null {
    return this.dataService.getByField(entityName, field, value);
  }

  public async list(
    entityName: string,
    options: {
      pagination?: PaginationOptions;
      sort?: SortCondition[];
      filter?: (SingleFilter | LogicalFilter)[];
      embed?: string[];
      expand?: string[];
      user?: User;
      includeDeleted?: boolean;
    } = {}
  ): Promise<{ data: Item[]; pagination: Pagination }> {
    return await this.dataService.list(entityName, options);
  }

  public async search(
    query: string,
    options: {
      pagination?: PaginationOptions;
      entity?: string | string[];
      sort?: SortCondition[];
      filter?: (SingleFilter | LogicalFilter)[];
      user?: User;
    } = {}
  ): Promise<{ data: Record<string, Item[]>; pagination: Pagination }> {
    return await this.dataService.search(query, options);
  }

  public async invalidateCache(entityName?: string): Promise<void> {
    await this.dataService.invalidateCache(entityName);
  }

  public getSystemUser(): User {
    return this.dataService.getSystemUser();
  }

  public getDefaultTenant(): Tenant {
    return this.dataService.getDefaultTenant();
  }
}

export default JsonDataManager;
