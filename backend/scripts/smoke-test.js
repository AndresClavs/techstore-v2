import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api";
const stamp = Date.now().toString(),
  secret = randomBytes(16).toString("hex");
async function request(token, path, method = "GET", body, expected) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = res.status === 204 ? {} : await res.json();
  assert(
    expected ? res.status === expected : res.ok,
    method +
      " " +
      path +
      " → " +
      res.status +
      " " +
      (json.error?.mensaje || ""),
  );
  return json.data;
}
assert.equal((await request(null, "/health")).status, "ok");
const admin = (
  await request(null, "/auth/login", "POST", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  })
).token;
const a = (...args) => request(admin, ...args);
const category = (await a("/categorias"))[0],
  brand = (await a("/marcas"))[0];
const supplier = await a("/admin/proveedores", "POST", {
  razon_social: "Prueba " + stamp,
  ruc: stamp,
});
const p = await a("/admin/productos", "POST", {
  id_categoria: category.id_categoria,
  id_marca: brand.id_marca,
  sku: "QA-" + stamp,
  nombre: "Prueba de integración " + stamp,
  precio_venta: 20,
});
const product = p.id_producto;
const oc = await a("/admin/ordenes-compra", "POST", {
  id_proveedor: supplier.id_proveedor,
  detalles: [
    { id_producto: product, cantidad_solicitada: 10, costo_unitario: 8 },
  ],
});
const path = "/admin/ordenes-compra/" + oc.id_orden_compra;
await a(path + "/enviar", "POST", {});
const line = (await a(path)).detalle_orden_compra[0].id_detalle_oc;
const receive = (n) =>
  a(path + "/recepciones", "POST", {
    detalles: [
      { id_detalle_oc: line, cantidad_recibida: n, cantidad_rechazada: 0 },
    ],
  });
const first = await receive(4);
assert.equal((await a(path)).estado, "recibida_parcial");
await receive(6);
assert.equal((await a(path)).estado, "recibida_total");
await a("/admin/inventario/ajustes", "POST", {
  id_producto: product,
  tipo: "positivo",
  cantidad: 2,
  costo_unitario: 14,
  motivo: "Prueba de promedio ponderado",
});
const ledger = () => a("/admin/inventario/" + product + "/kardex");
let k = await ledger();
assert.equal(k.saldo_actual.stock_actual, 12);
assert.equal(Number(k.movimientos.at(-1).saldo_costo_promedio), 9);
const login = await request(null, "/auth/registro", "POST", {
  identificacion: "P" + stamp,
  email: "qa-" + stamp + "@example.test",
  nombres: "Prueba",
  apellidos: "Integración",
  password: secret,
});
const c = (...args) => request(login.token, ...args);
assert(!JSON.stringify(await c("/auth/me")).includes("contrasena_hash"));
await c("/admin/inventario", "GET", undefined, 403);
await request(null, "/admin/inventario", "GET", undefined, 401);
const address = await c(
  "/usuarios/" + login.usuario.id_usuario + "/direcciones",
  "POST",
  {
    destinatario: "Prueba",
    calle_principal: "Principal",
    ciudad: "Quito",
    provincia: "Pichincha",
  },
);
const shipping = (await c("/metodos-envio"))[0],
  payment = (await c("/metodos-pago")).find((x) => x.tipo === "tarjeta");
await c("/carrito/items", "POST", { id_producto: product, cantidad: 13 }, 409);
const add = () =>
  c("/carrito/items", "POST", { id_producto: product, cantidad: 2 });
const checkout = () =>
  c("/pedidos", "POST", {
    id_direccion_envio: address.id_direccion,
    id_direccion_facturacion: address.id_direccion,
    id_metodo_envio: shipping.id_metodo_envio,
    codigo_cupon: "BIENVENIDO10",
  });
await add();
assert.equal(
  Number(
    (await c("/cupones/validar", "POST", { codigo: "BIENVENIDO10" }))
      .descuento_calculado,
  ),
  4,
);
const order = await checkout(),
  op = "/pedidos/" + order.id_pedido;
assert.equal(
  Number(order.total),
  Number(
    (
      Number(order.subtotal) -
      Number(order.descuento) +
      Number(order.iva) +
      Number(order.costo_envio)
    ).toFixed(2),
  ),
);
assert.equal((await ledger()).saldo_actual.stock_reservado, 2);
await c(op + "/pagos", "POST", { id_metodo_pago: payment.id_metodo_pago });
assert.equal((await c(op)).estado, "pagado");
assert.match((await c(op + "/factura")).clave_acceso, /^\d{49}$/);
k = await ledger();
assert.equal(k.saldo_actual.stock_actual, 10);
assert.equal(k.saldo_actual.stock_reservado, 0);
const carrier = (await a("/admin/transportistas"))[0];
for (const estado of ["preparando", "enviado", "entregado"])
  await a("/admin" + op + "/estado", "PUT", {
    estado,
    id_transportista: carrier.id_transportista,
  });
assert.deepEqual(
  (await c(op)).historial_estado_pedido.map((h) => h.estado),
  ["pendiente", "pagado", "preparando", "enviado", "entregado"],
);
const ret = await c("/devoluciones", "POST", {
  id_detalle: order.detalle_pedido[0].id_detalle,
  motivo: "Prueba de devolución",
  cantidad: 1,
});
const retPath = "/admin/devoluciones/" + ret.id_devolucion;
await a(retPath, "PUT", { estado: "aprobada" });
await a(retPath, "PUT", { estado: "completada", reingresa_stock: true });
assert((await c(op)).pago.some((v) => v.estado === "reembolsado"));
await a("/admin/recepciones/" + first.id_recepcion + "/anular", "POST", {});
k = await ledger();
assert.equal(k.saldo_actual.stock_actual, 7);
assert.equal(k.movimientos.at(-1).saldo_cantidad, 7);
assert.equal(k.movimientos.at(-1).tipo_documento, "devolucion_proveedor");
const couponUses = async () =>
  (await a("/admin/cupones?limite=100")).find(
    (x) => x.codigo === "BIENVENIDO10",
  ).usos_actuales;
const initial = await couponUses();
await add();
const canceled = await checkout();
await c("/pedidos/" + canceled.id_pedido + "/cancelar", "POST", {});
assert.equal(await couponUses(), initial);
assert.equal((await ledger()).saldo_actual.stock_reservado, 0);
await a("/admin/productos/" + product, "DELETE");
await a("/admin/proveedores/" + supplier.id_proveedor, "DELETE");
console.log(
  "Prueba completada: permisos, compra, recepción, kardex, checkout, pago, factura, envío, devolución y cancelación.",
);
