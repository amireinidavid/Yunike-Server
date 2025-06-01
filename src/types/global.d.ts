// Global type declarations

// EmailJS NodeJS module declaration
declare module '@emailjs/nodejs' {
  interface EmailJSResponseStatus {
    status: number;
    text: string;
  }

  interface SendOptions {
    publicKey: string;
    privateKey: string;
  }

  function send(
    serviceId: string, 
    templateId: string, 
    templateParams: Record<string, any>,
    options: SendOptions
  ): Promise<EmailJSResponseStatus>;

  export { EmailJSResponseStatus, send };
} 