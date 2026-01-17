import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<Product>,
    @InjectModel(Customer.name) private customerModel: Model<Customer>,
    @InjectModel(Order.name) private orderModel: Model<Order>,
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
      this.productModel.countDocuments({ isActive: true }),
      this.customerModel.countDocuments({ isActive: true }),
      this.orderModel.countDocuments(),
      this.productModel.find({
        isActive: true,
        $expr: { $lte: ['$quantityInStock', '$lowStockThreshold'] },
      }),
      this.orderModel.find({ status: OrderStatus.PENDING }).limit(10),
      this.customerModel.aggregate([
        {
          $group: {
            _id: null,
            totalReceivable: {
              $sum: { $cond: [{ $gt: ['$balance', 0] }, '$balance', 0] },
            },
            totalPayable: {
              $sum: { $cond: [{ $lt: ['$balance', 0] }, { $abs: '$balance' }, 0] },
            },
          },
        },
      ]),
    ]);

    return {
      metrics: {
        totalProducts,
        totalCustomers,
        totalOrders,
        ledger: {
          totalReceivable: ledgerSummary[0]?.totalReceivable || 0,
          totalPayable: ledgerSummary[0]?.totalPayable || 0,
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
          orderNumber: o.orderNumber,
          customerName: o.customerName,
          amount: o.finalAmount,
        })),
      },
    };
  }
}
