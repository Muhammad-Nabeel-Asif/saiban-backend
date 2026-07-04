import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const DASHBOARD_REVENUE_RANGES = ['7d', '14d', '30d', '90d'] as const;

export type DashboardRevenueRange = (typeof DASHBOARD_REVENUE_RANGES)[number];

export class DashboardRevenueTrendQueryDto {
  @IsIn(DASHBOARD_REVENUE_RANGES)
  range: DashboardRevenueRange;

  @IsOptional()
  @IsString()
  timezone?: string;
}

export const DASHBOARD_TOP_PRODUCT_METRICS = ['profit', 'margin', 'revenue'] as const;

export type DashboardTopProductMetric = (typeof DASHBOARD_TOP_PRODUCT_METRICS)[number];

export class DashboardTopProductsQueryDto {
  @IsOptional()
  @IsIn(DASHBOARD_TOP_PRODUCT_METRICS)
  metric: DashboardTopProductMetric = 'profit';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 5;
}
