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
import { CreateCustomerDto, CustomerQueryDto, UpdateCustomerDto } from './customer.dto';
import { CustomerService } from './customer.service';
import { AuthGuard } from '../../guards/jwt-auth.guard';
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
  create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto);
  }

  @Get()
  findAll(@Query() query: CustomerQueryDto) {
    return this.customerService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    this.validateObjectId(id);
    return this.customerService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    this.validateObjectId(id);
    return this.customerService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    this.validateObjectId(id);
    return this.customerService.remove(id);
  }

  @Get(':id/orders')
  getOrders(@Param('id') id: string, @Query() query: CustomerQueryDto) {
    this.validateObjectId(id);
    return this.customerService.getOrderHistory(id, query.page, query.limit);
  }

  @Get(':id/transactions')
  getTransactions(@Param('id') id: string, @Query() query: CustomerQueryDto) {
    this.validateObjectId(id);
    return this.customerService.getTransactionHistory(id, query.page, query.limit);
  }

  @Get(':id/balance')
  async getBalance(@Param('id') id: string) {
    this.validateObjectId(id);
    const balance = await this.ledgerService.getCustomerBalance(id);
    return { customerId: id, balance };
  }

  private validateObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid customer id');
    }
  }
}
