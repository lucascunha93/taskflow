import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Patch,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import type { Request } from 'express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

interface AuthenticatedRequest extends Request {
    user: {
        sub: string;
    };
}

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('register')
    @UseGuards(ThrottlerGuard)
    @HttpCode(HttpStatus.CREATED)
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('login')
    @UseGuards(ThrottlerGuard)
    login(@Body() dto: LoginDto) {
        return this.authService.login(dto);
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    getMe(@Req() request: AuthenticatedRequest) {
        return this.authService.getProfile(request.user.sub);
    }

    @Patch('me')
    @UseGuards(JwtAuthGuard)
    updateMe(@Req() request: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
        return this.authService.updateProfile(request.user.sub, dto);
    }
}

