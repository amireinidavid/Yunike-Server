/**
 * Base custom error class
 */
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * For 400 Bad Request errors (client-side error, invalid request)
 */
export class BadRequestError extends AppError {
  constructor(message = 'Bad Request') {
    super(message, 400);
  }
}

/**
 * For 401 Unauthorized errors (authentication failure)
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
  }
}

/**
 * For 403 Forbidden errors (authorization failure)
 */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403);
  }
}

/**
 * For 404 Not Found errors (resource not found)
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

/**
 * For 409 Conflict errors (resource conflict)
 */
export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
  }
}

/**
 * For 422 Unprocessable Entity errors (validation failure)
 */
export class ValidationError extends AppError {
  errors: any;

  constructor(message = 'Validation failed', errors?: any) {
    super(message, 422);
    this.errors = errors;
  }
}

/**
 * For 429 Too Many Requests errors (rate limiting)
 */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later') {
    super(message, 429);
  }
}

/**
 * For 500 Internal Server errors (server-side error)
 */
export class InternalServerError extends AppError {
  constructor(message = 'Internal server error', isOperational: boolean = false) {
    super(message, 500);
    this.isOperational = isOperational;
  }
}

/**
 * For 503 Service Unavailable errors (service temporarily unavailable)
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service Unavailable') {
    super(message, 503);
  }
}

/**
 * API Error class for consistent error response format
 */
export class ApiError extends Error {
  statusCode: number;
  errors: any;
  
  constructor(statusCode: number, message: string, errors = {}) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    
    // Ensures instanceof works correctly
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * Error handler function for converting Prisma errors to API errors
 * @param error Any error caught in the application
 * @returns AppError
 */
export const handlePrismaError = (error: any): AppError => {
  // Check if it's a Prisma error
  if (error.code) {
    switch (error.code) {
      // Unique constraint violation
      case 'P2002':
        return new ConflictError(`A record with this ${error.meta?.target} already exists.`);
      
      // Foreign key constraint failed
      case 'P2003':
        return new BadRequestError(`Related record not found.`);
      
      // Record not found
      case 'P2001':
      case 'P2025':
        return new NotFoundError('Record not found.');
      
      // Value out of range
      case 'P2007':
        return new ValidationError('Invalid data format.');
      
      // Invalid data type
      case 'P2006':
        return new ValidationError('Invalid data value.');
      
      default:
        return new InternalServerError(`Database error: ${error.message}`, true);
    }
  }
  
  // If it's already an AppError, return it
  if (error instanceof AppError) {
    return error;
  }
  
  // Default to Internal Server Error
  return new InternalServerError(error.message || 'Something went wrong');
};

/**
 * Error handler middleware for Express
 */
export const errorHandler = (err: any, req: any, res: any, next: any) => {
  console.error('Error:', err);
  
  // If the error is our ApiError, use its properties
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      errors: Object.keys(err.errors).length > 0 ? err.errors : undefined
    });
  }
  
  // If the error is our AppError, use its properties
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      errors: (err as any).errors
    });
  }
  
  // For multer errors (file uploads)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      status: 'error',
      message: 'File is too large. Maximum size is 5MB'
    });
  }
  
  // For validation errors (e.g., from express-validator)
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      status: 'error',
      message: 'Validation error',
      errors: err.errors
    });
  }
  
  // For prisma errors
  if (err.code && err.code.startsWith('P')) {
    // Prisma error codes start with 'P'
    let message = 'Database error';
    let statusCode = 500;
    
    // Handle common Prisma errors with meaningful messages
    switch (err.code) {
      case 'P2002': // Unique constraint failed
        message = `This ${err.meta?.target?.[0] || 'field'} already exists`;
        statusCode = 409;
        break;
      case 'P2025': // Record not found
        message = 'Record not found';
        statusCode = 404;
        break;
    }
    
    return res.status(statusCode).json({
      status: 'error',
      message,
      code: err.code,
      // In development, include more details
      meta: process.env.NODE_ENV === 'development' ? err.meta : undefined
    });
  }
  
  // Default error response for unhandled errors
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';
  
  res.status(statusCode).json({
    status: 'error',
    message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

// For handling async errors in express route handlers
export const catchAsync = (fn: Function) => {
  return (req: any, res: any, next: any) => {
    fn(req, res, next).catch(next);
  };
}; 