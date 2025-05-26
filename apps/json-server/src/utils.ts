import type { Request } from '@tinyhttp/app';
import bcrypt from 'bcryptjs';
import { camelCase } from 'change-case';
import { getProperty } from 'dot-prop';
import inflection from 'inflection';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

import { configs } from './configs.js';
import { UnauthorizedError } from './errors.js';
import type JsonDataManager from './json-data-manager.js';
import type {
  APIResponse,
  CrudFilters,
  CrudSorting,
  FilterGroup,
  FilterOperator,
  Pagination,
  ResponseMeta,
  SortCondition,
  User,
} from './types.js';

export type GenerateResponseArgs<TData = unknown> = {
  meta?: Partial<ResponseMeta>;
} & Omit<APIResponse<TData>, 'meta'>;

export const generateId = (): string => uuidv4();

export const pluralize = (word: string): string => inflection.pluralize(word);

export const singularize = (word: string): string =>
  inflection.singularize(word);

export const getNestedProperty = (obj: any, path: string): any =>
  getProperty(obj, path);

export const generateResponse = <TData = unknown>(
  req: Request,
  { data = null, meta, errors = null }: GenerateResponseArgs<TData>
): APIResponse<TData> => {
  return {
    data,
    meta: {
      request_id: req['request_id'],
      timestamp: req['timestamp'],
      ...meta,
    },
    errors,
  };
};

export const createToken = (
  payload: object,
  expiresIn: string | number = '1h'
): string => {
  return jwt.sign(payload, configs.jwtSecretKey, {
    expiresIn: expiresIn as any,
  });
};

export const verifyToken = async (
  token: string,
  dataManager: JsonDataManager
): Promise<{ user: User; decoded: string | jwt.JwtPayload }> => {
  try {
    const result = jwt.verify(token, configs.jwtSecretKey);
    const user = (await dataManager.read('users', result['userId'])) as User;
    return { user, decoded: result };
  } catch (error) {
    throw new UnauthorizedError('Invalid token');
  }
};

export function isTokenExpired(token: string): boolean {
  // Decode the token without verifying its signature.
  const decoded = jwt.decode(token) as jwt.JwtPayload | null;
  if (!decoded?.exp) {
    throw new Error('Invalid token: missing expiration field');
  }
  // Convert the exp value (in seconds) to milliseconds.
  const expiryTime = decoded.exp * 1000;
  // Compare with the current time.
  return Date.now() > expiryTime;
}

export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(configs.saltRounds);
  return bcrypt.hash(password, salt);
};

export const comparePassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

export const generateSort = (sorters?: CrudSorting): SortCondition[] => {
  if (sorters && sorters.length > 0) {
    return sorters.map(({ field, order }) => ({ field, order }));
  }
  return [];
};

export const generateFilter = (filters?: CrudFilters): FilterGroup => {
  const filterGroup: FilterGroup = {
    logic: 'and',
    filters: [],
  };

  if (filters) {
    filters.forEach(filter => {
      if (filter.operator === 'or' || filter.operator === 'and') {
        filterGroup.filters.push(generateFilter(filter.value));
      } else if ('field' in filter) {
        const { field, operator, value } = filter;

        let parsedField = field;
        let parsedOperator = mapOperator(operator);
        const parsedValue = parseValue(value);

        // Handle special cases for field names
        if (field.endsWith('_like')) {
          parsedField = field.replace('_like', '');
          parsedOperator = 'like';
        } else if (field.endsWith('_gte')) {
          parsedField = field.replace('_gte', '');
          parsedOperator = 'gte';
        } else if (field.endsWith('_lte')) {
          parsedField = field.replace('_lte', '');
          parsedOperator = 'lte';
        }

        filterGroup.filters.push({
          field: parsedField,
          operator: parsedOperator,
          value: parsedValue,
        });
      }
    });
  }

  return filterGroup;
};

const parseValue = (value: any): any => {
  if (value === 'true' || value === 'false') {
    return value === 'true';
  }
  if (!isNaN(Number(value))) {
    return Number(value);
  }
  if (!isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return value;
};

const mapOperator = (operator: string): FilterOperator => {
  switch (operator) {
    case 'eq':
      return 'eq';
    case 'ne':
      return 'ne';
    case 'lt':
      return 'lt';
    case 'gt':
      return 'gt';
    case 'lte':
      return 'lte';
    case 'gte':
      return 'gte';
    case 'in':
      return 'in';
    case 'nin':
      return 'nin';
    case 'contains':
    case 'like':
      return 'like';
    case 'ncontains':
    case 'nlike':
      return 'nlike';
    default:
      return 'eq';
  }
};

export const createPagination = (
  total: number,
  page: number,
  pageSize: number
): Pagination => {
  const totalPages = Math.ceil(total / pageSize);
  return {
    page,
    pages: totalPages,
    limit: pageSize,
    total,
    first: 1,
    prev: page > 1 ? page - 1 : null,
    next: page < totalPages ? page + 1 : null,
    last: totalPages,
  };
};

export function transformCase<T>(obj: any): T {
  const updatedObj = {};
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const updatedKey = camelCase(key);
        updatedObj[updatedKey] = transformCase(obj[key]);
      }
    }
  } else if (Array.isArray(obj)) {
    return obj.map(item => transformCase(item)) as T;
  } else {
    return obj;
  }

  return updatedObj as T;
}
