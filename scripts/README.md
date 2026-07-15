# Scripts de datos y mantenimiento

Herramientas de línea de comandos del piloto. Corren con `node scripts/<nombre>.mjs`
(los `.py` con Python + openpyxl) y leen la conexión de `.env.local` (`SUPABASE_DB_URL`).

## ⚠️ Scripts DESTRUCTIVOS (mantenimiento del ciclo a asignar)

Los tres corren en **dry-run por defecto** (solo muestran qué harían) y **siempre
respaldan en `backups/` antes de borrar**. Para ejecutar de verdad exigen `--apply`.
Aún así: son para reiniciar el ciclo de trabajo — no los corras sin estar seguro.

| Script | Qué borra |
|---|---|
| `vaciar-docentes-septiembre.mjs` | Todas las asignaciones CON docente del ciclo a asignar |
| `reset-asignaciones-septiembre.mjs` | TODAS las asignaciones del ciclo a asignar |
| `limpiar-bitacora-asignaciones.mjs` | Movimientos de la bitácora de asignaciones |

Para revertir un borrado accidental: `restaurar-asignaciones-septiembre.mjs` (lee el
respaldo de `backups/`) o `restaurar_db.mjs` para un respaldo completo.

## Carga inicial y utilidades (referencia)

- `extraer_*.py` / `analizar_*.py` — leen el Excel de proyección y generan CSV/JSON.
- `cargar_*.mjs` — siembran catálogos, demanda, usuarios, perfiles y recomendaciones.
- `migrate.mjs` — aplica las migraciones de `db/migrations/` en orden.
- `asignar.mjs` — motor de recomendación (propone docente por slot).
- `recalcular-alertas.mjs` — rehace el diagnóstico de alertas a mano.
- `respaldo_db.mjs` / `restaurar_db.mjs` — respaldo y restauración completos.
- `ingest_cvs.mjs` / `generar_cvs.py` — CVs demo y su lectura con Claude.
- `_audit_join.mjs`, `_dry_run.mjs` — herramientas locales ad-hoc (gitignoradas/manuales).

Nota: la contraseña con la que `cargar_usuarios.mjs` siembra usuarios es SOLO para la
carga inicial. Desde la plataforma, crear/resetear usuarios genera una contraseña
temporal aleatoria que se muestra una única vez.
