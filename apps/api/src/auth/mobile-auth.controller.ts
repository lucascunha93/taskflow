import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService, type AuthSession } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

export class MobileRefreshDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refreshToken!: string;
}

const mobileSession = (session: AuthSession) => ({
  ...session.response,
  refreshToken: session.refreshToken.token,
  refreshExpiresAt: session.refreshToken.expiresAt,
});

/**
 * Sessão do aplicativo mobile. O WebView do Capacitor roda em outra origem
 * (`capacitor://localhost`, `https://localhost`), onde o cookie SameSite=Strict
 * do navegador não é enviado; por isso o refresh token vai no corpo e o app o
 * guarda no armazenamento seguro do sistema (Keychain/Keystore). As regras são
 * as mesmas do cookie: token opaco, rotação a cada uso, detecção de reutilização
 * e revogação por versão de sessão. Sem credencial automática, não há CSRF.
 */
@Controller('auth/mobile')
export class MobileAuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return mobileSession(await this.authService.login(dto));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: MobileRefreshDto) {
    return mobileSession(await this.authService.refresh(dto.refreshToken));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: MobileRefreshDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }
}
