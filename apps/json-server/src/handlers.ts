import type { Response } from '@tinyhttp/app';
import { Resend } from 'resend';

import { HTTP_STATUS } from './enums.js';
import { Env } from './env.js';
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from './errors.js';
import type { JsonDataManager } from './json-data-manager.js';
import { EntityNotFound } from './model-errors.js';
import type {
  AuthenticatedRequest as Request,
  SingleFilter,
  User,
} from './types.js';
import {
  comparePassword,
  createToken,
  generateResponse,
  hashPassword,
  isTokenExpired,
  transformCase,
  verifyToken,
} from './utils.js';

const resendInstance = new Resend(process.env.RESEND_TOKEN);
const env = Env.getInstance();

// In handlers.ts
export const listEntities =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    const { entity } = req.params;
    const {
      pagination,
      sorters: sort,
      filters: filter,
      embed,
      expand,
    } = req['queryOptions'];
    const queryQ = req.query.q as string;

    try {
      // If 'q' is in query params, incorporate it into the filter
      let combinedFilter = filter;
      if (queryQ && typeof queryQ === 'string') {
        const qFilter: SingleFilter = {
          field: 'q',
          operator: 'contains',
          value: queryQ,
        };
        combinedFilter = combinedFilter
          ? { operator: 'or', value: [combinedFilter, qFilter] }
          : qFilter;
      }

      const result = await dataManager.list(entity, {
        pagination,
        sort,
        filter: combinedFilter,
        embed,
        expand,
        includeDeleted: req['queryOptions'].includeDeleted,
      });

      res.status(HTTP_STATUS.OK).json(
        generateResponse(req, {
          data: result.data,
          meta: { pagination: result.pagination },
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        throw new NotFoundError(error.message);
      }
      throw new InternalServerError('An unexpected error occurred');
    }
  };

export const createEntity =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    const { entity } = req.params;
    const user = req.user as User;

    try {
      const newItem = await dataManager.create(entity, req.body, user);
      res
        .status(HTTP_STATUS.CREATED)
        .json(generateResponse(req, { data: newItem }));
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestError(error.message);
      }
      throw new InternalServerError('An unexpected error occurred');
    }
  };

export const readEntity =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    const { entity, id } = req.params;

    try {
      const item = await dataManager.read(entity, id);
      res.status(HTTP_STATUS.OK).json(generateResponse(req, { data: item }));
    } catch (error) {
      if (error instanceof Error) {
        throw new NotFoundError(error.message);
      }
      throw new InternalServerError('An unexpected error occurred');
    }
  };

export const updateEntity =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    const { entity, id } = req.params;
    const user = req.user as User;

    try {
      const updatedItem = await dataManager.update(entity, id, req.body, user);
      res
        .status(HTTP_STATUS.OK)
        .json(generateResponse(req, { data: updatedItem }));
    } catch (error) {
      if (error instanceof Error) {
        throw new NotFoundError(error.message);
      }
      throw new InternalServerError('An unexpected error occurred');
    }
  };

export const deleteEntity =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    const { entity, id } = req.params;
    const user = req.user as User;

    try {
      await dataManager.delete(entity, id, user);
      res.status(HTTP_STATUS.OK).json(generateResponse(req, { data: null }));
    } catch (error) {
      if (error instanceof Error) {
        throw new NotFoundError(error.message);
      }
      throw new InternalServerError('An unexpected error occurred');
    }
  };

// Count of entity
export const countOfEntity =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    const { entity } = req.params;
    const { pagination, sort, filter, embed, expand } = req['queryOptions'];

    const { q } = req.query;

    try {
      let result;
      if (q && typeof q === 'string') {
        // If there's a search query, use the search method
        result = await dataManager.search(q, {
          pagination,
          sort,
          filter,
          entity,
        });
      } else {
        // Otherwise, use the regular list method
        result = await dataManager.list(entity, {
          pagination,
          sort,
          filter,
          embed,
          expand,
        });
      }
      const count = (q ? result.data[entity] || [] : result.data).length;
      res.status(HTTP_STATUS.OK).json(
        generateResponse(req, {
          data: { count },
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        throw new NotFoundError(error.message);
      }
      throw new InternalServerError('An unexpected error occurred');
    }
  };

// Global Search
export const globalSearch =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    const { q } = req.query;
    const { pagination, sort, filter, entity } = req['queryOptions'];

    if (!q || typeof q !== 'string') {
      return res.status(HTTP_STATUS.OK).json(
        generateResponse(req, {
          data: [],
          meta: {
            pagination: {
              total: 0,
              page: 1,
              limit: 10,
              pages: 0,
              first: 0,
              prev: 0,
              next: 0,
              last: 0,
            },
          },
        })
      );
    }

    try {
      const results = await dataManager.search(q, {
        pagination,
        sort,
        filter,
        entity,
      });

      res.status(HTTP_STATUS.OK).json(
        generateResponse(req, {
          data: results.data,
          meta: { pagination: results.pagination },
        })
      );
    } catch (error) {
      console.error('Error in global search:', error);
      throw new InternalServerError('An error occurred during the search');
    }
  };

