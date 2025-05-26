export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class DoesNotExist extends ModelError {
  constructor(entity: string, field = 'id', value: any) {
    super(`${entity} with ${field} ${value} does not exist`);
  }
}

export class InvalidFieldName extends ModelError {
  constructor(fieldName: string) {
    super(`Invalid field name: ${fieldName}`);
  }
}

export class InvalidOperator extends ModelError {
  constructor(operator: string) {
    super(`Invalid operator: ${operator}`);
  }
}

export class InvalidDataType extends ModelError {
  constructor(field: string, expectedType: string) {
    super(`Invalid data type for field ${field}. Expected ${expectedType}`);
  }
}

export class EntityNotFound extends ModelError {
  constructor(entityName: string) {
    super(`Entity ${entityName} not found`);
  }
}
