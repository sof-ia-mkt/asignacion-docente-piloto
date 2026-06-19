#!/usr/bin/env python3
"""
Normaliza la DEMANDA del ciclo Sep-Dic 2026 (las "Propuestas" por carrera, exportadas
como HTML desde la hoja de cálculo) hacia una estructura limpia y auditable.

NO carga nada a la base: extrae, limpia la mugre de Excel, agrupa por grupo y mide qué
materias/planes empatan con el catálogo de la plataforma.

Entradas:
  - Carpeta con los HTML por carrera (default ~/Downloads/_propuesta_zip)
  - /tmp/catalogo.json       (materias, planes de la base)

Salidas:
  - db/seed_data/demanda_sepdic2026.json
  - reporte por stdout

Decisiones de diseño (por qué así):
  - Se mapea cada columna por el NOMBRE de su encabezado (MATERIA, DÍA, TURNO, ...),
    no por posición fija: cada archivo recorre las columnas distinto.
  - La clave de grupo ("ID") viene corrida una columna respecto al encabezado, así que
    NO se confía en el header: se detecta por patrón PLAN_Gnn_TURNO_CB en la fila.
  - El CICLO viene podrido por arrastre de Excel (2026 -> 2040); se fuerza 2026-2027-1.
  - Fila válida = la que tiene una clave de grupo. Lo demás (banners, blancos) se ignora.
"""
import json, re, unicodedata, sys
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path

SRC = Path.home() / "Downloads" / "_propuesta_zip"
CATALOGO = Path("/tmp/catalogo.json")
OUT = Path(__file__).resolve().parent.parent / "db" / "seed_data" / "demanda_sepdic2026.json"

CICLO_FORZADO = "2026-2027-1"
CICLO_LABEL = "Septiembre-Diciembre 2026"

# Nombre de archivo -> carrera (los HTML con nombre de plantel NO son carreras, se ignoran)
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

# Clave de grupo: PLAN _ Gnn _ TURNO _ CAMPUS   (turno: MV/SM/DM/ESCM/...)
# Algunos grupos traen un segmento extra de sección (A/B) o especialidad antes del
# campus: PLAN_Gnn_TURNO_SECCION_CAMPUS (ej. IND_G22_DM_A_CB, CYC_G9_ESCM_A_CB). Se
# acepta ese segmento opcional; antes se descartaban silenciosamente.
CLAVE_RE = re.compile(r"^[A-Z]{2,5}_G\d+_[A-Z0-9]+(?:_[A-Z0-9]+)?_[A-Z]{2,3}$")
TIPOS_VALIDOS = {"DISCIPLINAR", "MÓDULO 1", "MÓDULO 2", "MÓDULO 3", "VIRTUAL"}
NA = {"", "N/A", "NA", "N/A.", "GENERAL", "-"}


def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("\n", " ")).strip().upper()


