
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

@Module({
  imports: [
    // Limite por IP e por rota, aplicado somente aos endpoints públicos de
    // login e cadastro para dificultar força bruta e criação massiva de contas.
    // O armazenamento é em memória: cada instância da API conta separadamente.
    ThrottlerModule.forRoot([{ name: 'auth', ttl: 60_000, limit: 10 }]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');

        if (!secret || secret.length < 32) {
          throw new Error(
            'JWT_SECRET precisa ter pelo menos 32 caracteres.',
          );
        }

        return {
          secret,
          signOptions: {
            expiresIn: '15m',
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule { }
