"use client";
// Form de UNA acción de servidor que puede devolver { error }: lo muestra inline bajo el
// botón en vez de perderlo. Necesario porque un `throw` desde una server action se REDACTA
// en producción (Next solo entrega un digest): el usuario nunca vería el mensaje en español.
// Con `confirm` pide confirmación antes de enviar (mismo comportamiento que ConfirmButton).
import { useActionState } from "react";
import { ConfirmButton } from "./confirm-button";
import { BotonSubmit } from "./boton-submit";

type ResultadoAccion = { error?: string } | void;

export function FormAccion({
  action,
  confirm,
  className,
  pendingText,
  children,
}: {
  action: () => Promise<ResultadoAccion>;
  confirm?: string;
  className?: string;
  pendingText?: string;
  children: React.ReactNode;
}) {
  const [state, dispatch] = useActionState(
    async (): Promise<{ error?: string }> => (await action()) ?? {},
    {},
  );
  return (
    <form action={dispatch}>
      {confirm ? (
        <ConfirmButton message={confirm} className={className}>{children}</ConfirmButton>
      ) : (
        <BotonSubmit className={className} pendingText={pendingText}>{children}</BotonSubmit>
      )}
      {state.error && (
        <p className="mt-1 max-w-[18rem] text-xs text-red-600">{state.error}</p>
      )}
    </form>
  );
}