// Authentication
export const registerUser =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    const { username, password, email, tenant_id } = req.body;

    const hashedPassword = await hashPassword(password);
    const newUser = await dataManager.create(
      'users',
      {
        username,
        password: hashedPassword,
        email,
        tenant_id: tenant_id || dataManager.getDefaultTenant().id,
        is_active: true,
      },
      dataManager.getSystemUser()
    );

    const { password: _, ...userWithoutPassword } = newUser;

    // add activity
    await dataManager.addActivity(
      {
        type: 'login',
        title: 'User logged in',
        description: `User ${newUser.username} logged in`,
        related_entity_type: 'users',
        related_entity_id: newUser.id,
      },
      newUser as User
    );

    res
      .status(HTTP_STATUS.CREATED)
      .json(generateResponse(req, { data: userWithoutPassword }));
  };

type LoginRequestBody = {
  username: string;
  password: string;
  tenantId?: string;
  email?: string;
  rememberMe?: boolean;
};

export const loginUser =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    // Extract credentials as well as the rememberMe flag from the request body
    const { email, username, password, rememberMe } =
      transformCase<LoginRequestBody>(req.body);

    let user: User;
    try {
      user = dataManager.getByField(
        'users',
        email ? 'email' : 'username',
        email ? email : username
      ) as User;
    } catch (error) {
      throw new UnauthorizedError('Invalid credentials');
    }

    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Always generate a short-lived access token (e.g., 1 hour)
    const accessToken = createToken(
      { userId: user.id, tenantId: user.tenant_id },
      '1h'
    );

    // For the refresh token, use a longer expiration if rememberMe is true;
    // otherwise, use a shorter duration (or omit the refresh token altogether).
    const refreshTokenExpiry = rememberMe ? '7d' : '1d';
    const refreshToken = createToken(
      { userId: user.id, tenantId: user.tenant_id },
      refreshTokenExpiry
    );

    const { password: _, ...userWithoutPassword } = user;

    // Log the activity (if desired)
    await dataManager.addActivity(
      {
        type: 'login',
        title: 'User logged in',
        description: `User ${user.username} logged in`,
        related_entity_type: 'users',
        related_entity_id: user.id,
      },
      user
    );

    res.status(HTTP_STATUS.OK).json(
      generateResponse(req, {
        data: {
          user: userWithoutPassword,
          access_token: accessToken,
          refresh_token: refreshToken,
          // Optionally, also return the rememberMe flag so the client knows how to store the token
          remember_me: Boolean(rememberMe),
        },
      })
    );
  };

export const logoutUser = (req: Request, res: Response) => {
  // Implement token invalidation logic here if needed
  res
    .status(HTTP_STATUS.OK)
    .json(
      generateResponse(req, { data: { message: 'Logged out successfully' } })
    );
};

export const verifyUserToken =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    const { token } = req.body;

    try {
      const { user, decoded } = await verifyToken(token, dataManager);
      res
        .status(HTTP_STATUS.OK)
        .json(generateResponse(req, { data: { decoded } }));
    } catch (error) {
      throw new UnauthorizedError('Invalid token');
    }
  };

export type TokenPayload = {
  userId: string;
  tenantId: string;
  iat: number;
  exp: number;
};

export const refreshToken =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    const { refresh_token } = req.body;
    const { decoded, user } = await verifyToken(refresh_token, dataManager);

    const accessToken = createToken(
      { userId: user.id, tenantId: user.tenant_id },
      '1h'
    );
    const refreshToken = createToken(
      { userId: user.id, tenantId: user.tenant_id },
      '7d'
    );

    res.status(HTTP_STATUS.OK).json(
      generateResponse(req, {
        data: {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
      })
    );
  };

export const sendPasswordResetLink =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    // Expect the username (or email) in the request body.
    const { username } = req.body;
    try {
      let user = dataManager.getByField('users', 'username', username) as User;
      if (!user) {
        user = dataManager.getByField('users', 'email', username) as User;
      }
      if (!user) {
        return res.status(HTTP_STATUS.NOT_FOUND).json(
          generateResponse(req, {
            errors: [{ code: 'USER_NOT_FOUND', message: 'User not found' }],
          })
        );
      }

      // Generate a reset token valid for 1 hour.
      const resetToken = createToken({ userId: user.id }, '1h');

      // Get required environment variables.
      const clientResetUrl = env.get('CLIENT_PASSWORD_RESET_URL');
      const resetEmailFrom = env.get('RESET_EMAIL_FROM');

      // Construct the reset link.
      const resetLink = `${clientResetUrl}?token=${resetToken}`;

      // Send the reset email using Resend.
      const emailResult = await resendInstance.emails.send({
        from: resetEmailFrom,
        to: user.email,
        subject: 'Password Reset Request',
        html: `<p>Hello ${user.username},</p>
               <p>You requested to reset your password. Please click the link below to proceed:</p>
               <p><a href="${resetLink}">Reset Your Password</a></p>
               <p>This link will expire in 1 hour.</p>
               <p>If you did not request a password reset, please ignore this email.</p>`,
      });

      if (emailResult.error) {
        console.error('Resend error:', emailResult.error);
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json(
          generateResponse(req, {
            errors: [
              {
                code: 'MAIL_SENT_FAILED',
                message: 'Failed to send reset email',
              },
            ],
          })
        );
      }

      console.log('Reset email sent:', emailResult.data);

      // Store the token in a dedicated collection for password resets.
      await dataManager.create(
        'password-reset-tokens',
        { token: resetToken, userId: user.id },
        undefined,
        false
      );

      return res.status(HTTP_STATUS.OK).json(
        generateResponse(req, {
          data: { message: 'Email sent' },
        })
      );
    } catch (error) {
      throw new BadRequestError(error?.message);
    }
  };

