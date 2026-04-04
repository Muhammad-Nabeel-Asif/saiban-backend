import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { AuthGuard } from '../../guards/jwt-auth.guard';
import { GetDateRangeReportDto } from './ledger.dto';
import type { Response } from 'express';

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
    @Res({ passthrough: true }) res?: Response,
  ) {
    // #region agent log
    res?.setHeader('X-Ledger-Entries-Filter-Version', 'valid-customer-filter-v1');
    res?.setHeader('X-Ledger-Entries-Node-Env', process.env.NODE_ENV || 'unknown');
    // #endregion
    return this.ledgerService.getAllLedgerEntries(
      page,
      limit,
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
}
