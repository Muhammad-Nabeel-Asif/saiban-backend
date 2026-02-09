# Multi-Environment Setup Guide

This guide explains how to run **Production** and **Staging** environments simultaneously on the same server.

## Quick Start (TL;DR)

```bash
# 1. Update your .env file
echo "MONGODB_URI_PROD=mongodb://localhost:27017/saiban-prod" >> .env
echo "MONGODB_URI_STAGING=mongodb://localhost:27017/saiban-staging" >> .env

# 2. Open firewall ports
sudo ufw allow 3000
sudo ufw allow 3001

# 3. Build and start both environments
npm run build
pm2 start ecosystem.config.js

# 4. Verify both are running
pm2 status
pm2 logs --lines 20

# Done! Production on :3000, Staging on :3001
```

## Architecture

```
┌─────────────────────────────────────────────┐
│                 SERVER                       │
├─────────────────────────────────────────────┤
│                                              │
│  Production (Port 3000)                      │
│  ├─ Database: saiban-prod                    │
│  ├─ Stable code for client                   │
│  └─ Cluster mode (multiple instances)        │
│                                              │
│  Staging (Port 3001)                         │
│  ├─ Database: saiban-staging                 │
│  ├─ Testing/development                      │
│  └─ Single instance (easier debugging)       │
│                                              │
└─────────────────────────────────────────────┘
```

## Setup Instructions

### 1. Environment Variables

The `ecosystem.config.js` automatically loads your `.env` file using `dotenv`. Each PM2 app instance reads different database URLs but sets them as `MONGODB_URI` (which `app.module.ts` expects).

Create/update your `.env` file:

```bash
# Production Database
MONGODB_URI_PROD=mongodb://localhost:27017/saiban-prod

# Staging Database
MONGODB_URI_STAGING=mongodb://localhost:27017/saiban-staging

# Or use MongoDB Atlas (recommended for cloud deployment)
# MONGODB_URI_PROD=mongodb+srv://user:password@cluster.mongodb.net/saiban-prod?retryWrites=true&w=majority
# MONGODB_URI_STAGING=mongodb+srv://user:password@cluster.mongodb.net/saiban-staging?retryWrites=true&w=majority

# Shared variables (both environments use these)
JWT_SECRET=your-super-secret-jwt-key-change-this
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

**How it works:**
- Production reads `MONGODB_URI_PROD` from `.env` and sets it as `MONGODB_URI` for the app
- Staging reads `MONGODB_URI_STAGING` from `.env` and sets it as `MONGODB_URI` for the app
- Your `app.module.ts` reads `MONGODB_URI` (works for both!)

### 2. Verify Configuration

Before starting, make sure:
- `.env` file exists with both `MONGODB_URI_PROD` and `MONGODB_URI_STAGING`
- MongoDB is running (if using local database)
- Ports 3000 and 3001 are available

```bash
# Check if MongoDB is running (local setup)
sudo systemctl status mongod

# Or start MongoDB if needed
sudo systemctl start mongod
```

### 3. PM2 Commands

#### Start Both Environments
```bash
# Build the application
npm run build

# Start both production and staging
pm2 start ecosystem.config.js

# Verify they're running on correct databases
pm2 logs --lines 30
```

#### Start Only Production
```bash
pm2 start ecosystem.config.js --only saiban-production
```

#### Start Only Staging
```bash
pm2 start ecosystem.config.js --only saiban-staging
```

#### Restart Production (after deploying updates)
```bash
npm run build
pm2 restart saiban-production
```

#### Restart Staging (after testing new features)
```bash
npm run build
pm2 restart saiban-staging
```

#### View Logs
```bash
# Production logs
pm2 logs saiban-production

# Staging logs
pm2 logs saiban-staging

# All logs
pm2 logs
```

#### Monitor Both
```bash
pm2 monit
```

#### Stop an environment
```bash
pm2 stop saiban-staging
pm2 stop saiban-production
```

### 4. Frontend Configuration

Update your frontend to point to the correct backend:

**Production Frontend** (for client):
```javascript
// Without Nginx (direct port access)
const API_URL = 'http://your-server-ip:3000/api';
// or if you have a domain
const API_URL = 'http://your-domain.com:3000/api';

// With Nginx (recommended)
const API_URL = 'https://api.your-domain.com/api';
```

**Development Frontend** (for testing):
```javascript
// Without Nginx (direct port access)
const API_URL = 'http://your-server-ip:3001/api';
// or if you have a domain
const API_URL = 'http://your-domain.com:3001/api';

