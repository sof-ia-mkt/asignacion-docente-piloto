#!/usr/bin/env python3
"""
Extrae la DEMANDA de Sep-Dic 2026 desde los CSV por carrera (los que Sergio exportó
de la hoja de cálculo). A diferencia del export HTML (_propuesta_zip), el CSV SÍ
conserva las columnas Hora Inicio / Hora Fin — esa fue la causa de que en la
plataforma faltaran ~260 horarios de Casa Blanca.

NO escribe en la base: solo limpia y produce el JSON que consumen los cargadores.

Entradas:
  - ~/Downloads/PROPUESTA SEP - DIC 2026 - *.csv  (uno por carrera)
  - /tmp/catalogo.json  (materias/planes de la base, para materia_canonica)

Salida:
  - db/seed_data/demanda_sepdic2026_csv.json   (mismo esquema que extraer_demanda.py)

Decisiones (por qué así):
  - Columnas mapeadas por NOMBRE de encabezado: cada archivo las pone en posición
    distinta (ingenierías corren TIPO/HORA una columna a la derecha).
  - La clave de grupo se detecta por patrón PLAN_Gnn_TURNO_CB en la fila (no por header).
  - De los dos "ADMINISTRACIÓN" se usa el "(1)", que está más completo (57 vs 40 horarios CB).
  - CICLO se fuerza a 2026-2027-1 (el de la hoja viene podrido: "2027 -2027-1", etc.).
"""
import csv, json, re, unicodedata, sys
from collections import Counter, defaultdict
from pathlib import Path

DOWNLOADS = Path.home() / "Downloads"
CATALOGO = Path("/tmp/catalogo.json")
OUT = Path(__file__).resolve().parent.parent / "db" / "seed_data" / "demanda_sepdic2026_csv.json"

CICLO_FORZADO = "2026-2027-1"
CICLO_LABEL = "Septiembre-Diciembre 2026"

# stem del archivo (sin "PROPUESTA SEP - DIC 2026 - " ni extensión) -> carrera canónica.
CARRERAS = {
    "ADMINISTRACIÓN": "ADMINISTRACIÓN",
    "CIENCIAS DE LA EDU.": "CIENCIAS DE LA EDUCACIÓN",
    "CONTADURIA P.": "CONTADURÍA PÚBLICA Y FINANZAS",
    "CYC": "CRIMINOLOGÍA Y CRIMINALÍSTICA",
    "DERECHO": "DERECHO",
    "GASTRONOMIA": "GASTRONOMÍA",
    "ING. ELECTROMECANICA": "INGENIERÍA ELECTROMECÁNICA",
    "ING. INDUSTRIAL": "INGENIERÍA INDUSTRIAL",
    "ING. MECATRONICA": "INGENIERÍA MECATRÓNICA",
    "ING. SISTEMAS COMP": "INGENIERÍA EN SISTEMAS COMPUTACIONALES",
    "PSICOLOGIA ORG.": "PSICOLOGÍA ORGANIZACIONAL",
}

CLAVE_RE = re.compile(r"^[A-Z]{2,5}_G\d+_[A-Z0-9]+(?:_[A-Z0-9]+)?_[A-Z]{2,3}$")
TIPOS_VALIDOS = {"DISCIPLINAR", "MÓDULO 1", "MÓDULO 2", "MÓDULO 3", "VIRTUAL"}
NA = {"", "N/A", "NA", "N/A.", "GENERAL", "-"}


def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("\n", " ")).strip().upper()


