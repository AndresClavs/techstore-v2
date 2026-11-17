import { randomUUID } from "node:crypto";
import { repos, transaction } from "../models/base.repository.js";
import { stock, round, decimal } from "./inventario.service.js";
import { failure } from "../utils/contract.js";
export const temporary = () => randomUUID().replaceAll("-", "").slice(0, 28);
export const numberDoc = (prefix, id) =>
  prefix +
  "-" +
  new Date().getUTCFullYear() +
  "-" +
  String(id).padStart(6, "0");
export async function cart(tx, user) {
  const where = { id_usuario: user.id_usuario, estado: "activo" };
  const current =
    (await repos.carrito(tx).findFirst({ where })) ||
    (await repos.carrito(tx).create({ data: where }));
  const rows = await repos
    .item_carrito(tx)
    .findMany({
      where: { id_carrito: current.id_carrito },
      orderBy: { id_producto: "asc" },
      include: {
        producto: {
          include: {
            inventario: true,
            imagen_producto: { take: 1, orderBy: { es_principal: "desc" } },
          },
        },
      },
    });
  const items = rows.map(({ producto: p, ...line }) => ({
    ...line,
    nombre: p.nombre,
    sku: p.sku,
    imagen: p.imagen_producto[0]?.url,
    activo: p.estado === "activo",
    precio_actual: p.precio_venta,
    precio_cambio: !p.precio_venta.eq(line.precio_unitario),
    porcentaje_iva: p.porcentaje_iva,
    stock_disponible:
      (p.inventario?.stock_actual || 0) - (p.inventario?.stock_reservado || 0),
    subtotal: round(p.precio_venta.times(line.cantidad)),
  }));
  const subtotal = items.reduce((a, i) => a.plus(i.subtotal), decimal(0)),
    iva = items.reduce(
      (a, i) => a.plus(round(i.subtotal.times(i.porcentaje_iva).div(100))),
      decimal(0),
    );
  return {
    ...current,
    items,
    resumen: {
      subtotal,
      iva,
      total: subtotal.plus(iva),
      total_items: items.reduce((a, i) => a + i.cantidad, 0),
    },
  };
}
export async function coupon(tx, codigo, subtotal) {
  const c = await repos
      .cupon(tx)
      .findUnique({ where: { codigo: codigo.toUpperCase() } }),
    now = new Date();
  if (
    !c?.activo ||
    c.fecha_inicio > now ||
    c.fecha_fin < now ||
    (c.usos_maximos !== null && c.usos_actuales >= c.usos_maximos) ||
    subtotal.lt(c.monto_minimo_compra)
  )
    throw failure(422, "Cupón no aplicable a esta compra");
  const discount = round(
    c.tipo_descuento === "porcentaje"
      ? subtotal.times(c.valor_descuento).div(100)
      : c.valor_descuento,
  );
  return {
    ...c,
    descuento_calculado: discount.gt(subtotal) ? subtotal : discount,
  };
}
export const history = (tx, id_pedido, estado, comentario) =>
  repos
    .historial_estado_pedido(tx)
    .create({ data: { id_pedido, estado, comentario } });
