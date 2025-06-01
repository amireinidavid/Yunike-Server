/// <reference path="../src/types/global.d.ts" />

import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';

// Email configuration
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const SMTP_USER = process.env.SMTP_USER || 'pitchhub1@gmail.com';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || 'zfhn bmwq xvyc hnxo'; // Set this in your environment variables
const EMAIL_FROM = process.env.EMAIL_FROM || 'pitchhub1@gmail.com';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Create nodemailer transporter with improved error handling
const createTransporter = () => {
  console.log(`Setting up email transporter with: ${SMTP_HOST}:${SMTP_PORT}`);
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true for 465, false for other ports
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false, // Fixes some connection issues
      ciphers: 'SSLv3'
    },
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000, // 10 seconds
    socketTimeout: 15000, // 15 seconds
  });
};

// Lazy initialize transporter when needed
let transporter: any = null;

// Get all email templates
const TEMPLATE_DIR = path.join(__dirname, '../templates/emails');

/**
 * Cache for compiled templates
 */
const templateCache: Record<string, Handlebars.TemplateDelegate> = {};

/**
 * Load and compile a template
 * @param templateName Name of the template
 * @returns Compiled Handlebars template
 */
const getTemplate = (templateName: string): Handlebars.TemplateDelegate => {
  // Return from cache if available
  if (templateCache[templateName]) {
    return templateCache[templateName];
  }

  try {
    // Load template file
    const filePath = path.join(TEMPLATE_DIR, `${templateName}.hbs`);
    const templateSource = fs.readFileSync(filePath, 'utf8');
    
    // Compile template
    const template = Handlebars.compile(templateSource);
    
    // Cache for future use
    templateCache[templateName] = template;
    
    return template;
  } catch (error) {
    console.error(`Error loading template ${templateName}:`, error);
    
    // Fallback to a simple template
    const fallbackTemplate = Handlebars.compile(`
      <h1>{{subject}}</h1>
      <p>Hello {{name}},</p>
      <p>{{message}}</p>
      <p>Best regards,<br>Yunike Team</p>
    `);
    
    // Cache the fallback
    templateCache[templateName] = fallbackTemplate;
    
    return fallbackTemplate;
  }
};

/**
 * Register Handlebars helpers
 */
Handlebars.registerHelper('formatDate', (date: Date) => {
  return date ? new Date(date).toLocaleDateString() : '';
});

Handlebars.registerHelper('formatCurrency', (amount: number, currency = 'USD') => {
  return amount ? new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency
  }).format(amount) : '';
});

/**
 * Email options interface
 */
interface EmailOptions {
  to: string | string[];
  subject: string;
  template?: string;
  context?: Record<string, any>;
  text?: string;
  html?: string;
  attachments?: {
    filename: string;
    content?: any;
    path?: string;
    contentType?: string;
  }[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}

/**
 * Send an email using Nodemailer
 * @param options Email options
 * @returns Promise that resolves to the Nodemailer info object
 */
export const sendEmail = async (options: EmailOptions) => {
  try {
    // Initialize transporter if needed
    if (!transporter) {
      transporter = createTransporter();
    }
    
    let html = options.html;
    let text = options.text;

    // If template is specified, render it
    if (options.template) {
      const template = getTemplate(options.template);
      const context = {
        ...options.context,
        subject: options.subject,
      };
      
      html = template(context);
      // Generate text version if not provided
      if (!text) {
        // Simple HTML to text conversion
        text = html
          .replace(/<div.*?>/gi, '\n')
          .replace(/<\/div>/gi, '')
          .replace(/<p.*?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<br.*?>/gi, '\n')
          .replace(/<(?:.|\n)*?>/gm, '');
      }
    }

    // Create email message
    const mailOptions = {
      from: options.replyTo ? `Yunike <${EMAIL_FROM}>` : `Yunike <${EMAIL_FROM}>`,
      to: options.to,
      cc: options.cc,
      bcc: options.bcc,
      subject: options.subject,
      text: text || '',
      html: html || '',
      replyTo: options.replyTo || EMAIL_FROM,
      attachments: options.attachments,
    };

    // For development, log that we're sending an email but don't actually send it
    // Remove this condition and keep the try/catch if you want to actually send in development
    if (NODE_ENV === 'development' && process.env.SKIP_EMAILS === 'true') {
      console.log('Email would be sent (skipped in development):', {
        to: mailOptions.to,
        subject: mailOptions.subject
      });
      console.log('Email content:', text || html?.substring(0, 100) + '...');
      return { messageId: 'dev-mode-skipped', response: 'skipped' };
    }

    // Send email using Nodemailer
    console.log(`Sending email to ${mailOptions.to} with subject: ${mailOptions.subject}`);
    const info = await transporter.sendMail(mailOptions);
    
    // Log in development mode
    if (NODE_ENV !== 'production') {
      console.log('Email sent:', info);
    }
    
    return info;
  } catch (error: unknown) {
    console.error('Error sending email:', error);
    
    // Recreate transporter on error to ensure fresh connection on next attempt
    transporter = null;
    
    // Rethrow for caller to handle
    throw new Error(`Failed to send email: ${error instanceof Error ? error.message : String(error)}`);
  }
};

/**
 * Verify email service connection
 * @returns Promise that resolves to true if connection is successful
 */
export const verifyEmailConnection = async (): Promise<boolean> => {
  try {
    // Initialize transporter if needed
    if (!transporter) {
      transporter = createTransporter();
    }
    
    // Verify SMTP connection
    const verification = await transporter.verify();
    
    if (NODE_ENV !== 'production') {
      console.log('SMTP connection verified:', verification);
    }
    
    return !!verification;
  } catch (error) {
    console.error('Email connection verification failed:', error);
    
    // Reset transporter on error
    transporter = null;
    
    return false;
  }
}; 