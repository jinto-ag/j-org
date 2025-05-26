import { BadRequestError } from './errors.js';
import { DoesNotExist, EntityNotFound } from './model-errors.js';
import type { ActivityLog, ActivityType, Data, Item, User } from './types.js';
import { generateId, pluralize } from './utils.js';

export class JsonCrudManager {
  private data: Data;
  private uniqueConstraints: Record<string, string[]> = {
    users: ['username', 'email'],
    tenants: ['name'],
  };

  constructor(initialData: Data) {
    this.data = initialData;
  }

  public createActivity(
    type: ActivityType,
    title: string,
    description: string,
    performedBy: User,
    relatedEntityType: string,
    relatedEntityId: string
  ): ActivityLog {
    const now = new Date().toISOString();
    const activity: ActivityLog = {
      id: generateId(),
      created_at: now,
      updated_at: now,
      is_deleted: false,
      deleted_at: null,
      deleted_by_id: null,
      type,
      title,
      description,
      performed_by_id: performedBy.id,
      related_entity_type: relatedEntityType,
      related_entity_id: relatedEntityId,
      tenant_id: performedBy.tenant_id,
      created_by_id: performedBy.id,
      updated_by_id: performedBy.id,
    };
    this.data.activities.push(activity);
    return activity;
  }

  private enforceUniqueness(
    entityName: string,
    item: Item,
    excludeId?: string
  ): void {
    const pluralEntityName = pluralize(entityName);
    const uniqueFields = this.uniqueConstraints[entityName] || [];
    for (const field of uniqueFields) {
      if (item[field]) {
        const existing = this.data[pluralEntityName].find(
          existingItem =>
            existingItem[field] === item[field] &&
            existingItem.id !== excludeId &&
            !existingItem.is_deleted
        );
        if (existing) {
          throw new BadRequestError(
            `"${field}" "${item[field]}" already exists.`
          );
        }
      }
    }
  }

  private ensureAuditFields(
    item: Partial<Item>,
    user: User,
    isNew: boolean
  ): Item {
    const now = new Date().toISOString();
    const auditFields: Partial<Item> = {
      tenant_id: user.tenant_id,
      created_at: isNew ? now : item.created_at || now,
      updated_at: now,
      deleted_at: item.deleted_at || null,
      created_by_id: isNew ? user.id : item.created_by_id || user.id,
      updated_by_id: user.id,
      deleted_by_id: item.deleted_by_id || null,
      is_deleted: item.is_deleted ?? false,
    };

    return {
      ...item,
      ...auditFields,
      id: isNew ? generateId() : item.id,
    } as Item;
  }

  private validateRelationships(item: Partial<Item>, entityName: string): void {
    if (
      item.tenant_id &&
      !this.data.tenants.some(t => t.id === item.tenant_id && !t.is_deleted)
    ) {
      throw new BadRequestError(
        `Invalid tenant_id: "${item.tenant_id}" does not exist.`
      );
    }
    if (
      item.created_by_id &&
      !this.data.users.some(u => u.id === item.created_by_id && !u.is_deleted)
    ) {
      throw new BadRequestError(
        `Invalid created_by_id: "${item.created_by_id}" does not exist.`
      );
    }
    if (
      item.updated_by_id &&
      !this.data.users.some(u => u.id === item.updated_by_id && !u.is_deleted)
    ) {
      throw new BadRequestError(
        `Invalid updated_by_id: "${item.updated_by_id}" does not exist.`
      );
    }
    if (
      item.deleted_by_id &&
      !this.data.users.some(u => u.id === item.deleted_by_id && !u.is_deleted)
    ) {
      throw new BadRequestError(
        `Invalid deleted_by_id: "${item.deleted_by_id}" does not exist.`
      );
    }
  }

  public create(
    entityName: string,
    item: Omit<Item, 'id'>,
    user: User,
    addActivity = true
  ): Item {
    const pluralEntityName = pluralize(entityName);
    if (!this.data[pluralEntityName]) {
      throw new EntityNotFound(entityName);
    }

    this.enforceUniqueness(entityName, item as Item);
    const newItem = this.ensureAuditFields(item, user, true);
    this.validateRelationships(newItem, entityName);
    this.data[pluralEntityName].push(newItem);

    if (addActivity) {
      this.createActivity(
        'create',
        `Created ${entityName}`,
        `A new ${entityName} was created`,
        user,
        entityName,
        newItem.id
      );
    }

    return newItem;
  }

