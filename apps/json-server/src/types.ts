import type { Request } from '@tinyhttp/app';

export type UUID = string;
export type ISODateTime = string;

export type ResponseError = {
  code: string;
  message: string;
  field?: string;
  details?: string;
};

export type PaginationOptions = {
  current: number;
  pageSize: number;
  start?: number;
  end?: number;
};

export type Pagination = {
  page: number;
  pages: number;
  limit: number;
  total: number;
  first: number;
  prev: number | null;
  next: number | null;
  last: number;
};

export type ResponseMeta = {
  timestamp: ISODateTime;
  request_id: UUID;
  pagination?: Pagination;
};

export type APIResponse<TData = unknown> = {
  data?: TData;
  meta: ResponseMeta;
  errors?: ResponseError[];
};

export type AuditInfo = {
  tenant_id: UUID;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  deleted_at?: ISODateTime | null;

  // User IDs
  created_by_id: UUID;
  updated_by_id: UUID;
  deleted_by_id?: UUID | null;
};

export type Tenant = {
  id: UUID;
  name: string;
  domain: string;
  uuid: UUID;
} & Omit<AuditInfo, 'tenant_id'>;

export type Role = {
  id: UUID;
  name: string;
  description: string;
} & AuditInfo;

export type Permission = {
  id: UUID;
  name: string;
  description: string;
} & AuditInfo;

export type UserRole = {
  id: UUID;
  user_id: UUID;
  role_id: UUID;
} & AuditInfo;

export type UserPermission = {
  id: UUID;
  user_id: UUID;
  permission_id: UUID;
} & AuditInfo;

export type User = {
  id: UUID;
  username: string;
  password: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_active: boolean;
  last_login?: ISODateTime;
  tenant_id: UUID;
} & AuditInfo;

export type ActivityType =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'register'
  | 'other'
  | 'error'
  | 'reset';

export type ActivityLog = {
  id: UUID;
  type: ActivityType;
  title: string;
  description: string;
  performed_by_id: UUID;
  related_entity_type: string;
  related_entity_id: UUID;
  tenant_id: UUID;
  is_deleted: boolean;
  deleted_at: ISODateTime | null;
} & AuditInfo;

export type UserWithRelations = {
  roles?: Role[];
  permissions?: Permission[];
} & User;

export type RoleWithPermissions = {
  permissions: Permission[];
} & Role;

export type PermissionWithRoles = {
  roles: Role[];
} & Permission;

export type EntityType =
  | 'user'
  | 'role'
  | 'permission'
  | 'user_role'
  | 'user_permission';

export type EntityMetadata = {
  entityName: EntityType;
  displayName: string;
  fields: {
    [key: string]: {
      type: string;
      required: boolean;
      editable: boolean;
      searchable: boolean;
    };
  };
};

export type AuthTokens = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
};

export type LoginResponse = {
  user: UserWithRelations;
  tokens: AuthTokens;
};

export type RefreshTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export type AuthenticatedRequest = {
  user: Omit<User, 'password'>;
} & Request;

export type Item = {
  id: UUID;
  [key: string]: any;
} & Partial<AuditInfo>;

export type Data = {
  [entityName: string]: Item[];
};

export type FilterOperator =
  | 'between'
  | 'contains'
  | 'containss'
  | 'endswith'
  | 'eq'
  | 'gt'
  | 'gte'
  | 'in'
  | 'like'
  | 'lt'
  | 'lte'
  | 'ncontains'
  | 'ncontainss'
  | 'ne'
  | 'nin'
  | 'nlike'
  | 'nnull'
  | 'null'
  | 'startswith';

export type SingleFilter = {
  field: string;
  operator: FilterOperator;
  value: any;
};

export type LogicalFilter = {
  operator?: 'and' | 'or';
  value: (SingleFilter | LogicalFilter)[];
};

export type FilterCondition = {
  field: string;
  operator: FilterOperator;
  value: any;
};

export type FilterGroup = {
  logic: 'and' | 'or';
  filters: (FilterCondition | FilterGroup)[];
};

export type SortCondition = {
  field: string;
  order: 'asc' | 'desc';
};

export type CaseType = 'camelCase' | 'snake_case';

export type ServerConfig = {
  prefix: string;
  auth: boolean;
  cors: string;
  log: string;
  jsonFilePath: string;
  apiPrefix: string;
  enableAuth: boolean;
  caseType: CaseType;
  port: number;
  host: string;
  corsOrigin: string;
  logLevel: string;
  maxExpansionDepth: number;
  defaultPageSize: number;
};

export type CrudFilters = {};

export type CrudSorting = {};
