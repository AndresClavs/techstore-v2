import { z } from "zod";
import { endpoint, id, str, money, roles } from "../middleware/http.js";
import * as service from "../services/catalogo.service.js";
const image = z.object({
  url: str(255),
  texto_alternativo: str(200).optional(),
  orden: z.number().int().nonnegative().optional(),
  es_principal: z.boolean().optional(),
});
const spec = z.object({
  nombre: str(100),
  valor: str(255),
  unidad: str(30).optional(),
});
const product = z.object({
  id_categoria: id,
  id_marca: id,
  sku: str(50),
  nombre: str(200),
  descripcion: str(10000).optional(),
  precio_venta: money,
  costo: money.optional(),
  porcentaje_iva: money.max(100).optional(),
  garantia_meses: z.number().int().nonnegative().optional(),
  peso_kg: money.optional(),
  destacado: z.boolean().optional(),
  estado: z.enum(["activo", "inactivo", "descontinuado"]).optional(),
  imagenes: z.array(image).optional(),
  especificaciones: z.array(spec).optional(),
  stock_minimo: z.number().int().nonnegative().optional(),
  ubicacion_bodega: str(100).optional(),
});
export function catalogRoutes(r) {
  const route = (...args) => endpoint(r, ...args);
  for (const admin of [false, true])
    route(
      "get",
      admin ? "/admin/productos" : "/productos",
      admin ? roles.sales : null,
      null,
      service.listarProductos(admin),
    );
  route("get", "/productos/:id", null, null, service.getProductos);
  route("get", "/categorias", null, null, service.getCategorias);
  for (const [path, model, where] of [
    ["marcas", "marca", {}],
    ["metodos-envio", "metodo_envio", { activo: true }],
    ["metodos-pago", "metodo_pago", { activo: true }],
  ])
    route("get", "/" + path, null, null, service.listarOpciones(model, where));
  for (const method of ["post", "put"])
    route(
      method,
      "/admin/productos" + (method === "put" ? "/:id" : ""),
      roles.sales,
      (method === "post" ? product : product.partial()).strict(),
      service.modificarAdminProductos,
      method === "post" ? 201 : 200,
    );
  route(
    "delete",
    "/admin/productos/:id",
    roles.sales,
    null,
    service.deleteAdminProductos,
    204,
  );
  const resources = [
    [
      "categorias",
      "categoria",
      roles.sales,
      z.object({
        nombre: str(100),
        id_categoria_padre: id.nullable().optional(),
        descripcion: str(255).optional(),
        imagen: str(255).optional(),
        activa: z.boolean().optional(),
      }),
      { activa: false },
    ],
    [
      "marcas",
      "marca",
      roles.sales,
      z.object({
        nombre: str(100),
        logo: str(255).optional(),
        pais_origen: str(100).optional(),
        sitio_web: str(255).optional(),
      }),
      null,
    ],
    [
      "proveedores",
      "proveedor",
      roles.warehouse,
      z.object({
        razon_social: str(150),
        ruc: z.string().regex(/^\d{13}$/),
        email: z.string().email().optional(),
        telefono: str(20).optional(),
        direccion: str(255).optional(),
        activo: z.boolean().optional(),
      }),
      { activo: false },
    ],
    [
      "cupones",
      "cupon",
      roles.sales,
      z.object({
        codigo: str(30).transform((s) => s.toUpperCase()),
        descripcion: str(255).optional(),
        tipo_descuento: z.enum(["porcentaje", "monto_fijo"]),
        valor_descuento: money,
        monto_minimo_compra: money.optional(),
        fecha_inicio: z.coerce.date(),
        fecha_fin: z.coerce.date(),
        usos_maximos: id.nullable().optional(),
        activo: z.boolean().optional(),
      }),
      { activo: false },
    ],
  ];
  for (const [path, name, allowed, schema, inactive] of resources) {
    const base = "/admin/" + path,
      pk = "id_" + name;
    route("get", base, allowed, null, service.listarRegistros(name));
    for (const method of ["post", "put", "delete"])
      route(
        method,
        base + (method === "post" ? "" : "/:id"),
        allowed,
        method === "delete"
          ? null
          : (method === "post" ? schema : schema.partial()).strict(),
        service.modificarRegistro(name, inactive, pk, method),
        method === "delete" ? 204 : method === "post" ? 201 : 200,
      );
  }
  route("get", "/favoritos", roles.client, null, service.getFavoritos);
  route(
    "post",
    "/favoritos",
    roles.client,
    z.object({ id_producto: id }),
    service.postFavoritos,
    201,
  );
  route(
    "delete",
    "/favoritos/:id",
    roles.client,
    null,
    service.deleteFavoritos,
    204,
  );
  route(
    "get",
    "/productos/:id/resenas",
    null,
    null,
    service.getProductosResenas,
  );
  route(
    "post",
    "/productos/:id/resenas",
    roles.client,
    z.object({
      calificacion: z.number().int().min(1).max(5),
      titulo: str(150).optional(),
      comentario: str(5000).optional(),
    }),
    service.postProductosResenas,
    201,
  );
  route("get", "/admin/resenas", roles.sales, null, service.getAdminResenas);
  route(
    "put",
    "/admin/resenas/:id/moderar",
    roles.sales,
    z.object({ estado_moderacion: z.enum(["aprobada", "rechazada"]) }),
    service.putAdminResenasModerar,
  );
}
