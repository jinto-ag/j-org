import { HTTP_STATUS, HTTP_STATUS_CODE } from './enums.js';

export class HttpError extends Error {
  status: HTTP_STATUS;
  code: string;

  constructor(message: string, status: HTTP_STATUS, code: HTTP_STATUS_CODE) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }

  getStackTrace(): string {
    return this.stack ?? '';
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request') {
    super(message, HTTP_STATUS.BAD_REQUEST, HTTP_STATUS_CODE.BAD_REQUEST);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'The resource you are looking for is not found.') {
    super(message, HTTP_STATUS.NOT_FOUND, HTTP_STATUS_CODE.NOT_FOUND);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized access') {
    super(message, HTTP_STATUS.UNAUTHORIZED, HTTP_STATUS_CODE.UNAUTHORIZED);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Access forbidden') {
    super(message, HTTP_STATUS.FORBIDDEN, HTTP_STATUS_CODE.FORBIDDEN);
  }
}

export class InternalServerError extends HttpError {
  constructor(message = 'Internal server error') {
    super(
      message,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR
    );
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict occurred') {
    super(message, HTTP_STATUS.CONFLICT, HTTP_STATUS_CODE.CONFLICT);
  }
}

export class UnprocessableEntityError extends HttpError {
  constructor(message = 'Unprocessable entity') {
    super(
      message,
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
      HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY
    );
  }
}

export class TooManyRequestsError extends HttpError {
  constructor(message = 'Too many requests') {
    super(
      message,
      HTTP_STATUS.TOO_MANY_REQUESTS,
      HTTP_STATUS_CODE.TOO_MANY_REQUESTS
    );
  }
}

export class NotImplementedError extends HttpError {
  constructor(message = 'Not implemented') {
    super(
      message,
      HTTP_STATUS.NOT_IMPLEMENTED,
      HTTP_STATUS_CODE.NOT_IMPLEMENTED
    );
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message = 'Service unavailable') {
    super(
      message,
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      HTTP_STATUS_CODE.SERVICE_UNAVAILABLE
    );
  }
}
