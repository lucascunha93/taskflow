-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('TASK_CREATED', 'TASK_UPDATED', 'TASK_DELETED', 'COMMENT_ADDED');

-- CreateTable
CREATE TABLE "task_activities" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "taskId" UUID,
    "taskTitle" VARCHAR(200) NOT NULL,
    "actorId" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "changes" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_activities_organizationId_createdAt_id_idx" ON "task_activities"("organizationId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "task_activities_taskId_createdAt_id_idx" ON "task_activities"("taskId", "createdAt" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
