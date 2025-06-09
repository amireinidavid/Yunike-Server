import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../utils/errors';

/**
 * Middleware to validate request body, query or params using Zod schema
 * @param validatorFn Zod validator function from utils/validators
 * @param property Request property to validate (body, query, params)
 */
export const validateSchema = (
  validatorFn: (data: any) => any,
  property: 'body' | 'query' | 'params' = 'body'
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = validatorFn(req[property]);
      
      if (result.error) {
        // Format validation errors
        const validationError = new ValidationError('Validation failed');
        validationError.errors = Array.isArray(result.error) ? result.error : [result.error];
        
        return next(validationError);
      }
      
      // Replace the validated object with the sanitized version
      req[property] = result.validData;
      next();
    } catch (error) {
      // Handle unexpected errors
      const validationError = new ValidationError('Validation failed due to unexpected error');
      return next(validationError);
    }
  };
}; 