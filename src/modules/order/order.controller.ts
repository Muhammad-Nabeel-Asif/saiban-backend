import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../guards/jwt-auth.guard';
import { CurrentUserId } from '../../decorators/current-user.decorator';
import { OrderService } from './order.service';
import { CreateOrderDto, OrderQueryDto } from './order.dto';

@Controller('orders')
@UseGuards(AuthGuard)
export class OrderController {
  constructor(private orderService: OrderService) {}

  @Post()
  create(@CurrentUserId() userId: string, @Body() createOrderDto: CreateOrderDto) {
    return this.orderService.create(userId, createOrderDto);
  }

  @Get()
  findAll(@CurrentUserId() userId: string, @Query() query: OrderQueryDto) {
    return this.orderService.findAll(userId, query);
  }

  @Get(':id')
  findOne(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.orderService.findOne(userId, id);
  }

  @Patch(':id/confirm')
  confirm(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.orderService.confirmOrder(userId, id);
  }

  @Patch(':id/cancel')
  cancel(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.orderService.cancelOrder(userId, id);
  }

  @Patch(':id/return')
  returnOrder(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.orderService.returnOrder(userId, id);
  }

  @Post('backfill-invoice-numbers')
  backfillInvoiceNumbers(@CurrentUserId() userId: string) {
    return this.orderService.backfillInvoiceNumbers(userId);
  }
}
