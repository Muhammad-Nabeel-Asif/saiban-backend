import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { AuthGuard } from '../../guards/jwt-auth.guard';
import { CurrentUserId } from '../../decorators/current-user.decorator';
import { DashboardRevenueTrendQueryDto, DashboardTopProductsQueryDto } from './dashboard.dto';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('metrics')
  async getMetrics(@CurrentUserId() userId: string) {
    return this.dashboardService.getDashboardMetrics(userId);
  }

  @Get('revenue-trend')
  async getRevenueTrend(
    @CurrentUserId() userId: string,
    @Query() query: DashboardRevenueTrendQueryDto,
  ) {
    return this.dashboardService.getRevenueTrend(userId, query);
  }

  @Get('top-products')
  async getTopProducts(
    @CurrentUserId() userId: string,
    @Query() query: DashboardTopProductsQueryDto,
  ) {
    return this.dashboardService.getTopProducts(userId, query);
  }
}
