#!/usr/bin/env python3
"""
Clasifica las materias que NO empatan con el catálogo (de la demanda y de la
disponibilidad) en dos cubetas:
  - TYPO  -> existe una materia muy parecida en el catálogo (probable error de dedo)
  - NUEVA -> no se parece a nada; hay que darla de alta en el catálogo

Usa similitud de cadenas (difflib) sobre el nombre normalizado sin acentos.
NO escribe a la base ni cambia el catálogo: solo propone, para que Sergio revise.

Salida:
  - db/seed_data/materias_a_revisar.json   (typos sugeridos + nuevas)
  - reporte por stdout
"""
import json, re, unicodedata
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
CATALOGO = Path("/tmp/catalogo.json")
DEMANDA = BASE / "db" / "seed_data" / "demanda_sepdic2026.json"
DISPO = BASE / "db" / "seed_data" / "disponibilidad_sepdic2026.json"
OUT = BASE / "db" / "seed_data" / "materias_a_revisar.json"

# Umbral: arriba de esto lo tratamos como "probable typo del catálogo"
UMBRAL_TYPO = 0.86


def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("\n", " ")).strip().upper()


def base(s):
    """Sin acentos, mayúsculas, sin puntuación — para comparar parecido."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9 ]+", " ", s.upper())


def sim(a, b):
    return SequenceMatcher(None, base(a), base(b)).ratio()


def main():
    cat = json.loads(CATALOGO.read_text())
    cat_nombres = [m["nombre"] for m in cat["materias"]]
    cat_base = {n: base(n) for n in cat_nombres}

    # juntar materias sin empatar de las dos fuentes, con su conteo y origen
    pendientes = Counter()
    origen = {}
    dem = json.loads(DEMANDA.read_text())
    for s in dem["slots"]:
        if not s["materia_en_catalogo"]:
            m = norm(s["materia"])
            pendientes[m] += 1
            origen.setdefault(m, set()).add("demanda")
    if DISPO.exists():
        dis = json.loads(DISPO.read_text())
        for d in dis["docentes"]:
            for v in d["carreras"].values():
                for it in v["materias"]:
                    if not it["en_catalogo"]:
                        m = norm(it["materia"])
                        pendientes[m] += 1
                        origen.setdefault(m, set()).add("disponibilidad")

    typos, nuevas = [], []
    for m, n in pendientes.most_common():
        # mejor candidato del catálogo
        mejor, score = max(((c, sim(m, c)) for c in cat_nombres),
                           key=lambda x: x[1])
        reg = {"materia": m, "veces": n, "origen": sorted(origen[m]),
               "sugerencia_catalogo": mejor, "parecido": round(score, 2)}
        (typos if score >= UMBRAL_TYPO else nuevas).append(reg)

    salida = {"umbral_typo": UMBRAL_TYPO,
              "typos_probables": typos,
              "materias_nuevas": nuevas}
    OUT.write_text(json.dumps(salida, ensure_ascii=False, indent=2))

    print("=" * 72)
    print("CLASIFICACIÓN DE MATERIAS SIN EMPATAR (revisión humana)")
    print("=" * 72)
    print(f"Distintas sin empatar: {len(pendientes)}  "
          f"(typos: {len(typos)}, nuevas: {len(nuevas)})")

    print("\n--- PROBABLES TYPOS (corregir al nombre del catálogo) ---")
    print(f"{'veces':>5}  {'parecido':>8}  materia escrita  ->  sugerencia catálogo")
    for r in sorted(typos, key=lambda x: -x["parecido"]):
        print(f"{r['veces']:>5}  {r['parecido']:>8}  {r['materia']}  ->  {r['sugerencia_catalogo']}")

    print("\n--- PROBABLES NUEVAS (dar de alta en catálogo) ---")
    print(f"{'veces':>5}  {'parecido':>8}  materia  (candidato más cercano)")
    for r in sorted(nuevas, key=lambda x: -x["veces"]):
        print(f"{r['veces']:>5}  {r['parecido']:>8}  {r['materia']}   ~ {r['sugerencia_catalogo']}")

    print(f"\nJSON escrito en: {OUT}")


if __name__ == "__main__":
    main()
