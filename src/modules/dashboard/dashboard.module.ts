import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from '../../schemas/product.schema';
import { Customer, CustomerSchema } from '../../schemas/customer.schema';
import { Order, OrderSchema } from '../../schemas/order.schema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    LedgerModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
