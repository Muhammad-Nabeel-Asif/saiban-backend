import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from '../../schemas/product.schema';
import { StockMovement, StockMovementSchema } from '../../schemas/stockMovement.schema';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { Order, OrderSchema } from '../../schemas/order.schema';
import { ProductModule } from '../product/product.module';
import { CustomerModule } from '../customer/customer.module';
import { LedgerEntry, LedgerEntrySchema } from '../../schemas/ledgerEntry.schema';
import { Payment, PaymentSchema } from '../../schemas/payment.schema';
import { Customer, CustomerSchema } from '../../schemas/customer.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: Order.name, schema: OrderSchema },
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Customer.name, schema: CustomerSchema },
    ]),
    ProductModule,
    CustomerModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
