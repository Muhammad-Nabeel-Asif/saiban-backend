import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { AuthGuard } from '../../guards/jwt-auth.guard';
import { CurrentUserId } from '../../decorators/current-user.decorator';
import { GetDateRangeReportDto } from './ledger.dto';

@Controller('ledger')
@UseGuards(AuthGuard)
export class LedgerController {
  constructor(private ledgerService: LedgerService) {}

  @Get('customer/:customerId/balance')
  async getCustomerBalance(
    @CurrentUserId() userId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.ledgerService.getCustomerBalance(userId, customerId);
  }

  @Get('customer/:customerId/entries')
  async getCustomerLedgerEntries(
    @CurrentUserId() userId: string,
    @Param('customerId') customerId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.ledgerService.getCustomerLedgerEntries(
      userId,
      customerId,
      page,
      limit,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('entries')
  async getAllLedgerEntries(
    @CurrentUserId() userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('customerId') customerId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.ledgerService.getAllLedgerEntries(
      userId,
      page,
      limit,
      customerId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('reports/date-range')
  async getDateRangeReport(
    @CurrentUserId() userId: string,
    @Query() { startDate, endDate }: GetDateRangeReportDto,
  ) {
    return this.ledgerService.getDateRangeReport(userId, new Date(startDate), new Date(endDate));
  }

  @Get('summary')
  async getLedgerSummary(@CurrentUserId() userId: string) {
    return this.ledgerService.getLedgerSummary(userId);
  }
}
