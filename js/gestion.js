import {
  $,
  api,
  data,
  session,
  node,
  action,
  form,
  status,
  money,
  notify,
  confirmar,
  avisar,
  task,
} from "./api.js";
const main = $("workspace"),
  menu = $("modules");
const role = session()?.usuario.rol;
const sections = {
  Ventas: [
    "productos",
    "categorias",
    "marcas",
    "cupones",
    "ordenes-venta",
    "resenas",
    "devoluciones",
    "transportistas",
  ],
  Bodega: ["inventario", "kardex", "proveedores", "ordenes-compra", "recepciones"],
  Administración: ["usuarios", "roles", "bases-distribuidas"],
};
const pk = {
  productos: "id_producto",
  categorias: "id_categoria",
  marcas: "id_marca",
  cupones: "id_cupon",
  pedidos: "id_pedido",
  resenas: "id_resena",
  devoluciones: "id_devolucion",
  inventario: "id_producto",
  proveedores: "id_proveedor",
  "ordenes-compra": "id_orden_compra",
  recepciones: "id_recepcion",
  usuarios: "id_usuario",
};
const fields = {
  productos: [
    ["nombre", "Nombre"],
    ["sku", "SKU"],
    ["id_categoria", "ID categoría", "number"],
    ["id_marca", "ID marca", "number"],
    ["precio_venta", "Precio sin IVA", "number"],
    ["descripcion", "Descripción", "text?"],
  ],
  categorias: [
    ["nombre", "Nombre"],
    ["id_categoria_padre", "ID categoría superior", "number?"],
  ],
  marcas: [["nombre", "Marca"]],
  proveedores: [
    ["razon_social", "Razón social"],
    ["ruc", "RUC"],
    ["email", "Email", "email?"],
  ],
  cupones: [
    ["codigo", "Código"],
    [
      "tipo_descuento",
      "Tipo",
      "select",
      [
        ["porcentaje", "Porcentaje"],
        ["monto_fijo", "Monto fijo"],
      ],
    ],
    ["valor_descuento", "Valor", "number"],
    ["fecha_inicio", "Inicio", "date"],
    ["fecha_fin", "Fin", "date"],
  ],
};
const options = (name, label, values) => [
  name,
  label,
  "select",
  values.map((v) => [v, v]),
];
function table(rows) {
  const t = node("table"),
    body = node("tbody"),
    head = node("tr");
  if (!rows.length) return node("p", "Sin registros.");
  const cols = Object.keys(rows[0]).filter(
    (k) => typeof rows[0][k] !== "object" && k !== "identificacion",
  );
  for (const k of cols) head.append(node("th", k.replaceAll("_", " ")));
  t.append(head);
  for (const row of rows) {
    const tr = node("tr");
    for (const k of cols) tr.append(node("td", row[k] ?? "—"));
    body.append(tr);
  }
  t.append(body);
  return t;
}
async function dashboard() {
  const d = await data("/admin/dashboard");
  main.replaceChildren(node("h2", "Resumen de la tienda"));
  for (const [label, v] of [
    ["Ventas del mes", money(d.ventas_mes)],
    ["Pedidos pendientes", d.pedidos_pendientes],
    ["Productos bajo mínimo", d.productos_stock_bajo],
    ["Valor de inventario", money(d.valor_inventario)],
  ])
    main.append(node("p", label + " · " + v));
  main.append(
    node("h3", "Pedidos por estado"),
    table(
      Object.entries(d.pedidos_por_estado).map(([estado, cantidad]) => ({
        estado,
        cantidad,
      })),
    ),
    node("h3", "Productos más vendidos"),
    table(
      d.top_productos.map((p) => ({
        producto: p.id_producto,
        unidades: p._sum.cantidad,
      })),
    ),
    node("h3", "Ventas de los últimos 30 días"),
    table(d.ventas_ultimos_30_dias),
  );
}
function purchaseEditor(title, save, existing) {
  const section = node("section", null, { class: "panel" });
  const lines = (existing?.detalle_orden_compra || []).map((l) => ({
    id_producto: l.id_producto,
    cantidad_solicitada: l.cantidad_solicitada,
    costo_unitario: Number(l.costo_unitario),
  }));
  const preview = node("div");
  function draw() {
    preview.replaceChildren();
    for (const l of lines) {
      const row = node(
        "p",
        "Producto " +
          l.id_producto +
          " · " +
          l.cantidad_solicitada +
          " × " +
          money(l.costo_unitario),
      );
      row.append(
        action("Quitar", () => {
          lines.splice(lines.indexOf(l), 1);
          draw();
        }),
      );
      preview.append(row);
    }
  }
  const lineForm = form(
    title,
    [
      ["id_producto", "Producto ID", "number"],
      ["cantidad_solicitada", "Cantidad", "number"],
      ["costo_unitario", "Costo unitario", "number"],
    ],
    "Agregar línea",
    async (l, f) => {
      if (lines.some((x) => x.id_producto === l.id_producto))
        throw Error("El producto ya está en la orden");
      lines.push(l);
      f.reset();
      draw();
    },
  );
  const header = form(
    "",
    [
      ["id_proveedor", "Proveedor ID", "number"],
      ["observaciones", "Observaciones", "text?"],
    ],
    "Guardar orden",
    (b) => {
      if (!lines.length) throw Error("Añade al menos una línea");
      return save({ ...b, detalles: lines });
    },
  );
  if (existing) {
    header.elements.id_proveedor.value = existing.id_proveedor;
    header.elements.observaciones.value = existing.observaciones || "";
  }
  section.append(lineForm, preview, header);
  draw();
  return section;
}
const LABELS = {
  "ordenes-compra": "Órdenes de compra",
  "ordenes-venta": "Órdenes de venta",
  kardex: "Kardex",
};
async function show(name, page = 1) {
  for (const b of menu.querySelectorAll("button"))
    b.setAttribute("aria-pressed", String(b.dataset.modulo === name));
  if (name === "bases-distribuidas") {
    distributedDatabases();
    return;
  }
  if (name === "ordenes-compra") return ordenesCompra();
  if (name === "ordenes-venta") return ordenesVenta();
  if (name === "kardex") return kardex();
  const base = "/admin/" + name,
    result = await api(base + "?pagina=" + page),
    rows = result.data;
  main.replaceChildren(node("h2", name.replaceAll("-", " ")), table(rows));
  if (page > 1) main.append(action("Anterior", () => show(name, page - 1)));
  if (page < result.meta?.totalPaginas)
    main.append(action("Siguiente", () => show(name, page + 1)));
  const refresh = async (path, method, b) => {
    await data(path, method, b);
    await show(name, page);
    status("Cambios guardados");
  };
  if (fields[name])
    main.append(
      form("Crear registro", fields[name], "Crear", (b) =>
        refresh(base, "POST", b),
      ),
    );
  if (name === "ordenes-compra")
    main.append(purchaseEditor("Nueva orden", (b) => refresh(base, "POST", b)));
  const panel = node("section", null, { class: "panel" });
  main.append(panel);
  function select(row) {
    const id = row[pk[name]],
      path = base + "/" + id;
    panel.replaceChildren(node("h3", "Registro " + id));
    const send = (suffix, b, method = "PUT") =>
      refresh(path + suffix, method, b);
    if (fields[name]) {
      const f = form("Editar", fields[name], "Guardar", (b) => send("", b));
      for (const input of f.elements)
        if (input.name && row[input.name] != null)
          input.value =
            input.type === "date"
              ? String(row[input.name]).slice(0, 10)
              : row[input.name];
      panel.append(
        f,
        action("Eliminar", () => {
          if (confirm("¿Eliminar el registro seleccionado?"))
            return send("", undefined, "DELETE");
        }),
      );
    }
    if (name === "proveedores")
      panel.append(
        action("Productos del proveedor", async () =>
          panel.append(table(await data(path + "/productos"))),
        ),
        form(
          "Vincular producto",
          [
            ["id_producto", "Producto ID", "number"],
            ["costo_compra", "Costo de compra", "number"],
            ["plazo_entrega_dias", "Plazo en días", "number"],
          ],
          "Guardar",
          (b) => send("/productos", b, "POST"),
        ),
        form(
          "Desvincular producto",
          [["id_producto", "Producto ID", "number"]],
          "Quitar",
          (b) => send("/productos/" + b.id_producto, undefined, "DELETE"),
        ),
      );
    if (name === "ordenes-compra" && row.estado === "borrador")
      panel.append(
        action("Editar líneas", async () =>
          panel.append(
            purchaseEditor(
              "Editar borrador",
              (b) => send("", b),
              await data(path),
            ),
          ),
        ),
      );
    if (
      name === "ordenes-compra" &&
      ["borrador", "enviada"].includes(row.estado)
    )
      panel.append(
        action("Cancelar orden", () => send("", undefined, "DELETE")),
      );
    if (name === "productos")
      panel.append(
        form(
          "Imagen principal",
          [
            ["url", "URL de imagen"],
            ["texto_alternativo", "Descripción"],
          ],
          "Reemplazar imágenes",
          (b) => send("", { imagenes: [{ ...b, es_principal: true }] }),
        ),
      );
    if (name === "inventario")
      panel.append(
        action("Consultar kardex", () => kardex(id)),
        form(
          "Ajustar inventario",
          [
            options("tipo", "Ajuste", ["positivo", "negativo"]),
            ["cantidad", "Cantidad", "number"],
            ["motivo", "Motivo"],
            ["costo_unitario", "Costo unitario", "number?"],
          ],
          "Registrar",
          (b) => refresh(base + "/ajustes", "POST", { ...b, id_producto: id }),
        ),
        form(
          "Reposición",
          [
            ["stock_minimo", "Stock mínimo", "number"],
            ["ubicacion_bodega", "Ubicación", "text?"],
          ],
          "Guardar",
          (b) => send("", b),
        ),
      );
    if (name === "ordenes-compra")
      panel.append(
        action("Ver líneas", async () =>
          panel.append(table((await data(path)).detalle_orden_compra)),
        ),
        action("Enviar al proveedor", () => send("/enviar", {}, "POST")),
        form(
          "Recibir línea",
          [
            ["id_detalle_oc", "ID detalle", "number"],
            ["cantidad_recibida", "Aceptadas", "number"],
            ["cantidad_rechazada", "Rechazadas", "number"],
          ],
          "Recibir",
          (line) => send("/recepciones", { detalles: [line] }, "POST"),
        ),
      );
    if (name === "recepciones")
      panel.append(
        action("Ver recepción", async () =>
          panel.append(table((await data(path)).detalle_recepcion)),
        ),
        action("Anular recepción", () => send("/anular", {}, "POST")),
      );
    if (name === "pedidos")
      panel.append(
        action("Ver detalle y pagos", async () => {
          const p = await data("/pedidos/" + id);
          panel.append(table(p.detalle_pedido), table(p.pago));
          if (role === "Administrador")
            for (const pay of p.pago.filter((x) => x.estado === "pendiente"))
              for (const estado of ["aprobado", "rechazado"])
                panel.append(
                  action("Pago " + pay.id_pago + " → " + estado, () =>
                    refresh("/admin/pagos/" + pay.id_pago + "/estado", "PUT", {
                      estado,
                    }),
                  ),
                );
        }),
        form(
          "Actualizar pedido",
          [
            options("estado", "Estado", [
              "preparando",
              "enviado",
              "entregado",
              "cancelado",
            ]),
            ["id_transportista", "ID transportista", "number?"],
            ["numero_guia", "Número de guía", "text?"],
          ],
          "Actualizar",
          (b) => send("/estado", b),
        ),
      );
    if (name === "resenas")
      panel.append(
        form(
          "Moderación",
          [options("estado_moderacion", "Estado", ["aprobada", "rechazada"])],
          "Guardar",
          (b) => send("/moderar", b),
        ),
      );
    if (name === "devoluciones")
      panel.append(
        form(
          "Resolver devolución",
          [
            options("estado", "Estado", [
              "aprobada",
              "rechazada",
              "completada",
            ]),
            options("reingresa_stock", "Reingresar al inventario", [
              "Sí",
              "No",
            ]),
          ],
          "Guardar",
          (b) =>
            send("", { ...b, reingresa_stock: b.reingresa_stock === "Sí" }),
        ),
      );
    if (name === "pedidos")
      panel.append(
        action("Gestionar envío", async () => {
          const order = await data("/pedidos/" + id);
          const shipping = order.envio[0];
          if (!shipping) throw Error("El pedido aún no tiene envío");
          panel.append(
            form(
              "Envío " + shipping.id_envio,
              [
                options("estado", "Estado", [
                  "despachado",
                  "en_transito",
                  "entregado",
                  "fallido",
                ]),
                ["numero_guia", "Guía", "text?"],
                ["fecha_entrega_estimada", "Fecha estimada", "date?"],
              ],
              "Actualizar envío",
              (b) => refresh("/admin/envios/" + shipping.id_envio, "PUT", b),
            ),
          );
        }),
      );
    if (name === "usuarios")
      panel.append(
        form(
          "Permisos",
          [
            ["id_rol", "ID rol", "number"],
            options("estado", "Estado", ["activo", "inactivo", "bloqueado"]),
          ],
          "Guardar",
          (b) => send("", b),
        ),
      );
  }
  if (pk[name] && rows.length) {
    const picker = form(
      "Seleccionar registro",
      [
        [
          "id",
          "Registro",
          "select",
          rows.map((row) => [
            row[pk[name]],
            row[pk[name]] +
              " · " +
              (row.nombre ||
                row.razon_social ||
                row.numero_pedido ||
                row.numero_orden ||
                row.email ||
                row.estado ||
                row.codigo ||
                ""),
          ]),
        ],
      ],
      "Abrir",
      (b) => select(rows.find((row) => row[pk[name]] === Number(b.id))),
    );
    main.insertBefore(picker, panel);
  }
}
function distributedDatabases() {
  main.replaceChildren(
    node("h2", "Bases de datos distribuidas"),
    node(
      "p",
      "Topología propuesta: Quito es la base primaria y recibe las escrituras. Guayaquil y Cuenca reciben réplicas para consultas y reportes.",
    ),
    node(
      "p",
      "Estado: diseño informativo. Las réplicas todavía no están configuradas ni conectadas a la aplicación.",
      { class: "replication-notice", role: "status" },
    ),
  );
  const grid = node("div", null, { class: "replication-grid" });
  for (const [city, role, detail] of [
    [
      "Quito",
      "Base central · primaria",
      "MariaDB actual. Único nodo autorizado para escrituras de la aplicación.",
    ],
    [
      "Guayaquil",
      "Réplica de lectura",
      "Copia de los datos de Quito para consultas locales y reportes.",
    ],
    [
      "Cuenca",
      "Réplica de lectura",
      "Copia de los datos de Quito para consultas locales y reportes.",
    ],
  ]) {
    const card = node("section", null, { class: "panel replication-node" });
    card.append(node("h3", city), node("strong", role), node("p", detail));
    grid.append(card);
  }
  main.append(
    grid,
    node("h3", "Flujo de datos"),
    node(
      "p",
      "Tienda/API → Quito (lecturas y escrituras) → replicación MariaDB → Guayaquil y Cuenca (solo lectura).",
      { class: "panel" },
    ),
    node("h3", "Pasos para habilitarlo"),
  );
  const steps = node("ol", null, { class: "panel replication-steps" });
  for (const text of [
    "Preparar tres servidores MariaDB compatibles, con red privada/VPN entre sedes y acceso al puerto 3306 limitado a los nodos autorizados.",
    "Asignar un server_id único a cada servidor y habilitar binlog en Quito con binlog_format=ROW.",
    "Crear una cuenta de replicación con privilegios mínimos y tomar una copia inicial consistente de Quito.",
    "Importar esa copia en Guayaquil y Cuenca; configurar ambas para seguir a Quito con GTID y dejarlas de solo lectura.",
    "Iniciar la replicación y verificar el estado IO/SQL, el retraso y que las tablas/datos coincidan.",
    "Configurar copias de seguridad y alertas. Probar recuperación/promoción manual antes de depender de una réplica.",
    "Adaptar el backend: mantener escrituras y transacciones en Quito y dirigir lecturas permitidas a las réplicas; tras una escritura, leer desde Quito para evitar datos atrasados.",
  ])
    steps.append(node("li", text));
  main.append(steps);
}
/* =====================================================================
   Módulos de Órdenes de compra, Órdenes de venta y Kardex
   ===================================================================== */
