import type { NextFunction, Request, Response } from '@tinyhttp/app';

import type JsonDataManager from './json-data-manager.js';
import type {
  FilterOperator,
  LogicalFilter,
  PaginationOptions,
  SingleFilter,
  User,
} from './types.js';
import { generateResponse } from './utils.js';

export type Sort = {
  field: string;
  order: 'asc' | 'desc';
};

export type QueryOptions = {
  pagination?: PaginationOptions;
  filters?: (SingleFilter | LogicalFilter)[];
  sorters?: Sort[];
  search?: string;
  embed?: string[];
  expand?: string[];
  fields?: string[];
  user?: User;
  includeDeleted?: boolean;
};

// Validation Error Interface
type ValidationError = {
  code: string;
  message: string;
  details?: string;
};

// Supported filter operators
const SUPPORTED_OPERATORS: FilterOperator[] = [
  'eq',
  'ne',
  'lt',
  'gt',
  'lte',
  'gte',
  'in',
  'nin',
  'contains',
  'ncontains',
  'containss',
  'ncontainss',
  'startswith',
  'endswith',
  'null',
  'nnull',
  'between',
];

// Utility function to safely parse JSON with error handling
const safeParseJSON = (input: string): { parsed: any; error: Error | null } => {
  try {
    // First, try standard JSON parse
    return { parsed: JSON.parse(input), error: null };
  } catch (jsonError) {
    try {
      // If standard parse fails, try URL decoding
      return { parsed: JSON.parse(decodeURIComponent(input)), error: null };
    } catch (decodeError) {
      return {
        parsed: null,
        error: new Error(
          'Invalid JSON format. Unable to parse filters/sort parameter.'
        ),
      };
    }
  }
};

export const validateFilters = (
  filters: any[]
): { valid: boolean; errors: ValidationError[] } => {
  const errors: ValidationError[] = [];

  // Utility function to validate a single filter
  const validateSingleFilter = (filter: any, path: string): boolean => {
    if (!filter.field) {
      errors.push({
        code: 'MISSING_FILTER_FIELD',
        message: 'Filter must have a field.',
        details: `At path: ${path}`,
      });
      return false;
    }
    if (!filter.operator || !SUPPORTED_OPERATORS.includes(filter.operator)) {
      errors.push({
        code: 'INVALID_FILTER_OPERATOR',
        message: 'Filter must have a valid operator.',
        details: `At path: ${path}. Supported operators: ${SUPPORTED_OPERATORS.join(', ')}`,
      });
      return false;
    }
    // Specific validations
    switch (filter.operator) {
      case 'between':
        if (!Array.isArray(filter.value) || filter.value.length !== 2) {
          errors.push({
            code: 'INVALID_BETWEEN_FILTER',
            message:
              'Between operator requires an array with exactly two values.',
            details: `At path: ${path}`,
          });
          return false;
        }
        break;
      case 'in':
      case 'nin':
        if (!Array.isArray(filter.value)) {
          errors.push({
            code: 'INVALID_ARRAY_FILTER',
            message: 'In/Nin operators require an array value.',
            details: `At path: ${path}`,
          });
          return false;
        }
        break;
      case 'null':
      case 'nnull':
        if (filter.value !== undefined) {
          errors.push({
            code: 'INVALID_NULL_FILTER',
            message: 'Null/Nnull operators should not have a value.',
            details: `At path: ${path}`,
          });
          return false;
        }
        break;
      case 'contains':
      case 'ncontains':
      case 'containss':
      case 'ncontainss':
      case 'startswith':
      case 'endswith':
      case 'like':
      case 'nlike':
        if (typeof filter.value !== 'string') {
          errors.push({
            code: 'INVALID_STRING_FILTER',
            message: `${filter.operator} operator requires a string value.`,
            details: `At path: ${path}`,
          });
          return false;
        }
        break;
    }
    return true;
  };

  const validateFilter = (filter: any, path = ''): boolean => {
    if (!filter || typeof filter !== 'object') {
      errors.push({
        code: 'INVALID_FILTER_STRUCTURE',
        message: 'Filter must be an object.',
        details: `At path: ${path}`,
      });
      return false;
    }

    if ('field' in filter) {
      // Single filter
      return validateSingleFilter(filter, path);
    } else if (
      'operator' in filter &&
      ['and', 'or'].includes(filter.operator)
    ) {
      // Logical filter
      if ('field' in filter) {
        errors.push({
          code: 'INVALID_LOGICAL_FILTER',
          message: 'Logical filters must not have a "field" property.',
          details: `At path: ${path}`,
        });
        return false;
      }
      if (!Array.isArray(filter.value)) {
        errors.push({
          code: 'INVALID_LOGICAL_VALUE',
          message: 'Logical filters must have a "value" array.',
          details: `At path: ${path}`,
        });
        return false;
      }
      return filter.value.every((subFilter: any, i: number) =>
        validateFilter(subFilter, `${path}[${i}]`)
      );
    }

    errors.push({
      code: 'INVALID_FILTER_TYPE',
      message: 'Filter must be a single filter or logical filter.',
      details: `At path: ${path}`,
    });
    return false;
  };

  const valid = filters.every((filter, i) => validateFilter(filter, `[${i}]`));
  return { valid, errors };
};