export const orderInclude = {
  detalle_pedido: {
    include: { producto: { select: { nombre: true, sku: true } } },
    orderBy: { id_producto: "asc" },
  },
  historial_estado_pedido: { orderBy: { id_historial: "asc" } },
  pago: true,
  envio: true,
  factura: true,
  direccion_pedido_id_direccion_envioTodireccion: true,
  direccion_pedido_id_direccion_facturacionTodireccion: true,
};
export async function getOrder(tx, id, user, own = false) {
  const p = await repos
    .pedido(tx)
    .findUniqueOrThrow({ where: { id_pedido: id }, include: orderInclude });
  if (
    p.id_usuario !== user.id_usuario &&
    (own || !["Administrador", "Vendedor"].includes(user.rol.nombre))
  )
    throw failure(403, "Pedido ajeno");
  return {
    ...p,
    detalles: p.detalle_pedido,
    historial: p.historial_estado_pedido,
    pagos: p.pago,
    direccion_envio: p.direccion_pedido_id_direccion_envioTodireccion,
    direccion_facturacion:
      p.direccion_pedido_id_direccion_facturacionTodireccion,
  };
}
export function totals(c, discount) {
  const subtotal = c.resumen.subtotal;
  let remaining = discount,
    iva = decimal(0),
    grossLeft = subtotal;
  const lines = [];
  for (const [index, i] of c.items.entries()) {
    const share = subtotal.isZero()
      ? decimal(0)
      : round(discount.times(i.subtotal).div(subtotal));
    grossLeft = grossLeft.minus(i.subtotal);
    const allocated =
      index === c.items.length - 1
        ? remaining
        : [share, remaining, i.subtotal].reduce((a, b) => (a.lt(b) ? a : b));
    const part = remaining.minus(allocated).gt(grossLeft)
      ? remaining.minus(grossLeft)
      : allocated;
    remaining = remaining.minus(part);
    const net = i.subtotal.minus(part),
      tax = round(net.times(i.porcentaje_iva).div(100));
    iva = iva.plus(tax);
    lines.push({
      id_producto: i.id_producto,
      cantidad: i.cantidad,
      precio_unitario: i.precio_actual,
      descuento: part,
      subtotal: net,
      iva: tax,
    });
  }
  return { lines, iva, total: subtotal.minus(discount).plus(iva) };
}
export const checkout = ({ user, body }) =>
  transaction(async (tx) => {
    const c = await cart(tx, user);
    if (!c.items.length) throw failure(422, "El carrito está vacío");
    for (const dir of [body.id_direccion_envio, body.id_direccion_facturacion])
      if (
        !(await repos
          .direccion(tx)
          .findFirst({
            where: { id_direccion: dir, id_usuario: user.id_usuario },
          }))
      )
        throw failure(403, "Dirección ajena o inexistente");
    const shipping = await repos
      .metodo_envio(tx)
      .findFirstOrThrow({
        where: { id_metodo_envio: body.id_metodo_envio, activo: true },
      });
    const subtotal = c.resumen.subtotal,
      cp = body.codigo_cupon
        ? await coupon(tx, body.codigo_cupon, subtotal)
        : null,
      discount = cp?.descuento_calculado ?? decimal(0);
    const { lines, iva, total } = totals(c, discount);
    for (const i of c.items) {
      const inv = await stock(tx, i.id_producto);
      if (!i.activo || inv.stock_actual - inv.stock_reservado < i.cantidad)
        throw failure(409, "Stock insuficiente para " + i.nombre);
      await repos
        .inventario(tx)
        .update({
          where: { id_producto: i.id_producto },
          data: { stock_reservado: { increment: i.cantidad } },
        });
    }
    const p = await repos
      .pedido(tx)
      .create({
        data: {
          id_usuario: user.id_usuario,
          id_direccion_envio: body.id_direccion_envio,
          id_direccion_facturacion: body.id_direccion_facturacion,
          id_cupon: cp?.id_cupon,
          numero_pedido: temporary(),
          subtotal,
          descuento: discount,
          iva,
          costo_envio: shipping.costo_base,
          total: total.plus(shipping.costo_base),
          observaciones: body.observaciones,
          detalle_pedido: { create: lines },
        },
      });
    await repos
      .pedido(tx)
      .update({
        where: { id_pedido: p.id_pedido },
        data: { numero_pedido: numberDoc("PED", p.id_pedido) },
      });
    await history(
      tx,
      p.id_pedido,
      "pendiente",
      "[envio:" + shipping.id_metodo_envio + "] Pedido creado",
    );
    if (cp)
      await repos
        .cupon(tx)
        .update({
          where: { id_cupon: cp.id_cupon },
          data: { usos_actuales: { increment: 1 } },
        });
    await repos
      .carrito(tx)
      .update({
        where: { id_carrito: c.id_carrito },
        data: { estado: "convertido" },
      });
    return getOrder(tx, p.id_pedido, user);
  });
