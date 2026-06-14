import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product } from '../../schemas/product.schema';
import { CreateProductDto, ProductQueryDto, UpdateProductDto } from './product.dto';
import { StockMovement } from '../../schemas/stockMovement.schema';
import { roundMoney } from '../../common/utils/money.util';
import { userScopeFilter } from '../../common/utils/user-scope.util';

const PRODUCT_NEWLY_INCLUDED_FIELDS = ['batchNo', 'expiry', 'mfg'] as const;

/** Case-insensitive alphabetical sort for product names (MongoDB collation). */
const NAME_SORT_COLLATION = { locale: 'en', strength: 2 } as const;

@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<Product>,
    @InjectModel(StockMovement.name)
    private readonly stockMovementModel: Model<StockMovement>,
  ) {}

  /** Ensures API responses always include batch/expiry/mfg keys (empty string when unset in DB). */
  private withProductNewFields(doc: object): Record<string, unknown> {
    const out = { ...doc } as Record<string, unknown>;
    for (const key of PRODUCT_NEWLY_INCLUDED_FIELDS) {
      if (out[key] === undefined) {
        out[key] = '';
      }
    }
    return out;
  }

  private getPagination(page?: number, limit?: number) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    return { pageNum, limitNum, skip };
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async create(userId: string, dto: CreateProductDto) {
    const payload = { ...dto, unitPrice: roundMoney(dto.unitPrice), ...userScopeFilter(userId) };
    const created = await this.productModel.create(payload);
    return this.withProductNewFields(created.toObject());
  }

  async findAll(userId: string, query: ProductQueryDto) {
    const { pageNum, limitNum, skip } = this.getPagination(query.page, query.limit);

    const filter: any = { ...userScopeFilter(userId) };

    if (query.search) {
      filter.name = {
        $regex: this.escapeRegex(query.search),
        $options: 'i',
      };
    }

    if (query.category) {
      filter.category = query.category;
    }

    if (query.stockStatus) {
      switch (query.stockStatus) {
        case 'out_of_stock':
          filter.quantityInStock = 0;
          break;

        case 'low_stock':
          filter.$expr = {
            $and: [
              { $gt: ['$quantityInStock', 0] },
              { $lte: ['$quantityInStock', '$lowStockThreshold'] },
            ],
          };
          break;

        case 'in_stock':
          filter.$expr = {
            $gt: ['$quantityInStock', '$lowStockThreshold'],
          };
          break;
      }
    }

    const [data, total] = await Promise.all([
      this.productModel
        .find(filter)
        .collation(NAME_SORT_COLLATION)
        .skip(skip)
        .limit(limitNum)
        .sort({ name: 1 })
        .lean()
        .exec(),
      this.productModel.countDocuments(filter).exec(),
    ]);

    return {
      data: data.map((p) => this.withProductNewFields(p)),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  }

  async findOne(userId: string, id: string) {
    const product = await this.productModel
      .findOne({ _id: id, ...userScopeFilter(userId) })
      .lean()
      .exec();
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return this.withProductNewFields(product);
  }

  async update(userId: string, id: string, dto: UpdateProductDto) {
    const payload = { ...dto } as UpdateProductDto;
    if (payload.unitPrice !== undefined) {
      payload.unitPrice = roundMoney(payload.unitPrice);
    }

    const product = await this.productModel
      .findOneAndUpdate({ _id: id, ...userScopeFilter(userId) }, payload, { returnDocument: 'after' })
      .lean()
      .exec();

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.withProductNewFields(product);
  }

  async remove(userId: string, id: string) {
    const product = await this.productModel.findOneAndDelete({ _id: id, ...userScopeFilter(userId) }).exec();
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return { message: 'Product deleted successfully' };
  }

  async adjustStock(
    userId: string,
    productId: string,
    quantityChange: number,
    reason: 'order' | 'adjustment' | 'return',
    referenceId?: string,
  ) {
    if (!Number.isInteger(quantityChange) || quantityChange === 0) {
      throw new BadRequestException('quantityChange must be a non-zero integer');
    }

    const session = await this.productModel.db.startSession();
    try {
      session.startTransaction();

      const product = await this.productModel
        .findOne({ _id: productId, ...userScopeFilter(userId) })
        .session(session);
      if (!product) throw new NotFoundException('Product not found');

      const newStock = (product.quantityInStock || 0) + quantityChange;
      if (newStock < 0) {
        throw new BadRequestException('Insufficient stock');
      }

      await this.stockMovementModel.create(
        [
          {
            productId: product._id,
            quantityChange,
            reason,
            referenceId,
          },
        ],
        { session },
      );

      product.quantityInStock = newStock;
      await product.save({ session });

      await session.commitTransaction();

      return {
        productId: product._id,
        previousStock: newStock - quantityChange,
        newStock,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async getAllStock(userId: string): Promise<{ productId: string; stock: number }[]> {
    const userProducts = await this.productModel.find(userScopeFilter(userId)).select('_id').lean().exec();
    const productIds = userProducts.map((p) => p._id);

    if (productIds.length === 0) {
      return [];
    }

    const result = await this.stockMovementModel.aggregate([
      { $match: { productId: { $in: productIds } } },
      {
        $group: {
          _id: '$productId',
          stock: { $sum: '$quantityChange' },
        },
      },
      { $project: { _id: 0, productId: '$_id', stock: 1 } },
    ]);

    return result;
  }

  async getProductStock(userId: string, productId: string): Promise<number> {
    const product = await this.productModel.findOne({ _id: productId, ...userScopeFilter(userId) }).lean().exec();
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const result = await this.stockMovementModel.aggregate([
      { $match: { productId: new Types.ObjectId(productId) } },
      { $group: { _id: null, stock: { $sum: '$quantityChange' } } },
    ]);

    return result.length ? result[0].stock : 0;
  }
}
