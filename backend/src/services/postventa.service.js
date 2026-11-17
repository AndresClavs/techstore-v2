import { repos, transaction } from "../models/base.repository.js";
import { id, list, failure } from "../utils/contract.js";
import {
  registrarMovimiento,
  round,
  decimal,
} from "../services/inventario.service.js";
import { history } from "../services/checkout.service.js";
export const getDevoluciones = ({ user, query }) =>
  list(repos.devolucion(), query, {
    where: { detalle_pedido: { pedido: { id_usuario: user.id_usuario } } },
  });
export const getAdminDevoluciones = ({ query }) =>
  list(repos.devolucion(), query, { where: { estado: query.estado } });
export const postDevoluciones = ({ body, user }) =>
  transaction(async (tx) => {
    const d = await repos
      .detalle_pedido(tx)
      .findUniqueOrThrow({
        where: { id_detalle: body.id_detalle },
        include: { pedido: true, devolucion: true },
      });
    if (d.pedido.id_usuario !== user.id_usuario)
      throw failure(403, "Detalle ajeno");
    if (d.pedido.estado !== "entregado")
      throw failure(409, "El pedido debe estar entregado");
    if (
      body.cantidad +
        d.devolucion
          .filter((x) => x.estado !== "rechazada")
          .reduce((a, x) => a + x.cantidad, 0) >
      d.cantidad
    )
      throw failure(422, "Cantidad excedida");
    return repos.devolucion(tx).create({ data: body });
  });
export const putAdminDevoluciones = ({ body, user, params }) =>
  transaction(async (tx) => {
    const where = { id_devolucion: params.id },
      ret = await repos
        .devolucion(tx)
        .findUniqueOrThrow({ where, include: { detalle_pedido: true } }),
      d = ret.detalle_pedido;
    if (!(
      (ret.estado === "solicitada" &&
        ["aprobada", "rechazada"].includes(body.estado)) ||
      (ret.estado === "aprobada" && body.estado === "completada")
    ))
      throw failure(409, "Transición de devolución inválida");
    const data = { estado: body.estado };
    if (body.estado === "completada") {
      if (body.reingresa_stock)
        await registrarMovimiento(tx, {
          id_producto: d.id_producto,
          id_usuario: user.id_usuario,
          cantidad: ret.cantidad,
          tipo_documento: "devolucion_cliente",
          id_documento: params.id,
        });
      const amount = round(
        d.subtotal.plus(d.iva).times(ret.cantidad).div(d.cantidad),
      );
      data.monto_reembolso = decimal(body.monto_reembolso ?? amount);
      if (data.monto_reembolso.gt(amount))
        throw failure(422, "Importe superior a la línea devuelta");
      const original = await repos
        .pago(tx)
        .findFirstOrThrow({
          where: { id_pedido: d.id_pedido, estado: "aprobado" },
          orderBy: { id_pago: "desc" },
        });
      await repos
        .pago(tx)
        .create({
          data: {
            id_pedido: d.id_pedido,
            id_metodo_pago: original.id_metodo_pago,
            monto: data.monto_reembolso,
            estado: "reembolsado",
          },
        });
    }
    if (body.estado !== "aprobada") data.fecha_resolucion = new Date();
    const result = await repos.devolucion(tx).update({ where, data });
    if (body.estado === "completada") {
      const lines = await repos
        .detalle_pedido(tx)
        .findMany({
          where: { id_pedido: d.id_pedido },
          include: { devolucion: { where: { estado: "completada" } } },
        });
      if (
        lines.every(
          (l) =>
            l.cantidad === l.devolucion.reduce((a, x) => a + x.cantidad, 0),
        )
      ) {
        await repos
          .pedido(tx)
          .update({
            where: { id_pedido: d.id_pedido },
            data: { estado: "devuelto" },
          });
        await history(tx, d.id_pedido, "devuelto");
      }
    }
    return result;
  });
export const getAdminDashboard = async () => {
  const today = new Date(),
    month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
    since = new Date(today.getTime() - 29 * 86400000);
  since.setUTCHours(0, 0, 0, 0);
  const where = {
    estado: { in: ["pagado", "preparando", "enviado", "entregado"] },
  };
  const [sales, groups, inventory, top, days] = await Promise.all([
    repos
      .pedido()
      .aggregate({
        where: { ...where, fecha_pedido: { gte: month } },
        _sum: { total: true },
      }),
    repos.pedido().groupBy({ by: ["estado"], _count: { _all: true } }),
    repos
      .inventario()
      .findMany({
        include: {
          producto: {
            select: {
              costo: true,
              kardex: { take: 1, orderBy: { id_kardex: "desc" } },
            },
          },
        },
      }),
    repos
      .detalle_pedido()
      .groupBy({
        by: ["id_producto"],
        where: { pedido: where },
        _sum: { cantidad: true },
        orderBy: { _sum: { cantidad: "desc" } },
        take: 5,
      }),
    repos
      .pedido()
      .findMany({
        where: { ...where, fecha_pedido: { gte: since } },
        select: { fecha_pedido: true, total: true },
      }),
  ]);
  const states = Object.fromEntries(
      groups.map((g) => [g.estado, g._count._all]),
    ),
    totals = new Map();
  for (let d = new Date(since); d <= today; d.setUTCDate(d.getUTCDate() + 1))
    totals.set(d.toISOString().slice(0, 10), decimal(0));
  for (const d of days) {
    const key = d.fecha_pedido.toISOString().slice(0, 10);
    totals.set(key, (totals.get(key) ?? decimal(0)).plus(d.total));
  }
  return {
    ventas_mes: sales._sum.total ?? 0,
    pedidos_pendientes: states.pendiente || 0,
    pedidos_por_estado: states,
    productos_stock_bajo: inventory.filter(
      (i) => i.stock_actual < i.stock_minimo,
    ).length,
    valor_inventario: inventory.reduce(
      (a, i) =>
        a.plus(
          i.producto.kardex[0]?.saldo_valor ??
            i.producto.costo.times(i.stock_actual),
        ),
      decimal(0),
    ),
    top_productos: top,
    ventas_ultimos_30_dias: [...totals].map(([fecha, total]) => ({
      fecha,
      total,
    })),
  };
};
