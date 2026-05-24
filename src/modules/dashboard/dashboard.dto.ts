import { IsIn, IsOptional, IsString } from 'class-validator';

export const DASHBOARD_REVENUE_RANGES = ['7d', '14d', '30d', '90d'] as const;

export type DashboardRevenueRange = (typeof DASHBOARD_REVENUE_RANGES)[number];

export class DashboardRevenueTrendQueryDto {
  @IsIn(DASHBOARD_REVENUE_RANGES)
  range: DashboardRevenueRange;

  @IsOptional()
  @IsString()
  timezone?: string;
}