export const resetPassword =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    // Expect token and new password in the request body.
    const { token, password: newPassword } = req.body;

    try {
      // Look up the token in our password-reset-tokens collection.
      const storedToken = dataManager.getByField(
        'password-reset-tokens',
        'token',
        token
      );

      if (!storedToken) {
        return res.status(HTTP_STATUS.NOT_FOUND).json(
          generateResponse(req, {
            errors: [
              { code: 'INVALID_TOKEN', message: 'Reset token not found' },
            ],
          })
        );
      }

      // Check if token has expired.
      if (isTokenExpired(token)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
          generateResponse(req, {
            errors: [
              { code: 'TOKEN_EXPIRED', message: 'Reset token has expired' },
            ],
          })
        );
      }

      // Verify token to extract associated user.
      const { user } = await verifyToken(token, dataManager);
      if (!user) {
        return res.status(HTTP_STATUS.NOT_FOUND).json(
          generateResponse(req, {
            errors: [{ code: 'USER_NOT_FOUND', message: 'User not found' }],
          })
        );
      }

      // Hash the new password.
      // const hashedPassword = await hashPassword(newPassword);

      // Update the user's password.
      const updatedUser = await dataManager.update(
        'users',
        user.id,
        { password: newPassword },
        dataManager.getSystemUser()
      );

      // Delete the used reset token (assuming dataManager.create returns an object with an id, adjust accordingly).
      // You might need a specific delete function; here we assume a delete by field:
      await dataManager.delete('password-reset-tokens', storedToken.id);

      return res.status(HTTP_STATUS.OK).json(
        generateResponse(req, {
          data: {
            message: 'Password updated successfully',
            user: updatedUser,
          },
        })
      );
    } catch (error) {
      throw new BadRequestError(error?.message);
    }
  };

export const changePassword =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    const currentUser = req.user;

    const { oldPassword, newPassword } = transformCase<{
      oldPassword: string;
      newPassword: string;
    }>(req.body);

    try {
      const user = dataManager.getByField(
        'users',
        'username',
        currentUser.username
      ) as User;

      if (!user) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json({ error: 'User not found' });
      }

      const validOldPassword = await comparePassword(
        oldPassword,
        user.password
      );

      if (!validOldPassword) {
        return res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: 'Old password is not valid!' });
      }

      await dataManager.update(
        'users',
        user.id,
        { password: newPassword },
        dataManager.getSystemUser()
      );

      res.status(HTTP_STATUS.NO_CONTENT).json(
        generateResponse(req, {
          data: null,
        })
      );
    } catch (error) {
      throw new BadRequestError(error?.message);
    }
  };

export const clearData =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    try {
      const user = req.user;
      await dataManager.reset(user as User);
      res
        .status(HTTP_STATUS.OK)
        .json(generateResponse(req, { data: { message: 'Data cleared' } }));
    } catch (error) {
      throw new InternalServerError(
        `An unexpected error occurred: ${error.message}`
      );
    }
  };

export const clearDataOfAnEntity =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    try {
      const { entity } = req.params;
      const user = req.user;
      await dataManager.reset(user as User, entity);
      res
        .status(HTTP_STATUS.OK)
        .json(generateResponse(req, { data: { message: 'Data cleared' } }));
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }
      if (error instanceof EntityNotFound) {
        throw new BadRequestError(error.message);
      }
      throw new InternalServerError(
        `An unexpected error occurred: ${error.message}`
      );
    }
  };

export const addNewEntityDefinition =
  (dataManager: JsonDataManager) => async (req: Request, res: Response) => {
    try {
      const { entity } = req.body;

      if (entity === undefined || typeof { entity } === 'string') {
        throw new BadRequestError('Entity definition is required');
      }
      const user = req.user;

      await dataManager.addNewEntityKey(entity, user as User);
      res.status(HTTP_STATUS.OK).json(
        generateResponse(req, {
          data: { message: 'New entity created', entity: entity['entity'] },
        })
      );
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }
      throw new InternalServerError(
        `An unexpected error occurred: ${error.message}`
      );
    }
  };
