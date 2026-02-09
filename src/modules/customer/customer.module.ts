import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { Customer, CustomerSchema } from '../../schemas/customer.schema';
import { Order, OrderSchema } from '../../schemas/order.schema';
import { LedgerEntry, LedgerEntrySchema } from '../../schemas/ledgerEntry.schema';
import { Payment, PaymentSchema } from '../../schemas/payment.schema';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Order.name, schema: OrderSchema },
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
    LedgerModule,
  ],
  controllers: [CustomerController],
  providers: [CustomerService],
  exports: [CustomerService],
})
export class CustomerModule {}
