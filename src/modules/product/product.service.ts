import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product } from '../../schemas/product.schema';
import { CreateProductDto, ProductQueryDto, UpdateProductDto } from './product.dto';
import { StockMovement } from '../../schemas/stockMovement.schema';

@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<Product>,
    @InjectModel(StockMovement.name)
    private readonly stockMovementModel: Model<StockMovement>,
  ) {}

  private getPagination(page?: number, limit?: number) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    return { pageNum, limitNum, skip };
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  create(dto: CreateProductDto) {
    return this.productModel.create(dto);
  }

  async findAll(query: ProductQueryDto) {
    const { pageNum, limitNum, skip } = this.getPagination(query.page, query.limit);

    const filter: any = {};

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
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.productModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  }

  async findOne(id: string) {
    const product = await this.productModel.findById(id).lean().exec();
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.productModel.findByIdAndUpdate(id, dto, { new: true }).lean().exec();

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async remove(id: string) {
    const product = await this.productModel.findByIdAndDelete(id).exec();
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return { message: 'Product deleted successfully' };
  }

  async adjustStock(
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

      const product = await this.productModel.findById(productId).session(session);
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
}
