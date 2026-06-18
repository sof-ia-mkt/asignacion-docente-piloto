#!/usr/bin/env python3
"""
Normaliza el CSV de "Disponibilidad Docente Sep-Dic 2026" (respuestas de Google Forms)
hacia una estructura limpia y auditable. NO carga nada a la base: solo extrae, deduplica,
etiqueta cada columna de materias con su carrera y mide qué empata con el catálogo.

Entradas:
  - CSV de respuestas (ruta por defecto en ~/Downloads)
  - /tmp/catalogo.json        (materias, planes, profesores de la base)
  - /tmp/materia_plan.json     (qué materias pertenecen a qué plan, vía slots)

Salidas:
  - db/seed_data/disponibilidad_sepdic2026.json   (estructura limpia)
  - reporte por stdout
"""
import csv, json, re, unicodedata, sys
from collections import Counter, defaultdict
from pathlib import Path

CSV_PATH = Path.home() / "Downloads" / "DISPONIBILIDAD DOCENTE - SEPTIEMBBRE - DICIEMBRE 2026 (Respuestas) - Respuestas de formulario 1.csv"
CATALOGO = Path("/tmp/catalogo.json")
MATERIA_PLAN = Path("/tmp/materia_plan.json")
OUT = Path(__file__).resolve().parent.parent / "db" / "seed_data" / "disponibilidad_sepdic2026.json"

# Tokens que significan "nada" en una celda de materias
NA = {"", "N/A", "NA", "N/A.", "N.A", "N.A.", "NINGUNA", "NO APLICA",
      "NINGUNA MATERIA", "NO APLICA N/A", "N/A "}

PLANTELES_VALIDOS = ["CASA BLANCA", "OTAY", "TECATE", "PALMAS"]


def norm(s):
    s = (s or "").replace("\n", " ")
    return re.sub(r"\s+", " ", s).strip().upper()


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()


def parse_planteles(cell):
    u = norm(cell)
    found = [p for p in PLANTELES_VALIDOS if p in u]
    return found


def parse_correo(cell):
    c = (cell or "").strip().replace(" ", "")
    valido = bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", c))
    return c, valido


# Horarios: "SÁBADO MATUTINO (8:00 am - 10:00 am)"
DIAS = ["LUNES", "MARTES", "MIÉRCOLES", "MIERCOLES", "JUEVES", "VIERNES", "SÁBADO", "SABADO", "DOMINGO"]
DIA_CANON = {"MIERCOLES": "MIÉRCOLES", "SABADO": "SÁBADO"}
H_RE = re.compile(r"\(([^)]+)\)")