// Política de la empresa (el backend también la valida).
const LIMITE_UNIDADES = 10000;
const fmt = (n) => Number(n).toLocaleString("es-EC");
const fecha = (d) => (d ? new Date(d).toLocaleDateString("es-EC") : "—");
const fechaHora = (d) =>
  d ? new Date(d).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" }) : "—";
const all = async (path) => data(path + (path.includes("?") ? "&" : "?") + "limite=100");
const ESTADOS_OC = {
  borrador: "Borrador",
  enviada: "Enviada",
  recibida_parcial: "Recibida parcial",
  recibida_total: "Recibida total",
  cancelada: "Cancelada",
};
const ESTADOS_PEDIDO = {
  pendiente: "Pendiente de pago",
  pagado: "Pagado",
  preparando: "Preparando",
  enviado: "Enviado",
  entregado: "Entregado",
  cancelado: "Cancelado",
  devuelto: "Devuelto",
};
const DOCUMENTOS = {
  inventario_inicial: "Inventario inicial",
  recepcion_compra: "Compra · recepción",
  venta: "Venta",
  devolucion_cliente: "Devolución de cliente",
  devolucion_proveedor: "Anulación / devolución a proveedor",
  ajuste_positivo: "Ajuste positivo",
  ajuste_negativo: "Ajuste negativo",
};
const chip = (estado, labels) =>
  node("span", labels?.[estado] || estado, { class: "estado " + estado });
