import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../guards/jwt-auth.guard';
import { CurrentUserId } from '../../decorators/current-user.decorator';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './payment.dto';

@Controller('payment')
@UseGuards(AuthGuard)
export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  @Post()
  recordPayment(@CurrentUserId() userId: string, @Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentService.recordPayment(userId, createPaymentDto);
  }
}
