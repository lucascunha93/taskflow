import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  Get,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { OrganizationsService } from './organizations.service.js';

interface AuthenticatedRequest extends Request {
  user: {
    sub: string;
  };
}

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
  ) { }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.organizationsService.create(
      request.user.sub,
      dto,
    );
  }

  @Get()
  findAll(@Req() request: AuthenticatedRequest) {
    return this.organizationsService.findAllByUser(
      request.user.sub,
    );
  }
}