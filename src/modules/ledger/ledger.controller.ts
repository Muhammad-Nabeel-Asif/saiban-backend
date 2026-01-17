import { Controller, Get, Post, Body, Query, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller('ledger')
@UseGuards(JwtAuthGuard)
export class LedgerController {
  constructor(private ledgerService: LedgerService) {}

  @Get()
  async findAll(@Query() query: LedgerQueryDto) {
    return this.ledgerService.findAll(query);
  }

  @Get('customer/:customerId')
  async getCustomerLedger(@Param('customerId') customerId: string) {
    return this.ledgerService.getCustomerLedger(customerId);
  }

  @Get('report')
  async generateReport(@Query() query: LedgerQueryDto) {
    return this.ledgerService.generateReport(query);
  }
}