def parse_horarios(cell):
    out = []
    for raw in (cell or "").split(","):
        seg = raw.strip()
        if not seg:
            continue
        u = norm(seg)
        dia = next((d for d in DIAS if d in u), None)
        if dia is None:
            continue
        dia = DIA_CANON.get(dia, dia)
        turno = "MATUTINO" if "MATUTINO" in u else ("VESPERTINO" if "VESPERTINO" in u else None)
        rango = None
        m = H_RE.search(seg)
        if m:
            rango = re.sub(r"\s+", " ", m.group(1)).strip()
        out.append({"dia": dia, "turno": turno, "rango": rango, "raw": seg.strip()})
    # dedup por (dia, rango)
    seen, uniq = set(), []
    for h in out:
        k = (h["dia"], h["rango"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(h)
    return uniq


def materias_de_celda(cell):
    out = []
    for p in (cell or "").split(","):
        t = norm(p)
        if t in NA:
            continue
        out.append(t)
    # dedup conservando orden
    seen, uniq = set(), []
    for m in out:
        if m in seen:
            continue
        seen.add(m)
        uniq.append(m)
    return uniq


def main():
    if not CSV_PATH.exists():
        sys.exit(f"No encuentro el CSV en {CSV_PATH}")
    cat = json.loads(CATALOGO.read_text()) if CATALOGO.exists() else {"materias": [], "planes": []}
    mp = json.loads(MATERIA_PLAN.read_text()) if MATERIA_PLAN.exists() else []

    # catálogo: slug -> nombre canónico
    cat_slug = {m["slug"]: m["nombre"] for m in cat.get("materias", [])}
    # slug de materia -> set de planes
    slug_planes = defaultdict(set)
    for row in mp:
        slug_planes[slugify(row["materia"])].add(row["plan"])

    with open(CSV_PATH, encoding="utf-8") as f:
        rows = list(csv.reader(f))
    header, data = rows[0], rows[1:]

    materia_cols = [i for i, h in enumerate(header)
                    if h.strip().lower().startswith("selección preliminar")]

    # --- detectar columnas "forzadas" (el form obligaba a marcar: 0 'N/A' exacto y todas llenas) ---
    forzadas = set()
    for c in materia_cols:
        na_exacto = sum(1 for r in data if norm(r[c]) in ("N/A", "NA"))
        llenas = sum(1 for r in data if r[c].strip())
        if na_exacto == 0 and llenas == len(data):
            forzadas.add(c)

    # --- etiquetar cada columna con su carrera (plan con más traslape) ---
    col_carrera = {}
    for c in materia_cols:
        votos = Counter()
        for r in data:
            for m in materias_de_celda(r[c]):
                for plan in slug_planes.get(slugify(m), ()):
                    votos[plan] += 1
        col_carrera[c] = votos.most_common(1)[0][0] if votos else "(indeterminada)"

    # --- construir registros por docente ---
    registros = []
    for r in data:
        correo, correo_ok = parse_correo(r[9])
        nombre = norm(f"{r[4]} {r[2]} {r[3]}")  # NOMBRE APELLIDOP APELLIDOM
        carreras = {}
        for c in materia_cols:
            ms = materias_de_celda(r[c])
            if not ms:
                continue
            items = []
            for m in ms:
                sl = slugify(m)
                items.append({
                    "materia": m,
                    "en_catalogo": sl in cat_slug,
                    "canonica": cat_slug.get(sl),
                })
            carreras[col_carrera[c]] = {
                "forzada": c in forzadas,
                "materias": items,
            }
        registros.append({
            "marca_temporal": r[0].strip(),
            "nombre": nombre,
            "slug": slugify(nombre),
            "apellido_paterno": r[2].strip(),
            "apellido_materno": r[3].strip(),
            "nombres": r[4].strip(),
            "correo": correo,
            "correo_valido": correo_ok,
            "planteles": parse_planteles(r[5]),
            "grado": norm(r[7]),
            "grados_texto": r[8].strip(),
            "horarios": parse_horarios(r[10]),
            "comentarios": r[6].strip(),
            "carreras": carreras,
        })

    # --- deduplicar: por correo válido; el "ganador" es el de más materias y marca más reciente ---
    def riqueza(reg):
        n = sum(len(v["materias"]) for v in reg["carreras"].values())
        return (n, reg["marca_temporal"])

    by_key = defaultdict(list)
    for reg in registros:
        key = reg["correo"].lower() if reg["correo_valido"] else f"NOMBRE::{reg['slug']}"
        by_key[key].append(reg)

    finales, duplicados = [], []
    for key, grp in by_key.items():
        grp_sorted = sorted(grp, key=riqueza, reverse=True)
        ganador = grp_sorted[0]
        finales.append(ganador)
        for perdedor in grp_sorted[1:]:
            duplicados.append({"clave": key, "descartado": perdedor["nombre"],
                               "marca": perdedor["marca_temporal"]})

    finales.sort(key=lambda x: x["nombre"])

    salida = {
        "ciclo": "2026-2027-1",
        "ciclo_label": "Septiembre-Diciembre 2026",
        "fuente": CSV_PATH.name,
        "columnas_carrera": {str(c): col_carrera[c] for c in materia_cols},
        "columnas_forzadas": {str(c): col_carrera[c] for c in forzadas},
        "docentes": finales,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(salida, ensure_ascii=False, indent=2))

    # ------------------- REPORTE -------------------
    print("=" * 64)
    print("NORMALIZACIÓN — Disponibilidad Docente Sep-Dic 2026")
    print("=" * 64)
    print(f"Respuestas crudas: {len(data)}")
    print(f"Docentes únicos (tras deduplicar): {len(finales)}")
    print(f"Envíos duplicados descartados: {len(duplicados)}")
    for d in duplicados:
        print(f"   · {d['descartado']}  [{d['clave']}]")

    print("\n--- CARRERA POR COLUMNA (auto-detectada vs catálogo) ---")
    for c in materia_cols:
        tag = "  ⚠ FORZADA (marca obligada, baja confianza)" if c in forzadas else ""
        print(f"   col {c:2d} → {col_carrera[c]}{tag}")

    correos_invalidos = [r["nombre"] for r in finales if not r["correo_valido"]]
    print(f"\nCorreos inválidos/faltantes: {len(correos_invalidos)}")
    for n in correos_invalidos:
        print(f"   · {n}")

    # match de materias contra catálogo
    tot = matched = 0
    sin_match = Counter()
    for r in finales:
        for v in r["carreras"].values():
            for it in v["materias"]:
                tot += 1
                if it["en_catalogo"]:
                    matched += 1
                else:
                    sin_match[it["materia"]] += 1
    print(f"\nMaterias declaradas (no-N/A, deduplicadas por celda): {tot}")
    print(f"   empatan con catálogo: {matched} ({matched*100//max(tot,1)}%)")
    print(f"   NO empatan (typos / nuevas): {tot-matched} — {len(sin_match)} distintas")
    print("   top 25 sin empatar:")
    for m, c in sin_match.most_common(25):
        print(f"      {c:3d}×  {m}")

    print(f"\nJSON limpio escrito en: {OUT}")


if __name__ == "__main__":
    main()