  public update(
    entityName: string,
    id: string,
    updates: Partial<Item>,
    user: User
  ): Item {
    const pluralEntityName = pluralize(entityName);
    if (!this.data[pluralEntityName]) {
      throw new EntityNotFound(entityName);
    }

    const index = this.data[pluralEntityName].findIndex(
      item => item.id === id && !item.is_deleted
    );
    if (index === -1) {
      throw new DoesNotExist(entityName, 'id', id);
    }

    // Enforce uniqueness for updates (e.g., username)
    if (pluralEntityName === 'users' && updates['username']) {
      const existing = this.data[pluralEntityName].find(
        item =>
          item.username === updates['username'] &&
          item.id !== id &&
          !item.is_deleted
      );
      if (existing) {
        throw new BadRequestError(
          `Username "${updates['username']}" already exists.`
        );
      }
    }

    const existingItem = this.data[pluralEntityName][index];
    this.enforceUniqueness(entityName, { ...existingItem, ...updates }, id);
    const updatedItem = this.ensureAuditFields(
      { ...existingItem, ...updates },
      user,
      false
    );
    this.validateRelationships(updatedItem, entityName);
    this.data[pluralEntityName][index] = updatedItem;

    this.createActivity(
      'update',
      `Updated ${entityName}`,
      `The ${entityName} with id ${id} was updated`,
      user,
      entityName,
      id
    );

    return updatedItem;
  }

  public delete(entityName: string, id: string, user: User): boolean {
    const pluralEntityName = pluralize(entityName);
    if (!this.data[pluralEntityName]) {
      throw new EntityNotFound(entityName);
    }

    const index = this.data[pluralEntityName].findIndex(
      item => item.id === id && !item.is_deleted
    );

    if (index === -1) {
      throw new DoesNotExist(entityName, 'id', id);
    }

    const now = new Date().toISOString();

    const updatedItem = this.ensureAuditFields(
      {
        ...this.data[pluralEntityName][index],
        deleted_at: now,
        deleted_by_id: user.id,
        is_deleted: true,
      },
      user,
      false
    );

    this.validateRelationships(updatedItem, entityName);

    this.data[pluralEntityName][index] = updatedItem;

    this.createActivity(
      'delete',
      `Deleted ${entityName}`,
      `The ${entityName} with id ${id} was deleted`,
      user,
      entityName,
      id
    );

    return true;
  }
  public read(entityName: string, id: string): Item {
    const pluralEntityName = pluralize(entityName);
    if (!this.data[pluralEntityName]) {
      throw new EntityNotFound(entityName);
    }

    const item = this.data[pluralEntityName].find(item => item.id === id);
    if (!item) {
      throw new DoesNotExist(entityName, 'id', id);
    }

    return item;
  }

  public getByField(entityName: string, field: string, value: any): Item {
    const pluralEntityName = pluralize(entityName);
    if (!this.data[pluralEntityName]) {
      throw new EntityNotFound(entityName);
    }

    const item = this.data[pluralEntityName].find(
      item => item[field] === value
    );
    if (!item) {
      throw new DoesNotExist(entityName, field, value);
    }

    return item;
  }

  public reset(user: User, entity?: string): boolean {
    if (entity) {
      const entityInData = Object.keys(this.data).includes(entity);
      if (!entityInData) {
        throw new EntityNotFound(entity);
      }
      if (entity === 'activities') {
        throw new BadRequestError(`Cannot reset activities`);
      }
      if (entity === 'users') {
        this.data[entity] = this.data[entity].filter(
          user =>
            user.id === 'system' &&
            user.username === 'system' &&
            user.tenant_id === 'system' &&
            user.created_by_id === 'system'
        );
      } else if (entity === 'tenants') {
        this.data[entity] = this.data[entity].filter(
          tenant =>
            tenant.id === 'system' &&
            tenant.created_by_id === 'system' &&
            tenant.name === 'Default'
        );
      } else {
        this.data[entity] = [];
      }
    } else {
      this.data = {
        ...this.data,
        ...Object.keys(this.data).reduce((acc, key) => {
          if (key !== 'activities') {
            acc[key] = [];
          } else {
            acc[key] = this.data[key];
          }
          return acc;
        }, {}),
      };
    }

    // Create activity
    this.createActivity(
      'reset',
      `Reset data`,
      `All data was reset`,
      user,
      entity ? entity : 'all',
      entity ? entity : 'all'
    );

    return true;
  }

  public addNewEntityKey(entityName: string, user: User): void {
    if (this.data[pluralize(entityName)]) {
      throw new BadRequestError(`Entity key ${entityName} already exists`);
    }
    this.data[pluralize(entityName)] = [];

    // Create activity
    this.createActivity(
      'create',
      `Added new entity`,
      `A new entity ${entityName} was added`,
      user,
      entityName,
      entityName
    );
  }

  public getData(): Data {
    return this.data;
  }

  public setData(newData: Data): void {
    this.data = newData;
  }
}
