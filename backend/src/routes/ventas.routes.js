import { z } from "zod";
import { checkout } from "../services/checkout.service.js";
import { endpoint, id, str, roles } from "../middleware/http.js";
import * as service from "../services/ventas.service.js";

export function salesRoutes(r) {
  const route = (...a) => endpoint(r, ...a),
    C = roles.client,
    S = roles.sales,
    read = [...C, "Vendedor"];
  route("get", "/carrito", C, null, service.getCarrito);
  for (const method of ["post", "put", "delete"])
    route(
      method,
      "/carrito/items" + (method === "post" ? "" : "/:id"),
      C,
      method === "delete"
        ? null
        : method === "post"
          ? z.object({ id_producto: id, cantidad: id })
          : z.object({ cantidad: id }),
      service.modificarCarritoItems(method),
      method === "post" ? 201 : method === "delete" ? 204 : 200,
    );
  route("delete", "/carrito", C, null, service.deleteCarrito, 204);
  route(
    "post",
    "/cupones/validar",
    C,
    z.object({ codigo: str(30) }),
    service.postCuponesValidar,
  );
  route(
    "post",
    "/pedidos",
    C,
    z
      .object({
        id_direccion_envio: id,
        id_direccion_facturacion: id,
        id_metodo_envio: id,
        codigo_cupon: str(30).optional(),
        observaciones: str(500).optional(),
      })
      .strict(),
    checkout,
    201,
  );
  route("get", "/pedidos", C, null, service.getPedidos);
  route("get", "/admin/pedidos", S, null, service.getAdminPedidos);
  route("get", "/pedidos/:id", read, null, service.getPedidosRegistro);
  for (const part of ["factura", "envio"])
    route(
      "get",
      "/pedidos/:id/" + part,
      read,
      null,
      service.getPedidosPart(part),
    );
  route(
    "post",
    "/pedidos/:id/cancelar",
    read,
    z.object({}),
    service.postPedidosCancelar,
  );
  route(
    "post",
    "/pedidos/:id/pagos",
    C,
    z
      .object({
        id_metodo_pago: id,
        referencia_transaccion: str(100).optional(),
      })
      .strict(),
    service.postPedidosPagos,
    201,
  );
  route(
    "put",
    "/admin/pagos/:id/estado",
    roles.admin,
    z.object({ estado: z.enum(["aprobado", "rechazado"]) }),
    service.putAdminPagosEstado,
  );
  route(
    "get",
    "/admin/transportistas",
    S,
    null,
    service.getAdminTransportistas,
  );
  route(
    "put",
    "/admin/pedidos/:id/estado",
    S,
    z.object({
      estado: z.enum(["cancelado", "preparando", "enviado", "entregado"]),
      comentario: str(255).optional(),
      id_transportista: id.optional(),
      id_metodo_envio: id.optional(),
      numero_guia: str(50).optional(),
    }),
    service.putAdminPedidosEstado,
  );
  route(
    "put",
    "/admin/envios/:id",
    S,
    z.object({
      estado: z
        .enum(["despachado", "en_transito", "entregado", "fallido"])
        .optional(),
      numero_guia: str(50).optional(),
      id_transportista: id.optional(),
      fecha_entrega_estimada: z.coerce.date().optional(),
    }),
    service.putAdminEnvios,
  );
}
