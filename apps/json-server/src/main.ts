import path from 'path';

import { App } from '@tinyhttp/app';

import { authorizationMiddleware } from './authorization.js';
import { configs } from './configs.js';
import { HTTP_STATUS } from './enums.js';
import { Env } from './env.js';
import {
  addNewEntityDefinition,
  changePassword,
  clearData,
  clearDataOfAnEntity,
  countOfEntity,
  createEntity,
  deleteEntity,
  globalSearch,
  listEntities,
  loginUser,
  logoutUser,
  readEntity,
  refreshToken,
  registerUser,
  resetPassword,
  sendPasswordResetLink,
  updateEntity,
  verifyUserToken,
} from './handlers.js';
import './instruments.js';
import { JsonDataManager } from './json-data-manager.js';
import { requestLogger } from './logger.js';
import {
  bodyParserMiddleware,
  corsMiddleware,
  errorHandler,
  isAuthenticated,
  notFoundHandler,
  requestMeta,
  securityHeadersMiddleware,
} from './middlewares.js';
import { MultitenancyManager, multitenancyMiddleware } from './multitenancy.js';
import { apiQueryParserMiddleware } from './refine-2.js';
import type { ServerConfig } from './types.js';
import { generateResponse } from './utils.js';

const startServer = async (
  config: ServerConfig,
  dataManager: JsonDataManager
) => {
  const app = new App({
    onError: errorHandler,
    noMatchHandler: notFoundHandler,
  });

  // Basic setup
  app.use(requestMeta);
  app.use(requestLogger({ fileLogging: { filename: 'log/q-mock.log' } }));
  app.use((_req, res, next) => {
    res.setHeader('Accept', 'application/json');
    res.setHeader('Content-Type', 'application/json');
    next();
  });
  app.use(corsMiddleware(config));
  app.use(securityHeadersMiddleware);
  app.use(bodyParserMiddleware);

  // Unauthenticated routes
  app.get('/health', (req, res) => {
    res
      .status(HTTP_STATUS.OK)
      .json(generateResponse(req, { data: { status: 'OK' } }));
  });
  app.post(`${config.apiPrefix}/auth/login`, loginUser(dataManager));
  app.post(`${config.apiPrefix}/auth/token/refresh`, refreshToken(dataManager));
  app.post(
    `${config.apiPrefix}/auth/token/verify`,
    verifyUserToken(dataManager)
  );
  app.get(`${config.apiPrefix}/auth/logout`, logoutUser);
  app.post(`${config.apiPrefix}/auth/logout`, logoutUser);
  app.post(
    `${config.apiPrefix}/auth/password/reset/sent-link`,
    sendPasswordResetLink(dataManager)
  );
  app.post(
    `${config.apiPrefix}/auth/password/reset`,
    resetPassword(dataManager)
  );

  // Authentication middleware
  app.use(isAuthenticated(dataManager, config.enableAuth));

  // Multitenancy and ABAC middleware
  app.use(multitenancyMiddleware());
  app.use(authorizationMiddleware({ dataManager })); // AuthorizationManager initializes lazily

  // Query parser middleware
  app.use(apiQueryParserMiddleware(dataManager));

  // Protected routes
  app.patch(
    `${config.apiPrefix}/auth/password/change`,
    changePassword(dataManager)
  );
  app.post(`${config.apiPrefix}/auth/register`, registerUser(dataManager));
  app.get(`${config.apiPrefix}/search`, globalSearch(dataManager));
  app.post(`${config.apiPrefix}/reset`, clearData(dataManager));
  app.post(
    `${config.apiPrefix}/:entity/reset`,
    clearDataOfAnEntity(dataManager)
  );
  app.post(
    `${config.apiPrefix}/add-entity`,
    addNewEntityDefinition(dataManager)
  );
  app.get(`${config.apiPrefix}/:entity`, listEntities(dataManager));
  app.get(`${config.apiPrefix}/:entity/count`, countOfEntity(dataManager));
  app.post(`${config.apiPrefix}/:entity`, createEntity(dataManager));
  app.get(`${config.apiPrefix}/:entity/:id`, readEntity(dataManager));
  app.put(`${config.apiPrefix}/:entity/:id`, updateEntity(dataManager));
  app.patch(`${config.apiPrefix}/:entity/:id`, updateEntity(dataManager));
  app.delete(`${config.apiPrefix}/:entity/:id`, deleteEntity(dataManager));

  app.listen(config.port, () => {
    console.info(`Server started on ${config.host}:${config.port}`);
  });

  return app;
};

const env = Env.getInstance();
const dbPath = env.get('DB_PATH') ?? path.join(process.cwd(), 'db.json');
const multitenancy = new MultitenancyManager({ superAdminRole: 'super_admin' });

const dataManager = JsonDataManager.getInstance(
  { filePath: dbPath, cacheTTL: 300 },
  multitenancy
);

export const defaultConfig: ServerConfig = {
  apiPrefix: configs.apiPrefix,
  auth: false,
  caseType: 'snake_case',
  enableAuth: env.get('ENABLE_AUTH'),
  prefix: '',
  cors: '',
  log: '',
  jsonFilePath: '',
  port: env.get('PORT'),
  host: env.get('HOST'),
  corsOrigin: env.get('ALLOWED_ORIGINS'),
  logLevel: '',
  maxExpansionDepth: 0,
  defaultPageSize: 10,
};

if (
  import.meta.url ===
  'file://' + (process.env.NX_FILE_TO_RUN ?? process.argv[1])
) {
  startServer(defaultConfig, dataManager).catch(err => {
    console.error('Server failed to start:', err);
    process.exit(1);
  });
} else {
  console.log('Server is not running...');
}

export { dataManager };
export default startServer;
