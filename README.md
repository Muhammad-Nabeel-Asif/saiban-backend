# Saiban Medical Billing Inventory System

A comprehensive backend system for managing medical inventory, customer orders, and financial ledgers built with NestJS,
TypeScript, and MongoDB.

## Features

### Core Functionality

- **Authentication & Authorization**: JWT-based secure authentication with role-based access control
- **Dashboard Analytics**: Real-time metrics, alerts, and business insights
- **Stock Management**: Complete inventory control with automatic stock tracking
- **Customer Management**: Comprehensive customer data with financial tracking
- **Order Management**: Two-step order confirmation with multi-item support
- **Ledger System**: Double-entry accounting with transaction history
- **Payment Processing**: Multiple payment methods with automatic ledger updates

### Key Capabilities

- Automatic stock deduction on order confirmation
- Low stock threshold alerts
- Running customer balance tracking
- Order cancellation with stock restoration
- Transaction history and reporting
- Pagination and advanced filtering
- Soft delete functionality
- Invoice generation support

## Tech Stack

- **Framework**: NestJS 10.x
- **Language**: TypeScript 5.x
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (JSON Web Tokens)
- **Validation**: class-validator & class-transformer
- **Password Hashing**: bcrypt

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: v18.x or higher
- **npm**: v9.x or higher
- **MongoDB**: v6.x or higher (local or cloud instance)
- **Git**: Latest version

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/nabeel.asif362/saiban-backend.git
cd saiban-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Install Required Packages

```bash
npm install @nestjs/common @nestjs/core @nestjs/platform-express
npm install @nestjs/mongoose mongoose
npm install @nestjs/jwt @nestjs/passport passport passport-jwt
npm install @nestjs/config
npm install bcrypt
npm install class-validator class-transformer

# Dev Dependencies
npm install -D @types/node @types/bcrypt @types/passport-jwt
npm install -D typescript ts-node
```

## Configuration

### 1. Environment Variables

Create a `.env` file in the root directory:

```env
# Application
NODE_ENV=development
PORT=3000

# Database
MONGODB_URI=mongodb://localhost:27017/saiban-db
# Or for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/saiban-db

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRATION=24h

# Application Settings
LOW_STOCK_THRESHOLD=10
DEFAULT_PAGE_SIZE=10
```

### 2. MongoDB Setup

**MongoDB Atlas (Cloud):**

1. Create account at [mongodb.com](https://www.mongodb.com/cloud/atlas)
2. Create a cluster
3. Get connection string
4. Add to `.env` file

## 📚 API Documentation

### Base URL

```
http://localhost:3000/api
```

### Authentication

#### Register User

```http
POST /auth/register
Content-Type: application/json

{
  "email": "admin@saiban.com",
  "password": "securePassword123"
}
```

#### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "admin@saiban.com",
  "password": "securePassword123"
}

Response:
{
  "access_token": "jwt_token_here",
  "user": {
    "id": "user_id",
    "email": "admin@saiban.com",
    "role": "admin"
  }
}
```

### Dashboard

#### Get Dashboard Metrics

```http
GET /dashboard/metrics
Authorization: Bearer {token}

Response:
{
  "metrics": {
    "totalProducts": 150,
    "totalCustomers": 45,
    "totalOrders": 320,
    "ledger": {
      "totalReceivable": 125000,
      "totalPayable": 15000
    }
  },
  "alerts": {
    "lowStockProducts": [...],
    "pendingOrders": [...]
  }
}
```

### Products

#### Create Product

```http
POST /products
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Saiban Syrup 120ml",
  "shortDescription": "Pain relief syrup",
  "descriptionUrdu": "درد کی دوا",
  "category": "syrup",
  "packType": "ml",
  "size": 120,
  "unitPrice": 250,
  "quantityInStock": 100,
  "lowStockThreshold": 20
}
```

#### Get All Products (with pagination & filters)

```http
GET /products?page=1&limit=10&search=syrup&category=syrup&stockStatus=in_stock
Authorization: Bearer {token}

Response:
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 45,
    "pages": 5
  }
}
```

#### Get Single Product

```http
GET /products/:id
Authorization: Bearer {token}
```

#### Update Product

```http
PUT /products/:id
Authorization: Bearer {token}
Content-Type: application/json

