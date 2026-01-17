import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../guards/jwt-auth.guard';
import { OrderService } from './order.service';
import { CreateOrderDto, OrderQueryDto } from './order.dto';

@Controller('orders')
@UseGuards(AuthGuard)
export class OrderController {
  constructor(private orderService: OrderService) {}

  @Post()
  create(@Body() createOrderDto: CreateOrderDto) {
    return this.orderService.create(createOrderDto);
  }

  @Get()
  findAll(@Query() query: OrderQueryDto) {
    return this.orderService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orderService.findOne(id);
  }

  @Patch(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.orderService.confirmOrder(id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.orderService.cancelOrder(id);
  }
}
