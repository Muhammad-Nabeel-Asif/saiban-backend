import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../../schemas/schema.types';

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsEnum(PaymentMethod)
  @IsNotEmpty()
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsString()
  note?: string;
}
