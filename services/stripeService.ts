import Stripe from 'stripe';
import { PrismaClient, StripeAccountStatus, StripeAccountType, Vendor } from '@prisma/client';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-04-30.basil', // Use the latest API version, // Cast to any to avoid API version type error
});

/**
 * Map full country names to ISO 2-letter country codes
 * This helps convert country names from the form to the format Stripe requires
 */
const countryNameToCode: Record<string, string> = {
  'afghanistan': 'AF',
  'albania': 'AL',
  'algeria': 'DZ',
  'andorra': 'AD',
  'angola': 'AO',
  'argentina': 'AR',
  'armenia': 'AM',
  'australia': 'AU',
  'austria': 'AT',
  'azerbaijan': 'AZ',
  'bahamas': 'BS',
  'bahrain': 'BH',
  'bangladesh': 'BD',
  'barbados': 'BB',
  'belarus': 'BY',
  'belgium': 'BE',
  'belize': 'BZ',
  'benin': 'BJ',
  'bhutan': 'BT',
  'bolivia': 'BO',
  'bosnia and herzegovina': 'BA',
  'botswana': 'BW',
  'brazil': 'BR',
  'brunei': 'BN',
  'bulgaria': 'BG',
  'burkina faso': 'BF',
  'burundi': 'BI',
  'cambodia': 'KH',
  'cameroon': 'CM',
  'canada': 'CA',
  'cape verde': 'CV',
  'central african republic': 'CF',
  'chad': 'TD',
  'chile': 'CL',
  'china': 'CN',
  'colombia': 'CO',
  'comoros': 'KM',
  'congo': 'CG',
  'costa rica': 'CR',
  'croatia': 'HR',
  'cuba': 'CU',
  'cyprus': 'CY',
  'czech republic': 'CZ',
  'denmark': 'DK',
  'djibouti': 'DJ',
  'dominica': 'DM',
  'dominican republic': 'DO',
  'east timor': 'TL',
  'ecuador': 'EC',
  'egypt': 'EG',
  'el salvador': 'SV',
  'equatorial guinea': 'GQ',
  'eritrea': 'ER',
  'estonia': 'EE',
  'ethiopia': 'ET',
  'fiji': 'FJ',
  'finland': 'FI',
  'france': 'FR',
  'gabon': 'GA',
  'gambia': 'GM',
  'georgia': 'GE',
  'germany': 'DE',
  'ghana': 'GH',
  'greece': 'GR',
  'grenada': 'GD',
  'guatemala': 'GT',
  'guinea': 'GN',
  'guinea-bissau': 'GW',
  'guyana': 'GY',
  'haiti': 'HT',
  'honduras': 'HN',
  'hungary': 'HU',
  'iceland': 'IS',
  'india': 'IN',
  'indonesia': 'ID',
  'iran': 'IR',
  'iraq': 'IQ',
  'ireland': 'IE',
  'israel': 'IL',
  'italy': 'IT',
  'ivory coast': 'CI',
  'jamaica': 'JM',
  'japan': 'JP',
  'jordan': 'JO',
  'kazakhstan': 'KZ',
  'kenya': 'KE',
  'kiribati': 'KI',
  'north korea': 'KP',
  'south korea': 'KR',
  'kosovo': 'XK',
  'kuwait': 'KW',
  'kyrgyzstan': 'KG',
  'laos': 'LA',
  'latvia': 'LV',
  'lebanon': 'LB',
  'lesotho': 'LS',
  'liberia': 'LR',
  'libya': 'LY',
  'liechtenstein': 'LI',
  'lithuania': 'LT',
  'luxembourg': 'LU',
  'macedonia': 'MK',
  'madagascar': 'MG',
  'malawi': 'MW',
  'malaysia': 'MY',
  'maldives': 'MV',
  'mali': 'ML',
  'malta': 'MT',
  'marshall islands': 'MH',
  'mauritania': 'MR',
  'mauritius': 'MU',
  'mexico': 'MX',
  'micronesia': 'FM',
  'moldova': 'MD',
  'monaco': 'MC',
  'mongolia': 'MN',
  'montenegro': 'ME',
  'morocco': 'MA',
  'mozambique': 'MZ',
  'myanmar': 'MM',
  'namibia': 'NA',
  'nauru': 'NR',
  'nepal': 'NP',
  'netherlands': 'NL',
  'new zealand': 'NZ',
  'nicaragua': 'NI',
  'niger': 'NE',
  'nigeria': 'NG',
  'norway': 'NO',
  'oman': 'OM',
  'pakistan': 'PK',
  'palau': 'PW',
  'panama': 'PA',
  'papua new guinea': 'PG',
  'paraguay': 'PY',
  'peru': 'PE',
  'philippines': 'PH',
  'poland': 'PL',
  'portugal': 'PT',
  'qatar': 'QA',
  'romania': 'RO',
  'russia': 'RU',
  'rwanda': 'RW',
  'saint kitts and nevis': 'KN',
  'saint lucia': 'LC',
  'saint vincent and the grenadines': 'VC',
  'samoa': 'WS',
  'san marino': 'SM',
  'sao tome and principe': 'ST',
  'saudi arabia': 'SA',
  'senegal': 'SN',
  'serbia': 'RS',
  'seychelles': 'SC',
  'sierra leone': 'SL',
  'singapore': 'SG',
  'slovakia': 'SK',
  'slovenia': 'SI',
  'solomon islands': 'SB',
  'somalia': 'SO',
  'south africa': 'ZA',
  'south sudan': 'SS',
  'spain': 'ES',
  'sri lanka': 'LK',
  'sudan': 'SD',
  'suriname': 'SR',
  'swaziland': 'SZ',
  'sweden': 'SE',
  'switzerland': 'CH',
  'syria': 'SY',
  'taiwan': 'TW',
  'tajikistan': 'TJ',
  'tanzania': 'TZ',
  'thailand': 'TH',
  'togo': 'TG',
  'tonga': 'TO',
  'trinidad and tobago': 'TT',
  'tunisia': 'TN',
  'turkey': 'TR',
  'turkmenistan': 'TM',
  'tuvalu': 'TV',
  'uganda': 'UG',
  'ukraine': 'UA',
  'united arab emirates': 'AE',
  'united kingdom': 'GB',
  'united states': 'US',
  'usa': 'US',
  'united states of america': 'US',
  'uruguay': 'UY',
  'uzbekistan': 'UZ',
  'vanuatu': 'VU',
  'vatican city': 'VA',
  'venezuela': 'VE',
  'vietnam': 'VN',
  'yemen': 'YE',
  'zambia': 'ZM',
  'zimbabwe': 'ZW'
};

