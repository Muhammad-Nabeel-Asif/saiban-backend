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
import {
  BalanceAdjustmentDto,
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from './customer.dto';
import { CustomerService } from './customer.service';
import { AuthGuard } from '../../guards/jwt-auth.guard';
import { CurrentUserId } from '../../decorators/current-user.decorator';
import { Types } from 'mongoose';
import { LedgerService } from '../ledger/ledger.service';

@Controller('customers')
@UseGuards(AuthGuard)
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly ledgerService: LedgerService,
  ) {}

  @Post()
  create(@CurrentUserId() userId: string, @Body() dto: CreateCustomerDto) {
    return this.customerService.create(userId, dto);
  }

  @Get()
  findAll(@CurrentUserId() userId: string, @Query() query: CustomerQueryDto) {
    return this.customerService.findAll(userId, query);
  }

  @Get(':id')
  findOne(@CurrentUserId() userId: string, @Param('id') id: string) {
    this.validateObjectId(id);
    return this.customerService.findOne(userId, id);
  }

  @Patch(':id')
  update(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    this.validateObjectId(id);
    return this.customerService.update(userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUserId() userId: string, @Param('id') id: string) {
    this.validateObjectId(id);
    return this.customerService.remove(userId, id);
  }

  @Post(':id/balance-adjustments')
  adjustBalance(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: BalanceAdjustmentDto) {
    this.validateObjectId(id);
    return this.customerService.adjustBalance(userId, id, dto);
  }

  @Get(':id/orders')
  getOrders(@CurrentUserId() userId: string, @Param('id') id: string, @Query() query: CustomerQueryDto) {
    this.validateObjectId(id);
    return this.customerService.getOrderHistory(userId, id, query.page, query.limit);
  }

  @Get(':id/transactions')
  getTransactions(@CurrentUserId() userId: string, @Param('id') id: string, @Query() query: CustomerQueryDto) {
    this.validateObjectId(id);
    return this.customerService.getTransactionHistory(userId, id, query.page, query.limit);
  }

  @Get(':id/balance')
  async getBalance(@CurrentUserId() userId: string, @Param('id') id: string) {
    this.validateObjectId(id);
    const balance = await this.ledgerService.getCustomerBalance(userId, id);
    return { customerId: id, balance };
  }

  private validateObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid customer id');
    }
  }
}
