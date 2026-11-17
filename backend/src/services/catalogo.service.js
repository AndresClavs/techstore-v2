import { z } from "zod";
import { repos, transaction } from "../models/base.repository.js";
import { id, str, list, failure } from "../utils/contract.js";
const include = {
  marca: true,
  categoria: true,
  inventario: true,
  imagen_producto: { orderBy: [{ es_principal: "desc" }, { orden: "asc" }] },
  especificacion: true,
  resena: {
    where: { estado_moderacion: "aprobada" },
    select: { calificacion: true },
  },
};
function view(row, admin = false) {
  const { inventario, imagen_producto, especificacion, resena, costo, ...p } =
    row;
  return {
    ...p,
    ...(admin ? { costo, ...inventario } : {}),
    imagen_principal: imagen_producto[0]?.url || null,
    imagenes: imagen_producto,
    especificaciones: especificacion,
    stock_disponible: Math.max(
      0,
      (inventario?.stock_actual || 0) - (inventario?.stock_reservado || 0),
    ),
    total_resenas: resena.length,
    rating_promedio: resena.length
      ? resena.reduce((a, b) => a + b.calificacion, 0) / resena.length
      : null,
  };
}
function descendants(rows, id) {
  const ids = new Set([id]);
  for (const current of ids)
    for (const row of rows)
      if (row.id_categoria_padre === current) ids.add(row.id_categoria);
  return [...ids];
}
export const listarProductos =
  (admin) =>
  async ({ query: q }) => {
    const where = { estado: admin ? q.estado : "activo" };
    if (q.q)
      where.OR = ["nombre", "sku", "descripcion"].map((k) => ({
        [k]: { contains: str(200).parse(q.q) },
      }));
    if (q.marca) where.id_marca = id.parse(q.marca);
    if (q.categoria)
      where.id_categoria = {
        in: descendants(
          await repos.categoria().findMany(),
          id.parse(q.categoria),
        ),
      };
    if (q.destacado) where.destacado = q.destacado === "1";
    if (q.precio_min || q.precio_max)
      where.precio_venta = {
        gte:
          q.precio_min === undefined
            ? undefined
            : z.coerce.number().nonnegative().parse(q.precio_min),
        lte:
          q.precio_max === undefined
            ? undefined
            : z.coerce.number().nonnegative().parse(q.precio_max),
      };
    const orderBy = {
      precio_asc: { precio_venta: "asc" },
      precio_desc: { precio_venta: "desc" },
      recientes: { id_producto: "desc" },
      nombre: { nombre: "asc" },
    }[q.orden] || { id_producto: "asc" };
    const result = await list(repos.producto(), q, { where, orderBy, include });
    result.data = result.data.map((p) => view(p, admin));
    return result;
  };
export const getProductos = async ({ params }) =>
  view(
    await repos
      .producto()
      .findFirstOrThrow({
        where: { id_producto: params.id, estado: "activo" },
        include,
      }),
  );
export const getCategorias = async () => {
  const rows = await repos.categoria().findMany({ where: { activa: true } });
  const tree = (parent) =>
    rows
      .filter((c) => c.id_categoria_padre === parent)
      .map((c) => ({ ...c, hijos: tree(c.id_categoria) }));
  return tree(null);
};
export const listarOpciones = (model, where) => () =>
  repos[model]().findMany({ where });
export const modificarAdminProductos = ({ params, body }) =>
  transaction(async (tx) => {
    const {
      imagenes,
      especificaciones,
      stock_minimo,
      ubicacion_bodega,
      ...data
    } = body;
    const creating = !params.id;
    if (imagenes)
      data.imagen_producto = creating
        ? { create: imagenes }
        : { deleteMany: {}, create: imagenes };
    if (especificaciones)
      data.especificacion = creating
        ? { create: especificaciones }
        : { deleteMany: {}, create: especificaciones };
    const inv = { stock_minimo, ubicacion_bodega };
    if (creating) data.inventario = { create: inv };
    else if (stock_minimo !== undefined || ubicacion_bodega !== undefined)
      data.inventario = { upsert: { create: inv, update: inv } };
    return creating
      ? repos.producto(tx).create({ data })
      : repos.producto(tx).update({ where: { id_producto: params.id }, data });
  });
export const deleteAdminProductos = ({ params }) =>
  repos
    .producto()
    .update({
      where: { id_producto: params.id },
      data: { estado: "inactivo" },
    });
export const listarRegistros =
  (name) =>
  ({ query }) =>
    list(repos[name](), query);
export const modificarRegistro =
  (name, inactive, pk, method) =>
  ({ params, body }) =>
    transaction(async (tx) => {
      const m = repos[name](tx),
        where = { [pk]: params.id };
      if (name === "cupon" && body) {
        const previous = params.id ? await m.findUniqueOrThrow({ where }) : {};
        const coupon = { ...previous, ...body };
        if (
          coupon.fecha_inicio > coupon.fecha_fin ||
          (coupon.tipo_descuento === "porcentaje" &&
            Number(coupon.valor_descuento) > 100)
        )
          throw failure(422, "Revisa el período y el porcentaje del cupón");
      }
      if (
        name === "categoria" &&
        params.id &&
        body?.id_categoria_padre &&
        descendants(await m.findMany(), params.id).includes(
          body.id_categoria_padre,
        )
      )
        throw failure(422, "La categoría formaría un ciclo");
      if (method === "delete")
        return inactive
          ? m.update({ where, data: inactive })
          : m.delete({ where });
      return method === "post"
        ? m.create({ data: body })
        : m.update({ where, data: body });
    });
export const getFavoritos = async ({ user }) =>
  (
    await repos
      .favorito()
      .findMany({
        where: { id_usuario: user.id_usuario, producto: { estado: "activo" } },
        include: { producto: { include } },
      })
  ).map((f) => view(f.producto));
export const postFavoritos = ({ user, body }) => {
  const key = { id_usuario: user.id_usuario, ...body };
  return repos
    .favorito()
    .upsert({
      where: { id_usuario_id_producto: key },
      create: key,
      update: {},
    });
};
export const deleteFavoritos = ({ user, params }) =>
  repos
    .favorito()
    .deleteMany({
      where: { id_usuario: user.id_usuario, id_producto: params.id },
    });
export const getProductosResenas = ({ params, query }) =>
  list(repos.resena(), query, {
    where: { id_producto: params.id, estado_moderacion: "aprobada" },
    include: { usuario: { select: { nombres: true } } },
  });
export const postProductosResenas = ({ params, user, body }) =>
  transaction(async (tx) => {
    const keys = { id_producto: params.id, id_usuario: user.id_usuario };
    if (await repos.resena(tx).findFirst({ where: keys }))
      throw failure(409, "Ya registraste una reseña");
    const compra = await repos
      .detalle_pedido(tx)
      .findFirst({
        where: {
          id_producto: params.id,
          pedido: {
            id_usuario: user.id_usuario,
            estado: { in: ["pagado", "preparando", "enviado", "entregado"] },
          },
        },
      });
    return repos
      .resena(tx)
      .create({ data: { ...keys, ...body, compra_verificada: !!compra } });
  });
export const getAdminResenas = ({ query }) =>
  list(repos.resena(), query, { where: { estado_moderacion: query.estado } });
export const putAdminResenasModerar = ({ params, body }) =>
  repos.resena().update({ where: { id_resena: params.id }, data: body });