/**
 * Convert a country name to its ISO 2-letter code
 * @param country Country name or code
 * @returns ISO 2-letter country code
 */
const getCountryCode = (country: string | null | undefined): string => {
  if (!country) return 'US'; // Default to US for test accounts
  
  // If it's already a 2-letter code, return it
  if (/^[A-Z]{2}$/.test(country)) {
    return country;
  }
  
  // Normalize the country name (lowercase, trim)
  const normalizedCountry = country.toLowerCase().trim();
  
  // Check if the normalized country is in our mapping
  if (countryNameToCode[normalizedCountry]) {
    return countryNameToCode[normalizedCountry];
  }
  
  // For any country not in our mapping, default to US for test accounts
  console.warn(`Country "${country}" not found in mapping, defaulting to US`);
  return 'US';
};

/**
 * Create a Stripe Connect account for a vendor
 */
export const createConnectAccount = async (
  vendorId: string,
  accountType: StripeAccountType = StripeAccountType.EXPRESS
): Promise<{ accountId: string; accountLinkUrl?: string }> => {
  try {
    // Get vendor info
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: { user: true }
    });

    if (!vendor) {
      throw new Error('Vendor not found');
    }

    // If vendor already has a Stripe account
    if (vendor.stripeAccountId) {
      return { accountId: vendor.stripeAccountId };
    }

    // Get country code from business address
    let countryCode = 'US'; // Default for test accounts
    
    // Check if we're in test mode (force US for test accounts)
    const isTestMode = process.env.STRIPE_TEST_MODE === 'true';
    
    if (!isTestMode && vendor.businessAddress) {
      try {
        // Handle different possible structures of businessAddress
        if (typeof vendor.businessAddress === 'object') {
          const address = vendor.businessAddress as any;
          if (address.country) {
            countryCode = getCountryCode(address.country);
          }
        } else if (typeof vendor.businessAddress === 'string') {
          // Try to parse if it's a JSON string
          try {
            const address = JSON.parse(vendor.businessAddress);
            if (address.country) {
              countryCode = getCountryCode(address.country);
            }
          } catch (e) {
            // If not valid JSON, use default
            console.warn('Could not parse business address:', e);
          }
        }
      } catch (error) {
        console.warn('Error processing business address:', error);
        // Continue with default countryCode
      }
    } else {
      // Force US for test accounts
      countryCode = 'US';
      console.log('Using test account with US country code');
    }

    console.log(`Creating Stripe account for vendor ${vendorId} with country code: ${countryCode}`);

    // Create a Stripe Connect account based on the account type
    let account;
    
    if (accountType === StripeAccountType.EXPRESS) {
      // Create an Express account (easiest onboarding)
      account = await stripe.accounts.create({
        type: 'express',
        country: countryCode,
        email: vendor.contactEmail,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: mapBusinessType(vendor.businessType) as any, // Cast to any to avoid type error
        business_profile: {
          name: vendor.storeName,
          url: `${process.env.FRONTEND_URL}/vendor/${vendor.slug}`,
        },
        metadata: {
          vendorId: vendor.id,
          platformId: process.env.PLATFORM_ID || 'yunike',
          isTestAccount: 'true'
        }
      });
    } else if (accountType === StripeAccountType.STANDARD) {
      // Create a Standard account
      account = await stripe.accounts.create({
        type: 'standard',
        country: countryCode,
        email: vendor.contactEmail,
        metadata: {
          vendorId: vendor.id,
          platformId: process.env.PLATFORM_ID || 'yunike',
          isTestAccount: 'true'
        }
      });
    } else {
      // Create a Custom account (most flexibility but requires more compliance work)
      account = await stripe.accounts.create({
        type: 'custom',
        country: countryCode,
        email: vendor.contactEmail,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: mapBusinessType(vendor.businessType) as any, // Cast to any to avoid type error
        business_profile: {
          name: vendor.storeName,
          url: `${process.env.FRONTEND_URL}/vendor/${vendor.slug}`,
        },
        metadata: {
          vendorId: vendor.id,
          platformId: process.env.PLATFORM_ID || 'yunike',
          isTestAccount: 'true'
        }
      });
    }

    // Update vendor with Stripe account ID
    await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        stripeAccountId: account.id,
        stripeAccountType: accountType,
        stripeAccountStatus: StripeAccountStatus.PENDING
      }
    });

    // For Express accounts, create an account link for onboarding
    let accountLinkUrl;
    if (accountType === StripeAccountType.EXPRESS) {
      const accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: `${process.env.VENDOR_FRONTEND_URL}/vendor/stripe/callback?setup_mode=canceled`,
        return_url: `${process.env.VENDOR_FRONTEND_URL}/vendor/stripe/callback?setup_mode=complete`,
        type: 'account_onboarding',
      });
      accountLinkUrl = accountLink.url;
    }

    return { 
      accountId: account.id,
      accountLinkUrl
    };
  } catch (error) {
    console.error('Error creating Stripe Connect account:', error);
    throw error;
  }
};

