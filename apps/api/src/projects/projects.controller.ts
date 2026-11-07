import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto.js';
import { ProjectsService } from './projects.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string };
}

@Controller('organizations/:organizationId/projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Req() request: AuthenticatedRequest) {
    return this.projects.list(organizationId, request.user.sub);
  }

  @Post()
  create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(organizationId, request.user.sub, dto);
  }

  @Get(':projectId')
  findOne(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.projects.findOne(organizationId, projectId, request.user.sub);
  }

  @Patch(':projectId')
  update(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(organizationId, projectId, request.user.sub, dto);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.projects.remove(organizationId, projectId, request.user.sub);
  }
}
