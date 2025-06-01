# Redis Setup Guide for Yunike OTP Authentication

This guide will help you install and configure Redis for the Yunike OTP authentication system.

## Why Redis is Required

Redis is used for:
- Storing OTP codes with expiration
- Rate limiting authentication attempts
- Tracking blocked users
- Storing temporary registration data

## Installation Instructions

### Windows

1. **Option 1: Using the Windows Installer**
   - Download the MSI installer from [Redis for Windows](https://github.com/microsoftarchive/redis/releases)
   - Run the installer and follow the prompts
   - The service will start automatically

2. **Option 2: Using Chocolatey**
   - Install Chocolatey if you don't have it
   - Run in PowerShell as administrator:
     ```
     choco install redis-64
     ```

3. **Option 3: Using WSL (Windows Subsystem for Linux)**
   - Install WSL if you don't have it
   - Follow the Linux instructions below within WSL

### macOS

1. **Using Homebrew**
   ```
   brew install redis
   ```

2. **Start Redis**
   ```
   brew services start redis
   ```

### Linux (Ubuntu/Debian)

1. **Install Redis**
   ```
   sudo apt update
   sudo apt install redis-server
   ```

2. **Configure Redis to start on boot**
   ```
   sudo systemctl enable redis-server
   ```

3. **Start Redis**
   ```
   sudo systemctl start redis-server
   ```

### Docker

If you prefer using Docker:

```
docker run --name yunike-redis -p 6379:6379 -d redis
```

## Verifying Installation

1. **Run the provided check script**
   ```
   node server/scripts/checkRedis.js
   ```

2. **Test Redis CLI** (if installed locally)
   ```
   redis-cli ping
   ```
   Should return: `PONG`

## Configuration

By default, the application connects to Redis at `localhost:6379`. To use a custom Redis server:

1. **Set the REDIS_URL environment variable**
   - Add to your `.env` file:
     ```
     REDIS_URL=redis://username:password@your-redis-host:port
     ```

2. **For password-protected Redis:**
   ```
   REDIS_URL=redis://:your-password@localhost:6379
   ```

## Troubleshooting

### Connection Refused
- Ensure Redis is running: `redis-cli ping`
- Check firewall settings
- Verify correct port (default is 6379)

### Authentication Error
- Check if Redis requires authentication
- Verify the password in REDIS_URL is correct

### Memory Issues
- Redis is using too much memory - adjust maxmemory in redis.conf
- Set an appropriate eviction policy (e.g., volatile-lru)

## For Production

In production environments, consider:

1. Setting up Redis with password authentication
2. Using Redis in cluster mode for high availability
3. Implementing backup strategies
4. Monitoring Redis memory usage and performance

## Further Resources

- [Redis Documentation](https://redis.io/documentation)
- [Redis Security Guide](https://redis.io/topics/security)
- [Redis Configuration Options](https://redis.io/topics/config) 