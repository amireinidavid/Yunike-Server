# Yunike E-commerce Platform - Server

This is the backend server for the Yunike multi-vendor e-commerce platform. It provides API endpoints for the client, vendor, and admin applications.

## Features

- Express.js server with TypeScript
- PostgreSQL database with Prisma ORM
- RESTful API endpoints for e-commerce operations
- Authentication and authorization
- Vendor management
- Product and inventory management
- Order processing
- User management
- Admin dashboard APIs
- Real-time notifications (WebSockets)

## Tech Stack

- **Node.js & Express**: Server framework
- **TypeScript**: Type safety
- **Prisma**: ORM for database operations
- **PostgreSQL**: Database
- **JWT**: Authentication
- **Nodemon**: Development server with hot reload
- **Helmet**: Security headers
- **Morgan**: HTTP request logging
- **CORS**: Cross-origin resource sharing
- **Compression**: Response compression
- **Rate Limiting**: API abuse prevention

## Getting Started

### Prerequisites

- Node.js (v18+)
- PostgreSQL database
- Redis (optional for caching)

### Setup

1. Clone the repository
2. Navigate to the server directory
3. Install dependencies:

```bash
npm install
```

4. Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

5. Update the `.env` file with your configuration

6. Generate Prisma client:

```bash
npm run prisma:generate
```

7. Run database migrations:

```bash
npm run prisma:migrate
```

8. Start the development server:

```bash
npm run dev
```

The server will be running at http://localhost:5000

## Database Management

- Generate Prisma client: `npm run prisma:generate`
- Run migrations: `npm run prisma:migrate`
- View database with Prisma Studio: `npm run prisma:studio`

## API Documentation

The API endpoints are organized into the following categories:

- `/api/v1/auth` - Authentication and authorization
- `/api/v1/users` - User management
- `/api/v1/products` - Product management
- `/api/v1/orders` - Order processing
- `/api/v1/vendors` - Vendor management

Detailed API documentation will be available at `/api/docs` when the server is running.

## Deployment

For production deployment:

1. Build the project:

```bash
npm run build
```

2. Start the production server:

```bash
npm start
```

## License

This project is licensed under the MIT License. 