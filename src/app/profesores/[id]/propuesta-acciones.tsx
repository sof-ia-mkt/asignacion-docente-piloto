"use client";
// Botones del ciclo de la propuesta del docente (cliente, porque combinan abrir el correo
// y llamar a una acción de servidor con confirmación):
//   - "Enviar por correo": abre el cliente de correo (mailto) Y marca la propuesta como ENVIADA.
//   - "Confirmar propuesta": acto forzoso del coordinador, sólo habilitado si ya está ENVIADA.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { marcarPropuestaEnviada, confirmarPropuesta } from "@/app/actions";

const base = "px-2.5 py-1.5 rounded-md text-sm whitespace-nowrap";

export function PropuestaAcciones({ profesorId, estado, mailtoHref, nombre }: {
  profesorId: number; estado: string; mailtoHref: string | null; nombre: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // El <a> abre el cliente de correo por su cuenta (mailto no navega la página); aquí
  // sólo registramos el envío en el servidor y refrescamos para ver el nuevo estado.
  const enviar = () => {
    start(async () => {
      const r = await marcarPropuestaEnviada(profesorId);
      if (!r.ok) { alert(r.error); return; }
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
      {mailtoHref ? (
        <a
          href={mailtoHref}
          onClick={enviar}
          className={`${base} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
          {estado === "borrador" ? "Enviar por correo" : "Reenviar por correo"}
        </a>
      ) : (
        <span
          title="Agrega el correo del docente en Editar para poder enviarle su propuesta."
          className={`${base} border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed`}>
          Enviar por correo
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
