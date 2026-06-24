-- 0016: ruta del CV en Supabase Storage (bucket privado "cvs").
-- Idempotente: el runner re-aplica todas las migraciones en cada corrida.
ALTER TABLE profesores ADD COLUMN IF NOT EXISTS cv_path text;
