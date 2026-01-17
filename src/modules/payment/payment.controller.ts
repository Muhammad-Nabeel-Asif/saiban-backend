import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../guards/jwt-auth.guard';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './payment.dto';

@Controller('payment')
@UseGuards(AuthGuard)
export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  @Post()
  async recordPayment(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentService.recordPayment(createPaymentDto);
  }
}
