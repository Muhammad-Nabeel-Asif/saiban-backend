import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product } from '../../schemas/product.schema';
import { Customer } from '../../schemas/customer.schema';
import { Order } from '../../schemas/order.schema';
import { OrderStatus } from '../../schemas/schema.types';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<Product>,
    @InjectModel(Customer.name) private customerModel: Model<Customer>,
    @InjectModel(Order.name) private orderModel: Model<Order>,
    private ledgerService: LedgerService,
  ) {}

  async getDashboardMetrics() {
    const [
      totalProducts,
      totalCustomers,
      totalOrders,
      lowStockProducts,
      pendingOrders,
      ledgerSummary,
    ] = await Promise.all([
      this.productModel.countDocuments(),
      this.customerModel.countDocuments(),
      this.orderModel.countDocuments(),
      this.productModel
        .find({
          $expr: { $lte: ['$quantityInStock', '$lowStockThreshold'] },
        })
        .limit(20),
      this.orderModel
        .find({ status: OrderStatus.PENDING })
        .populate('customerId', 'firstName lastName')
        .limit(10)
        .sort({ createdAt: -1 }),
      this.ledgerService.getLedgerSummary(),
    ]);

    return {
      metrics: {
        totalProducts,
        totalCustomers,
        totalOrders,
        ledger: {
          totalReceivable: ledgerSummary.totalReceivable,
          totalDebit: ledgerSummary.totalDebit,
          totalCredit: ledgerSummary.totalCredit,
        },
      },
      alerts: {
        lowStockProducts: lowStockProducts.map((p) => ({
          id: p._id,
          name: p.name,
          currentStock: p.quantityInStock,
          threshold: p.lowStockThreshold,
        })),
        pendingOrders: pendingOrders.map((o) => ({
          id: o._id,
          customerId: o.customerId,
          customerName: (o.customerId as any)?.firstName
            ? `${(o.customerId as any).firstName} ${(o.customerId as any).lastName}`
            : 'Unknown',
          amount: o.grandTotal,
          createdAt: (o as any).createdAt,
        })),
      },
    };
  }
}
