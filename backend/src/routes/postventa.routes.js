import { z } from "zod";
import { endpoint, id, str, money, roles } from "../middleware/http.js";
import * as service from "../services/postventa.service.js";

export function postventaRoutes(r) {
  const route = (...a) => endpoint(r, ...a);
  route("get", "/devoluciones", roles.client, null, service.getDevoluciones);
  route(
    "get",
    "/admin/devoluciones",
    roles.sales,
    null,
    service.getAdminDevoluciones,
  );
  route(
    "post",
    "/devoluciones",
    roles.client,
    z.object({
      id_detalle: id,
      motivo: str(255),
      descripcion: str(5000).optional(),
      cantidad: id,
    }),
    service.postDevoluciones,
    201,
  );
  route(
    "put",
    "/admin/devoluciones/:id",
    roles.sales,
    z.object({
      estado: z.enum(["aprobada", "rechazada", "completada"]),
      monto_reembolso: money.optional(),
      reingresa_stock: z.boolean().optional(),
    }),
    service.putAdminDevoluciones,
  );
  route(
    "get",
    "/admin/dashboard",
    [...roles.sales, "Bodeguero"],
    null,
    service.getAdminDashboard,
  );
}
