import { IsNotEmpty } from 'class-validator';

export class GetDateRangeReportDto {
  @IsNotEmpty()
  startDate: Date;

  @IsNotEmpty()
  endDate: Date;
}
