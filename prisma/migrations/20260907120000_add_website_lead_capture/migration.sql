-- CreateTable
CREATE TABLE "newsletter_subscribers" (
    "id" UUID NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "name" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_by_id" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alumni_registrations" (
    "id" UUID NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "graduation_year" VARCHAR(4) NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "current_occupation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_by_id" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "alumni_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_requests" (
    "id" UUID NOT NULL,
    "parent_name" VARCHAR(120) NOT NULL,
    "parent_phone" VARCHAR(20) NOT NULL,
    "parent_email" VARCHAR(160),
    "child_name" VARCHAR(120),
    "child_date_of_birth" DATE,
    "programme_slug" VARCHAR(60),
    "preferred_date" DATE NOT NULL,
    "preferred_time" VARCHAR(80) NOT NULL,
    "notes" TEXT,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_by_id" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "visit_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_email_key" ON "newsletter_subscribers"("email");

-- CreateIndex
CREATE INDEX "newsletter_subscribers_created_by_id_idx" ON "newsletter_subscribers"("created_by_id");

-- CreateIndex
CREATE INDEX "newsletter_subscribers_updated_by_id_idx" ON "newsletter_subscribers"("updated_by_id");

-- CreateIndex
CREATE INDEX "newsletter_subscribers_deleted_by_id_idx" ON "newsletter_subscribers"("deleted_by_id");

-- CreateIndex
CREATE INDEX "alumni_registrations_created_by_id_idx" ON "alumni_registrations"("created_by_id");

-- CreateIndex
CREATE INDEX "alumni_registrations_updated_by_id_idx" ON "alumni_registrations"("updated_by_id");

-- CreateIndex
CREATE INDEX "alumni_registrations_deleted_by_id_idx" ON "alumni_registrations"("deleted_by_id");

-- CreateIndex
CREATE INDEX "visit_requests_handled_idx" ON "visit_requests"("handled");

-- CreateIndex
CREATE INDEX "visit_requests_created_by_id_idx" ON "visit_requests"("created_by_id");

-- CreateIndex
CREATE INDEX "visit_requests_updated_by_id_idx" ON "visit_requests"("updated_by_id");

-- CreateIndex
CREATE INDEX "visit_requests_deleted_by_id_idx" ON "visit_requests"("deleted_by_id");

-- AddForeignKey
ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alumni_registrations" ADD CONSTRAINT "alumni_registrations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alumni_registrations" ADD CONSTRAINT "alumni_registrations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alumni_registrations" ADD CONSTRAINT "alumni_registrations_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_requests" ADD CONSTRAINT "visit_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_requests" ADD CONSTRAINT "visit_requests_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_requests" ADD CONSTRAINT "visit_requests_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
