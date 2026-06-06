#!/usr/bin/env python3
"""
Genera 20 CVs PDF inventados pero COHERENTES para los docentes piloto.
- Infiere el área de cada docente desde su historial real (mayo).
- Le asigna título/maestría/experiencia plausibles para esa área.
- El CV describe formación + área + experiencia (no es una lista calcada de materias):
  así Claude tiene que INFERIR qué materias puede dar, y puede sugerir afines
  que el docente todavía no ha impartido.

Salida: docs/cvs-demo/*.pdf  +  db/seed_data/cvs_meta.json (ground truth del área).
"""
import json, random, datetime
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable

BASE = Path(__file__).resolve().parent.parent
DATA = json.load(open(BASE / "db" / "seed_data" / "casablanca.json"))
OUT_DIR = BASE / "docs" / "cvs-demo"
META_OUT = BASE / "db" / "seed_data" / "cvs_meta.json"
random.seed(42)

UNIS = ["Universidad Autónoma de Baja California", "CETYS Universidad",
        "Instituto Tecnológico de Tijuana", "Universidad Xochicalco",
        "Tecnológico de Monterrey", "Universidad de Sonora"]
EMPRESAS_ING = ["Smiths Interconnect", "Skyworks Solutions", "Plantronics (Poly)",
                "Hyundai Translead", "Toyota Baja California", "Honeywell Aerospace",
                "Kenworth Mexicana", "Eaton"]

