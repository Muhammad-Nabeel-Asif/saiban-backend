# PM2 Logging Setup Guide

## Problem
PM2 logs not showing when requests hit the server

## Solution Implemented

### 1. Enhanced NestJS Logging
- Added `LoggingInterceptor` to log all incoming requests and responses
- Added `AllExceptionsFilter` to log all errors with stack traces
- Configured Morgan to work with NestJS Logger
- All logs now use NestJS Logger which properly outputs to stdout/stderr

### 2. PM2 Configuration
The `ecosystem.config.js` has been configured for optimal logging:
- Separate error and output log files
- Timestamps enabled
- Logs merged for easier viewing

## How to Use

### Build and Deploy
```bash
# Build the application
npm run build

# Start with PM2
pm2 start ecosystem.config.js

# Or update if already running
pm2 reload ecosystem.config.js
```

### View Logs in Real-Time

```bash
# View all logs (stdout + stderr)
pm2 logs saiban-backend

# View only output logs
pm2 logs saiban-backend --out

# View only error logs
pm2 logs saiban-backend --err

# View logs with no limit (all history)
pm2 logs saiban-backend --lines 1000

# Clear all logs
pm2 flush

# View logs in JSON format
pm2 logs saiban-backend --json
```

### Monitor Application
```bash
# Real-time monitoring dashboard
pm2 monit

# Show application status
pm2 status

# Show detailed app info
pm2 info saiban-backend
```

### Log Files Location
Logs are stored in the `logs/` directory:
- `logs/saiban-backend-out.log` - Standard output
- `logs/saiban-backend-error.log` - Error output
- `logs/saiban-backend-combined.log` - Combined logs

### View Log Files Directly
```bash
# Tail output logs
tail -f logs/saiban-backend-out.log

# Tail error logs
tail -f logs/saiban-backend-error.log

# View last 100 lines
tail -n 100 logs/saiban-backend-combined.log
```

## What Gets Logged Now

### 1. Startup Logs
```
[Bootstrap] ==================================================
[Bootstrap] Environment: production
[Bootstrap] Port: 3000
[Bootstrap] CORS Origins: http://localhost:3000
[Bootstrap] ==================================================
[Bootstrap] 🚀 Application is running on: http://localhost:3000/api
[Bootstrap] 📝 Logging is enabled and working properly
```

### 2. Request Logs (via LoggingInterceptor)
```
[HTTP] → GET /api/products - ::1 - Mozilla/5.0...
[HTTP] ← GET /api/products 200 - 45ms
```

### 3. Request Body Logs (POST/PATCH/PUT)
```
[HTTP] Request Body: {"customerId":"123","items":[...]}
```

### 4. Error Logs
```
[ExceptionFilter] POST /api/orders - Status: 400
=== ERROR ===
Time: 2025-01-18T10:30:45.123Z
Method: POST
URL: /api/orders
Status: 400
Error: BadRequestException: Insufficient stock
=============
```

## Troubleshooting

### Issue: Still no logs showing

**Solution 1: Restart PM2 with log flush**
```bash
pm2 delete saiban-backend
pm2 flush
pm2 start ecosystem.config.js
pm2 logs saiban-backend
```

**Solution 2: Check PM2 is running as correct user**
```bash
pm2 list
# Ensure the app is running and status is "online"
```

**Solution 3: Disable log buffering**
```bash
# Add this to your .env or ecosystem.config.js
NODE_ENV=production
FORCE_COLOR=0
```

**Solution 4: Use pm2-runtime for debugging**
```bash
# Instead of pm2 start, use pm2-runtime (shows logs directly)
pm2-runtime start ecosystem.config.js
```

### Issue: Logs are delayed

**Solution: Use --raw flag**
```bash
pm2 logs saiban-backend --raw
```

### Issue: Too many logs

**Solution: Adjust log level in main.ts**
```typescript
// In main.ts, change logger levels
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  logger: ['error', 'warn', 'log'], // Remove 'debug' and 'verbose'
});
```

## Production Best Practices

1. **Log Rotation**: Install pm2-logrotate
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
```

2. **Monitor Logs Size**
```bash
du -sh logs/
```

3. **Clean Old Logs Periodically**
```bash
# Manual cleanup
pm2 flush

# Or setup a cron job
0 0 * * * pm2 flush
```

4. **Use Log Aggregation Services** (for production)
- PM2 Plus (paid)
- ELK Stack
- Datadog
- CloudWatch (AWS)
- Google Cloud Logging (GCP)

## Testing the Logging

### Test Request Logging
```bash
# Make a request to any endpoint
curl http://localhost:3000/api/products

# Check logs immediately
pm2 logs saiban-backend --lines 20
```

### Test Error Logging
```bash
# Make a request that will fail
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"invalid":"data"}'

# Check error logs
pm2 logs saiban-backend --err --lines 20
```

## Additional PM2 Commands

```bash
# Restart app
pm2 restart saiban-backend

# Reload app (zero-downtime)
pm2 reload saiban-backend

# Stop app
pm2 stop saiban-backend

# Delete app from PM2
pm2 delete saiban-backend

# Save PM2 process list
pm2 save

# Resurrect saved processes after reboot
pm2 resurrect

# Setup PM2 to start on system boot
pm2 startup
```
