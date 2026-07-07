import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { BalanceDirection } from '../../schemas/schema.types';

/** GET /customers list ordering. Omit or `name` = A–Z; `recent` = newest created first (e.g. dashboard). */
export enum CustomerSort {
  Name = 'name',
  Recent = 'recent',
}

class CustomerProfileDto {
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => value?.toLowerCase())
  email?: string;

  @IsOptional()
  @IsString()
  streetAddress?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  note?: string;
}

export class BalanceAdjustmentDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsEnum(BalanceDirection)
  direction: BalanceDirection;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateCustomerDto extends CustomerProfileDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BalanceAdjustmentDto)
  balanceAdjustment?: BalanceAdjustmentDto;
}

export class UpdateCustomerDto extends PartialType(CustomerProfileDto) {}

export class CustomerQueryDto {
  @IsOptional()
  page?: number = 1;

  @IsOptional()
  limit?: number = 10;

  @IsOptional()
  search?: string;

  @IsOptional()
  @IsEnum(CustomerSort)
  sort?: CustomerSort;
}
