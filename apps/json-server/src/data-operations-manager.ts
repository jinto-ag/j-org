import sortOn from 'sort-on';

import { ModelRelationsManager } from './model-relations-manager.js';
import type {
  Data,
  Item,
  LogicalFilter,
  Pagination,
  PaginationOptions,
  SingleFilter,
  SortCondition,
} from './types.js';
import { getNestedProperty } from './utils.js';

export class DataOperationsManager {
  private relationsManager: ModelRelationsManager;

  constructor(data: Data) {
    this.relationsManager = new ModelRelationsManager();
    this.relationsManager.detectRelationships(data);
  }

  /**
   * Applies a list of filters to an array of items.
   *
   * Filtering supports both single condition filters and logical combinations:
   * - Single Filter: `{"field": "name", "operator": "eq", "value": "John"}`
   *   - Applies a condition to a specific field (e.g., equality, contains, etc.).
   * - Logical Filter: `{"operator": "and", "value": [...]}` or `{"operator": "or", "value": [...]}`
   *   - Combines multiple sub-filters (single or logical) with AND/OR logic.
   *   - Must not include a "field" property.
   *   - "value" is an array of filters (can be nested).
   * - Special "q" Filter: `{"field": "q", "operator": "contains", "value": "searchTerm"}`
   *   - Searches all searchable fields (strings, numbers, booleans) for the term (case-insensitive).
   *
   * Default Behavior:
   * - When multiple top-level filters are provided without an explicit logical operator,
   *   they are combined with an OR condition.
   *
   * Examples:
   * - Simple OR: `[{"field": "first_name", "operator": "contains", "value": "jin"}, {"field": "last_name", "operator": "contains", "value": "jin"}]`
   *   - Returns items where first_name OR last_name contains "jin".
   * - Explicit AND: `[{"operator": "and", "value": [{"field": "first_name", "operator": "contains", "value": "jin"}, {"field": "last_name", "operator": "contains", "value": "jin"}]}]`
   *   - Returns items where first_name AND last_name contain "jin".
   */
  public applyFilter(
    items: Item[],
    filters: (SingleFilter | LogicalFilter)[] = []
  ): Item[] {
    if (!filters.length) return items;

    // If there's only one filter, process it directly
    if (filters.length === 1) {
      const filter = filters[0];
      if ('field' in filter) {
        if (filter.field === 'q' && typeof filter.value === 'string') {
          return this.searchItems(items, filter.value);
        }
        return items.filter(item => this.evaluateFilter(item, filter));
      } else if ('operator' in filter && 'value' in filter) {
        const { operator, value } = filter;
        if (operator === 'and') {
          return this.applyFilter(items, value);
        } else if (operator === 'or') {
          const filteredItems: Item[] = [];
          const seen = new Set<string>();
          for (const subFilter of value) {
            const subResult = this.applyFilter(items, [subFilter]);
            subResult.forEach(item => {
              if (!seen.has(item.id)) {
                filteredItems.push(item);
                seen.add(item.id);
              }
            });
          }
          return filteredItems;
        }
      }
      return items; // Invalid filter case
    }

    // Multiple top-level filters: default to OR
    const filteredItems: Item[] = [];
    const seen = new Set<string>();
    for (const filter of filters) {
      if ('field' in filter) {
        let subResult: Item[];
        if (filter.field === 'q' && typeof filter.value === 'string') {
          subResult = this.searchItems(items, filter.value);
        } else {
          subResult = items.filter(item => this.evaluateFilter(item, filter));
        }
        subResult.forEach(item => {
          if (!seen.has(item.id)) {
            filteredItems.push(item);
            seen.add(item.id);
          }
        });
      } else if ('operator' in filter && 'value' in filter) {
        const subResult = this.applyFilter(items, [filter]);
        subResult.forEach(item => {
          if (!seen.has(item.id)) {
            filteredItems.push(item);
            seen.add(item.id);
          }
        });
      }
    }
    return filteredItems;
  }

  private evaluateLogicalFilter(item: Item, filter: LogicalFilter): boolean {
    const { operator = 'or', value } = filter;

    if (operator === 'and') {
      return value.every(subFilter =>
        'field' in subFilter
          ? this.evaluateFilter(item, subFilter)
          : this.evaluateLogicalFilter(item, subFilter)
      );
    } else if (operator === 'or') {
      return value.some(subFilter =>
        'field' in subFilter
          ? this.evaluateFilter(item, subFilter)
          : this.evaluateLogicalFilter(item, subFilter)
      );
    }

    return false;
  }

  private evaluateFilter(item: Item, filter: SingleFilter): boolean {
    const { field, operator, value } = filter;
    const itemValue = getNestedProperty(item, field);

    return this.evaluateCondition({ field, operator, value, itemValue });
  }

