import { Request, Response, NextFunction } from 'express';
import { Schema } from 'joi';
import { ValidationError } from '../utils/errors';

/**
 * Middleware to validate request body, query or params using Joi schema
 * @param schema Joi validation schema
 * @param property Request property to validate (body, query, params)
 */
export const validateRequest = (
  schema: Schema,
  property: 'body' | 'query' | 'params' = 'body'
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req[property], { 
      abortEarly: false,
      stripUnknown: true
    });
    
    if (error) {
      // Format validation errors
      const errorDetails = error.details.map(detail => ({
        message: detail.message,
        path: detail.path,
        type: detail.type
      }));
      
      const validationError = new ValidationError('Validation failed');
      (validationError as any).errors = errorDetails;
      
      return next(validationError);
    }
    
    // Replace the validated object to remove any unwanted properties
    req[property] = value;
    next();
  };
};

/**
 * Middleware to sanitize and validate pagination parameters
 */
export const validatePagination = (
  req: Request, 
  res: Response, 
  next: NextFunction
) => {
  // Set default values if not provided
  req.query.page = req.query.page || '1';
  req.query.limit = req.query.limit || '20';
  
  // Parse and validate page number
  const page = parseInt(req.query.page as string, 10);
  if (isNaN(page) || page < 1) {
    return next(new ValidationError('Page must be a positive integer'));
  }
  
  // Parse and validate limit
  const limit = parseInt(req.query.limit as string, 10);
  if (isNaN(limit) || limit < 1 || limit > 100) {
    return next(new ValidationError('Limit must be between 1 and 100'));
  }
  
  // Assign validated values
  req.query.page = page.toString();
  req.query.limit = limit.toString();
  
  next();
};

/**
 * Middleware to validate and parse numeric parameters
 * @param params Array of parameter names to validate
 */
export const validateNumericParams = (params: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: string[] = [];
    
    params.forEach(param => {
      if (req.params[param]) {
        const value = parseInt(req.params[param], 10);
        
        if (isNaN(value)) {
          errors.push(`${param} must be a valid number`);
        } else {
          // Replace with the parsed value
          req.params[param] = value.toString();
        }
      }
    });
    
    if (errors.length > 0) {
      const validationError = new ValidationError('Validation failed');
      (validationError as any).errors = errors;
      
      return next(validationError);
    }
    
    next();
  };
};

export default {
  validateRequest,
  validatePagination,
  validateNumericParams
}; 