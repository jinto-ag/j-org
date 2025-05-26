import type { Data, Item } from './types.js';
import { pluralize, singularize } from './utils.js';

export class ModelRelationsManager {
  private relationships: Record<string, string[]>;
  private foreignKeySuffixes: string[];

  constructor(foreignKeySuffixes: string[] = ['Id', '_id']) {
    this.relationships = {};
    this.foreignKeySuffixes = foreignKeySuffixes;
  }

  public detectRelationships(data: Data): void {
    this.relationships = {};
    for (const [entityName, entities] of Object.entries(data)) {
      this.relationships[entityName] = [];
      if (entities.length > 0) {
        const sampleEntity = entities[0];
        for (const key of Object.keys(sampleEntity)) {
          const relatedEntity = this.getRelatedEntityName(key);
          if (relatedEntity && data[pluralize(relatedEntity)]) {
            this.relationships[entityName].push(relatedEntity);
          }
        }
      }
    }
  }

  private getRelatedEntityName(key: string): string | null {
    for (const suffix of this.foreignKeySuffixes) {
      if (key.endsWith(suffix)) {
        return key.slice(0, -suffix.length);
      }
    }
    return null;
  }

  public getRelationships(entityName: string): string[] {
    return this.relationships[entityName] || [];
  }

  public expandRelatedEntities(
    entityName: string,
    data: Item[],
    embed: string[],
    expand: string[],
    allData: Data,
    depth = 0,
    maxDepth = 3
  ): Item[] {
    if (depth >= maxDepth) return data;

    return data.map(item => {
      const expanded = { ...item };

      // Handle embed (one-to-many relationships)
      for (const relation of embed) {
        const [directRelation, ...nestedEmbed] = relation.split('.');
        const relatedEntityName = pluralize(directRelation);
        if (allData[relatedEntityName]) {
          const foreignKey = `${singularize(entityName)}_id`;
          const relatedItems = allData[relatedEntityName].filter(
            r => r[foreignKey] === item.id
          );
          if (relatedItems.length > 0) {
            expanded[relatedEntityName] =
              nestedEmbed.length > 0
                ? this.expandRelatedEntities(
                    relatedEntityName,
                    relatedItems,
                    nestedEmbed,
                    [],
                    allData,
                    depth + 1,
                    maxDepth
                  )
                : relatedItems;
          }
        }
      }

      // Handle expand (one-to-one relationships)
      for (const relation of expand) {
        const [directRelation, ...nestedExpand] = relation.split('.');
        if (this.relationships[entityName]?.includes(directRelation)) {
          const foreignKey = `${directRelation}_id`;
          const relatedEntityName = pluralize(directRelation);
          const relatedItem = allData[relatedEntityName]?.find(
            r => r.id === item[foreignKey]
          );
          if (relatedItem) {
            expanded[directRelation] =
              nestedExpand.length > 0
                ? this.expandRelatedEntities(
                    relatedEntityName,
                    [relatedItem],
                    [],
                    nestedExpand,
                    allData,
                    depth + 1,
                    maxDepth
                  )[0]
                : relatedItem;
          }
        }
      }

      return expanded;
    });
  }

  public getForeignKey(entityName: string): string {
    const singularName = singularize(entityName);
    for (const suffix of this.foreignKeySuffixes) {
      const key = `${singularName}${suffix}`;
      if (key in this.relationships) {
        return key;
      }
    }
    return `${singularName}Id`; // Default to camelCase if not found
  }
}