function btn(label, cls, fn) {
  const b = node("button", label, { type: "button", class: cls });
  b.addEventListener("click", task(fn));
  return b;
}
function cabecera(title, text) {
  const h = node("div", null, { class: "modulo-cabecera" });
  h.append(node("h2", title));
  if (text) h.append(node("p", text, { class: "nota" }));
  return h;
}
function grid(headers, rows, onClick) {
  const t = node("table", null, { class: "tabla" });
  const head = node("tr");
  for (const h of headers) head.append(node("th", h));
  const thead = node("thead");
  thead.append(head);
  const body = node("tbody");
  for (const r of rows) {
    const tr = node("tr");
    for (const cell of r.cells)
      tr.append(cell instanceof Node ? (() => { const td = node("td"); td.append(cell); return td; })() : node("td", cell ?? "—"));
    if (onClick) {
      tr.tabIndex = 0;
      tr.classList.add("fila-clic");
      tr.addEventListener("click", task(() => onClick(r.item)));
      tr.addEventListener("keydown", (e) => e.key === "Enter" && tr.click());
    }
    body.append(tr);
  }
  t.append(thead, body);
  const wrap = node("div", null, { class: "tabla-scroll" });
  wrap.append(rows.length ? t : node("p", "No hay registros.", { class: "vacio-mini" }));
  return wrap;
}
function campo(label, input, wide) {
  const l = node("label", label, wide ? { class: "ancho" } : {});
  l.append(input);
  return l;
}
function selectOf(options, placeholder) {
  const s = node("select");
  if (placeholder) s.append(node("option", placeholder, { value: "" }));
  for (const [value, text] of options) s.append(node("option", text, { value }));
  return s;
}
async function politica(message) {
  await avisar({
    title: "Política de la empresa",
    message:
      message ||
      "No se pueden comprar más de " + fmt(LIMITE_UNIDADES) + " unidades a un proveedor en una misma orden de compra.",
  });
}

