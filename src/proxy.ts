import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { leerToken } from "@/lib/session-token";
import { COOKIE_SESION } from "@/lib/session-cookie";

// Candado de la plataforma: cada página exige una sesión válida (cookie firmada).
// Si no hay sesión, se redirige a /login. La validación profunda (que el usuario siga
// activo en la base) la hace src/lib/session.ts; aquí solo verificamos firma y expiración.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Pasa la ruta actual en un header para que el layout pueda saber dónde estamos
  // (el layout fuerza el cambio de contraseña salvo en /cambiar-password y /login).
  const conRuta = () => {
    const h = new Headers(request.headers);
    h.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: h } });
  };

  // /login y los recursos públicos no requieren sesión (si no, no se podría entrar).
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return conRuta();
  }

  const token = request.cookies.get(COOKIE_SESION)?.value;
  if (await leerToken(token)) {
    return conRuta();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