def slugify(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()


def _plantel_de_clave(clave):
    suf = clave.rsplit("_", 1)[-1]
    return {"CB": "CASA BLANCA", "OT": "OTAY", "TC": "TECATE", "TEC": "TECATE",
            "PL": "PALMAS"}.get(suf, suf)


def _limpia_na(v):
    return "" if norm(v) in NA else (v or "").strip()


def stem_carrera(path):
    """De 'PROPUESTA SEP - DIC 2026 - ADMINISTRACIÓN .csv' -> 'ADMINISTRACIÓN'."""
    n = path.stem
    pref = "PROPUESTA SEP - DIC 2026 - "
    if n.startswith(pref):
        n = n[len(pref):]
    n = re.sub(r"\s*\(\d+\)\s*$", "", n)  # quita el "(1)"
    return n.strip()


def elegir_archivos():
    """Un CSV por carrera. Si hay duplicado (admin con y sin '(1)'), toma el más completo."""
    cands = defaultdict(list)
    for p in DOWNLOADS.glob("PROPUESTA SEP - DIC 2026 - *.csv"):
        car = stem_carrera(p)
        if car in CARRERAS:
            cands[car].append(p)
    elegidos = {}
    for car, ps in cands.items():
        if len(ps) == 1:
            elegidos[car] = ps[0]
        else:
            # más completo = más horarios CB poblados
            elegidos[car] = max(ps, key=lambda p: _contar_horas_cb(p))
    return elegidos


def _contar_horas_cb(path):
    n = 0
    for r in _leer(path):
        if any(c.strip().endswith("_CB") and "_G" in c for c in r):
            if any(":" in c and c.strip()[:1].isdigit() for c in r):
                n += 1
    return n


def _leer(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.reader(f))


def mapear_columnas(header):
    alias = {
        "plan": ["PLAN DE ESTUDIOS"],
        "cuatrimestre": ["CUATRIMESTRE"],
        "tipo": ["TIPO"],
        "materia": ["MATERIA"],
        "dia": ["DÍA", "DIA"],
        "turno": ["TURNO"],
        "hora_inicio": ["HORA INICIO"],
        "hora_fin": ["HORA FIN"],
        "fechas": ["FECHAS", "FECHA", "FECHA AUTOMÁTICA", "FECHA AUTOMATICA"],
        "docente": ["DOCENTE"],
    }
    up = [norm(h) for h in header]
    idx = {}
    for logica, nombres in alias.items():
        for n in nombres:
            if n in up:
                idx[logica] = up.index(n)
                break
    return idx


def encontrar_clave(row):
    for c in row:
        if CLAVE_RE.match(c.strip()):
            return c.strip()
    return None


def main():
    cat = json.loads(CATALOGO.read_text()) if CATALOGO.exists() else {}
    cat_mat = {m["slug"]: m["nombre"] for m in cat.get("materias", [])}
    cat_plan = {p["slug"]: p["nombre"] for p in cat.get("planes", [])}

    archivos = elegir_archivos()
    faltan = [c for c in CARRERAS if c not in archivos]
    if faltan:
        print(f"⚠ Carreras sin archivo CSV: {faltan}", file=sys.stderr)

    slots = []
    por_archivo = {}
    for stem, path in sorted(archivos.items()):
        carrera = CARRERAS[stem]
        rows = _leer(path)
        hi = next((i for i, r in enumerate(rows[:8])
                   if any(norm(c) == "MATERIA" for c in r)), None)
        if hi is None:
            por_archivo[carrera] = {"slots": 0, "grupos": 0, "error": "sin header"}
            continue
        cols = mapear_columnas(rows[hi])
        n_slots = 0
        for r in rows[hi + 1:]:
            clave = encontrar_clave(r)
            if not clave:
                continue
            def get(k):
                i = cols.get(k)
                return r[i].strip() if i is not None and i < len(r) else ""
            tipo = norm(get("tipo"))
            materia = norm(get("materia"))
            if not materia:
                continue
            plan_raw = get("plan")
            mslug = slugify(materia)
            pslug = slugify(plan_raw)
            slots.append({
                "ciclo": CICLO_FORZADO,
                "carrera": carrera,
                "archivo": path.name,
                "clave_grupo": clave,
                "plantel": _plantel_de_clave(clave),
                "plan_raw": plan_raw,
                "plan_en_catalogo": pslug in cat_plan,
                "cuatrimestre": get("cuatrimestre"),
                "tipo": tipo if tipo in TIPOS_VALIDOS else (tipo or "(?)"),
                "materia": materia,
                "materia_en_catalogo": mslug in cat_mat,
                "materia_canonica": cat_mat.get(mslug),
                "dia": _limpia_na(get("dia")),
                "turno": _limpia_na(get("turno")),
                "hora_inicio": _limpia_na(get("hora_inicio")),
                "hora_fin": _limpia_na(get("hora_fin")),
                "fechas": get("fechas"),
                "docente": _limpia_na(get("docente")),
            })
            n_slots += 1
        grupos = {s["clave_grupo"] for s in slots if s["carrera"] == carrera}
        por_archivo[carrera] = {"slots": n_slots, "grupos": len(grupos), "archivo": path.name}

    grupos = defaultdict(list)
    for s in slots:
        grupos[s["clave_grupo"]].append(s)

    salida = {
        "ciclo": CICLO_FORZADO,
        "ciclo_label": CICLO_LABEL,
        "fuente": "CSV: " + str(DOWNLOADS / "PROPUESTA SEP - DIC 2026 - *.csv"),
        "total_slots": len(slots),
        "total_grupos": len(grupos),
        "por_carrera": por_archivo,
        "slots": slots,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(salida, ensure_ascii=False, indent=2))

    _reporte(slots, por_archivo)
    print(f"\nJSON limpio escrito en: {OUT}")


def _reporte(slots, por_archivo):
    print("=" * 70)
    print("EXTRACCIÓN CSV — DEMANDA Sep-Dic 2026 (con horarios)")
    print("=" * 70)
    print(f"Total slots: {len(slots)}   grupos: {len({s['clave_grupo'] for s in slots})}")
    cb = [s for s in slots if s["plantel"] == "CASA BLANCA"]
    con = [s for s in cb if s["hora_inicio"]]
    sin = [s for s in cb if not s["hora_inicio"] and s["tipo"] != "VIRTUAL"]
    virt = [s for s in cb if s["tipo"] == "VIRTUAL"]
    print(f"\n--- CASA BLANCA ({len(cb)} slots) ---")
    print(f"   con horario:            {len(con)}")
    print(f"   sin horario (presencial): {len(sin)}")
    print(f"   virtuales (sin horario):  {len(virt)}")
    print("\n--- POR PLANTEL ---")
    for p, n in Counter(s["plantel"] for s in slots).most_common():
        print(f"   {n:4d}  {p}")
    print("\n--- POR CARRERA ---")
    for c, d in sorted(por_archivo.items(), key=lambda x: -x[1].get("slots", 0)):
        print(f"   {d.get('slots',0):4d} slots / {d.get('grupos',0):3d} grupos   {c}")


if __name__ == "__main__":
    main()
