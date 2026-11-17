import { z } from "zod";
import { randomInt, randomBytes } from "node:crypto";
import { repos, transaction } from "../models/base.repository.js";
import {
  cart,
  coupon,
  totals,
  history,
  getOrder,
} from "../services/checkout.service.js";
import {
  decimal,
  stock,
  registrarMovimiento,
} from "../services/inventario.service.js";
import { id, list, failure } from "../utils/contract.js";
async function state(tx, p, estado, comentario) {
  await repos
    .pedido(tx)
    .update({ where: { id_pedido: p.id_pedido }, data: { estado } });
  await history(tx, p.id_pedido, estado, comentario);
}
async function cancel(tx, p) {
  if (p.estado !== "pendiente")
    throw failure(409, "Solo puedes cancelar un pedido pendiente");
  for (const d of p.detalle_pedido) {
    await stock(tx, d.id_producto);
    await repos
      .inventario(tx)
      .update({
        where: { id_producto: d.id_producto },
        data: { stock_reservado: { decrement: d.cantidad } },
      });
  }
  if (p.id_cupon)
    await repos
      .cupon(tx)
      .update({
        where: { id_cupon: p.id_cupon },
        data: { usos_actuales: { decrement: 1 } },
      });
  await repos
    .pago(tx)
    .updateMany({
      where: { id_pedido: p.id_pedido, estado: "pendiente" },
      data: { estado: "rechazado" },
    });
  await state(tx, p, "cancelado");
  return { estado: "cancelado" };
}
async function paid(tx, p, user) {
  const sum = await repos
    .pago(tx)
    .aggregate({
      where: { id_pedido: p.id_pedido, estado: "aprobado" },
      _sum: { monto: true },
    });
  if ((sum._sum.monto ?? decimal(0)).lt(p.total)) return;
  for (const d of p.detalle_pedido) {
    await stock(tx, d.id_producto);
    await repos
      .inventario(tx)
      .update({
        where: { id_producto: d.id_producto },
        data: { stock_reservado: { decrement: d.cantidad } },
      });
    await registrarMovimiento(tx, {
      id_producto: d.id_producto,
      id_usuario: user.id_usuario,
      cantidad: -d.cantidad,
      tipo_documento: "venta",
      id_documento: p.id_pedido,
      detalle: p.numero_pedido,
    });
  }
  await state(tx, p, "pagado");
  const customer = await repos
    .usuario(tx)
    .findUniqueOrThrow({
      where: { id_usuario: p.id_usuario },
      select: { identificacion: true, nombres: true, apellidos: true },
    });
  const tmp = randomBytes(9).toString("hex");
  const bill = await repos
    .factura(tx)
    .create({
      data: {
        numero_factura: tmp,
        clave_acceso: tmp,
        id_pedido: p.id_pedido,
        identificacion_cliente: customer.identificacion,
        razon_social_cliente: customer.nombres + " " + customer.apellidos,
        subtotal: p.subtotal,
        iva: p.iva,
        total: p.total,
      },
    });
  const seq = String(bill.id_factura).padStart(9, "0"),
    date = bill.fecha_emision
      .toISOString()
      .slice(0, 10)
      .split("-")
      .reverse()
      .join("");
  const key =
    date +
    "01" +
    (process.env.EMISOR_RUC || "9999999999001") +
    "1001001" +
    seq +
    String(randomInt(100000000)).padStart(8, "0") +
    "1";
  const digit =
    11 -
    ([...key].reverse().reduce((a, n, i) => a + Number(n) * (2 + (i % 6)), 0) %
      11);
  await repos
    .factura(tx)
    .update({
      where: { id_factura: bill.id_factura },
      data: {
        numero_factura: "001-001-" + seq,
        clave_acceso: key + (digit === 11 ? 0 : digit === 10 ? 1 : digit),
      },
    });
}
export const getCarrito = ({ user }) => transaction((tx) => cart(tx, user));
export const modificarCarritoItems =
  (method) =>
  ({ params, body, user }) =>
    transaction(async (tx) => {
      const c = await cart(tx, user),
        item = params.id
          ? c.items.find((i) => i.id_item === params.id)
          : c.items.find((i) => i.id_producto === body.id_producto);
      if (params.id && !item) throw failure(404, "Ítem inexistente");
      if (method === "delete")
        return repos
          .item_carrito(tx)
          .delete({ where: { id_item: item.id_item } });
      const id_producto = item?.id_producto ?? body.id_producto;
      const p = await repos
        .producto(tx)
        .findFirstOrThrow({ where: { id_producto, estado: "activo" } });
      const inv = await stock(tx, id_producto),
        cantidad =
          body.cantidad + (method === "post" ? item?.cantidad || 0 : 0);
      if (cantidad > inv.stock_actual - inv.stock_reservado)
        throw failure(409, "Stock insuficiente");
      const data = { cantidad, precio_unitario: p.precio_venta };
      return item
        ? repos
            .item_carrito(tx)
            .update({ where: { id_item: item.id_item }, data })
        : repos
            .item_carrito(tx)
            .create({
              data: { ...data, id_producto, id_carrito: c.id_carrito },
            });
    });
export const deleteCarrito = ({ user }) =>
  transaction(async (tx) =>
    repos
      .item_carrito(tx)
      .deleteMany({ where: { id_carrito: (await cart(tx, user)).id_carrito } }),
  );
export const postCuponesValidar = ({ user, body }) =>
  transaction(async (tx) => {
    const c = await cart(tx, user),
      cp = await coupon(tx, body.codigo, c.resumen.subtotal);
    const quote = totals(c, cp.descuento_calculado);
    return {
      codigo: cp.codigo,
      tipo_descuento: cp.tipo_descuento,
      descuento_calculado: cp.descuento_calculado,
      iva: quote.iva,
      total: quote.total,
    };
  });
