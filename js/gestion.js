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
    "pedidos",
    "resenas",
    "devoluciones",
    "transportistas",
  ],
  Bodega: ["inventario", "proveedores", "ordenes-compra", "recepciones"],
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
async function show(name, page = 1) {
  if (name === "bases-distribuidas") {
    distributedDatabases();
    return;
  }
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
        action("Consultar kardex", async () =>
          panel.append(table((await data(path + "/kardex")).movimientos)),
        ),
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
if (!["Administrador", "Vendedor", "Bodeguero"].includes(role))
  location.replace("cuenta.html");
else {
  menu.append(action("Resumen", dashboard));
  for (const [key, names] of Object.entries(sections))
    if (
      role === "Administrador" ||
      (key === "Ventas" && role === "Vendedor") ||
      (key === "Bodega" && role === "Bodeguero")
    )
      for (const n of names)
        menu.append(action(n.replaceAll("-", " "), () => show(n)));
  dashboard().catch((e) => status(e.message));
}
