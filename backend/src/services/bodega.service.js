import { z } from "zod";
import { repos, transaction } from "../models/base.repository.js";
import { LIMITE_UNIDADES_PROVEEDOR, id, list, failure, page } from "../utils/contract.js";
import {
  registrarMovimiento,
  round,
  decimal,
} from "../services/inventario.service.js";
import { temporary, numberDoc } from "../services/checkout.service.js";
function unique(rows, key) {
  if (new Set(rows.map((row) => row[key])).size !== rows.length)
    throw failure(422, "Detalle repetido");
}
async function orderState(tx, id_orden_compra) {
  const lines = await repos
    .detalle_orden_compra(tx)
    .findMany({ where: { id_orden_compra } });
  const estado = lines.every(
    (l) => l.cantidad_recibida === l.cantidad_solicitada,
  )
    ? "recibida_total"
    : lines.some((l) => l.cantidad_recibida)
      ? "recibida_parcial"
      : "enviada";
  return repos
    .orden_compra(tx)
    .update({ where: { id_orden_compra }, data: { estado } });
}
export const getInventario = async ({ query }) => {
  const rows = await repos
    .inventario()
    .findMany({
      where: {
        producto: {
          OR: [
            { nombre: { contains: query.q || "" } },
            { sku: { contains: query.q || "" } },
          ],
        },
      },
      include: {
        producto: {
          select: {
            nombre: true,
            sku: true,
            costo: true,
            kardex: { orderBy: { id_kardex: "desc" }, take: 1 },
          },
        },
      },
      orderBy: { id_producto: "asc" },
    });
  const all = rows
    .map(({ producto, ...i }) => ({
      ...i,
      nombre: producto.nombre,
      sku: producto.sku,
      costo_promedio:
        producto.kardex[0]?.saldo_costo_promedio ?? producto.costo,
      valor_inventario:
        producto.kardex[0]?.saldo_valor ?? producto.costo.times(i.stock_actual),
      stock_disponible: i.stock_actual - i.stock_reservado,
      bajo_stock: i.stock_actual < i.stock_minimo,
    }))
    .filter((i) => query.bajo_stock !== "true" || i.bajo_stock);
  const { pagina, limite, skip } = page(query);
  return {
    data: all.slice(skip, skip + limite),
    meta: {
      pagina,
      limite,
      total: all.length,
      totalPaginas: Math.ceil(all.length / limite),
    },
  };
};
export const putInventario = ({ params, body }) =>
  repos.inventario().update({ where: { id_producto: params.id }, data: body });
export const getInventarioKardex = async ({ params, query }) => ({
  producto: await repos
    .producto()
    .findUniqueOrThrow({ where: { id_producto: params.id } }),
  saldo_actual: await repos
    .inventario()
    .findUnique({ where: { id_producto: params.id } }),
  movimientos: await repos
    .kardex()
    .findMany({
      where: {
        id_producto: params.id,
        fecha_kardex: {
          gte: query.desde ? z.coerce.date().parse(query.desde) : undefined,
          lte: query.hasta ? z.coerce.date().parse(query.hasta) : undefined,
        },
      },
      orderBy: { id_kardex: "asc" },
      include: { usuario: { select: { nombres: true, apellidos: true } } },
    }),
});
export const postInventarioAjustes = ({ user, body: b }) =>
  transaction((tx) =>
    registrarMovimiento(tx, {
      ...b,
      id_usuario: user.id_usuario,
      cantidad: b.tipo === "positivo" ? b.cantidad : -b.cantidad,
      tipo_documento: "ajuste_" + b.tipo,
      detalle: b.motivo,
    }),
  );
export const getProveedoresProductos = ({ params }) =>
  repos
    .producto_proveedor()
    .findMany({
      where: { id_proveedor: params.id },
      include: { producto: true },
    });
export const postProveedoresProductos = ({ params, body }) => {
  const key = { id_proveedor: params.id, id_producto: body.id_producto };
  return repos
    .producto_proveedor()
    .upsert({
      where: { id_producto_id_proveedor: key },
      create: { ...key, ...body },
      update: body,
    });
};
export const deleteProveedoresProductosProducto = ({ params }) =>
  repos
    .producto_proveedor()
    .delete({
      where: {
        id_producto_id_proveedor: {
          id_proveedor: params.id,
          id_producto: params.producto,
        },
      },
    });