export const getPedidos = ({ query, user }) =>
  list(repos.pedido(), query, {
    where: { id_usuario: user.id_usuario },
    orderBy: { id_pedido: "desc" },
  });
export const getAdminPedidos = ({ query }) =>
  list(repos.pedido(), query, {
    where: {
      estado: query.estado,
      fecha_pedido: {
        gte: query.desde ? z.coerce.date().parse(query.desde) : undefined,
        lte: query.hasta ? z.coerce.date().parse(query.hasta) : undefined,
      },
      OR: [
        { numero_pedido: { contains: query.q || "" } },
        { usuario: { email: { contains: query.q || "" } } },
      ],
    },
    orderBy: { id_pedido: "desc" },
  });
export const getPedidosRegistro = ({ params, user }) =>
  getOrder(undefined, params.id, user);
export const getPedidosPart =
  (part) =>
  async ({ params, user }) => {
    const p = await getOrder(undefined, params.id, user),
      result = part === "envio" ? p.envio[0] : p.factura;
    if (!result) throw failure(404, "Aún no existe");
    return result;
  };
export const postPedidosCancelar = ({ params, user }) =>
  transaction(async (tx) => cancel(tx, await getOrder(tx, params.id, user)));
export const postPedidosPagos = ({ params, user, body }) =>
  transaction(async (tx) => {
    const p = await getOrder(tx, params.id, user, true);
    if (
      p.estado !== "pendiente" ||
      p.pago.some((x) => x.estado === "pendiente")
    )
      throw failure(409, "El pedido ya tiene un pago o no admite pagos");
    const method = await repos
      .metodo_pago(tx)
      .findFirstOrThrow({
        where: { id_metodo_pago: body.id_metodo_pago, activo: true },
      });
    const amount = p.pago
      .filter((x) => x.estado === "aprobado")
      .reduce((a, x) => a.minus(x.monto), p.total);
    const pago = await repos
      .pago(tx)
      .create({
        data: {
          ...body,
          id_pedido: p.id_pedido,
          monto: amount,
          estado: method.tipo === "tarjeta" ? "aprobado" : "pendiente",
        },
      });
    if (pago.estado === "aprobado") await paid(tx, p, user);
    return pago;
  });
export const putAdminPagosEstado = ({ user, params, body }) =>
  transaction(async (tx) => {
    const pago = await repos
        .pago(tx)
        .findUniqueOrThrow({ where: { id_pago: params.id } }),
      p = await getOrder(tx, pago.id_pedido, user);
    if (pago.estado !== "pendiente" || p.estado !== "pendiente")
      throw failure(409, "Pago ya resuelto");
    const result = await repos
      .pago(tx)
      .update({ where: { id_pago: params.id }, data: body });
    if (body.estado === "aprobado") await paid(tx, p, user);
    return result;
  });
export const getAdminTransportistas = () => repos.transportista().findMany();
export const putAdminPedidosEstado = ({ user, params, body: b }) =>
  transaction(async (tx) => {
    const p = await getOrder(tx, params.id, user);
    if (b.estado === "cancelado") return cancel(tx, p);
    if (
      { pagado: "preparando", preparando: "enviado", enviado: "entregado" }[
        p.estado
      ] !== b.estado
    )
      throw failure(409, "Transición de pedido inválida");
    if (b.estado === "preparando") {
      const method =
        Number(
          p.historial_estado_pedido[0]?.comentario?.match(
            /\[envio:(\d+)\]/,
          )?.[1],
        ) || b.id_metodo_envio;
      if (!b.id_transportista || !method)
        throw failure(422, "Selecciona transportista y método de envío");
      await repos
        .envio(tx)
        .create({
          data: {
            id_pedido: p.id_pedido,
            id_transportista: b.id_transportista,
            id_metodo_envio: method,
            costo: p.costo_envio,
            numero_guia: b.numero_guia,
          },
        });
    } else {
      if (!p.envio.length) throw failure(409, "Falta el envío");
      await repos
        .envio(tx)
        .update({
          where: { id_envio: p.envio[0].id_envio },
          data:
            b.estado === "enviado"
              ? {
                  estado: "despachado",
                  fecha_despacho: new Date(),
                  numero_guia: b.numero_guia,
                }
              : { estado: "entregado", fecha_entrega: new Date() },
        });
    }
    await state(tx, p, b.estado, b.comentario);
    return { estado: b.estado };
  });
export const putAdminEnvios = ({ params, body, user }) =>
  transaction(async (tx) => {
    const e = await repos
        .envio(tx)
        .findUniqueOrThrow({ where: { id_envio: params.id } }),
      p = await getOrder(tx, e.id_pedido, user);
    if (body.estado && body.estado !== e.estado) {
      if (
        !(
          {
            preparando: ["despachado"],
            despachado: ["en_transito", "entregado", "fallido"],
            en_transito: ["entregado", "fallido"],
            fallido: ["en_transito"],
          }[e.estado] || []
        ).includes(body.estado)
      )
        throw failure(409, "Transición de envío inválida");
      if (body.estado === "despachado") {
        body.fecha_despacho = new Date();
        await state(tx, p, "enviado");
      }
      if (body.estado === "entregado") {
        body.fecha_entrega = new Date();
        await state(tx, p, "entregado");
      }
    }
    return repos
      .envio(tx)
      .update({ where: { id_envio: params.id }, data: body });
  });
