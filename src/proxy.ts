import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { leerToken } from "@/lib/session-token";
import { COOKIE_SESION } from "@/lib/session-cookie";

// Candado de la plataforma: cada página exige una sesión válida (cookie firmada).
// Si no hay sesión, se redirige a /login. La validación profunda (que el usuario siga
// activo en la base) la hace src/lib/session.ts; aquí solo verificamos firma y expiración.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /login y los recursos públicos no requieren sesión (si no, no se podría entrar).
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_SESION)?.value;
  if (await leerToken(token)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