/**
 * Create an account link for an existing Stripe Connect account
 */
export const createAccountLink = async (vendorId: string): Promise<string> => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId }
    });

    if (!vendor || !vendor.stripeAccountId) {
      throw new Error('Vendor has no Stripe account');
    }

    const accountLink = await stripe.accountLinks.create({
      account: vendor.stripeAccountId,
      refresh_url: `${process.env.VENDOR_FRONTEND_URL}/vendor/stripe/callback?setup_mode=canceled`,
      return_url: `${process.env.VENDOR_FRONTEND_URL}/vendor/stripe/callback?setup_mode=complete`,
      type: 'account_onboarding',
    });

    return accountLink.url;
  } catch (error) {
    console.error('Error creating account link:', error);
    throw error;
  }
};

/**
 * Get Stripe account status
 */
export const getAccountStatus = async (vendorId: string): Promise<{
  stripeAccountId: string | null;
  status: StripeAccountStatus | null;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
}> => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId }
    });

    if (!vendor || !vendor.stripeAccountId) {
      return {
        stripeAccountId: null,
        status: null,
        detailsSubmitted: false,
        payoutsEnabled: false,
        chargesEnabled: false
      };
    }

    const account = await stripe.accounts.retrieve(vendor.stripeAccountId);

    // Update account status in database
    await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        stripeDetailsSubmitted: account.details_submitted,
        stripePayoutsEnabled: account.payouts_enabled,
        stripeChargesEnabled: account.charges_enabled,
        stripeOnboardingComplete: 
          account.details_submitted && 
          account.payouts_enabled && 
          account.charges_enabled,
        stripeAccountStatus: mapStripeStatus(account)
      }
    });

    return {
      stripeAccountId: vendor.stripeAccountId,
      status: mapStripeStatus(account),
      detailsSubmitted: account.details_submitted,
      payoutsEnabled: account.payouts_enabled,
      chargesEnabled: account.charges_enabled
    };
  } catch (error) {
    console.error('Error getting account status:', error);
    throw error;
  }
};

/**
 * Create a payment intent with connected account
 */
export const createPaymentIntent = async (
  amount: number, 
  currency: string, 
  vendorId: string,
  metadata: any = {}
): Promise<Stripe.PaymentIntent> => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId }
    });

    if (!vendor || !vendor.stripeAccountId) {
      throw new Error('Vendor has no Stripe account');
    }

    if (!vendor.stripeOnboardingComplete) {
      throw new Error('Vendor has not completed Stripe onboarding');
    }

    const applicationFee = calculateApplicationFee(amount, vendor.commissionRate);

    return await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      application_fee_amount: Math.round(applicationFee * 100),
      transfer_data: {
        destination: vendor.stripeAccountId,
      },
      metadata: {
        ...metadata,
        vendorId,
        platformId: process.env.PLATFORM_ID || 'yunike'
      }
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    throw error;
  }
};

