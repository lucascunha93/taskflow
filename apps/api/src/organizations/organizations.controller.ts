import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { OrganizationsService } from './organizations.service.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';

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

  @Patch(':organizationId')
  update(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(
      organizationId,
      request.user.sub,
      dto,
    );
  }

  @Post(':organizationId/members')
  addMember(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: AddMemberDto,
  ) {
    return this.organizationsService.addMember(
      organizationId,
      request.user.sub,
      dto,
    );
  }


  @Get(':organizationId/members')
  findMembers(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.organizationsService.findMembers(
      organizationId,
      request.user.sub,
    );
  }


}