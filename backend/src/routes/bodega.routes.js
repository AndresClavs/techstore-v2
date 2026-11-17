import { z } from "zod";
import { endpoint, id, str, money, roles } from "../middleware/http.js";
import * as service from "../services/bodega.service.js";
const zero = z.number().int().nonnegative();
const order = z.object({
  id_proveedor: id,
  fecha_entrega_esperada: z.coerce.date().optional(),
  observaciones: str(500).optional(),
  detalles: z
    .array(
      z.object({
        id_producto: id,
        cantidad_solicitada: id,
        costo_unitario: money,
      }),
    )
    .min(1),
});
const receipt = z.object({
  guia_remision_proveedor: str(50).optional(),
  observaciones: str(500).optional(),
  detalles: z
    .array(
      z.object({
        id_detalle_oc: id,
        cantidad_recibida: zero,
        cantidad_rechazada: zero.default(0),
      }),
    )
    .min(1),
});
export function warehouseRoutes(r) {
  const route = (method, path, schema, service, status) =>
    endpoint(
      r,
      method,
      "/admin/" + path,
      roles.warehouse,
      schema,
      service,
      status,
    );
  route("get", "inventario", null, service.getInventario);
  route(
    "put",
    "inventario/:id",
    z
      .object({
        stock_minimo: zero.optional(),
        ubicacion_bodega: str(100).optional(),
      })
      .strict(),
    service.putInventario,
  );
  route("get", "inventario/:id/kardex", null, service.getInventarioKardex);
  route(
    "post",
    "inventario/ajustes",
    z.object({
      id_producto: id,
      tipo: z.enum(["positivo", "negativo"]),
      cantidad: id,
      motivo: str(255),
      costo_unitario: money.optional(),
    }),
    service.postInventarioAjustes,
    201,
  );
  route(
    "get",
    "proveedores/:id/productos",
    null,
    service.getProveedoresProductos,
  );
  route(
    "post",
    "proveedores/:id/productos",
    z.object({
      id_producto: id,
      costo_compra: money,
      plazo_entrega_dias: zero.optional(),
    }),
    service.postProveedoresProductos,
    201,
  );
  route(
    "delete",
    "proveedores/:id/productos",
    z.object({ id_producto: id }),
    ({ params, body }) =>
      service.deleteProveedoresProductosProducto({
        params: { ...params, producto: body.id_producto },
      }),
    204,
  );
  route(
    "delete",
    "proveedores/:id/productos/:producto",
    null,
    service.deleteProveedoresProductosProducto,
    204,
  );
  route("get", "ordenes-compra", null, service.getOrdenesCompra);
  route("get", "ordenes-compra/:id", null, service.getOrdenesCompraRegistro);
  for (const method of ["post", "put"])
    route(
      method,
      "ordenes-compra" + (method === "put" ? "/:id" : ""),
      order,
      service.modificarOrdenesCompra,
      method === "post" ? 201 : 200,
    );
  for (const method of ["post", "delete"])
    route(
      method,
      "ordenes-compra/:id" + (method === "post" ? "/enviar" : ""),
      null,
      service.modificarOrdenesCompraEnviar(method),
      method === "delete" ? 204 : 200,
    );
  route(
    "post",
    "ordenes-compra/:id/recepciones",
    receipt,
    service.postOrdenesCompraRecepciones,
    201,
  );
  route("get", "recepciones", null, service.getRecepciones);
  route("get", "recepciones/:id", null, service.getRecepcionesRegistro);
  route("post", "recepciones/:id/anular", null, service.postRecepcionesAnular);
}
