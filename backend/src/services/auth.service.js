import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { repos, transaction } from "../models/base.repository.js";
import { id, safeUser, failure, list } from "../utils/contract.js";
function owner(user, id) {
  if (user.id_usuario !== id && user.rol.nombre !== "Administrador")
    throw failure(403, "Recurso ajeno");
}
function session(usuario) {
  return {
    usuario: { ...usuario, rol: usuario.rol.nombre },
    token: jwt.sign({ rol: usuario.rol.nombre }, process.env.JWT_SECRET, {
      subject: String(usuario.id_usuario),
      expiresIn: process.env.JWT_EXPIRES_IN || "8h",
    }),
  };
}
export const postAuthRegistro = async ({ body }) => {
  const { password, ...data } = body;
  const usuario = await repos
    .usuario()
    .create({
      data: {
        ...data,
        contrasena_hash: await bcrypt.hash(password, 10),
        rol: { connect: { nombre: "Cliente" } },
      },
      select: safeUser,
    });
  return session(usuario);
};
export const postAuthLogin = async ({ body }) => {
  const u = await repos.usuario().findUnique({ where: { email: body.email } });
  if (
    u?.estado !== "activo" ||
    !(await bcrypt.compare(body.password, u.contrasena_hash))
  )
    throw failure(401, "Credenciales inválidas");
  return session(
    await repos
      .usuario()
      .update({
        where: { id_usuario: u.id_usuario },
        data: { ultimo_acceso: new Date() },
        select: safeUser,
      }),
  );
};
export const getAuthMe = ({ user }) => ({ ...user, rol: user.rol.nombre });
export const getUsuarios = ({ user, params }) => {
  owner(user, params.id);
  return repos
    .usuario()
    .findUniqueOrThrow({ where: { id_usuario: params.id }, select: safeUser });
};
export const putUsuarios = async ({ user, params, body }) => {
  owner(user, params.id);
  const { password, ...data } = body;
  if (password) data.contrasena_hash = await bcrypt.hash(password, 10);
  return repos
    .usuario()
    .update({ where: { id_usuario: params.id }, data, select: safeUser });
};
export const listarDirecciones = ({ user, params }) => {
  owner(user, params.id);
  return repos.direccion().findMany({ where: { id_usuario: params.id } });
};
export const modificarDireccion =
  (method) =>
  ({ user, params, body }) => {
    owner(user, params.id);
    return transaction(async (tx) => {
      const model = repos.direccion(tx),
        where = { id_usuario: params.id, id_direccion: params.dir };
      if (params.dir) await model.findFirstOrThrow({ where });
      if (method === "delete") return model.delete({ where });
      if (body.es_predeterminada)
        await model.updateMany({
          where: { id_usuario: params.id },
          data: { es_predeterminada: false },
        });
      return params.dir
        ? model.update({ where, data: body })
        : model.create({ data: { ...body, id_usuario: params.id } });
    });
  };
export const getAdminRoles = () => repos.rol().findMany();
export const getAdminUsuarios = ({ query }) =>
  list(repos.usuario(), query, {
    where: {
      estado: query.estado,
      rol: query.rol ? { nombre: query.rol } : undefined,
      email: { contains: query.q || "" },
    },
    select: safeUser,
  });
export const putAdminUsuarios = ({ params, body }) =>
  repos
    .usuario()
    .update({ where: { id_usuario: params.id }, data: body, select: safeUser });