# Configuración por área: keywords para detectar, y metadatos del CV.
AREAS = {
    "matematicas": {
        "kw": ["ÁLGEBRA", "ALGEBRA", "CÁLCULO", "CALCULO", "ESTADÍSTICA", "ESTADISTICA",
               "ECUACIONES", "MÉTODOS NUMÉRICOS", "METODOS NUMERICOS", "MODELACIÓN MATEMÁTICA",
               "MODELACION MATEMATICA", "INFERENCIA", "FUNDAMENTOS MATEMÁTICOS", "MULTIVARIABLE"],
        "lic": "Licenciatura en Matemáticas Aplicadas",
        "maestria": "Maestría en Ciencias con especialidad en Matemáticas Aplicadas",
        "perfil": "Docente con sólida formación en matemáticas y estadística aplicada a la ingeniería. "
                  "Experiencia impartiendo asignaturas de ciencias básicas y análisis cuantitativo en nivel superior.",
        "prof": ["Analista de datos en proyectos de mejora de procesos industriales.",
                 "Consultor en modelos estadísticos de control de calidad."],
        "cert": ["Certificación en análisis estadístico con R y Python",
                 "Diplomado en Didáctica de las Matemáticas"],
        "skills": "Estadística inferencial, cálculo aplicado, modelación matemática, álgebra lineal, análisis numérico.",
    },
    "electronica": {
        "kw": ["ELECTRÓNICA", "ELECTRONICA", "OPTOELECTRÓNICA", "CONTROL CLÁSICO", "CONTROL CLASICO",
               "INGENIERÍA ELÉCTRICA", "ELECTRICIDAD Y MAGNETISMO", "ELÉCTRICA"],
        "lic": "Ingeniería en Electrónica",
        "maestria": "Maestría en Ingeniería con orientación en Sistemas Electrónicos",
        "perfil": "Ingeniero en electrónica con experiencia en sistemas de control, instrumentación y "
                  "electrónica analógica/digital, tanto en industria como en docencia de ingeniería.",
        "prof": ["Ingeniero de pruebas en línea de manufactura electrónica.",
                 "Diseño de tableros de control e instrumentación industrial."],
        "cert": ["Certificación en sistemas de control PLC", "Diplomado en electrónica de potencia"],
        "skills": "Electrónica analógica y digital, sistemas de control, instrumentación, optoelectrónica.",
    },
    "electromecanica": {
        "kw": ["MECÁNICA", "MECANICA", "ESTÁTICA Y DINÁMICA", "ESTATICA Y DINAMICA", "MÁQUINAS",
               "MAQUINAS", "NEUMÁTICOS", "NEUMATICOS", "HIDRÁULICOS", "HIDRAULICOS", "DINÁMICA DE FLUÍDOS",
               "DINAMICA DE FLUIDOS", "MECÁNICA DE MATERIALES", "AUTOMATIZACIÓN", "ROBÓTICA", "ROBOTICA",
               "MANUFACTURA"],
        "lic": "Ingeniería Electromecánica",
        "maestria": "Maestría en Ingeniería Mecánica",
        "perfil": "Ingeniero electromecánico con experiencia en sistemas mecánicos, automatización y "
                  "manufactura. Ha combinado el ejercicio profesional en planta con la docencia en ingeniería.",
        "prof": ["Ingeniero de mantenimiento de equipo industrial.",
                 "Líder de proyectos de automatización de líneas de producción."],
        "cert": ["Certificación en automatización industrial (FESTO)", "SolidWorks Professional (CSWP)"],
        "skills": "Diseño mecánico, automatización, sistemas neumáticos e hidráulicos, manufactura, robótica.",
    },
    "industrial": {
        "kw": ["PLANEACIÓN Y CONTROL DE LA PRODUCCIÓN", "CONTROL ESTADÍSTICO DE LA CALIDAD",
               "INGENIERÍA DE MÉTODOS", "GESTIÓN DE LA CALIDAD", "ADMINISTRACIÓN DE LA PRODUCCIÓN",
               "ESTRUCTURA ORGANIZACIONAL", "SISTEMAS DE MANUFACTURA"],
        "lic": "Ingeniería Industrial",
        "maestria": "Maestría en Ingeniería Industrial y de Calidad",
        "perfil": "Ingeniero industrial especializado en mejora de procesos, control de calidad y "
                  "productividad. Experiencia en implementación de sistemas de gestión en manufactura.",
        "prof": ["Coordinador de mejora continua y Lean Manufacturing.",
                 "Responsable de sistemas de gestión de calidad ISO 9001."],
        "cert": ["Green Belt Six Sigma", "Auditor interno ISO 9001:2015"],
        "skills": "Lean Manufacturing, Six Sigma, control estadístico de calidad, planeación de producción.",
    },
    "programacion": {
        "kw": ["PROGRAMACIÓN", "PROGRAMACION", "ALGORITMOS", "BASE DE DATOS", "TECNOLOGÍAS DE LA INFORMACIÓN"],
        "lic": "Ingeniería en Sistemas Computacionales",
        "maestria": "Maestría en Ciencias de la Computación",
        "perfil": "Ingeniero en sistemas con experiencia en desarrollo de software, bases de datos y "
                  "fundamentos de programación. Combina práctica profesional en TI con docencia.",
        "prof": ["Desarrollador de software full-stack.",
                 "Administrador de bases de datos y sistemas de información."],
        "cert": ["Certificación Oracle Database SQL", "Scrum Master certificado (PSM I)"],
        "skills": "Programación estructurada y orientada a objetos, bases de datos, algoritmos, desarrollo web.",
    },
    "administracion": {
        "kw": ["ADMINISTRACIÓN", "ADMINISTRACION", "CONTABILIDAD", "FINANCIERA", "FINANZAS",
               "ECONOMÍA", "ECONOMIA", "AUDITORÍA", "AUDITORIA", "PRESUPUESTOS", "PLANEACIÓN ESTRATÉGICA"],
        "lic": "Licenciatura en Administración de Empresas",
        "maestria": "Maestría en Administración (MBA)",
        "perfil": "Profesional en administración y finanzas con experiencia gerencial y docente. "
                  "Especialista en planeación estratégica, contabilidad y gestión financiera.",
        "prof": ["Gerente administrativo y financiero en empresa de servicios.",
                 "Consultor en planeación estratégica para PyMEs."],
        "cert": ["Certificación en NIF (Normas de Información Financiera)", "Diplomado en Alta Dirección"],
        "skills": "Planeación estratégica, contabilidad, finanzas corporativas, análisis económico, auditoría.",
    },
    "criminologia": {
        "kw": ["DERECHO", "PENAL", "BALÍSTICA", "BALISTICA", "FORENSE", "CRIMINALÍSTICA", "CRIMINALISTICA",
               "TOXICOLOGÍA", "TOXICOLOGIA", "PERFILACIÓN", "PERFILACION", "PENITENCIARIO", "EXPLOSIVOS",
               "IDENTIFICACIONES", "DELINCUENCIA", "SEXOLOGÍA"],
        "lic": "Licenciatura en Criminología y Criminalística",
        "maestria": "Maestría en Ciencias Forenses",
        "perfil": "Especialista en criminología y ciencias forenses con experiencia pericial y docente. "
                  "Formación jurídica complementaria orientada al ámbito penal.",
        "prof": ["Perito en criminalística de campo.",
                 "Asesor en investigación criminal y cadena de custodia."],
        "cert": ["Certificación en cadena de custodia (Protocolo de Estambul)",
                 "Diplomado en perfilación criminal"],
        "skills": "Criminalística de campo, balística, medicina forense, perfilación criminal, derecho penal.",
    },
    "educacion": {
        "kw": ["PEDAGOGÍA", "PEDAGOGIA", "PSICOLOGÍA", "PSICOLOGIA", "EDUCACIÓN", "EDUCACION",
               "INNOVACIÓN Y TECNOLOGÍA EDUCATIVA"],
        "lic": "Licenciatura en Ciencias de la Educación",
        "maestria": "Maestría en Educación con especialidad en Innovación Educativa",
        "perfil": "Profesional de la educación y psicología educativa con experiencia en docencia, "
                  "diseño instruccional y tecnología educativa.",
        "prof": ["Coordinadora académica y diseñadora instruccional.",
                 "Asesora pedagógica en programas de educación superior."],
        "cert": ["Certificación en diseño instruccional", "Diplomado en tecnologías para el aprendizaje"],
        "skills": "Diseño instruccional, psicología educativa, tecnología educativa, didáctica.",
    },
}
LABELS = {
    "matematicas": "ciencias básicas y matemáticas",
    "electronica": "electrónica y control",
    "electromecanica": "ingeniería electromecánica",
    "industrial": "ingeniería industrial y calidad",
    "programacion": "programación y sistemas",
    "administracion": "administración y finanzas",
    "criminologia": "criminología y ciencias forenses",
    "educacion": "educación y psicología",
}
for _k, _v in LABELS.items():
    AREAS[_k]["label"] = _v

