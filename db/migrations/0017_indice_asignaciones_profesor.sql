-- El patrón de consulta más frecuente de la app son subconsultas correlacionadas por docente:
-- carga del docente, chequeo de choques, candidatos... todas filtran asignaciones.profesor_id.
-- Sin este índice, cada una era un escaneo secuencial por candidato.
create index if not exists idx_asig_profesor on asignaciones(profesor_id);
