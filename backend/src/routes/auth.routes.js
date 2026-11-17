import { z } from "zod";
import { endpoint, id, str, roles } from "../middleware/http.js";
import * as service from "../services/auth.service.js";
const email = z
  .string()
  .email()
  .max(150)
  .transform((s) => s.toLowerCase());
const password = z.string().min(8).max(72);
const profile = z.object({
  nombres: str(100),
  apellidos: str(100),
  telefono: str(20).optional(),
  fecha_nacimiento: z.coerce.date().optional(),
});
const address = z.object({
  alias: str(50).optional(),
  destinatario: str(150),
  telefono_contacto: str(20).optional(),
  calle_principal: str(150),
  calle_secundaria: str(150).optional(),
  numeracion: str(20).optional(),
  referencia: str(255).optional(),
  ciudad: str(100),
  provincia: str(100),
  pais: str(100).optional(),
  codigo_postal: str(20).optional(),
  es_predeterminada: z.boolean().optional(),
});
export function authRoutes(r) {
  const route = (...args) => endpoint(r, ...args);
  route(
    "post",
    "/auth/registro",
    null,
    profile.extend({ identificacion: str(20), email, password }).strict(),
    service.postAuthRegistro,
    201,
  );
  route(
    "post",
    "/auth/login",
    null,
    z.object({ email, password: z.string().max(128) }).strict(),
    service.postAuthLogin,
  );
  route("get", "/auth/me", [], null, service.getAuthMe);
  route("get", "/usuarios/:id", [], null, service.getUsuarios);
  route(
    "put",
    "/usuarios/:id",
    [],
    profile.partial().extend({ password: password.optional() }).strict(),
    service.putUsuarios,
  );
  const path = "/usuarios/:id/direcciones";
  route("get", path, [], null, service.listarDirecciones);
  for (const method of ["post", "put", "delete"])
    route(
      method,
      path + (method === "post" ? "" : "/:dir"),
      [],
      method === "delete"
        ? null
        : method === "post"
          ? address.strict()
          : address.partial().strict(),
      service.modificarDireccion(method),
      method === "delete" ? 204 : method === "post" ? 201 : 200,
    );
  route("get", "/admin/roles", roles.admin, null, service.getAdminRoles);
  route("get", "/admin/usuarios", roles.admin, null, service.getAdminUsuarios);
  route(
    "put",
    "/admin/usuarios/:id",
    roles.admin,
    z
      .object({
        id_rol: id.optional(),
        estado: z.enum(["activo", "inactivo", "bloqueado"]).optional(),
      })
      .strict(),
    service.putAdminUsuarios,
  );
}
