import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RevenueQueryDto } from '../payment/payment.dto';
import { LedgerService } from './ledger.service';
import { AuthGuard } from '../../guards/jwt-auth.guard';
import { GetDateRangeReportDto } from './ledger.dto';

@Controller('ledger')
@UseGuards(AuthGuard)
export class LedgerController {
  constructor(private ledgerService: LedgerService) {}

  @Get('customer/:customerId/balance')
  async getCustomerBalance(@Param('customerId') customerId: string) {
    return this.ledgerService.getCustomerBalance(customerId);
  }

  @Get('customer/:customerId/entries')
  async getCustomerLedgerEntries(
    @Param('customerId') customerId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.ledgerService.getCustomerLedgerEntries(
      customerId,
      page,
      limit,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('entries')
  async getAllLedgerEntries(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.ledgerService.getAllLedgerEntries(
      page,
      limit,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('reports/customer-wise')
  async getCustomerWiseReport(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.ledgerService.getCustomerWiseReport(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('reports/date-range')
  async getDateRangeReport(@Query() { startDate, endDate }: GetDateRangeReportDto) {
    return this.ledgerService.getDateRangeReport(new Date(startDate), new Date(endDate));
  }

  @Get('summary')
  async getLedgerSummary() {
    return this.ledgerService.getLedgerSummary();
  }

  @Get('revenue')
  async getRevenue(@Query() query: RevenueQueryDto) {
    return this.ledgerService.getRevenue(query);
  }
}
