# Saiban - Medical Billing & Inventory System

A backend system for managing medical inventory, customer orders, and financial ledgers built with NestJS, TypeScript, and MongoDB.

## Features

- **Authentication**: JWT-based secure authentication with role-based access control
- **Dashboard Analytics**: Real-time metrics, alerts, and business insights
- **Stock Management**: Inventory control with automatic stock tracking and low stock alerts
- **Customer Management**: Customer data with financial tracking and running balances
- **Order Management**: Two-step order confirmation (create -> confirm) with multi-item support
- **Ledger System**: Double-entry accounting with transaction history
- **Payment Processing**: Multiple payment methods with automatic ledger updates

## Tech Stack

- **Framework**: NestJS 11
- **Language**: TypeScript 5
- **Database**: MongoDB Atlas (Mongoose ODM)
- **Authentication**: JWT
- **Validation**: class-validator & class-transformer
- **Process Manager**: PM2
- **Reverse Proxy**: Nginx with Let's Encrypt SSL
- **CI/CD**: GitHub Actions

## Project Structure

```
saiban-backend/
├── src/
│   ├── main.ts                  # Application entry point
│   ├── app.module.ts            # Root module
│   ├── modules/                 # Feature modules
│   │   ├── auth/                # Authentication (JWT login/register)
│   │   ├── customer/            # Customer CRUD and history
│   │   ├── dashboard/           # Metrics and analytics
│   │   ├── ledger/              # Double-entry ledger
│   │   ├── order/               # Order lifecycle
│   │   ├── payment/             # Payment recording
│   │   └── product/             # Product/inventory management
│   ├── schemas/                 # Mongoose schemas
│   ├── guards/                  # JWT auth guard
│   ├── decorators/              # Custom decorators
│   ├── common/                  # Shared filters, interceptors, utils
│   └── exceptions/              # Custom exception filters
├── ecosystem.config.js          # PM2 configuration (prod + staging)
├── .github/workflows/deploy.yml # CI/CD pipeline
├── .env                         # Environment variables (not committed)
├── .env.example                 # Environment variable template
├── tsconfig.json
├── nest-cli.json
└── package.json
```

---

## Local Development

### Prerequisites

- Node.js v18+ and npm
- MongoDB (local or Atlas connection string)
- Git

### Setup

```bash
git clone https://github.com/Muhammad-Nabeel-Asif/saiban-backend.git
cd saiban-backend
npm install
```

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/saiban-db
MONGODB_URI_PROD=mongodb+srv://user:password@cluster.mongodb.net/saiban-db
MONGODB_URI_STAGING=mongodb+srv://user:password@cluster.mongodb.net/saiban-db-staging
JWT_SECRET=your-secret-key
JWT_EXPIRATION=240h
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

### Run in Development

```bash
npm run start:dev
```

The API will be available at `http://localhost:3000/api`.

### Build

```bash
npm run build        # compiles TypeScript to dist/
```

### Code Formatting

```bash
npm run format:check # check formatting
npm run format       # auto-fix formatting
```

---

## Production Deployment

### Infrastructure

The app runs on **AWS EC2** (Ubuntu 24.04) with the following setup:

| Component | Details |
|---|---|
| Server | AWS EC2 with Elastic IP `51.21.139.213` |
| Node.js | v22 LTS (via NodeSource) |
| Process Manager | PM2 with `ecosystem.config.js` |
| Reverse Proxy | Nginx with SSL (Let's Encrypt, auto-renewing) |
| Database | MongoDB Atlas (cloud) |
| CI/CD | GitHub Actions (auto-deploy on push to `main`) |

### Environments

| Environment | Domain | Port | PM2 Name |
|---|---|---|---|
| Production | `https://backend.saiban.click` | 4000 | `saiban-production` |
| Staging | `https://staging.saiban.click` | 4001 | `saiban-staging` |

Both environments run on the same EC2 instance with separate MongoDB databases (configured via `MONGODB_URI_PROD` and `MONGODB_URI_STAGING` in `.env`). The `ecosystem.config.js` maps the correct database URI to each PM2 process.

### CI/CD Pipeline

Every push to the `main` branch triggers automatic deployment via GitHub Actions:

1. SSHs into EC2
2. Fetches and resets to the latest code
3. Installs dependencies and builds
4. Restarts PM2 processes

Required GitHub Secrets (Settings -> Secrets -> Actions):

| Secret | Value |
|---|---|
| `EC2_HOST` | EC2 Elastic IP |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | EC2 private key (`.pem` file contents) |

### Manual Deployment

SSH into the server and run:

```bash
ssh -i your-key.pem ubuntu@51.21.139.213

cd ~/saiban-backend
git pull origin main
npm install
npm run build
pm2 restart ecosystem.config.js
pm2 save
```

Or use the convenience scripts:

```bash
npm run deploy:prod     # build + restart production only
npm run deploy:staging  # build + restart staging only
npm run deploy:both     # install + build + restart all
```

---

## Logs & Monitoring

### Log File Locations

```
~/saiban-backend/logs/
├── production-out.log       # production stdout
├── production-error.log     # production errors
├── staging-out.log          # staging stdout
└── staging-error.log        # staging errors
```

PM2 log rotation is configured (10MB max per file, 7 files retained, compressed).

### Common Commands

```bash
# Live logs (Ctrl+C to stop)
pm2 logs                            # all apps
pm2 logs saiban-production          # production only
pm2 logs saiban-production --err    # errors only

# Recent logs
pm2 logs saiban-production --lines 100

# App status
pm2 status

# Real-time resource monitor
pm2 monit

# Search logs for something specific
grep "error" ~/saiban-backend/logs/production-error.log
grep "POST /api/orders" ~/saiban-backend/logs/production-out.log

# Quick health check (status + recent errors)
pm2 status && grep "$(date -d '1 day ago' +%Y-%m-%d)" ~/saiban-backend/logs/production-error.log 2>/dev/null | tail -20
```

### What Gets Logged

**Startup:**
```
[Bootstrap] Environment: production
[Bootstrap] Port: 4000
[Bootstrap] CORS Origins: https://backend.saiban.click, ...
```

**Requests:**
```
[HTTP] → POST /api/orders
[HTTP] Request Body: {"customerId":"123","items":[...]}
[HTTP] ← POST /api/orders 201 - 45ms
```

**Errors:**
```
[ExceptionFilter] POST /api/orders - 400 - "Insufficient stock for product X"
```

---

## Troubleshooting

### App not starting / port in use

```bash
pm2 status                    # check if apps are online
pm2 logs saiban-production --lines 50 --err   # check error logs
sudo ss -tlnp | grep 4000    # check what's using the port
```

### Database connection issues

```bash
# Check the MONGODB_URI being used
pm2 env <app-id> | grep MONGODB_URI

# Restart cleanly
pm2 delete saiban-production saiban-staging
pm2 start ecosystem.config.js
```

### Logs not showing

```bash
pm2 flush                     # clear all logs
pm2 restart saiban-production # restart the app
pm2 logs saiban-production    # watch fresh logs
```

### PM2 commands reference

```bash
pm2 status                    # list all apps
pm2 restart <name>            # restart an app
pm2 stop <name>               # stop an app
pm2 delete <name>             # remove from PM2
pm2 save                      # save current process list
pm2 startup                   # enable auto-start on boot
```