// With Nginx (recommended)
const API_URL = 'https://staging-api.your-domain.com/api';
```

**Important:** Make sure ports 3000 and 3001 are open in your firewall:
```bash
# Ubuntu/Debian with ufw
sudo ufw allow 3000
sudo ufw allow 3001
sudo ufw status

# Or check your cloud provider's security group settings
```

### 5. Nginx Reverse Proxy (Optional but Recommended)

Set up Nginx to route requests:

```nginx
# Production API
server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Staging API
server {
    listen 80;
    server_name staging-api.your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Workflow

### For Production (Client-facing)
1. Test features thoroughly in staging
2. Merge code to `main` branch
3. Deploy to production:
   ```bash
   git pull origin main
   npm install
   npm run build
   pm2 restart saiban-production
   ```

### For Staging (Testing/Development)
1. Push new features/fixes
2. Deploy to staging:
   ```bash
   git pull origin main  # or your dev branch
   npm install
   npm run build
   pm2 restart saiban-staging
   ```
3. Frontend dev tests against staging
4. Once verified, deploy to production

## Database Management

### Initial Setup

When you first start, both databases will be empty. You need to:

**Option 1: Start fresh with both**
- Let both create empty databases
- Add test data to staging manually
- Add real data to production when ready

**Option 2: Copy existing data to production**
If you have existing data in your current database:
```bash
# Assuming your current database is named 'saiban'
# Copy to production
mongodump --uri="mongodb://localhost:27017/saiban" --out=./backup
mongorestore --uri="mongodb://localhost:27017/saiban-prod" ./backup/saiban

# Create empty staging database
# It will be created automatically when staging app starts
```

### Seed Staging with Production Data (Optional)
```bash
# Export from production
mongodump --uri="mongodb://localhost:27017/saiban-prod" --out=./backup

# Import to staging
mongorestore --uri="mongodb://localhost:27017/saiban-staging" ./backup/saiban-prod
```

### Keep Staging Separate (Recommended)
- Use test data in staging
- Prevents accidental changes to production data
- Faster testing without real customer data

## Monitoring

### Check Status
```bash
pm2 status
```

### Check Resource Usage
```bash
pm2 monit
```

### Auto-start on Server Reboot
```bash
pm2 startup
pm2 save
```

## Troubleshooting

### Port Already in Use
```bash
# Find process using port
lsof -i :3000
lsof -i :3001

# Kill if needed
kill -9 <PID>

# Or stop PM2 apps
pm2 stop all
```

### Database Connection Issues

**Check MongoDB is running:**
```bash
sudo systemctl status mongod

# Start if not running
sudo systemctl start mongod

# Enable auto-start on boot
sudo systemctl enable mongod
```

**Verify connection strings:**
```bash
# Check your .env file has correct values
cat .env | grep MONGODB_URI

# Test connection manually
mongosh mongodb://localhost:27017/saiban-prod
mongosh mongodb://localhost:27017/saiban-staging
```

**Check PM2 logs for connection errors:**
```bash
pm2 logs saiban-production --lines 50
pm2 logs saiban-staging --lines 50
```

### Apps not using correct databases

**Verify environment variables are loaded:**
```bash
# Check what environment variables PM2 apps see
pm2 env 0  # Production (first app)
pm2 env 1  # Staging (second app)

# Should show different MONGODB_URI for each
```

**If databases are not different:**
1. Make sure `.env` file has both `MONGODB_URI_PROD` and `MONGODB_URI_STAGING`
2. Restart PM2 completely:
   ```bash
   pm2 delete all
   pm2 start ecosystem.config.js
   ```

### Firewall blocking ports

**Ubuntu/Debian:**
```bash
sudo ufw allow 3000
sudo ufw allow 3001
sudo ufw reload
```

**CentOS/RHEL:**
```bash
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --reload
```

**Cloud Providers:**
- AWS: Add inbound rules to Security Group for ports 3000, 3001
- DigitalOcean: Configure Cloud Firewalls
- Azure: Configure Network Security Group

### Memory Issues
- Staging uses less memory (500M vs 1G)
- Adjust in `ecosystem.config.js` if needed

## Benefits of This Setup

✅ **Isolated Testing** - Test without affecting production
✅ **Same Codebase** - No need to maintain separate repos
✅ **Easy Deployment** - One command to deploy either environment
✅ **Separate Databases** - Production data stays safe
✅ **Independent Scaling** - Production can use cluster mode
✅ **Better Debugging** - Staging runs in single instance mode

## Alternative: Use Git Branches

If you prefer branch-based deployments:

```bash
# Production always from main
git checkout main
pm2 restart saiban-production

# Staging from develop branch
git checkout develop
pm2 restart saiban-staging
```

This requires checking out different branches before restarting each environment.
