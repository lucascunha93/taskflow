-- CreateEnum
CREATE TYPE "OrganizationPlan" AS ENUM ('FREE', 'PRO', 'BUSINESS');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "plan" "OrganizationPlan" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "planChangedAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "task_attachments_organizationId_size_idx" ON "task_attachments"("organizationId", "size");
