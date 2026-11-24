// Datos de demostración para Órdenes de compra, Órdenes de venta y Kardex.
// Usa la API real, así cada movimiento pasa por las mismas reglas y queda en el kardex.
// Uso (desde backend/):  npm run demo        BASE_URL=https://... npm run demo
// Es idempotente: si los datos ya existen, no los duplica.
import "dotenv/config";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api";
let token = "";

async function call(path, method = "GET", body, expected) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = res.status === 204 ? {} : await res.json();
  if (expected ? res.status !== expected : !res.ok)
    throw Error(method + " " + path + " → " + res.status + " " + (json.error?.mensaje || ""));
  return { status: res.status, ...json };
}
async function login(email, password) {
  token = (await call("/auth/login", "POST", { email, password })).data.token;
}
const all = async (path) => (await call(path + (path.includes("?") ? "&" : "?") + "limite=100")).data;

const SUPPLIERS = [
  {
    razon_social: "Distribuidora Tecnológica Andina S.A.",
    ruc: "1792456781001",
    email: "ventas@andinatech.test",
    telefono: "022456789",
    direccion: "Av. República E7-123, Quito",
    categorias: ["Laptops", "Celulares", "Tablets"],
  },
  {
    razon_social: "Importadora Audio Pro Cía. Ltda.",
    ruc: "0992345678001",
    email: "pedidos@audiopro.test",
    telefono: "042345678",
    direccion: "Av. 9 de Octubre 1200, Guayaquil",
    categorias: ["Audio", "Wearables"],
  },
  {
    razon_social: "Periféricos del Pacífico S.A.",
    ruc: "0190345612001",
    email: "compras@perifericos.test",
    telefono: "072834561",
    direccion: "Av. Remigio Crespo 3-45, Cuenca",
    categorias: ["Periféricos", "Teclados"],
  },
  {
    razon_social: "Pantallas y Monitores Ecuador S.A.",
    ruc: "1791234567001",
    email: "info@pantallas.test",
    telefono: "023987654",
    direccion: "Av. Eloy Alfaro N35-10, Quito",
    categorias: ["Pantallas"],
  },
];

async function suppliersAndLinks(products) {
  const existing = await all("/admin/proveedores");
  const result = [];
  for (const s of SUPPLIERS) {
    const { categorias, ...data } = s;
    let p = existing.find((x) => x.ruc === s.ruc);
    if (!p) {
      p = (await call("/admin/proveedores", "POST", data, 201)).data;
      console.log("  + proveedor", p.razon_social);
    } else if (!p.activo) await call("/admin/proveedores/" + p.id_proveedor, "PUT", { activo: true });
    const linked = await call("/admin/proveedores/" + p.id_proveedor + "/productos");
    const mine = products.filter((x) => categorias.includes(x.categoria.nombre));
    for (const prod of mine)
      if (!linked.data.some((l) => l.id_producto === prod.id_producto))
        await call(
          "/admin/proveedores/" + p.id_proveedor + "/productos",
          "POST",
          {
            id_producto: prod.id_producto,
            costo_compra: Math.round(prod.precio_venta * 0.62 * 100) / 100,
            plazo_entrega_dias: 5,
          },
          201,
        );
    result.push({ ...p, productos: mine });
  }
  return result;
}

