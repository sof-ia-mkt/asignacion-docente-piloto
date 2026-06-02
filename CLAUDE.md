@AGENTS.md

# Asignación Docente — Piloto CENYCA

Plataforma para que **coordinación académica** asigne docentes a materias del próximo
cuatrimestre, con recomendación automática y alertas.

## Qué demuestra el piloto
1. Lee el CV de cada docente y deduce qué materias puede dar (vía Claude).
2. Recomienda y asigna docentes a materias automáticamente.
3. Alerta: choque de horario, docente repetido, materia sin candidato, sobrecarga.

## Modelo mental (NO confundir)
- **Ciclo** = periodo lectivo (ej. `2025-2026-3` = mayo-agosto). **Cuatrimestre** = nivel 1°-9° dentro del plan.
- **Mayo = HISTORIAL real** (lo que cada docente ya dio, sale del Excel). Solo lectura.
- **Septiembre = el cuatrimestre A ASIGNAR** (mismas materias/grupos, en blanco).
- La recomendación combina **historial real (señal fuerte, +40 si ya dio la materia) + CV**.

## Alcance del piloto
- Un solo plantel: **CASA BLANCA** (601 slots, 203 materias, 121 grupos).
- **20 docentes reales** (los que más materias dan) con **CV inventado** coherente con su historial.
- Fuente: `PROYECCIÓN MAYO - AGOSTO -ACTUALIZADA.xlsx` (en ~/Downloads).

## Trampas de los datos (ya detectadas)
- El **ID NO es único** entre planteles → llave = `ID + plantel`.
- Nombres de docente sucios (`\n`, espacios) → normalizar antes de comparar.
- Fechas en texto libre, 29 formatos distintos.
- Clave de grupo compuesta: `PLAN_Gnn_TURNO_CAMPUS` (ej. `MEC_G19_DM_CB`).
- Cada grupo = 5 slots: Disciplinar + Módulo 1/2/3 + Virtual.

## Stack
- Next.js 16 (App Router) + Tailwind — OJO: Next 16 tiene cambios; leer `node_modules/next/dist/docs/`.
- Supabase (Postgres + auth) en la nube.
- Claude API (@anthropic-ai/sdk) para leer CVs.
- Scripts de datos en Python (openpyxl) en `scripts/`.