export const getOrdenesCompra = ({ query }) =>
  list(repos.orden_compra(), query, {
    where: {
      estado: query.estado,
      id_proveedor: query.id_proveedor
        ? id.parse(query.id_proveedor)
        : undefined,
    },
    include: {
      proveedor: { select: { razon_social: true, ruc: true } },
      _count: { select: { detalle_orden_compra: true } },
    },
    orderBy: { id_orden_compra: "desc" },
  });
export const getOrdenesCompraRegistro = ({ params }) =>
  repos
    .orden_compra()
    .findUniqueOrThrow({
      where: { id_orden_compra: params.id },
      include: {
        proveedor: true,
        detalle_orden_compra: {
          include: { producto: { select: { nombre: true, sku: true } } },
          orderBy: { id_detalle_oc: "asc" },
        },
        recepcion_compra: { orderBy: { id_recepcion: "asc" } },
      },
    });
export const modificarOrdenesCompra = ({ user, params, body }) =>
  transaction(async (tx) => {
    const { detalles, ...header } = body;
    unique(detalles, "id_producto");
    const unidades = detalles.reduce((a, l) => a + l.cantidad_solicitada, 0);
    if (unidades > LIMITE_UNIDADES_PROVEEDOR)
      throw failure(
        422,
        "Política de la empresa: no se pueden comprar más de " +
          LIMITE_UNIDADES_PROVEEDOR.toLocaleString("es-EC") +
          " unidades a un proveedor en una misma orden de compra. Esta orden suma " +
          unidades.toLocaleString("es-EC") +
          " unidades.",
      );
    const supplier = await repos
      .proveedor(tx)
      .findUnique({ where: { id_proveedor: header.id_proveedor } });
    if (!supplier?.activo)
      throw failure(422, "Selecciona un proveedor activo");
    if (params.id) {
      const oc = await repos
        .orden_compra(tx)
        .findUniqueOrThrow({ where: { id_orden_compra: params.id } });
      if (oc.estado !== "borrador")
        throw failure(409, "Orden fuera de borrador");
    }
    let subtotal = decimal(0),
      iva = decimal(0);
    const lines = [];
    for (const line of detalles) {
      const p = await repos
        .producto(tx)
        .findUniqueOrThrow({ where: { id_producto: line.id_producto } });
      const net = round(
          decimal(line.costo_unitario).times(line.cantidad_solicitada),
        ),
        tax = round(net.times(p.porcentaje_iva).div(100));
      subtotal = subtotal.plus(net);
      iva = iva.plus(tax);
      lines.push({ ...line, subtotal: net, iva: tax });
    }
    const data = {
      ...header,
      subtotal,
      iva,
      total: subtotal.plus(iva),
      detalle_orden_compra: params.id
        ? { deleteMany: {}, create: lines }
        : { create: lines },
    };
    if (params.id)
      return repos
        .orden_compra(tx)
        .update({ where: { id_orden_compra: params.id }, data });
    const oc = await repos
      .orden_compra(tx)
      .create({
        data: {
          ...data,
          numero_orden: temporary(),
          id_usuario: user.id_usuario,
        },
      });
    return repos
      .orden_compra(tx)
      .update({
        where: { id_orden_compra: oc.id_orden_compra },
        data: { numero_orden: numberDoc("OC", oc.id_orden_compra) },
      });
  });
export const modificarOrdenesCompraEnviar =
  (method) =>
  ({ params }) =>
    transaction(async (tx) => {
      const where = { id_orden_compra: params.id },
        oc = await repos
          .orden_compra(tx)
          .findUniqueOrThrow({
            where,
            include: { detalle_orden_compra: true, recepcion_compra: true },
          });
      if (
        method === "post"
          ? oc.estado !== "borrador" || !oc.detalle_orden_compra.length
          : !["enviada", "borrador"].includes(oc.estado) ||
            oc.recepcion_compra.some((x) => x.estado === "completada")
      )
        throw failure(409, "Estado de orden incompatible");
      return repos
        .orden_compra(tx)
        .update({
          where,
          data: { estado: method === "post" ? "enviada" : "cancelada" },
        });
    });