/* ---------------------------- Órdenes de compra ---------------------------- */
let filtroOC = "";
async function ordenesCompra(abrir) {
  const [suppliers, orders] = await Promise.all([
    all("/admin/proveedores"),
    all("/admin/ordenes-compra" + (filtroOC ? "?estado=" + filtroOC : "")),
  ]);
  const activos = suppliers.filter((s) => s.activo);
  main.replaceChildren(
    cabecera(
      "Órdenes de compra",
      "Crea pedidos a tus proveedores, envíalos y registra la recepción. Cada recepción suma stock y queda registrada en el kardex.",
    ),
  );
  const banner = node("p", null, { class: "politica" });
  banner.append(
    node("strong", "Política de la empresa: "),
    "máximo " + fmt(LIMITE_UNIDADES) + " unidades por orden de compra a un proveedor.",
  );
  const toolbar = node("div", null, { class: "barra-modulo" });
  const filtros = node("div", null, { class: "filtros" });
  for (const [value, label] of [["", "Todas"], ...Object.entries(ESTADOS_OC)]) {
    const b = btn(label, "chip", async () => {
      filtroOC = value;
      await ordenesCompra();
    });
    b.setAttribute("aria-pressed", String(filtroOC === value));
    filtros.append(b);
  }
  toolbar.append(filtros, btn("+ Nueva orden de compra", "btn-exito", () => nuevaOrdenCompra(activos)));
  const detalle = node("section", null, { id: "detalle-modulo" });
  main.append(
    banner,
    toolbar,
    node("div", null, { id: "editor-oc" }),
    grid(
      ["Número", "Proveedor", "Emisión", "Entrega esperada", "Estado", "Total"],
      orders.map((o) => ({
        item: o,
        cells: [
          o.numero_orden,
          o.proveedor?.razon_social,
          fecha(o.fecha_emision),
          fecha(o.fecha_entrega_esperada),
          chip(o.estado, ESTADOS_OC),
          money(o.total),
        ],
      })),
      (o) => detalleOrdenCompra(o.id_orden_compra),
    ),
    detalle,
  );
  if (abrir) await detalleOrdenCompra(abrir);
}

