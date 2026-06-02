import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Candado simple para el piloto: pide usuario y contraseña (popup del navegador)
// antes de dejar entrar a cualquier página. Si APP_PASSWORD no está configurada
// (ej. en local) se deja pasar sin candado.
export function proxy(request: NextRequest) {
  const pass = process.env.APP_PASSWORD;
  if (!pass) return NextResponse.next();

  const user = process.env.APP_USER || "cenyca";
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString();
    const i = decoded.indexOf(":");
    if (decoded.slice(0, i) === user && decoded.slice(i + 1) === pass) {
      return NextResponse.next();
    }
  }
  return new NextResponse("Autenticación requerida.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Asignación Docente CENYCA", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