GENERICO = ["PROYECTO INTEGRADOR", "PROYECTOS DE INVESTIGACIÓN", "SEMINARIO DE TESIS",
            "INNOVACIÓN TECNOLÓGICA", "QUÍMICA APLICADA"]


def inferir_area(historial):
    score = {a: 0 for a in AREAS}
    for mat in historial:
        for area, cfg in AREAS.items():
            if any(k in mat for k in cfg["kw"]):
                score[area] += 1
    best = max(score, key=score.get)
    if score[best] == 0:
        best = "electromecanica"  # fallback ingeniería
    return best, score


def build_pdf(doc_info, area_key, path):
    cfg = AREAS[area_key]
    nombre_title = doc_info["nombre"].title()
    slug = doc_info["slug"]
    hist = doc_info["historial_materias"]
    anios_exp = random.randint(6, 18)
    uni = random.choice(UNIS)
    uni2 = random.choice([u for u in UNIS if u != uni])

    styles = getSampleStyleSheet()
    H = ParagraphStyle("H", parent=styles["Heading2"], textColor=colors.HexColor("#1a3a6b"),
                       spaceBefore=10, spaceAfter=4, fontSize=12)
    NAME = ParagraphStyle("NAME", parent=styles["Title"], fontSize=20,
                          textColor=colors.HexColor("#1a3a6b"), spaceAfter=2)
    SUB = ParagraphStyle("SUB", parent=styles["Normal"], fontSize=10,
                         textColor=colors.HexColor("#555555"), spaceAfter=2)
    BODY = ParagraphStyle("BODY", parent=styles["Normal"], fontSize=10, leading=14)
    BULLET = ParagraphStyle("BULLET", parent=BODY, leftIndent=12, bulletIndent=2)

    correo = slug.replace("-", ".") + "@correo.com"
    tel = f"664-{random.randint(100,999)}-{random.randint(1000,9999)}"

    elems = [
        Paragraph(nombre_title, NAME),
        Paragraph(cfg["lic"], SUB),
        Paragraph(f"Tijuana, B.C. &nbsp;|&nbsp; {tel} &nbsp;|&nbsp; {correo}", SUB),
        HRFlowable(width="100%", thickness=1, color=colors.HexColor("#1a3a6b"), spaceBefore=6, spaceAfter=4),
        Paragraph("Perfil profesional", H),
        Paragraph(cfg["perfil"] + f" Más de {anios_exp} años de trayectoria combinando industria y docencia universitaria.", BODY),
        Paragraph("Formación académica", H),
        Paragraph(f"<b>{cfg['maestria']}</b><br/>{uni} — {2026-anios_exp+random.randint(2,5)}", BODY),
        Spacer(1, 3),
        Paragraph(f"<b>{cfg['lic']}</b><br/>{uni2} — {2026-anios_exp}", BODY),
        Paragraph("Experiencia docente", H),
    ]
    # CENYCA con materias del historial (subset)
    mat_cenyca = ", ".join(m.title() for m in hist[:6])
    elems.append(Paragraph(
        f"<b>Profesor de asignatura — CENYCA</b> (2022 – actualidad)<br/>"
        f"Impartición de materias del área de {cfg['label']}: {mat_cenyca}.", BODY))
    elems.append(Spacer(1, 3))
    elems.append(Paragraph(
        f"<b>Docente — {uni2}</b> ({2026-anios_exp+1} – 2021)<br/>"
        f"Asignaturas de ciencias básicas e ingeniería a nivel licenciatura.", BODY))

    elems.append(Paragraph("Experiencia profesional", H))
    for b in cfg["prof"]:
        emp = random.choice(EMPRESAS_ING) if area_key in ("electronica", "electromecanica", "industrial", "programacion") else "sector privado"
        elems.append(Paragraph(f"• {b} <i>({emp})</i>", BULLET))

    elems.append(Paragraph("Certificaciones", H))
    for c in cfg["cert"]:
        elems.append(Paragraph(f"• {c}", BULLET))

    elems.append(Paragraph("Habilidades", H))
    elems.append(Paragraph(cfg["skills"], BODY))

    SimpleDocTemplate(str(path), pagesize=letter, topMargin=1.8*cm, bottomMargin=1.8*cm,
                      leftMargin=2*cm, rightMargin=2*cm,
                      title=f"CV {nombre_title}").build(elems)
    return {"area": area_key, "lic": cfg["lic"], "maestria": cfg["maestria"], "anios_exp": anios_exp}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    meta = []
    for d in DATA["docentes_piloto"]:
        area, score = inferir_area(d["historial_materias"])
        path = OUT_DIR / f"{d['slug']}.pdf"
        info = build_pdf(d, area, path)
        meta.append({"nombre": d["nombre"], "slug": d["slug"], "archivo": path.name,
                     "area_inferida": area, **info})
        print(f"  {d['nombre'][:34]:35s} -> {area:15s} {path.name}")
    META_OUT.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print(f"\n{len(meta)} CVs generados en {OUT_DIR}")
    # resumen por área
    from collections import Counter
    print("Distribución por área:", dict(Counter(m["area_inferida"] for m in meta)))


if __name__ == "__main__":
    main()
