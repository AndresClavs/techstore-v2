import {
  $,
  api,
  data,
  session,
  saveSession,
  logout,
  node,
  action,
  form,
  money,
  status,
} from "./api.js";
const main = $("workspace");
function credentials() {
  async function enter(path, b) {
    saveSession(await data("/auth/" + path, "POST", b));
    location.reload();
  }
  const auth = [
    ["email", "Correo", "email"],
    ["password", "Contraseña", "password"],
  ];
  main.append(
    form("Iniciar sesión", auth, "Entrar", (b) => enter("login", b)),
    form(
      "Crear cuenta",
      [
        ["identificacion", "Identificación"],
        ["nombres", "Nombres"],
        ["apellidos", "Apellidos"],
        ...auth,
      ],
      "Registrarme",
      (b) => enter("registro", b),
    ),
  );
}
async function order(id) {
  const p = await data("/pedidos/" + id),
    box = $("order");
  box.replaceChildren(
    node("h3", p.numero_pedido),
    node("p", p.estado + " · " + money(p.total)),
  );
  box.append(
    node("p", p.historial_estado_pedido.map((h) => h.estado).join(" → ")),
  );
  for (const l of p.detalle_pedido) {
    box.append(
      node(
        "p",
        l.producto.nombre +
          " × " +
          l.cantidad +
          " · " +
          money(Number(l.subtotal) + Number(l.iva)),
      ),
    );
    if (p.estado === "entregado")
      box.append(
        form(
          "Devolución de " + l.producto.nombre,
          [
            ["cantidad", "Cantidad", "number"],
            ["motivo", "Motivo"],
          ],
          "Solicitar",
          async (b) => {
            await data("/devoluciones", "POST", {
              ...b,
              id_detalle: l.id_detalle,
            });
            status("Devolución solicitada");
          },
        ),
      );
  }
  if (p.factura)
    box.append(
      node(
        "p",
        "Factura " + p.factura.numero_factura + " · " + money(p.factura.total),
      ),
    );
  if (p.envio.length)
    box.append(
      node(
        "p",
        "Envío " +
          p.envio[0].estado +
          " · " +
          (p.envio[0].numero_guia || "Sin guía"),
      ),
    );
  for (const pay of p.pago)
    box.append(node("p", "Pago " + pay.estado + " · " + money(pay.monto)));
  if (p.estado === "pendiente") {
    box.append(
      action("Cancelar pedido", async () => {
        await data("/pedidos/" + id + "/cancelar", "POST", {});
        await account();
      }),
    );
    if (!p.pago.some((x) => x.estado === "pendiente"))
      box.append(
        form(
          "Pagar pedido",
          [
            [
              "id_metodo_pago",
              "Método",
              "select",
              (await data("/metodos-pago")).map((m) => [
                m.id_metodo_pago,
                m.nombre,
              ]),
            ],
          ],
          "Registrar pago",
          async (b) => {
            await data("/pedidos/" + id + "/pagos", "POST", b);
            await account();
            await order(id);
          },
        ),
      );
  }
}
async function account() {
  const u = await data("/auth/me");
  main.replaceChildren(
    node("h2", u.nombres + " " + u.apellidos),
    node("p", u.email + " · " + u.rol),
    action("Cerrar sesión", () => {
      logout();
      location.reload();
    }),
  );
  const profile = form(
    "Mi perfil",
    [
      ["nombres", "Nombres"],
      ["apellidos", "Apellidos"],
      ["telefono", "Teléfono", "tel?"],
    ],
    "Guardar perfil",
    async (b) => {
      await data("/usuarios/" + u.id_usuario, "PUT", b);
      await account();
      status("Perfil actualizado");
    },
  );
  for (const input of profile.elements)
    if (input.name) input.value = u[input.name] || "";
  main.append(profile);
  if (u.rol !== "Cliente")
    main.append(
      node("a", "Abrir gestión de tienda", {
        href: "gestion.html",
        class: "nav-link",
      }),
    );
  if (!["Cliente", "Administrador"].includes(u.rol)) return;
  const path = "/usuarios/" + u.id_usuario + "/direcciones";
  const [dirs, orders, favorites, returns] = await Promise.all([
    data(path),
    data("/pedidos?limite=100"),
    data("/favoritos"),
    data("/devoluciones?limite=100"),
  ]);
  const fields = [
    ["destinatario", "Destinatario"],
    ["calle_principal", "Calle principal"],
    ["ciudad", "Ciudad"],
    ["provincia", "Provincia"],
  ];
  main.append(node("h2", "Mis direcciones"));
  for (const d of dirs) {
    const line = node(
      "p",
      d.destinatario + " · " + d.calle_principal + ", " + d.ciudad,
    );
    line.append(
      action("Editar", () => {
        const f = form("Editar dirección", fields, "Guardar", async (b) => {
          await data(path + "/" + d.id_direccion, "PUT", b);
          await account();
        });
        for (const input of f.elements)
          if (input.name) input.value = d[input.name] || "";
        line.after(f);
      }),
      action("Quitar", async () => {
        await data(path + "/" + d.id_direccion, "DELETE");
        await account();
      }),
    );
    main.append(line);
  }
  main.append(
    form("Añadir dirección", fields, "Guardar", async (b) => {
      await data(path, "POST", { ...b, es_predeterminada: !dirs.length });
      await account();
    }),
  );
  main.append(node("h2", "Mis pedidos"));
  for (const p of orders)
    main.append(
      action(p.numero_pedido + " · " + p.estado + " · " + money(p.total), () =>
        order(p.id_pedido),
      ),
    );
  if (!orders.length) main.append(node("p", "Aún no tienes pedidos."));
  main.append(
    node("section", null, { id: "order", class: "panel" }),
    node("h2", "Mis favoritos"),
  );
  for (const p of favorites) {
    const row = node("p", p.nombre);
    row.append(
      action("Quitar", async () => {
        await data("/favoritos/" + p.id_producto, "DELETE");
        await account();
      }),
    );
    main.append(row);
  }
  if (!favorites.length) main.append(node("p", "Aún no tienes favoritos."));
  main.append(node("h2", "Mis devoluciones"));
  for (const d of returns) main.append(node("p", d.motivo + " · " + d.estado));
  if (!returns.length) main.append(node("p", "Sin devoluciones."));
  const selected = new URLSearchParams(location.search).get("pedido");
  if (selected) await order(selected);
}
if (!session()) credentials();
else account().catch((e) => status(e.message));
