"use client";
// Botón de submit que se deshabilita mientras la server action del <form> padre corre.
// Evita el doble clic → acción ejecutada dos veces → movimientos duplicados en la bitácora.
// Úsalo en lugar de <button> plano dentro de cualquier <form action={...}> sin useActionState.
import { useFormStatus } from "react-dom";

export function BotonSubmit({
  children,
  className,
  pendingText,
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${className ?? ""} disabled:opacity-50`}>
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