async function purchaseOrders(suppliers) {
  const orders = await all("/admin/ordenes-compra");
  const plan = [
    // [proveedor, unidades por línea, estado final]
    [0, [40, 25], "recibida_total"],
    [1, [60, 30, 20], "recibida_parcial"],
    [2, [50, 35], "enviada"],
    [3, [15], "borrador"],
  ];
  for (const [index, quantities, target] of plan) {
    const s = suppliers[index];
    if (orders.some((o) => o.id_proveedor === s.id_proveedor && o.observaciones?.startsWith("DEMO"))) continue;
    const lines = s.productos.slice(0, quantities.length).map((prod, i) => ({
      id_producto: prod.id_producto,
      cantidad_solicitada: quantities[i],
      costo_unitario: Math.round(prod.precio_venta * 0.62 * 100) / 100,
    }));
    if (!lines.length) continue;
    const oc = (
      await call(
        "/admin/ordenes-compra",
        "POST",
        {
          id_proveedor: s.id_proveedor,
          observaciones: "DEMO · Reposición de " + s.razon_social,
          fecha_entrega_esperada: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
          detalles: lines,
        },
        201,
      )
    ).data;
    if (target !== "borrador") await call("/admin/ordenes-compra/" + oc.id_orden_compra + "/enviar", "POST");
    if (target.startsWith("recibida")) {
      const full = (await call("/admin/ordenes-compra/" + oc.id_orden_compra)).data;
      await call(
        "/admin/ordenes-compra/" + oc.id_orden_compra + "/recepciones",
        "POST",
        {
          guia_remision_proveedor: "GR-" + oc.id_orden_compra,
          detalles: full.detalle_orden_compra.map((l, i) => ({
            id_detalle_oc: l.id_detalle_oc,
            cantidad_recibida:
              target === "recibida_total" || i === 0 ? l.cantidad_solicitada : Math.floor(l.cantidad_solicitada / 2),
            cantidad_rechazada: 0,
          })),
        },
        201,
      );
    }
    console.log("  + orden de compra", oc.numero_orden, "→", target);
  }
  // Política: una orden de más de 10.000 unidades debe rechazarse.
  const s = suppliers[0];
  const r = await call(
    "/admin/ordenes-compra",
    "POST",
    {
      id_proveedor: s.id_proveedor,
      detalles: [{ id_producto: s.productos[0].id_producto, cantidad_solicitada: 10001, costo_unitario: 1 }],
    },
    422,
  );
  console.log("  ✓ política verificada:", r.error.mensaje);
}

async function salesOrders(products) {
  const client = process.env.DEMO_CLIENT_EMAIL || "cliente@techstore.local";
  await login(client, process.env.DEMO_USERS_PASSWORD);
  const mine = await all("/pedidos");
  const demo = mine.filter((p) => p.observaciones?.startsWith("DEMO"));
  if (demo.length >= 3) return;
  const me = (await call("/auth/me")).data;
  let dirs = (await call("/usuarios/" + me.id_usuario + "/direcciones")).data;
  if (!dirs.length) {
    await call("/usuarios/" + me.id_usuario + "/direcciones", "POST", {
      destinatario: me.nombres + " " + me.apellidos,
      calle_principal: "Av. Amazonas N24-03 y Colón",
      ciudad: "Quito",
      provincia: "Pichincha",
      es_predeterminada: true,
    }, 201);
    dirs = (await call("/usuarios/" + me.id_usuario + "/direcciones")).data;
  }
  const pay = await all("/metodos-pago");
  const card = pay.find((m) => m.tipo === "tarjeta"),
    transfer = pay.find((m) => m.tipo === "transferencia");
  const plan = [
    [[["Sony", 1], ["Keychron", 2]], card, "enviado"],
    [[["Logitech", 1]], card, "pagado"],
    [[["Samsung", 1]], transfer, "pendiente"],
  ];
  const created = [];
  for (const [items, method, target] of plan.slice(demo.length)) {
    await call("/carrito", "DELETE");
    for (const [name, qty] of items) {
      const prod = products.find((p) => p.nombre.startsWith(name) && p.stock_disponible >= qty);
      if (prod) await call("/carrito/items", "POST", { id_producto: prod.id_producto, cantidad: qty }, 201);
    }
    const order = (
      await call("/pedidos", "POST", {
        id_direccion_envio: dirs[0].id_direccion,
        id_direccion_facturacion: dirs[0].id_direccion,
        id_metodo_envio: 1,
        observaciones: "DEMO · Pedido de demostración",
      }, 201)
    ).data;
    await call("/pedidos/" + order.id_pedido + "/pagos", "POST", { id_metodo_pago: method.id_metodo_pago }, 201);
    created.push([order, target]);
    console.log("  + orden de venta", order.numero_pedido, "→", target);
  }
  return created;
}

const products = (await call("/productos?limite=100")).data;
await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
console.log("Proveedores y productos vinculados");
const suppliers = await suppliersAndLinks(products);
console.log("Órdenes de compra");
await purchaseOrders(suppliers);
console.log("Órdenes de venta");
const fresh = (await call("/productos?limite=100")).data;
const created = (await salesOrders(fresh)) || [];
await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
const carriers = (await call("/admin/transportistas")).data;
for (const [order, target] of created)
  if (target === "enviado") {
    await call("/admin/pedidos/" + order.id_pedido + "/estado", "PUT", {
      estado: "preparando",
      id_transportista: carriers[0].id_transportista,
      numero_guia: "GUIA-" + order.id_pedido,
    });
    await call("/admin/pedidos/" + order.id_pedido + "/estado", "PUT", { estado: "enviado" });
  }
console.log("Datos de demostración listos.");
