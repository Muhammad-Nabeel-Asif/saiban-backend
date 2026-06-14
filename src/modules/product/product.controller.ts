import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto, ProductQueryDto, UpdateProductDto } from './product.dto';
import { AuthGuard } from '../../guards/jwt-auth.guard';
import { CurrentUserId } from '../../decorators/current-user.decorator';
import { Types } from 'mongoose';

@Controller('products')
@UseGuards(AuthGuard)
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  create(@CurrentUserId() userId: string, @Body() dto: CreateProductDto) {
    return this.productService.create(userId, dto);
  }

  @Get()
  findAll(@CurrentUserId() userId: string, @Query() query: ProductQueryDto) {
    return this.productService.findAll(userId, query);
  }

  @Get(':id')
  findOne(@CurrentUserId() userId: string, @Param('id') id: string) {
    this.validateObjectId(id);
    return this.productService.findOne(userId, id);
  }

  @Patch(':id')
  update(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    this.validateObjectId(id);
    return this.productService.update(userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUserId() userId: string, @Param('id') id: string) {
    this.validateObjectId(id);
    return this.productService.remove(userId, id);
  }

  private validateObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid product id');
    }
  }
}
