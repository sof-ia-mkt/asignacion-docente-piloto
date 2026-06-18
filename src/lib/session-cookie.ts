// Nombre de la cookie de sesión. En su propio módulo (sin imports de Node) para que
// lo puedan compartir el middleware (runtime edge) y el servidor sin arrastrar `pg`.
export const COOKIE_SESION = "sesion";