export const postOrdenesCompraRecepciones = ({ user, params, body }) =>
  transaction(async (tx) => {
    const { detalles, ...header } = body;
    unique(detalles, "id_detalle_oc");
    const oc = await repos
      .orden_compra(tx)
      .findUniqueOrThrow({
        where: { id_orden_compra: params.id },
        include: { detalle_orden_compra: { orderBy: { id_producto: "asc" } } },
      });
    if (!["enviada", "recibida_parcial"].includes(oc.estado))
      throw failure(409, "Orden no disponible para recepción");
    if (
      detalles.some(
        (d) =>
          !oc.detalle_orden_compra.some(
            (l) => l.id_detalle_oc === d.id_detalle_oc,
          ) || !(d.cantidad_recibida + d.cantidad_rechazada),
      )
    )
      throw failure(422, "Detalle de recepción inválido");
    const rec = await repos
      .recepcion_compra(tx)
      .create({
        data: {
          ...header,
          id_orden_compra: params.id,
          id_usuario: user.id_usuario,
          numero_recepcion: temporary(),
          estado: "completada",
          detalle_recepcion: { create: detalles },
        },
      });
    for (const line of oc.detalle_orden_compra) {
      const d = detalles.find((x) => x.id_detalle_oc === line.id_detalle_oc);
      if (!d) continue;
      if (
        d.cantidad_recibida >
        line.cantidad_solicitada - line.cantidad_recibida
      )
        throw failure(422, "Cantidad recibida excedida");
      if (!d.cantidad_recibida) continue;
      await registrarMovimiento(tx, {
        id_producto: line.id_producto,
        id_usuario: user.id_usuario,
        cantidad: d.cantidad_recibida,
        tipo_documento: "recepcion_compra",
        id_documento: rec.id_recepcion,
        detalle: "Recepción de " + oc.numero_orden,
        costo_unitario: line.costo_unitario,
      });
      await repos
        .detalle_orden_compra(tx)
        .update({
          where: { id_detalle_oc: d.id_detalle_oc },
          data: { cantidad_recibida: { increment: d.cantidad_recibida } },
        });
    }
    await orderState(tx, params.id);
    return repos
      .recepcion_compra(tx)
      .update({
        where: { id_recepcion: rec.id_recepcion },
        data: { numero_recepcion: numberDoc("REC", rec.id_recepcion) },
      });
  });
export const getRecepciones = ({ query }) =>
  list(repos.recepcion_compra(), query, { orderBy: { id_recepcion: "desc" } });
export const getRecepcionesRegistro = ({ params }) =>
  repos
    .recepcion_compra()
    .findUniqueOrThrow({
      where: { id_recepcion: params.id },
      include: { detalle_recepcion: true },
    });
export const postRecepcionesAnular = ({ user, params }) =>
  transaction(async (tx) => {
    const where = { id_recepcion: params.id },
      rec = await repos
        .recepcion_compra(tx)
        .findUniqueOrThrow({
          where,
          include: {
            detalle_recepcion: {
              include: { detalle_orden_compra: true },
              orderBy: { detalle_orden_compra: { id_producto: "asc" } },
            },
          },
        });
    if (rec.estado !== "completada")
      throw failure(409, "La recepción ya fue anulada");
    for (const d of rec.detalle_recepcion)
      if (d.cantidad_recibida) {
        await registrarMovimiento(tx, {
          id_producto: d.detalle_orden_compra.id_producto,
          id_usuario: user.id_usuario,
          cantidad: -d.cantidad_recibida,
          tipo_documento: "devolucion_proveedor",
          id_documento: params.id,
          detalle: "Anulación de recepción " + rec.numero_recepcion,
        });
        await repos
          .detalle_orden_compra(tx)
          .update({
            where: { id_detalle_oc: d.id_detalle_oc },
            data: { cantidad_recibida: { decrement: d.cantidad_recibida } },
          });
      }
    await orderState(tx, rec.id_orden_compra);
    return repos
      .recepcion_compra(tx)
      .update({ where, data: { estado: "anulada" } });
  });
