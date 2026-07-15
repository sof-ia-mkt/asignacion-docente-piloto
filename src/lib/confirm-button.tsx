"use client";
// Botón de envío que pide confirmación antes de ejecutar la acción del <form>.
// Se usa para acciones destructivas (borrar docente, quitar asignación, eliminar clase).
// Si el usuario cancela, se evita el submit y no pasa nada.
// Mientras la acción corre se deshabilita (useFormStatus): un doble clic ya no dispara
// la acción dos veces (evita movimientos duplicados en la bitácora).
import { useFormStatus } from "react-dom";

export function ConfirmButton({
  children,
  message,
  className,
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${className ?? ""} disabled:opacity-50`}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
