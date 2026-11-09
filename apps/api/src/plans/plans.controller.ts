import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlansService } from './plans.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string };
}

@Controller()
@UseGuards(JwtAuthGuard)
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  /** Catálogo de planos com seus limites. */
  @Get('plans')
  catalog() {
    return this.plans.catalog();
  }

  /** Plano atual da organização, limites e uso. */
  @Get('organizations/:organizationId/plan')
  overview(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.plans.overview(organizationId, request.user.sub);
  }
}
