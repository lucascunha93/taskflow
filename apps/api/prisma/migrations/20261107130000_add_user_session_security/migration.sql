-- Colunas aditivas com valores padrão: seguras para tabelas que já possuem usuários.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMPTZ(3),
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;