{
  "unitPrice": 275,
  "quantityInStock": 150
}
```

#### Delete Product (Soft Delete)

```http
DELETE /products/:id
Authorization: Bearer {token}
```

### Customers

#### Create Customer

```http
POST /customers
Authorization: Bearer {token}
Content-Type: application/json

{
  "firstName": "Ahmed",
  "lastName": "Khan",
  "phoneNumber": "+92-300-1234567",
  "email": "ahmed@example.com",
  "streetAddress": "House 123, Street 5",
  "city": "Lahore",
  "state": "Punjab"
}
```

#### Get All Customers

```http
GET /customers?page=1&limit=10&search=ahmed
Authorization: Bearer {token}
```

#### Get Customer Details

```http
GET /customers/:id
Authorization: Bearer {token}
```

#### Get Customer Order History

```http
GET /customers/:id/orders?page=1&limit=10
Authorization: Bearer {token}
```

#### Get Customer Transaction History

```http
GET /customers/:id/transactions?page=1&limit=10
Authorization: Bearer {token}
```

#### Update Customer

```http
PUT /customers/:id
Authorization: Bearer {token}
Content-Type: application/json

{
  "phoneNumber": "+92-300-9876543",
  "city": "Karachi"
}
```

#### Delete Customer

```http
DELETE /customers/:id
Authorization: Bearer {token}
```

### Orders

#### Create Order (Step 1)

```http
POST /orders
Authorization: Bearer {token}
Content-Type: application/json

{
  "customerId": "customer_id_here",
  "items": [
    {
      "productId": "product_id_1",
      "quantity": 5,
      "discountPercentage": 10
    },
    {
      "productId": "product_id_2",
      "quantity": 3,
      "discountPercentage": 0
    }
  ],
  "paymentMethod": "cash",
  "paymentReference": "RECEIPT-001",
  "notes": "Urgent delivery"
}

Response:
{
  "order": {...},
  "message": "Order created successfully. Please confirm to complete."
}
```

#### Confirm Order (Step 2)

```http
POST /orders/:id/confirm
Authorization: Bearer {token}

Response:
{
  "order": {...},
  "message": "Order confirmed successfully"
}
```

#### Get All Orders

```http
GET /orders?page=1&limit=10&search=ORD-123&status=completed&customerId=xyz
Authorization: Bearer {token}
```

#### Get Single Order

```http
GET /orders/:id
Authorization: Bearer {token}
```

#### Update Order Status

```http
PUT /orders/:id/status
Authorization: Bearer {token}
Content-Type: application/json

{
  "status": "cancelled"
}
```

#### Get Order Invoice

```http
GET /orders/:id/invoice
Authorization: Bearer {token}
```

### Ledger

#### Get All Ledger Entries

```http
GET /ledger?customerId=xyz&startDate=2024-01-01&endDate=2024-12-31&page=1&limit=10
Authorization: Bearer {token}
```

#### Get Customer Ledger

```http
GET /ledger/customer/:customerId
Authorization: Bearer {token}

Response:
{
  "customer": {
    "id": "customer_id",
    "name": "Ahmed Khan",
    "currentBalance": 15000
  },
  "entries": [...]
}
```

#### Generate Ledger Report

```http
GET /ledger/report?customerId=xyz&startDate=2024-01-01&endDate=2024-12-31
Authorization: Bearer {token}
```

### Payments

#### Record Payment

```http
POST /payments
Authorization: Bearer {token}
Content-Type: application/json

{
  "customerId": "customer_id_here",
  "amount": 5000,
  "paymentMethod": "bank_transfer",
  "reference": "TXN-123456",
  "notes": "Partial payment"
}

Response:
{
  "payment": {...},
  "updatedBalance": 10000,
  "message": "Payment recorded successfully"
}
```

## Project Structure

```
saiban-medical-billing/
├── src/
│   ├── schemas/              # Mongoose schemas
│   │   ├── user.schema.ts
│   │   ├── product.schema.ts
│   │   ├── customer.schema.ts
│   │   ├── order.schema.ts
│   │   ├── ledgerEntry.schema.ts
│   │   └── payment.schema.ts
│   ├── dto/                  # Data Transfer Objects
│   │   ├── auth.dto.ts
│   │   ├── product.dto.ts
│   │   ├── customer.dto.ts
│   │   ├── order.dto.ts
│   │   └── payment.dto.ts
│   ├── services/             # Business logic
│   │   ├── auth.service.ts
│   │   ├── dashboard.service.ts
│   │   ├── product.service.ts
│   │   ├── customer.service.ts
│   │   ├── order.service.ts
│   │   ├── ledger.service.ts
│   │   └── payment.service.ts
│   ├── controllers/          # API endpoints
│   │   ├── auth.controller.ts
│   │   ├── dashboard.controller.ts
│   │   ├── products.controller.ts
│   │   ├── customers.controller.ts
│   │   ├── orders.controller.ts
│   │   ├── ledger.controller.ts
│   │   └── payments.controller.ts
│   ├── guards/               # Auth guards
│   │   └── jwt-auth.guard.ts
│   ├── app.module.ts         # Root module
│   └── main.ts               # Application entry point
├── .env                      # Environment variables
├── .env.example              # Environment template
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Usage Examples

### Complete Order Flow

```typescript
// 1. Create a customer
const customer = await fetch('http://localhost:3000/api/customers', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer YOUR_TOKEN',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        firstName: 'Ali',
        lastName: 'Hassan',
        phoneNumber: '+92-300-1234567'
    })
});

// 2. Create products
const product1 = await createProduct({
    name: 'Saiban Syrup 120ml',
    category: 'syrup',
    unitPrice: 250,
    quantityInStock: 100
});

// 3. Create order
const order = await fetch('http://localhost:3000/api/orders', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer YOUR_TOKEN',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        customerId: customer.id,
        items: [
            {productId: product1.id, quantity: 5, discountPercentage: 10}
        ],
        paymentMethod: 'on_account'
    })
});

// 4. Confirm order (this deducts stock and creates ledger entries)
await fetch(`http://localhost:3000/api/orders/${order.id}/confirm`, {
    method: 'POST',
    headers: {'Authorization': 'Bearer YOUR_TOKEN'}
});

// 5. Record payment later
await fetch('http://localhost:3000/api/payments', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer YOUR_TOKEN',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        customerId: customer.id,
        amount: 1125, // (250 * 5) - 10% discount
        paymentMethod: 'cash',
        reference: 'CASH-001'
    })
});
```

## Business Logic

### Order Confirmation Flow

1. **Create Order**: Validates products and calculates totals, creates order in PENDING status
2. **Confirm Order**:
    - Deducts stock from inventory
    - Changes status to COMPLETED
    - Creates debit ledger entry (increases customer balance)
    - If payment method is not "on_account", creates credit ledger entry

### Stock Management

- Stock is only deducted after order confirmation
- Prevents negative stock
- Automatic low stock alerts when quantity ≤ threshold
- Order cancellation restores stock

### Ledger System

- **Debit Entry**: Created when order is confirmed (customer owes money)
- **Credit Entry**: Created when payment is received (customer pays money)
- **Balance Calculation**: Balance = Previous Balance + Debits - Credits
- Positive balance = Amount receivable from customer
- Negative balance = Amount payable to customer

### Payment Methods

- **on_account**: Payment due later (creates only debit entry)
- **cash/jazzcash/bank_transfer/card/other**: Immediate payment (creates both debit and credit entries)

## Development

### Running the Application

```bash
# Development mode with hot-reload
npm run start:dev

# Production mode
npm run build
npm run start:prod

# Debug mode
npm run start:debug
```

### Code Quality

```bash
# Format
npm run format:check && npm run format
```

## 🚀 Deployment

### Production Build

```bash
npm run build
```

### Environment Variables for Production

```env
NODE_ENV=production
PORT=3000
MONGODB_URI=your_production_mongodb_uri
JWT_SECRET=your_very_secure_production_secret
```

### Docker Deployment (Optional)

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["node", "dist/main"]
```

Build and run:

```bash
docker build -t saiban-medical .
docker run -p 3000:3000 --env-file .env saiban-medical
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## 📝 License

This project is licensed under the MIT License.

## 👥 Authors

- **Your Name** - *Initial work*

## 🙏 Acknowledgments

- NestJS Team for the excellent framework
- MongoDB for the flexible database solution
- All contributors and testers

## 📞 Support

For support, email support@saiban.com or open an issue in the repository.

---

**Made with ❤️ for Saiban Medical**