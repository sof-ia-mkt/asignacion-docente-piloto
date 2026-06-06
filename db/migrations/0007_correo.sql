-- Correo electrónico del docente, para poder enviarle su Propuesta Académica.
-- Texto libre y OPCIONAL (no todos los docentes lo tienen capturado todavía); la app
-- valida el formato al guardarlo y deshabilita el botón de envío si está vacío.
alter table profesores add column if not exists correo text;
