import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Patch,
    Post,
    Put,
    Req,
    Res,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import type { Request, Response } from 'express';
import { readRefreshCookie, RefreshCookieService, RefreshRequestGuard } from './refresh-cookie.js';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

interface AuthenticatedRequest extends Request {
    user: {
        sub: string;
    };
}

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly refreshCookie: RefreshCookieService,
    ) { }

    @Post('register')
    @UseGuards(ThrottlerGuard)
    @HttpCode(HttpStatus.CREATED)
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('login')
    @UseGuards(ThrottlerGuard)
    async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
        const session = await this.authService.login(dto);
        this.refreshCookie.set(response, session.refreshToken);
        return session.response;
    }

    @Post('refresh')
    @UseGuards(RefreshRequestGuard)
    @HttpCode(HttpStatus.OK)
    async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
        const token = readRefreshCookie(request);
        if (!token) {
            throw new UnauthorizedException('Sessão não encontrada. Entre novamente.');
        }
        try {
            const session = await this.authService.refresh(token);
            this.refreshCookie.set(response, session.refreshToken);
            return session.response;
        } catch (error: unknown) {
            if (error instanceof UnauthorizedException) this.refreshCookie.clear(response);
            throw error;
        }
    }

    @Post('logout')
    @UseGuards(RefreshRequestGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
        await this.authService.logout(readRefreshCookie(request));
        this.refreshCookie.clear(response);
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

    @Put('me/password')
    @UseGuards(JwtAuthGuard, ThrottlerGuard)
    async changePassword(
        @Req() request: AuthenticatedRequest,
        @Body() dto: ChangePasswordDto,
        @Res({ passthrough: true }) response: Response,
    ) {
        const session = await this.authService.changePassword(request.user.sub, dto);
        this.refreshCookie.set(response, session.refreshToken);
        return session.response;
    }

    @Delete('me/sessions')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    async revokeSessions(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
        await this.authService.revokeSessions(request.user.sub);
        this.refreshCookie.clear(response);
    }
}
