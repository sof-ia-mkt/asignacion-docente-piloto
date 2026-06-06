"use client";
// Botones del ciclo de la propuesta del docente. Tres pasos, ninguno automático:
//   1. "Abrir correo": abre el borrador en Gmail (pestaña nueva). NO cambia el estado.
//      El coordinador lo revisa, adjunta el PDF y lo ENVÍA él mismo desde su cuenta.
//   2. "Marcar como enviada": aparece tras abrir el correo y pide CONFIRMACIÓN antes de
//      registrar el envío (porque la app no puede saber si de verdad le diste "Enviar").
//   3. "Confirmar propuesta": acto forzoso del coordinador, sólo si ya está ENVIADA.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { marcarPropuestaEnviada, confirmarPropuesta } from "@/app/actions";

const base = "px-2.5 py-1.5 rounded-md text-sm whitespace-nowrap";

export function PropuestaAcciones({ profesorId, estado, correoHref, nombre }: {
  profesorId: number; estado: string; correoHref: string | null; nombre: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Se pone en true al abrir el borrador en Gmail: sólo entonces ofrecemos "Marcar como enviada".
  const [abrioCorreo, setAbrioCorreo] = useState(false);

  // Marca "Propuesta enviada" SÓLO tras un cuadro de confirmación explícito: la app abre el
  // borrador pero no envía nada, así que el coordinador afirma que ya le dio "Enviar" en Gmail.
  const marcarEnviada = () => {
    if (!window.confirm(
      `¿Ya enviaste la Propuesta Académica a ${nombre} desde tu correo?\n\nAcepta SÓLO si de verdad le diste "Enviar" en Gmail. Quedará como "Propuesta enviada".`)) return;
    start(async () => {
      const r = await marcarPropuestaEnviada(profesorId);
      if (!r.ok) { alert(r.error); return; }
      setAbrioCorreo(false);
      router.refresh();
    });
  };

  const confirmar = () => {
    if (!window.confirm(
      `¿Confirmar la propuesta de ${nombre}?\n\nHazlo SÓLO cuando el docente ya aceptó. Quedará como "Confirmada".`)) return;
    start(async () => {
      const r = await confirmarPropuesta(profesorId);
      if (!r.ok) { alert(r.error); return; }
      router.refresh();
    });
  };

  return (
    <>
      {correoHref ? (
        <>
          {/* Enlace nativo: abre Gmail en pestaña nueva de forma confiable (sin bloqueo de pop-ups). */}
          <a
            href={correoHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setAbrioCorreo(true)}
            title="Abre el borrador en Gmail para que lo revises y lo envíes tú. La plataforma no envía nada."
            className={`${base} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
            {estado === "borrador" ? "Abrir correo" : "Reabrir correo"}
          </a>
          {abrioCorreo && estado !== "confirmada" && (
            <button
              type="button"
              onClick={marcarEnviada}
              disabled={pending}
              title="Hazlo sólo después de enviar el correo desde tu cuenta de Gmail."
              className={`${base} border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-60`}>
              Marcar como enviada
            </button>
          )}
        </>
      ) : (
        <span
          title="Agrega el correo del docente en Editar para poder enviarle su propuesta."
          className={`${base} border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed`}>
          Abrir correo
        </span>
      )}

      {estado === "confirmada" ? (
        <span className={`${base} border border-green-200 bg-green-50 text-green-700`}>
          Confirmada ✓
        </span>
      ) : (
        <button
          type="button"
          onClick={confirmar}
          disabled={estado !== "enviada" || pending}
          title={estado !== "enviada" ? "Primero envía la propuesta al docente." : "Confirmar que el docente aceptó."}
          className={`${base} ${estado === "enviada"
            ? "bg-green-600 text-white hover:bg-green-700"
            : "border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"} disabled:opacity-60`}>
          Confirmar propuesta
        </button>
      )}
    </>
  );
}