  private evaluateCondition(condition: any): boolean {
    const { operator, value, itemValue } = condition;

    let result: boolean;
    switch (operator) {
      case 'eq':
        result = this.compareValues(itemValue, value, (a, b) => a === b);
        break;
      case 'ne':
        result = this.compareValues(itemValue, value, (a, b) => a !== b);
        break;
      case 'gt':
        result = this.compareValues(itemValue, value, (a, b) => a > b);
        break;
      case 'gte':
        result = this.compareValues(itemValue, value, (a, b) => a >= b);
        break;
      case 'lt':
        result = this.compareValues(itemValue, value, (a, b) => a < b);
        break;
      case 'lte':
        result = this.compareValues(itemValue, value, (a, b) => a <= b);
        break;
      case 'in':
        result = Array.isArray(value) && value.includes(itemValue);
        break;
      case 'nin':
        result = Array.isArray(value) && !value.includes(itemValue);
        break;
      case 'contains':
        result =
          typeof itemValue === 'string' &&
          typeof value === 'string' &&
          itemValue.toLowerCase().includes(value.toLowerCase());
        break;
      case 'ncontains':
        result =
          typeof itemValue === 'string' &&
          typeof value === 'string' &&
          !itemValue.toLowerCase().includes(value.toLowerCase());
        break;
      case 'startswith':
        result =
          typeof itemValue === 'string' &&
          typeof value === 'string' &&
          itemValue.toLowerCase().startsWith(value.toLowerCase());
        break;
      case 'endswith':
        result =
          typeof itemValue === 'string' &&
          typeof value === 'string' &&
          itemValue.toLowerCase().endsWith(value.toLowerCase());
        break;
      case 'like':
        result =
          typeof itemValue === 'string' &&
          typeof value === 'string' &&
          new RegExp(value, 'i').test(itemValue);
        break;
      case 'nlike':
        result =
          typeof itemValue === 'string' &&
          typeof value === 'string' &&
          !new RegExp(value, 'i').test(itemValue);
        break;
      case 'null':
        result = itemValue === null || itemValue === undefined;
        break;
      case 'nnull':
        result = itemValue !== null && itemValue !== undefined;
        break;
      case 'between':
        result =
          Array.isArray(value) &&
          value.length === 2 &&
          this.compareValues(itemValue, value[0], (a, b) => a >= b) &&
          this.compareValues(itemValue, value[1], (a, b) => a <= b);
        break;
      case 'containss':
        result =
          typeof itemValue === 'string' &&
          typeof value === 'string' &&
          itemValue.includes(value);
        break;
      case 'ncontainss':
        result =
          typeof itemValue === 'string' &&
          typeof value === 'string' &&
          !itemValue.includes(value);
        break;
      default:
        result = false;
    }
    return result;
  }

  private compareValues(
    a: any,
    b: any,
    compareFn: (a: any, b: any) => boolean
  ): boolean {
    if (this.isValidDate(a) && this.isValidDate(b)) {
      return compareFn(new Date(a).getTime(), new Date(b).getTime());
    }
    return compareFn(a, b);
  }

  private isValidDate(value: any): boolean {
    return !isNaN(Date.parse(value));
  }

  public applySort(data: Item[], sort: SortCondition[]): Item[] {
    const sortFields = sort.map(({ field, order }) =>
      order === 'desc' ? `-${field}` : field
    );
    return sortOn(data, sortFields);
  }

  public applyPagination(
    data: Item[],
    options: PaginationOptions
  ): { data: Item[]; pagination: Pagination } {
    const total = data.length;
    const pageSize = options.pageSize || 10;
    const totalPages = Math.ceil(total / pageSize);
    const current = Math.min(options.current || 1, totalPages);
    const start = (current - 1) * pageSize;
    const end = start + pageSize;
    const paginatedData = data.slice(start, end);

    const pagination: Pagination = {
      page: current,
      pages: totalPages,
      limit: pageSize,
      total,
      first: 1,
      prev: current > 1 ? current - 1 : null,
      next: current < totalPages ? current + 1 : null,
      last: totalPages,
    };

    return { data: paginatedData, pagination };
  }

  public searchItems(data: Item[], query: string): Item[] {
    const lowercaseQuery = query.toLowerCase();
    return data.filter(item => this.itemContainsQuery(item, lowercaseQuery));
  }

  private itemContainsQuery(item: Item, lowercaseQuery: string): boolean {
    for (const [key, value] of Object.entries(item)) {
      // if (['id', 'created_at', 'updated_at', 'deleted_at'].includes(key)) {
      //   continue;
      // }

      if (
        typeof value === 'string' &&
        value.toLowerCase().includes(lowercaseQuery)
      ) {
        return true;
      } else if (
        (typeof value === 'number' || typeof value === 'boolean') &&
        value.toString().toLowerCase().includes(lowercaseQuery)
      ) {
        return true;
      }
    }
    return false;
  }

  public expandRelatedEntities(
    entityName: string,
    data: Item[],
    embed: string[],
    expand: string[],
    allData: Data
  ): Item[] {
    return this.relationsManager.expandRelatedEntities(
      entityName,
      data,
      embed,
      expand,
      allData
    );
  }
}
