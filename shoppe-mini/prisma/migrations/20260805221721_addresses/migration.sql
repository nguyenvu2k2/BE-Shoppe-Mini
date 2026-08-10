-- CreateTable
CREATE TABLE "addresses" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "ward" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- At most one default address per user
CREATE UNIQUE INDEX "addresses_user_id_default_unique" ON "addresses"("user_id") WHERE "is_default" = true;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