export const apiQueryParserMiddleware =
  (dataManager: JsonDataManager) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const queryOptions: QueryOptions = {};

    try {
      // Pagination parsing (unchanged)
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize
        ? parseInt(req.query.pageSize as string, 10)
        : dataManager['config']?.defaultPageSize || 10;
      const queryStart = req.query.start
        ? parseInt(req.query.start as string, 10)
        : null;
      const queryEnd = req.query.end
        ? parseInt(req.query.end as string, 10)
        : null;

      let start: number;
      let end: number;
      if (
        queryStart !== null &&
        queryEnd !== null &&
        queryStart >= 0 &&
        queryEnd > queryStart
      ) {
        start = queryStart;
        end = queryEnd;
      } else {
        const validPage = Math.max(1, page);
        const validPageSize = Math.max(1, pageSize);
        start = (validPage - 1) * validPageSize;
        end = start + validPageSize;
      }
      queryOptions.pagination = {
        current: Math.floor(start / pageSize) + 1,
        pageSize,
        start,
        end,
      };

      if (req.query.include_deleted === 'true') {
        queryOptions.includeDeleted = true;
      }

      // Filters parsing
      if (req.query.filters) {
        const { parsed: parsedFilters, error } = safeParseJSON(
          req.query.filters as string
        );
        if (error || !Array.isArray(parsedFilters)) {
          return res.status(400).json(
            generateResponse(req, {
              errors: [
                {
                  code: 'INVALID_FILTER_FORMAT',
                  message: 'Filters must be a JSON array.',
                  details: error?.message || 'Expected an array.',
                },
              ],
            })
          );
        }

        const { valid, errors } = validateFilters(parsedFilters);
        if (!valid) {
          return res.status(400).json(generateResponse(req, { errors }));
        }
        queryOptions.filters = parsedFilters;
      }

      // Sort parsing (support multiple)
      if (req.query.sorters) {
        const { parsed: parsedSort, error } = safeParseJSON(
          req.query.sorters as string
        );
        if (error || !Array.isArray(parsedSort)) {
          return res.status(400).json(
            generateResponse(req, {
              errors: [
                {
                  code: 'INVALID_SORT_FORMAT',
                  message: 'Sorters must be a JSON array.',
                  details: error?.message || 'Expected an array.',
                },
              ],
            })
          );
        }
        queryOptions.sorters = parsedSort.map((s: any) => ({
          field: s.field,
          order: s.order === 'desc' ? 'desc' : 'asc',
        }));
      }

      // Add 'q' from query param if present
      if (req.query.q && typeof req.query.q === 'string') {
        queryOptions.filters = queryOptions.filters || [];
        queryOptions.filters.push({
          field: 'q',
          operator: 'contains',
          value: req.query.q,
        });
      }

      // Other options (unchanged)
      if (req.query.embed)
        queryOptions.embed = (req.query.embed as string).split(',');
      if (req.query.expand)
        queryOptions.expand = (req.query.expand as string).split(',');
      if (req.query.fields)
        queryOptions.fields = (req.query.fields as string).split(',');

      req['queryOptions'] = queryOptions;
      next();
    } catch (error) {
      return res.status(500).json(
        generateResponse(req, {
          errors: [
            {
              code: 'QUERY_PARSING_ERROR',
              message: 'Error parsing query parameters.',
              details: (error as Error).message,
            },
          ],
        })
      );
    }
  };

export default apiQueryParserMiddleware;