async function nuevaOrdenCompra(suppliers) {
  const box = $("editor-oc");
  if (!suppliers.length) {
    notify("Primero registra un proveedor activo en el módulo proveedores.", "aviso", { title: "Sin proveedores" });
    return;
  }
  const products = await all("/productos");
  const lines = [];
  let linked = [];
  const panelEl = node("section", null, { class: "panel editor" });
  panelEl.append(node("h3", "Nueva orden de compra"));

  const proveedor = selectOf(
    suppliers.map((s) => [s.id_proveedor, s.razon_social + " · RUC " + s.ruc]),
    "Selecciona un proveedor…",
  );
  proveedor.required = true;
  const entrega = node("input", null, { type: "date", min: new Date().toISOString().slice(0, 10) });
  const obs = node("input", null, { maxlength: 500, placeholder: "Opcional" });
  const head = node("div", null, { class: "form-inline" });
  head.append(campo("Proveedor *", proveedor, true), campo("Fecha de entrega esperada", entrega), campo("Observaciones", obs));

  const producto = selectOf([], "Primero elige un proveedor");
  producto.disabled = true;
  const cantidad = node("input", null, { type: "number", min: 1, step: 1, max: LIMITE_UNIDADES, placeholder: "Ej. 50" });
  const costo = node("input", null, { type: "number", min: 0.01, step: "0.01", placeholder: "0.00" });
  const add = node("button", "+ Agregar producto", { type: "button", class: "btn-add" });
  const lineRow = node("div", null, { class: "linea-oc" });
  lineRow.append(campo("Producto *", producto), campo("Cantidad *", cantidad), campo("Costo unitario *", costo), add);

  const meter = node("div", null, { class: "medidor" });
  const bar = node("div", null, { class: "medidor-barra" });
  const fill = node("span");
  bar.append(fill);
  const meterText = node("p");
  meter.append(meterText, bar);
  const tableBox = node("div");
  const totalsBox = node("dl", null, { class: "totales" });

  function units() {
    return lines.reduce((a, l) => a + l.cantidad_solicitada, 0);
  }
  function draw() {
    const u = units();
    meterText.replaceChildren(
      node("strong", "Unidades en la orden: " + fmt(u) + " / " + fmt(LIMITE_UNIDADES)),
      node("span", u > LIMITE_UNIDADES ? " · supera la política" : " · disponible " + fmt(LIMITE_UNIDADES - u)),
    );
    fill.style.width = Math.min(100, (u / LIMITE_UNIDADES) * 100) + "%";
    meter.className = "medidor" + (u > LIMITE_UNIDADES ? " excedido" : u > LIMITE_UNIDADES * 0.8 ? " alerta" : "");
    tableBox.replaceChildren(
      grid(
        ["Producto", "Cantidad", "Costo unitario", "Subtotal", ""],
        lines.map((l) => ({
          item: l,
          cells: [
            l.nombre,
            fmt(l.cantidad_solicitada),
            money(l.costo_unitario),
            money(l.cantidad_solicitada * l.costo_unitario),
            btn("Quitar", "btn-peligro-suave", () => {
              lines.splice(lines.indexOf(l), 1);
              draw();
            }),
          ],
        })),
      ),
    );
    const sub = lines.reduce((a, l) => a + l.cantidad_solicitada * l.costo_unitario, 0);
    const iva = lines.reduce((a, l) => a + l.cantidad_solicitada * l.costo_unitario * (l.iva / 100), 0);
    totalsBox.replaceChildren();
    for (const [k, v, cls] of [["Subtotal", money(sub)], ["IVA", money(iva)], ["Total", money(sub + iva), "fila total"]]) {
      const row = node("div", null, { class: cls || "fila" });
      row.append(node("dt", k), node("dd", v));
      totalsBox.append(row);
    }
  }

  proveedor.addEventListener(
    "change",
    task(async () => {
      producto.replaceChildren();
      if (!proveedor.value) {
        producto.disabled = true;
        producto.append(node("option", "Primero elige un proveedor", { value: "" }));
        return;
      }
      linked = await data("/admin/proveedores/" + proveedor.value + "/productos");
      producto.disabled = false;
      producto.append(node("option", "Selecciona un producto…", { value: "" }));
      const ids = new Set(linked.map((l) => l.id_producto));
      const g1 = node("optgroup", null, { label: "Productos de este proveedor" });
      const g2 = node("optgroup", null, { label: "Otros productos" });
      for (const p of products)
        (ids.has(p.id_producto) ? g1 : g2).append(node("option", p.nombre + " · " + p.sku, { value: p.id_producto }));
      if (g1.children.length) producto.append(g1);
      producto.append(g2);
    }),
  );
  producto.addEventListener("change", () => {
    const l = linked.find((x) => x.id_producto === Number(producto.value));
    costo.value = l ? Number(l.costo_compra).toFixed(2) : "";
  });
  add.addEventListener(
    "click",
    task(async () => {
      const id = Number(producto.value),
        qty = Number(cantidad.value),
        cost = Number(costo.value);
      if (!id) return notify("Elige un producto de la lista.", "aviso", { title: "Falta el producto" });
      if (!Number.isInteger(qty) || qty < 1)
        return notify("La cantidad debe ser un número entero mayor que cero.", "aviso", { title: "Cantidad inválida" });
      if (!(cost > 0)) return notify("Ingresa un costo unitario mayor que cero.", "aviso", { title: "Costo inválido" });
      const existing = lines.find((l) => l.id_producto === id);
      const total = units() + qty;
      if (total > LIMITE_UNIDADES)
        return politica(
          "No se pueden comprar más de " + fmt(LIMITE_UNIDADES) + " unidades a un proveedor en una misma orden de compra. Con esta línea la orden sumaría " + fmt(total) + " unidades.",
        );
      const p = products.find((x) => x.id_producto === id);
      if (existing) {
        existing.cantidad_solicitada += qty;
        existing.costo_unitario = cost;
      } else
        lines.push({ id_producto: id, nombre: p.nombre, cantidad_solicitada: qty, costo_unitario: cost, iva: Number(p.porcentaje_iva ?? 15) });
      cantidad.value = "";
      producto.value = "";
      costo.value = "";
      draw();
      notify(p.nombre + " · " + fmt(qty) + " u.", "exito", { title: existing ? "Cantidad sumada" : "Producto agregado", duration: 2000 });
    }),
  );

  async function guardar(enviar) {
    if (!proveedor.value) return notify("Selecciona el proveedor de la orden.", "aviso", { title: "Falta el proveedor" });
    if (!lines.length) return notify("Agrega al menos un producto.", "aviso", { title: "Orden vacía" });
    if (units() > LIMITE_UNIDADES) return politica();
    const body = {
      id_proveedor: Number(proveedor.value),
      detalles: lines.map(({ id_producto, cantidad_solicitada, costo_unitario }) => ({ id_producto, cantidad_solicitada, costo_unitario })),
    };
    if (entrega.value) body.fecha_entrega_esperada = entrega.value;
    if (obs.value.trim()) body.observaciones = obs.value.trim();
    let oc;
    try {
      oc = await data("/admin/ordenes-compra", "POST", body);
    } catch (e) {
      if (e.message.startsWith("Política")) return politica(e.message);
      throw e;
    }
    if (enviar) await data("/admin/ordenes-compra/" + oc.id_orden_compra + "/enviar", "POST", {});
    notify(oc.numero_orden + (enviar ? " fue enviada al proveedor." : " quedó guardada como borrador."), "exito", {
      title: "Orden de compra creada",
    });
    await ordenesCompra(oc.id_orden_compra);
  }
  const actions = node("div", null, { class: "acciones-modulo" });
  actions.append(
    btn("Cancelar", "btn-secundario", () => box.replaceChildren()),
    btn("Guardar borrador", "chip", () => guardar(false)),
    btn("✓ Guardar y enviar al proveedor", "btn-exito", () => guardar(true)),
  );
  panelEl.append(head, node("h4", "Productos"), lineRow, meter, tableBox, totalsBox, actions);
  box.replaceChildren(panelEl);
  draw();
  panelEl.scrollIntoView({ behavior: "smooth", block: "start" });
  proveedor.focus();
}