def slugify(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()


class TablaParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.cur = None
        self.cell = None
        self.intd = False

    def handle_starttag(self, t, a):
        if t == "tr":
            self.cur = []
        elif t in ("td", "th"):
            self.cell = []
            self.intd = True

    def handle_endtag(self, t):
        if t == "tr" and self.cur is not None:
            self.rows.append(self.cur)
            self.cur = None
        elif t in ("td", "th") and self.intd:
            self.cur.append(" ".join("".join(self.cell).split()))
            self.intd = False

    def handle_data(self, d):
        if self.intd:
            self.cell.append(d)


def parse_html(path):
    p = TablaParser()
    p.feed(path.read_text(encoding="utf-8"))
    return [r for r in p.rows if r]


def mapear_columnas(header):
    """Devuelve {clave_logica: indice} mapeando por NOMBRE de encabezado."""
    alias = {
        "plan": ["PLAN DE ESTUDIOS"],
        "cuatrimestre": ["CUATRIMESTRE"],
        "tipo": ["TIPO"],
        "materia": ["MATERIA"],
        "plantel": ["PLANTEL"],  # casi nunca está como header; se infiere aparte
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
    """La clave de grupo viene corrida; se busca por patrón en toda la fila."""
    for c in row:
        if CLAVE_RE.match(c.strip()):
            return c.strip()
    return None


def main():
    if not SRC.exists():
        sys.exit(f"No encuentro la carpeta {SRC}")
    cat = json.loads(CATALOGO.read_text())
    cat_mat = {m["slug"]: m["nombre"] for m in cat.get("materias", [])}
    cat_plan = {p["slug"]: p["nombre"] for p in cat.get("planes", [])}

    slots = []
    por_archivo = {}

    for path in sorted(SRC.glob("*.html")):
        stem = path.stem.strip()
        if stem not in CARRERAS:
            continue  # archivos con nombre de plantel (extractos), no carreras
        carrera = CARRERAS[stem]
        rows = parse_html(path)
        # header = primera fila que contenga "MATERIA"
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
                continue  # banner / blanco / basura
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
                "archivo": stem,
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
        por_archivo[carrera] = {"slots": n_slots, "grupos": len(grupos)}

    # agrupar por clave de grupo
    grupos = defaultdict(list)
    for s in slots:
        grupos[s["clave_grupo"]].append(s)

    salida = {
        "ciclo": CICLO_FORZADO,
        "ciclo_label": CICLO_LABEL,
        "fuente": str(SRC),
        "total_slots": len(slots),
        "total_grupos": len(grupos),
        "por_carrera": por_archivo,
        "slots": slots,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(salida, ensure_ascii=False, indent=2))

    _reporte(slots, grupos, por_archivo, cat_mat)
    print(f"\nJSON limpio escrito en: {OUT}")


def _plantel_de_clave(clave):
    suf = clave.rsplit("_", 1)[-1]
    return {"CB": "CASA BLANCA", "OT": "OTAY", "TC": "TECATE", "TEC": "TECATE",
            "PL": "PALMAS"}.get(suf, suf)


def _limpia_na(v):
    return "" if norm(v) in NA else v


def _reporte(slots, grupos, por_archivo, cat_mat):
    print("=" * 70)
    print("NORMALIZACIÓN — DEMANDA (Propuestas) Sep-Dic 2026")
    print("=" * 70)
    print(f"Total slots (clases a cubrir): {len(slots)}")
    print(f"Total grupos: {len(grupos)}")
    print("\n--- POR CARRERA ---")
    for c, d in sorted(por_archivo.items(), key=lambda x: -x[1]["slots"]):
        print(f"   {d['slots']:4d} slots / {d['grupos']:3d} grupos   {c}")

    # tamaño de grupo (cuántos componentes)
    tam = Counter(len(v) for v in grupos.values())
    print("\n--- COMPONENTES POR GRUPO ---")
    for k in sorted(tam):
        print(f"   {tam[k]:3d} grupos con {k} componentes")
    irregulares = [g for g, v in grupos.items() if len(v) != 5]
    if irregulares:
        print(f"   grupos != 5 componentes ({len(irregulares)}): {', '.join(sorted(irregulares)[:15])}"
              + (" ..." if len(irregulares) > 15 else ""))

    # plantel
    pl = Counter(s["plantel"] for s in slots)
    print("\n--- PLANTEL ---")
    for p, n in pl.most_common():
        print(f"   {n:4d}  {p}")

    # horarios faltantes
    sin_dia = sum(1 for s in slots if not s["dia"] and s["tipo"] != "VIRTUAL")
    print(f"\nSlots sin día (no virtuales): {sin_dia}")

    # materias vs catálogo
    tot = len(slots)
    matched = sum(1 for s in slots if s["materia_en_catalogo"])
    sin = Counter(s["materia"] for s in slots if not s["materia_en_catalogo"])
    print(f"\nMaterias (slots) vs catálogo: {matched}/{tot} ({matched*100//max(tot,1)}%) empatan")
    print(f"   distintas sin empatar: {len(sin)}")
    for m, n in sin.most_common(30):
        print(f"      {n:3d}×  {m}")

    # planes sin empatar
    planes_no = Counter(s["plan_raw"] for s in slots if not s["plan_en_catalogo"])
    if planes_no:
        print(f"\nPlanes sin empatar exacto con catálogo: {len(planes_no)}")
        for p, n in planes_no.most_common():
            print(f"   {n:4d}×  {p}")


if __name__ == "__main__":
    main()
