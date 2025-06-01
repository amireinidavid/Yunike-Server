import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { AppError } from '../utils/errors';

/**
 * Global error handling middleware
 */
const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Log the error
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    requestId: req.headers['x-request-id']
  });

  // Check if it's a known error type
  if (err instanceof AppError) {
    // Return formatted error response for known errors
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      statusCode: err.statusCode,
      requestId: req.headers['x-request-id']
    });
  }

  // Handle validation errors from express-validator
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: (err as any).errors || [err.message],
      statusCode: 400,
      requestId: req.headers['x-request-id']
    });
  }

  // Handle Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    // Extract the error code from the Prisma error
    const prismaErr = err as any;
    const errorCode = prismaErr.code;

    // Handle specific Prisma errors
    if (errorCode === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'A resource with this identifier already exists',
        statusCode: 409,
        requestId: req.headers['x-request-id']
      });
    }

    if (errorCode === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Record not found',
        statusCode: 404,
        requestId: req.headers['x-request-id']
      });
    }
  }

  // For unknown errors, return a generic 500 error
  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  
  return res.status(statusCode).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred' 
      : err.message || 'Internal Server Error',
    statusCode,
    requestId: req.headers['x-request-id']
  });
};

export default errorHandler; 