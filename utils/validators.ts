import { z } from 'zod';

/**
 * Validate vendor update data
 */
export const validateVendorUpdate = (data: any) => {
  // Define schema for vendor update
  const schema = z.object({
    storeName: z.string().min(2).max(100).optional(),
    slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, {
      message: 'Slug can only contain lowercase letters, numbers, and hyphens',
    }).optional(),
    description: z.string().max(2000).optional().nullable(),
    shortDescription: z.string().max(200).optional().nullable(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().optional().nullable(),
    businessAddress: z.any().optional(), // JSON object
    taxIdentification: z.string().optional().nullable(),
    businessType: z.enum(['INDIVIDUAL', 'PARTNERSHIP', 'CORPORATION', 'LLC', 'NON_PROFIT']).optional(),
    foundedYear: z.number().int().positive().optional(),
    processingTime: z.string().optional().nullable(),
    minOrderAmount: z.number().positive().optional().nullable(),
    maxOrderAmount: z.number().positive().optional().nullable(),
    freeShippingThreshold: z.number().positive().optional().nullable(),
    operatingHours: z.any().optional(), // JSON object
    socialLinks: z.any().optional(), // JSON object
    policies: z.any().optional(), // JSON object
    seo: z.any().optional(), // JSON object
    tags: z.array(z.string()).optional(),
  });

  try {
    // Validate data against schema
    const validData = schema.parse(data);
    return { error: null, validData };
  } catch (error) {
    // Return validation errors
    return {
      error: error instanceof z.ZodError ? error.errors : 'Validation error',
      validData: null
    };
  }
};

/**
 * Validate user profile update data
 */
export const validateUserProfileUpdate = (data: any) => {
  // Define schema for user profile update
  const schema = z.object({
    name: z.string().min(2).max(100).optional(),
    firstName: z.string().min(1).max(50).optional(),
    lastName: z.string().min(1).max(50).optional(),
    phone: z.string().min(5).max(20).optional(),
    biography: z.string().max(500).optional(),
    preferredLanguage: z.string().max(10).optional(),
    preferredCurrency: z.string().max(3).optional(),
  });

  try {
    // Validate data against schema
    const validData = schema.parse(data);
    return { error: null, validData };
  } catch (error) {
    // Return validation errors
    return {
      error: error instanceof z.ZodError ? error.errors : 'Validation error',
      validData: null
    };
  }
};

/**
 * Validate Stripe Connect account update data
 */
export const validateStripeAccountUpdate = (data: any) => {
  // Define schema for Stripe Connect account update
  const schema = z.object({
    stripeAccountId: z.string().optional().nullable(),
    stripeAccountStatus: z.enum(['PENDING', 'ACTIVE', 'RESTRICTED', 'REJECTED', 'DISABLED']).optional(),
    stripeAccountType: z.enum(['EXPRESS', 'STANDARD', 'CUSTOM']).optional(),
    stripeOnboardingComplete: z.boolean().optional(),
    stripePayoutsEnabled: z.boolean().optional(),
    stripeChargesEnabled: z.boolean().optional(),
    stripeDetailsSubmitted: z.boolean().optional(),
    stripeMetadata: z.any().optional(), // JSON object
  });

  try {
    // Validate data against schema
    const validData = schema.parse(data);
    return { error: null, validData };
  } catch (error) {
    // Return validation errors
    return {
      error: error instanceof z.ZodError ? error.errors : 'Validation error',
      validData: null
    };
  }
};

/**
 * Validate payment intent creation data
 */
export const validatePaymentIntentData = (data: any) => {
  const schema = z.object({
    amount: z.number().positive(),
    currency: z.string().min(3).max(3).default('USD'),
    description: z.string().optional(),
    customerId: z.string().optional(),
    metadata: z.record(z.string()).optional(),
    receiptEmail: z.string().email().optional(),
    vendorId: z.string().optional(), // For single vendor payments
    items: z.array(
      z.object({
        vendorId: z.string(),
        amount: z.number().positive(),
        description: z.string().optional()
      })
    ).optional(), // For multi-vendor payments
    applicationFee: z.number().min(0).optional(),
    statementDescriptor: z.string().max(22).optional()
  });

  try {
    // Validate data against schema
    const validData = schema.parse(data);
    return { error: null, validData };
  } catch (error) {
    // Return validation errors
    return {
      error: error instanceof z.ZodError ? error.errors : 'Validation error',
      validData: null
    };
  }
};

/**
 * Validate payment method data
 */
export const validatePaymentMethodData = (data: any) => {
  const schema = z.object({
    type: z.enum(['CREDIT_CARD', 'DEBIT_CARD', 'PAYPAL', 'APPLE_PAY', 'GOOGLE_PAY', 'BANK_TRANSFER', 'CRYPTO', 'STORE_CREDIT', 'OTHER']),
    provider: z.string(),
    accountNumber: z.string().optional().nullable(),
    expiryDate: z.string().optional().nullable(),
    isDefault: z.boolean().optional(),
    paymentToken: z.string().optional().nullable(),
    billingAddressId: z.string().optional().nullable(),
    metadata: z.any().optional()
  });

  try {
    // Validate data against schema
    const validData = schema.parse(data);
    return { error: null, validData };
  } catch (error) {
    // Return validation errors
    return {
      error: error instanceof z.ZodError ? error.errors : 'Validation error',
      validData: null
    };
  }
};

/**
 * Validate Stripe onboarding data
 */
export const validateStripeOnboardingRequest = (data: any) => {
  const schema = z.object({
    vendorId: z.string(),
    accountType: z.enum(['EXPRESS', 'STANDARD', 'CUSTOM']).default('EXPRESS'),
    refreshUrl: z.string().url(),
    returnUrl: z.string().url(),
    businessProfile: z.object({
      mcc: z.string().optional(),
      url: z.string().url().optional(),
      productDescription: z.string().optional()
    }).optional(),
    businessType: z.enum(['individual', 'company', 'non_profit', 'government_entity']).optional(),
    settings: z.object({
      payouts: z.object({
        schedule: z.object({
          interval: z.enum(['manual', 'daily', 'weekly', 'monthly']).optional(),
          weekly_anchor: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']).optional(),
          monthly_anchor: z.number().min(1).max(31).optional()
        }).optional()
      }).optional()
    }).optional()
  });

  try {
    const validData = schema.parse(data);
    return { error: null, validData };
  } catch (error) {
    return {
      error: error instanceof z.ZodError ? error.errors : 'Validation error',
      validData: null
    };
  }
};

/**
 * Validate Stripe account verification data
 */
export const validateStripeAccountVerification = (data: any) => {
  const schema = z.object({
    vendorId: z.string(),
    accountId: z.string(),
    verification: z.object({
      document: z.object({
        front: z.string(),
        back: z.string().optional()
      }).optional(),
      person: z.string().optional(),
      personId: z.string().optional(),
      documentType: z.enum(['id_card', 'passport', 'driving_license']).optional()
    }).optional()
  });

  try {
    const validData = schema.parse(data);
    return { error: null, validData };
  } catch (error) {
    return {
      error: error instanceof z.ZodError ? error.errors : 'Validation error',
      validData: null
    };
  }
}; 