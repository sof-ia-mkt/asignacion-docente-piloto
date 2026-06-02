"use client";
// Botón de envío que pide confirmación antes de ejecutar la acción del <form>.
// Se usa para acciones destructivas (borrar docente, quitar asignación, eliminar clase).
// Si el usuario cancela, se evita el submit y no pasa nada.

export function ConfirmButton({
  children,
  message,
  className,
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