async function detalleOrdenCompra(id) {
  const oc = await data("/admin/ordenes-compra/" + id);
  const box = $("detalle-modulo");
  const panelEl = node("section", null, { class: "panel detalle-orden" });
  const top = node("div", null, { class: "cuenta-cabecera" });
  const t = node("div");
  t.append(node("h3", "Orden " + oc.numero_orden), node("p", oc.proveedor.razon_social + " · RUC " + oc.proveedor.ruc, { class: "nota" }));
  top.append(t, chip(oc.estado, ESTADOS_OC));
  const info = node("dl", null, { class: "info-grid" });
  for (const [k, v] of [
    ["Emisión", fechaHora(oc.fecha_emision)],
    ["Entrega esperada", fecha(oc.fecha_entrega_esperada)],
    ["Subtotal", money(oc.subtotal)],
    ["IVA", money(oc.iva)],
    ["Total", money(oc.total)],
    ["Observaciones", oc.observaciones || "—"],
  ])
    info.append(node("dt", k), node("dd", v));
  const unidades = oc.detalle_orden_compra.reduce((a, l) => a + l.cantidad_solicitada, 0);
  panelEl.append(
    top,
    info,
    node("h4", "Productos (" + fmt(unidades) + " unidades)"),
    grid(
      ["Producto", "Solicitada", "Recibida", "Pendiente", "Costo", "Subtotal", ""],
      oc.detalle_orden_compra.map((l) => ({
        item: l,
        cells: [
          l.producto.nombre,
          fmt(l.cantidad_solicitada),
          fmt(l.cantidad_recibida),
          fmt(l.cantidad_solicitada - l.cantidad_recibida),
          money(l.costo_unitario),
          money(l.subtotal),
          btn("Ver kardex", "chip", () => kardex(l.id_producto)),
        ],
      })),
    ),
  );
  const acts = node("div", null, { class: "acciones-modulo" });
  if (oc.estado === "borrador")
    acts.append(
      btn("✓ Enviar al proveedor", "btn-exito", async () => {
        if (!(await confirmar({ title: "¿Enviar la orden " + oc.numero_orden + "?", message: "Después ya no podrás editar sus productos.", accept: "Sí, enviar" }))) return;
        await data("/admin/ordenes-compra/" + id + "/enviar", "POST", {});
        notify(oc.proveedor.razon_social, "exito", { title: "Orden enviada al proveedor" });
        await ordenesCompra(id);
      }),
    );
  if (["borrador", "enviada"].includes(oc.estado))
    acts.append(
      btn("✕ Cancelar orden", "btn-peligro-suave", async () => {
        if (!(await confirmar({ title: "¿Cancelar la orden " + oc.numero_orden + "?", message: "La orden quedará anulada y no podrá recibirse.", accept: "Sí, cancelar", danger: true }))) return;
        await data("/admin/ordenes-compra/" + id, "DELETE");
        notify(oc.numero_orden, "info", { title: "Orden cancelada" });
        await ordenesCompra(id);
      }),
    );
  panelEl.append(acts);

  if (["enviada", "recibida_parcial"].includes(oc.estado)) {
    const rec = node("form", null, { class: "panel recepcion" });
    rec.append(node("h4", "Registrar recepción de mercadería"), node("p", "Indica lo que llegó en buen estado. Solo las unidades aceptadas entran al inventario y al kardex.", { class: "nota" }));
    const inputs = [];
    const lista = node("div", null, { class: "recepcion-lineas" });
    for (const l of oc.detalle_orden_compra) {
      const pend = l.cantidad_solicitada - l.cantidad_recibida;
      if (!pend) continue;
      const ok = node("input", null, { type: "number", min: 0, max: pend, step: 1, value: pend });
      const bad = node("input", null, { type: "number", min: 0, step: 1, value: 0 });
      const row = node("div", null, { class: "recepcion-fila" });
      row.append(node("strong", l.producto.nombre), node("small", "Pendiente: " + fmt(pend)), campo("Aceptadas", ok), campo("Rechazadas", bad));
      lista.append(row);
      inputs.push({ l, pend, ok, bad });
    }
    const guia = node("input", null, { maxlength: 50, placeholder: "Opcional" });
    rec.append(lista, campo("Guía de remisión del proveedor", guia), node("button", "✓ Registrar recepción", { type: "submit", class: "btn-exito" }));
    rec.addEventListener(
      "submit",
      task(async () => {
        const detalles = [];
        for (const { l, pend, ok, bad } of inputs) {
          const a = Number(ok.value || 0),
            r = Number(bad.value || 0);
          if (!Number.isInteger(a) || !Number.isInteger(r) || a < 0 || r < 0)
            return notify("Las cantidades deben ser números enteros, cero o mayores.", "aviso", { title: "Cantidad inválida" });
          if (a > pend)
            return notify(l.producto.nombre + ": no puedes aceptar más de " + fmt(pend) + " unidades pendientes.", "aviso", { title: "Cantidad excedida" });
          if (a + r) detalles.push({ id_detalle_oc: l.id_detalle_oc, cantidad_recibida: a, cantidad_rechazada: r });
        }
        if (!detalles.length) return notify("Indica al menos una cantidad recibida.", "aviso", { title: "Recepción vacía" });
        const total = detalles.reduce((s, d) => s + d.cantidad_recibida, 0);
        if (!(await confirmar({ title: "¿Registrar la recepción?", message: fmt(total) + " unidades entrarán al inventario y se registrarán en el kardex.", accept: "Sí, registrar" }))) return;
        const body = { detalles };
        if (guia.value.trim()) body.guia_remision_proveedor = guia.value.trim();
        const r = await data("/admin/ordenes-compra/" + id + "/recepciones", "POST", body);
        notify(fmt(total) + " unidades ingresaron al inventario. El kardex se actualizó.", "exito", { title: "Recepción " + r.numero_recepcion + " registrada" });
        await ordenesCompra(id);
      }),
    );
    panelEl.append(rec);
  }
  if (oc.recepcion_compra.length) {
    panelEl.append(
      node("h4", "Recepciones"),
      grid(
        ["Número", "Fecha", "Guía", "Estado", ""],
        oc.recepcion_compra.map((r) => ({
          item: r,
          cells: [
            r.numero_recepcion,
            fechaHora(r.fecha_recepcion),
            r.guia_remision_proveedor,
            chip(r.estado),
            r.estado === "completada"
              ? btn("Anular", "btn-peligro-suave", async () => {
                  if (!(await confirmar({ title: "¿Anular la recepción " + r.numero_recepcion + "?", message: "Se descontarán esas unidades del inventario con movimientos inversos en el kardex.", accept: "Sí, anular", danger: true }))) return;
                  await data("/admin/recepciones/" + r.id_recepcion + "/anular", "POST", {});
                  notify(r.numero_recepcion, "info", { title: "Recepción anulada · kardex actualizado" });
                  await ordenesCompra(id);
                })
              : "",
          ],
        })),
      ),
    );
  }
  box.replaceChildren(panelEl);
  panelEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------------------- Órdenes de venta ----------------------------- */
let filtroPedido = "",
  busquedaPedido = "";
async function ordenesVenta(abrir) {
  const q = new URLSearchParams({ limite: 100 });
  if (filtroPedido) q.set("estado", filtroPedido);
  if (busquedaPedido) q.set("q", busquedaPedido);
  const orders = await data("/admin/pedidos?" + q);
  main.replaceChildren(
    cabecera(
      "Órdenes de venta",
      "Pedidos de los clientes. Al aprobarse el pago se descuenta el stock y se registra la salida en el kardex.",
    ),
  );
  const toolbar = node("div", null, { class: "barra-modulo" });
  const filtros = node("div", null, { class: "filtros" });
  for (const [value, label] of [["", "Todos"], ...Object.entries(ESTADOS_PEDIDO).filter(([k]) => k !== "devuelto")]) {
    const b = btn(label, "chip", async () => {
      filtroPedido = value;
      await ordenesVenta();
    });
    b.setAttribute("aria-pressed", String(filtroPedido === value));
    filtros.append(b);
  }
  const search = node("input", null, { type: "search", placeholder: "Buscar por número o correo…", value: busquedaPedido, "aria-label": "Buscar pedido" });
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(task(async () => {
      busquedaPedido = search.value.trim();
      await ordenesVenta();
      $("buscar-pedido")?.focus();
    }), 350);
  });
  search.id = "buscar-pedido";
  toolbar.append(filtros, search);
  main.append(
    toolbar,
    grid(
      ["Número", "Cliente", "Fecha", "Estado", "Total"],
      orders.map((p) => ({
        item: p,
        cells: [
          p.numero_pedido,
          p.usuario ? p.usuario.nombres + " " + p.usuario.apellidos + " · " + p.usuario.email : "—",
          fechaHora(p.fecha_pedido),
          chip(p.estado, ESTADOS_PEDIDO),
          money(p.total),
        ],
      })),
      (p) => detalleOrdenVenta(p.id_pedido),
    ),
    node("section", null, { id: "detalle-modulo" }),
  );
  if (abrir) await detalleOrdenVenta(abrir);
}

