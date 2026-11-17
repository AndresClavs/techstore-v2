import jwt from "jsonwebtoken";
import { z } from "zod";
import { repos } from "../models/base.repository.js";
import { id, safeUser, failure } from "../utils/contract.js";
import { controller } from "../controllers/resource.controller.js";
export * from "../utils/contract.js";
async function authenticate(req, res, next) {
  try {
    const match = req.headers.authorization?.match(/^Bearer (.+)$/);
    if (!match) throw failure(401, "Inicia sesión");
    let sub;
    try {
      sub = jwt.verify(match[1], process.env.JWT_SECRET, {
        algorithms: ["HS256"],
      }).sub;
    } catch {
      throw failure(401, "Sesión inválida");
    }
    req.user = await repos
      .usuario()
      .findUnique({ where: { id_usuario: id.parse(sub) }, select: safeUser });
    if (req.user?.estado !== "activo") throw failure(401, "Usuario inactivo");
    next();
  } catch (error) {
    next(error);
  }
}
const authorize = (allowed) => (req, res, next) =>
  allowed.length && !allowed.includes(req.user.rol.nombre)
    ? next(failure(403, "Permiso insuficiente"))
    : next();
const validate = (schema) => (req, res, next) => {
  try {
    const params = Object.fromEntries(
      Object.entries(req.params).map(([k, v]) => [k, id.parse(v)]),
    );
    req.input = {
      user: req.user,
      params,
      body: schema?.parse(req.body),
      query: req.query,
    };
    next();
  } catch (error) {
    next(error);
  }
};
export function endpoint(
  router,
  method,
  path,
  allowed,
  schema,
  service,
  status = 200,
) {
  router[method](
    path,
    ...(allowed ? [authenticate, authorize(allowed)] : []),
    validate(schema),
    controller(service, status),
  );
}
export function handleError(e, req, res, next) {
  const status =
    e instanceof z.ZodError
      ? 422
      : { P2002: 409, P2025: 404, P2003: 409, P2034: 409 }[e.code] ||
        e.status ||
        500;
  const codigo =
    {
      400: "PETICION",
      401: "AUTENTICACION",
      403: "PERMISO",
      404: "NO_ENCONTRADO",
      409: "CONFLICTO",
      422: "VALIDACION",
      500: "INTERNO",
    }[status] || "ERROR";
  const mensaje =
    status === 400
      ? "Solicitud inválida"
      : e instanceof z.ZodError
        ? "Revisa los campos indicados"
        : e.code || status >= 500
          ? {
              404: "Registro inexistente",
              409: "Conflicto con los datos existentes",
            }[status] || "Error interno"
          : e.message;
  res
    .status(status)
    .json({
      success: false,
      error: {
        codigo,
        mensaje,
        detalles: e.issues?.map((i) => ({
          campo: i.path.join("."),
          mensaje: i.message,
        })),
      },
    });
}
