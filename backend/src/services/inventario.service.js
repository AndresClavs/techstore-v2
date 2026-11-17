import { Prisma } from "@prisma/client";
import { repos, lockStock } from "../models/base.repository.js";
import { failure } from "../utils/contract.js";
export const decimal = (value) => new Prisma.Decimal(value);
export const round = (value) =>
  decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export async function stock(tx, id_producto) {
  await lockStock(tx, id_producto);
  return repos
    .inventario(tx)
    .findUniqueOrThrow({
      where: { id_producto },
      include: { producto: { select: { costo: true } } },
    });
}
export async function registrarMovimiento(
  tx,
  {
    id_producto,
    id_usuario,
    cantidad,
    tipo_documento,
    id_documento,
    detalle,
    costo_unitario,
  },
) {
  const inv = await stock(tx, id_producto),
    saldo = inv.stock_actual + cantidad;
  if (saldo < inv.stock_reservado || saldo < 0)
    throw failure(409, "Stock disponible insuficiente");
  const last = await repos
    .kardex(tx)
    .findFirst({ where: { id_producto }, orderBy: { id_kardex: "desc" } });
  const average = last?.saldo_costo_promedio ?? inv.producto.costo;
  const cost = cantidad > 0 ? decimal(costo_unitario ?? average) : average;
  const previous = last?.saldo_valor ?? average.times(inv.stock_actual);
  const value = round(
    cantidad > 0 ? previous.plus(cost.times(cantidad)) : average.times(saldo),
  );
  const next = cantidad > 0 ? value.div(saldo).toDecimalPlaces(4) : average;
  const tipo = tipo_documento.startsWith("ajuste")
    ? "ajuste"
    : cantidad > 0
      ? "entrada"
      : "salida";
  const movement = await repos
    .movimiento_inventario(tx)
    .create({
      data: { id_producto, id_usuario, cantidad, tipo, motivo: detalle },
    });
  await repos
    .inventario(tx)
    .update({ where: { id_producto }, data: { stock_actual: saldo } });
  if (tipo_documento === "recepcion_compra")
    await repos
      .producto(tx)
      .update({ where: { id_producto }, data: { costo: round(next) } });
  return repos
    .kardex(tx)
    .create({
      data: {
        id_producto,
        id_usuario,
        id_movimiento: movement.id_movimiento,
        cantidad,
        tipo_documento,
        id_documento,
        detalle,
        costo_unitario: cost,
        costo_total: round(cost.times(cantidad)),
        saldo_cantidad: saldo,
        saldo_valor: value,
        saldo_costo_promedio: next,
      },
    });
}
