ALTER TABLE "legal_documents" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE "legal_documents" ADD COLUMN IF NOT EXISTS "locale" text;
ALTER TABLE "legal_documents" ADD COLUMN IF NOT EXISTS "updated_at" bigint;
ALTER TABLE "legal_documents" ADD COLUMN IF NOT EXISTS "updated_by_admin_user_id" integer;
