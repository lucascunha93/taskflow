import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { BillingService } from './billing.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string };
}

export class StartCheckoutDto {
  /** Apenas planos pagos passam pelo checkout; o Gratuito usa o cancelamento. */
  @IsIn(['PRO', 'BUSINESS'])
  plan!: 'PRO' | 'BUSINESS';
}

export class CompleteCheckoutDto {
  @IsIn(['approve', 'decline'])
  outcome!: 'approve' | 'decline';
}

@Controller()
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('organizations/:organizationId/billing')
  overview(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Req() request: AuthenticatedRequest) {
    return this.billing.overview(organizationId, request.user.sub);
  }

  @Post('organizations/:organizationId/billing/checkouts')
  start(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: StartCheckoutDto,
  ) {
    return this.billing.startCheckout(organizationId, request.user.sub, dto.plan);
  }

  @Get('organizations/:organizationId/billing/checkouts/:checkoutId')
  checkout(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('checkoutId', ParseUUIDPipe) checkoutId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.billing.getCheckout(organizationId, checkoutId, request.user.sub);
  }

  @Post('organizations/:organizationId/billing/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Req() request: AuthenticatedRequest) {
    return this.billing.cancel(organizationId, request.user.sub);
  }

  /** Somente com BILLING_PROVIDER=fake: simula a resposta do gateway (404 nos demais casos). */
  @Post('billing/fake/checkouts/:checkoutId/complete')
  @HttpCode(HttpStatus.OK)
  completeFake(
    @Param('checkoutId', ParseUUIDPipe) checkoutId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CompleteCheckoutDto,
  ) {
    return this.billing.completeFake(checkoutId, request.user.sub, dto.outcome);
  }
}