async function detalleOrdenVenta(id) {
  const p = await data("/pedidos/" + id);
  const box = $("detalle-modulo");
  const panelEl = node("section", null, { class: "panel detalle-orden" });
  const top = node("div", null, { class: "cuenta-cabecera" });
  const t = node("div");
  const dir = p.direccion_envio || p.direccion_pedido_id_direccion_envioTodireccion;
  t.append(node("h3", "Pedido " + p.numero_pedido), node("p", (dir?.destinatario || "") + " · " + (dir ? dir.calle_principal + ", " + dir.ciudad : ""), { class: "nota" }));
  top.append(t, chip(p.estado, ESTADOS_PEDIDO));
  const info = node("dl", null, { class: "info-grid" });
  for (const [k, v] of [
    ["Fecha", fechaHora(p.fecha_pedido)],
    ["Subtotal", money(p.subtotal)],
    ["Descuento", money(p.descuento)],
    ["IVA", money(p.iva)],
    ["Envío", money(p.costo_envio)],
    ["Total", money(p.total)],
  ])
    info.append(node("dt", k), node("dd", v));
  const timeline = node("ol", null, { class: "linea-tiempo" });
  for (const h of p.historial_estado_pedido) {
    const li = node("li");
    li.append(chip(h.estado, ESTADOS_PEDIDO), node("small", fechaHora(h.fecha_cambio)));
    timeline.append(li);
  }
  panelEl.append(
    top,
    info,
    node("h4", "Productos"),
    grid(
      ["Producto", "Cantidad", "Precio unitario", "Subtotal", "IVA", ""],
      p.detalle_pedido.map((l) => ({
        item: l,
        cells: [l.producto.nombre, fmt(l.cantidad), money(l.precio_unitario), money(l.subtotal), money(l.iva), btn("Ver kardex", "chip", () => kardex(l.id_producto))],
      })),
    ),
    node("h4", "Historial"),
    timeline,
  );
  if (p.pago.length) {
    panelEl.append(
      node("h4", "Pagos"),
      grid(
        ["Pago", "Monto", "Estado", ""],
        p.pago.map((pay) => {
          const actions = node("div", null, { class: "mini-acciones" });
          if (pay.estado === "pendiente" && role === "Administrador")
            actions.append(
              btn("✓ Aprobar", "btn-exito btn-sm", async () => {
                if (!(await confirmar({ title: "¿Aprobar el pago de " + money(pay.monto) + "?", message: "El pedido pasará a pagado, se descontará el stock y se registrará la salida en el kardex.", accept: "Sí, aprobar" }))) return;
                await data("/admin/pagos/" + pay.id_pago + "/estado", "PUT", { estado: "aprobado" });
                notify(p.numero_pedido + " · stock descontado y kardex actualizado.", "exito", { title: "Pago aprobado" });
                await ordenesVenta(id);
              }),
              btn("✕ Rechazar", "btn-peligro-suave", async () => {
                if (!(await confirmar({ title: "¿Rechazar este pago?", message: "El cliente deberá registrar un nuevo pago.", accept: "Sí, rechazar", danger: true }))) return;
                await data("/admin/pagos/" + pay.id_pago + "/estado", "PUT", { estado: "rechazado" });
                notify(p.numero_pedido, "info", { title: "Pago rechazado" });
                await ordenesVenta(id);
              }),
            );
          return { item: pay, cells: ["#" + pay.id_pago, money(pay.monto), chip(pay.estado), actions] };
        }),
      ),
    );
  }
  if (p.factura) panelEl.append(node("p", "🧾 Factura " + p.factura.numero_factura + " · " + money(p.factura.total)));
  if (p.envio[0]) panelEl.append(node("p", "🚚 Envío " + p.envio[0].estado + " · guía " + (p.envio[0].numero_guia || "pendiente")));

  const acts = node("div", null, { class: "acciones-modulo" });
  const next = { pagado: "preparando", preparando: "enviado", enviado: "entregado" }[p.estado];
  if (next === "preparando") {
    const carriers = (await data("/admin/transportistas")).filter((c) => c.activo);
    const carrier = selectOf(carriers.map((c) => [c.id_transportista, c.nombre]), "Selecciona transportista…");
    const guia = node("input", null, { maxlength: 50, placeholder: "Opcional" });
    const f = node("div", null, { class: "form-inline" });
    f.append(campo("Transportista *", carrier), campo("Número de guía", guia));
    acts.append(
      f,
      btn("✓ Pasar a preparación", "btn-exito", async () => {
        if (!carrier.value) return notify("Elige el transportista del envío.", "aviso", { title: "Falta transportista" });
        const body = { estado: "preparando", id_transportista: Number(carrier.value) };
        if (guia.value.trim()) body.numero_guia = guia.value.trim();
        await data("/admin/pedidos/" + id + "/estado", "PUT", body);
        notify(p.numero_pedido, "exito", { title: "Pedido en preparación" });
        await ordenesVenta(id);
      }),
    );
  } else if (next)
    acts.append(
      btn(next === "enviado" ? "✓ Marcar como enviado" : "✓ Marcar como entregado", "btn-exito", async () => {
        if (!(await confirmar({ title: "¿Cambiar el pedido a " + ESTADOS_PEDIDO[next].toLowerCase() + "?", accept: "Sí, cambiar" }))) return;
        await data("/admin/pedidos/" + id + "/estado", "PUT", { estado: next });
        notify(p.numero_pedido, "exito", { title: "Pedido " + ESTADOS_PEDIDO[next].toLowerCase() });
        await ordenesVenta(id);
      }),
    );
  if (p.estado === "pendiente")
    acts.append(
      btn("✕ Cancelar pedido", "btn-peligro-suave", async () => {
        if (!(await confirmar({ title: "¿Cancelar " + p.numero_pedido + "?", message: "Se liberará el stock reservado.", accept: "Sí, cancelar", danger: true }))) return;
        await data("/admin/pedidos/" + id + "/estado", "PUT", { estado: "cancelado" });
        notify(p.numero_pedido, "info", { title: "Pedido cancelado" });
        await ordenesVenta(id);
      }),
    );
  if (["pagado", "preparando", "enviado", "entregado"].includes(p.estado))
    panelEl.append(node("p", "✓ La salida de estos productos ya está registrada en el kardex como «Venta».", { class: "nota-ok" }));
  panelEl.append(acts);
  box.replaceChildren(panelEl);
  panelEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* --------------------------------- Kardex --------------------------------- */
let kardexProducto = null;
async function kardex(idProducto) {
  if (idProducto) kardexProducto = idProducto;
  if (!["Administrador", "Bodeguero"].includes(role)) {
    notify("El kardex lo consultan Bodega y Administración.", "aviso");
    return;
  }
  const inventory = await all("/admin/inventario");
  kardexProducto ??= inventory[0]?.id_producto;
  main.replaceChildren(
    cabecera("Kardex de inventario", "Historial de entradas y salidas de cada producto con su costo promedio ponderado."),
  );
  const pick = selectOf(inventory.map((i) => [i.id_producto, i.nombre + " · " + i.sku + " · stock " + i.stock_actual]));
  pick.value = String(kardexProducto);
  pick.id = "kardex-producto";
  pick.addEventListener("change", task(() => kardex(Number(pick.value))));
  const desde = node("input", null, { type: "date" }),
    hasta = node("input", null, { type: "date" });
  const filtrar = btn("Filtrar fechas", "chip", () => cargar());
  const bar = node("div", null, { class: "form-inline kardex-filtros" });
  bar.append(campo("Producto", pick, true), campo("Desde", desde), campo("Hasta", hasta), filtrar);
  const resumen = node("div", null, { class: "stats" });
  const check = node("p");
  const tabla = node("div");
  main.append(bar, resumen, check, tabla);
  async function cargar() {
    const q = new URLSearchParams();
    if (desde.value) q.set("desde", desde.value);
    if (hasta.value) q.set("hasta", hasta.value + "T23:59:59");
    const k = await data("/admin/inventario/" + kardexProducto + "/kardex" + (q.size ? "?" + q : ""));
    const movs = k.movimientos;
    const entradas = movs.filter((m) => m.cantidad > 0).reduce((a, m) => a + m.cantidad, 0);
    const salidas = movs.filter((m) => m.cantidad < 0).reduce((a, m) => a - m.cantidad, 0);
    const last = movs.at(-1);
    resumen.replaceChildren();
    for (const [label, value, cls] of [
      ["Stock actual", fmt(k.saldo_actual?.stock_actual ?? 0)],
      ["Reservado", fmt(k.saldo_actual?.stock_reservado ?? 0)],
      ["Entradas", "+" + fmt(entradas), "entrada"],
      ["Salidas", "−" + fmt(salidas), "salida"],
      ["Costo promedio", money(last?.saldo_costo_promedio ?? 0)],
      ["Valor en bodega", money(last?.saldo_valor ?? 0)],
    ]) {
      const c = node("div", null, { class: "stat " + (cls || "") });
      c.append(node("strong", value), node("span", label));
      resumen.append(c);
    }
    const ok = !q.size && last ? last.saldo_cantidad === k.saldo_actual?.stock_actual : null;
    check.className = ok === null ? "nota" : ok ? "nota-ok" : "nota-error";
    check.textContent =
      ok === null
        ? "Mostrando movimientos filtrados por fecha."
        : ok
          ? "✓ El saldo del kardex (" + fmt(last.saldo_cantidad) + ") coincide con el stock del inventario."
          : "✕ El saldo del kardex no coincide con el inventario.";
    tabla.replaceChildren(
      grid(
        ["Fecha", "Documento", "Detalle", "Entrada", "Salida", "Costo unit.", "Saldo", "Costo prom.", "Saldo valor", "Usuario"],
        [...movs].reverse().map((m) => ({
          item: m,
          cells: [
            fechaHora(m.fecha_kardex),
            DOCUMENTOS[m.tipo_documento] || m.tipo_documento,
            m.detalle || (m.id_documento ? "#" + m.id_documento : "—"),
            m.cantidad > 0 ? node("span", "+" + fmt(m.cantidad), { class: "entrada" }) : "",
            m.cantidad < 0 ? node("span", "−" + fmt(-m.cantidad), { class: "salida" }) : "",
            money(m.costo_unitario),
            node("strong", fmt(m.saldo_cantidad)),
            money(m.saldo_costo_promedio),
            money(m.saldo_valor),
            m.usuario ? m.usuario.nombres : "—",
          ],
        })),
      ),
    );
  }
  await cargar();
}

if (!["Administrador", "Vendedor", "Bodeguero"].includes(role))
  location.replace("cuenta.html");
else {
  const home = action("Resumen", dashboard);
  home.dataset.modulo = "resumen";
  menu.append(home);
  for (const [key, names] of Object.entries(sections))
    if (
      role === "Administrador" ||
      (key === "Ventas" && role === "Vendedor") ||
      (key === "Bodega" && role === "Bodeguero")
    ) {
      menu.append(node("span", key, { class: "menu-grupo" }));
      for (const n of names) {
        const b = action(LABELS[n] || n.replaceAll("-", " "), () => show(n));
        b.dataset.modulo = n;
        if (LABELS[n]) b.classList.add("chip-destacado");
        menu.append(b);
      }
    }
  dashboard().catch((e) => status(e.message));
}
