import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { OrganizationsService } from './organizations.service.js';
import { AddMemberDto } from './dto/add-member.dto.js';

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


  @Post(':organizationId/members')
  addMember(
    @Param('organizationId') organizationId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: AddMemberDto,
  ) {
    return this.organizationsService.addMember(
      organizationId,
      request.user.sub,
      dto,
    );
  }

}