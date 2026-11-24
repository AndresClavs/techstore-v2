import { prisma } from "./prisma.client.js";
export class BaseRepository {
  constructor(name) {
    this.name = name;
  }
  client(tx = prisma) {
    return tx[this.name];
  }
}
const models =
  "carrito categoria cupon detalle_orden_compra detalle_pedido detalle_recepcion devolucion direccion envio especificacion factura favorito historial_estado_pedido imagen_producto inventario item_carrito kardex marca metodo_envio metodo_pago movimiento_inventario orden_compra pago pedido producto producto_proveedor proveedor recepcion_compra resena rol transportista usuario".split(
    " ",
  );
export const repos = Object.fromEntries(
  models.map((name) => {
    const repository = new BaseRepository(name);
    return [name, repository.client.bind(repository)];
  }),
);
export async function transaction(work) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: "Serializable",
        timeout: Number(process.env.TX_TIMEOUT_MS) || 15000,
        maxWait: 10000,
      });
    } catch (error) {
      if (attempt || error.code !== "P2034") throw error;
    }
  }
}
export const lockStock = (tx, id) =>
  tx.$queryRaw`SELECT id_producto FROM inventario WHERE id_producto = ${id} FOR UPDATE`;
