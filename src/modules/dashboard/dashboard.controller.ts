import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { AuthGuard } from '../../guards/jwt-auth.guard';
import { DashboardRevenueTrendQueryDto } from './dashboard.dto';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('metrics')
  async getMetrics() {
    return this.dashboardService.getDashboardMetrics();
  }

  @Get('revenue-trend')
  async getRevenueTrend(@Query() query: DashboardRevenueTrendQueryDto) {
    return this.dashboardService.getRevenueTrend(query);
  }
}