/**
 * Create a payment intent for multiple vendors (split payment)
 * Returns payment intent for the total amount and schedules transfers to vendors
 */
export const createMultiVendorPayment = async (
  items: Array<{
    vendorId: string;
    amount: number;
    productIds: string[];
  }>,
  currency: string,
  metadata: any = {}
): Promise<Stripe.PaymentIntent> => {
  try {
    // Calculate total amount
    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
    
    // Create payment intent for the total amount
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(totalAmount * 100), // Convert to cents
      currency,
      metadata: {
        ...metadata,
        vendorIds: items.map(item => item.vendorId).join(','),
        platformId: process.env.PLATFORM_ID || 'yunike',
        isMultiVendor: 'true'
      }
    });

    // Store transfer information for later processing after payment completes
    // This would be handled by webhook in production
    const transferInfo = await Promise.all(items.map(async (item) => {
      const vendor = await prisma.vendor.findUnique({
        where: { id: item.vendorId }
      });

      if (!vendor || !vendor.stripeAccountId) {
        throw new Error(`Vendor ${item.vendorId} has no Stripe account`);
      }

      if (!vendor.stripeOnboardingComplete) {
        throw new Error(`Vendor ${item.vendorId} has not completed Stripe onboarding`);
      }

      const applicationFee = calculateApplicationFee(item.amount, vendor.commissionRate);
      const transferAmount = item.amount - applicationFee;

      return {
        vendorId: item.vendorId,
        stripeAccountId: vendor.stripeAccountId,
        amount: Math.round(transferAmount * 100), // Convert to cents
        applicationFee: Math.round(applicationFee * 100),
        productIds: item.productIds
      };
    }));

    // In production, you'd store transferInfo in your database
    // to process after payment webhook confirms success
    console.log('Transfer info for webhook processing:', transferInfo);

    return paymentIntent;
  } catch (error) {
    console.error('Error creating multi-vendor payment:', error);
    throw error;
  }
};

/**
 * Process transfer to vendor after payment is complete
 * This would be called by webhook in production
 */
export const transferToVendor = async (
  paymentIntentId: string,
  vendorId: string,
  amount: number,
  description: string = ''
): Promise<Stripe.Transfer> => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId }
    });

    if (!vendor || !vendor.stripeAccountId) {
      throw new Error('Vendor has no Stripe account');
    }

    // Get payment intent to use as source
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      throw new Error('Payment not successful');
    }

    // Get the charge ID from the payment intent
    const charges = await stripe.charges.list({
      payment_intent: paymentIntentId
    });
    
    if (!charges.data.length) {
      throw new Error('No charges found for this payment intent');
    }

    // Create a transfer to the connected account
    return await stripe.transfers.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: paymentIntent.currency,
      destination: vendor.stripeAccountId,
      source_transaction: charges.data[0].id,
      description,
      metadata: {
        paymentIntentId,
        vendorId,
        platformId: process.env.PLATFORM_ID || 'yunike'
      }
    });
  } catch (error) {
    console.error('Error transferring to vendor:', error);
    throw error;
  }
};

/**
 * Helper function to calculate platform fee
 */
const calculateApplicationFee = (amount: number, commissionRate: number): number => {
  return (amount * commissionRate) / 100;
};

/**
 * Map business type to Stripe format
 */
const mapBusinessType = (businessType: string | null): string | undefined => {
  if (!businessType) return undefined;
  
  const mapping: Record<string, string> = {
    'INDIVIDUAL': 'individual',
    'PARTNERSHIP': 'company',
    'CORPORATION': 'company',
    'LLC': 'company',
    'NON_PROFIT': 'non_profit'
  };
  
  return mapping[businessType] || undefined;
};

/**
 * Map Stripe account status to our enum
 */
const mapStripeStatus = (account: Stripe.Account): StripeAccountStatus => {
  if (!account.details_submitted) {
    return StripeAccountStatus.PENDING;
  }
  
  if (account.charges_enabled && account.payouts_enabled) {
    return StripeAccountStatus.ACTIVE;
  }
  
  if (account.requirements?.disabled_reason) {
    return StripeAccountStatus.DISABLED;
  }
  
  if (account.requirements?.errors && account.requirements.errors.length > 0) {
    return StripeAccountStatus.REJECTED;
  }
  
  return StripeAccountStatus.RESTRICTED;
}; 