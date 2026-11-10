import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../common/validation/trim.decorator.js';
import { PasswordResetService } from './password-reset.service.js';

export class ForgotPasswordDto {
  @Trim()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

/** Recuperação de senha; os dois endpoints são públicos e limitados por IP. */
@Controller('auth/password')
@UseGuards(ThrottlerGuard)
export class PasswordResetController {
  constructor(private readonly passwordReset: PasswordResetService) {}

  /** Sempre 202, exista ou não uma conta com o e-mail. */
  @Post('forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  forgot(@Body() dto: ForgotPasswordDto) {
    this.passwordReset.assertAvailable();
    this.passwordReset.requestInBackground(dto.email);
    return { message: 'Se houver uma conta com esse e-mail, enviaremos um link para redefinir a senha.' };
  }

  @Post('reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reset(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.passwordReset.reset(dto.token, dto.newPassword);
  }
}
