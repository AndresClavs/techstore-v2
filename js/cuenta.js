import {
  $,
  data,
  session,
  saveSession,
  logout,
  node,
  form,
  money,
  task,
  notify,
  confirmar,
} from "./api.js";
const main = $("workspace");
const params = new URLSearchParams(location.search);

const button = (label, cls, fn) => {
  const b = node("button", label, { type: "button", class: cls });
  b.addEventListener("click", task(fn));
  return b;
};
const badge = (estado) => node("span", estado, { class: "estado " + estado });
function panel(title) {
  const p = node("section", null, { class: "panel" });
  p.append(node("h2", title));
  return p;
}

function credentials() {
  async function enter(path, b) {
    const result = await data("/auth/" + path, "POST", b);
    saveSession(result);
    notify(
      path === "login" ? "Hola de nuevo, " + result.usuario.nombres : "Bienvenido/a, " + result.usuario.nombres,
      "exito",
      { title: path === "login" ? "Sesión iniciada" : "Cuenta creada" },
    );
    const back = params.get("volver");
    setTimeout(() => {
      if (back && /^[a-z]+\.html$/.test(back)) location.assign(back);
      else location.reload();
    }, 700);
  }
  const auth = [
    ["email", "Correo", "email"],
    ["password", "Contraseña", "password"],
  ];
  const grid = node("div", null, { class: "auth-grid" });
  grid.append(
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
  if (params.get("volver"))
    main.append(node("p", "Inicia sesión o crea una cuenta para continuar con tu compra.", { class: "replication-notice" }));
  main.append(grid);
}

async function order(id) {
  const p = await data("/pedidos/" + id),
    box = $("order");
  box.hidden = false;
  const head = node("div", null, { class: "cuenta-cabecera" });
  head.append(node("h2", "Pedido " + p.numero_pedido), badge(p.estado));
  box.replaceChildren(head);
  box.append(node("p", "Total: " + money(p.total), { class: "precio" }));
  box.append(node("p", "Historial: " + p.historial_estado_pedido.map((h) => h.estado).join(" → "), { class: "nota" }));
  const lines = node("ul", null, { class: "lista-simple" });
  for (const l of p.detalle_pedido) {
    const li = node("li");
    li.append(node("span", l.producto.nombre + " × " + l.cantidad), node("strong", money(Number(l.subtotal) + Number(l.iva))));
    lines.append(li);
    if (p.estado === "entregado") {
      const f = form(
        "Devolver " + l.producto.nombre,
        [
          ["cantidad", "Cantidad", "number"],
          ["motivo", "Motivo"],
        ],
        "Solicitar devolución",
        async (b) => {
          await data("/devoluciones", "POST", { ...b, id_detalle: l.id_detalle });
          notify(l.producto.nombre, "exito", { title: "Devolución solicitada" });
          await account();
        },
      );
      const d = node("details");
      d.append(node("summary", "Solicitar devolución"), f);
      li.append(d);
    }
  }
  box.append(lines);
  if (p.factura) box.append(node("p", "🧾 Factura " + p.factura.numero_factura + " · " + money(p.factura.total)));
  if (p.envio.length) box.append(node("p", "🚚 Envío " + p.envio[0].estado + " · " + (p.envio[0].numero_guia || "sin guía aún")));
  for (const pay of p.pago) {
    const row = node("p", "💳 Pago " + money(pay.monto) + " ");
    row.append(badge(pay.estado));
    box.append(row);
  }
  if (p.estado === "pendiente") {
    if (!p.pago.some((x) => x.estado === "pendiente")) {
      const methods = await data("/metodos-pago");
      box.append(
        form(
          "Pagar pedido",
          [["id_metodo_pago", "Forma de pago", "select", methods.map((m) => [m.id_metodo_pago, m.nombre])]],
          "Registrar pago",
          async (b) => {
            const pay = await data("/pedidos/" + id + "/pagos", "POST", b);
            notify(
              pay.estado === "aprobado" ? "Tu pedido ya está pagado." : "Queda pendiente de aprobación.",
              "exito",
              { title: "Pago registrado" },
            );
            await account();
          },
        ),
      );
    }
    box.append(
      button("✕ Cancelar pedido", "btn-peligro-suave", async () => {
        const ok = await confirmar({
          title: "¿Cancelar el pedido " + p.numero_pedido + "?",
          message: "Se liberarán los productos reservados. No se puede deshacer.",
          accept: "Sí, cancelar pedido",
          cancel: "No, mantenerlo",
          danger: true,
        });
        if (!ok) return;
        await data("/pedidos/" + id + "/cancelar", "POST", {});
        notify(p.numero_pedido, "info", { title: "Pedido cancelado" });
        await account();
      }),
    );
  }
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function account() {
  const u = await data("/auth/me");
  const head = node("section", null, { class: "panel cuenta-cabecera" });
  const who = node("div");
  who.append(node("h2", "Hola, " + u.nombres + " " + u.apellidos), node("p", u.email + " · " + u.rol, { class: "nota" }));
  const acts = node("div", null, { class: "acciones" });
  if (u.rol !== "Cliente")
    acts.append(node("a", "Abrir gestión de tienda", { href: "gestion.html", class: "btn-secundario" }));
  acts.append(
    button("Cerrar sesión", "btn-peligro-suave", async () => {
      const ok = await confirmar({
        title: "¿Cerrar sesión?",
        message: "Tendrás que volver a ingresar para comprar.",
        accept: "Sí, salir",
        cancel: "Quedarme",
        danger: true,
      });
      if (!ok) return;
      logout();
      location.assign("index.html");
    }),
  );
  head.append(who, acts);
  main.replaceChildren(head);

  const grid = node("div", null, { class: "cuenta-grid" });
  main.append(grid);
  const profilePanel = panel("Mi perfil");
  const profile = form(
    "",
    [
      ["nombres", "Nombres"],
      ["apellidos", "Apellidos"],
      ["telefono", "Teléfono", "tel?"],
    ],
    "Guardar perfil",
    async (b) => {
      await data("/usuarios/" + u.id_usuario, "PUT", b);
      notify("Tus datos se guardaron correctamente.", "exito", { title: "Perfil actualizado" });
      await account();
    },
  );
  for (const input of profile.elements) if (input.name) input.value = u[input.name] || "";
  profilePanel.append(profile);
  grid.append(profilePanel);
  if (!["Cliente", "Administrador"].includes(u.rol)) return;

  const path = "/usuarios/" + u.id_usuario + "/direcciones";
  const [dirs, orders, favorites, returns] = await Promise.all([
    data(path),
    data("/pedidos?limite=100"),
    data("/favoritos"),
    data("/devoluciones?limite=100"),
  ]);

  // Favoritos
  const favPanel = panel("♥ Mis favoritos");
  if (!favorites.length)
    favPanel.append(node("p", "Aún no tienes favoritos. En la tienda, toca el corazón ♡ de un producto.", { class: "vacio-mini" }));
  const favList = node("div", null, { class: "favoritos-lista" });
  for (const p of favorites) {
    const card = node("article", null, { class: "mini-card" });
    const img = node("img", null, { src: p.imagen_principal || "assets/img/placeholder.svg", alt: p.nombre, loading: "lazy" });
    img.addEventListener("error", () => (img.src = "assets/img/placeholder.svg"), { once: true });
    const info = node("div");
    info.append(node("h3", p.nombre), node("p", money(p.precio_venta), { class: "precio" }));
    const actions = node("div", null, { class: "mini-acciones" });
    actions.append(
      button("🛒 Añadir", "btn-add", async () => {
        await data("/carrito/items", "POST", { id_producto: p.id_producto, cantidad: 1 });
        notify(p.nombre, "exito", { title: "Producto añadido al carrito", link: ["Ver carrito", "carrito.html"] });
      }),
      button("Quitar", "btn-peligro-suave", async () => {
        await data("/favoritos/" + p.id_producto, "DELETE");
        notify(p.nombre, "info", { title: "Quitado de tus favoritos" });
        await account();
      }),
    );
    card.append(img, info, actions);
    favList.append(card);
  }
  favPanel.append(favList, node("a", "Ir a la tienda →", { href: "index.html#favoritos", class: "enlace" }));

  // Pedidos
  const ordersPanel = panel("📦 Mis pedidos");
  const oList = node("ul", null, { class: "lista-simple" });
  for (const p of orders) {
    const li = node("li");
    const text = node("span", p.numero_pedido + " · " + money(p.total) + " ");
    text.append(badge(p.estado));
    li.append(text, button("Ver detalle", "chip", () => order(p.id_pedido)));
    oList.append(li);
  }
  ordersPanel.append(orders.length ? oList : node("p", "Aún no tienes pedidos.", { class: "vacio-mini" }));

  // Direcciones
  const fields = [
    ["destinatario", "Destinatario"],
    ["calle_principal", "Calle principal"],
    ["ciudad", "Ciudad"],
    ["provincia", "Provincia"],
  ];
  const dirPanel = panel("📍 Mis direcciones");
  const dList = node("ul", null, { class: "lista-simple" });
  for (const d of dirs) {
    const li = node("li");
    li.append(
      node("span", d.destinatario + " · " + d.calle_principal + ", " + d.ciudad),
      button("Editar", "chip", () => {
        const f = form("Editar dirección", fields, "Guardar cambios", async (b) => {
          await data(path + "/" + d.id_direccion, "PUT", b);
          notify(b.calle_principal, "exito", { title: "Dirección actualizada" });
          await account();
        });
        for (const input of f.elements) if (input.name) input.value = d[input.name] || "";
        li.after(f);
      }),
      button("Quitar", "btn-peligro-suave", async () => {
        const ok = await confirmar({
          title: "¿Eliminar esta dirección?",
          message: d.calle_principal + ", " + d.ciudad,
          accept: "Sí, eliminar",
          danger: true,
        });
        if (!ok) return;
        await data(path + "/" + d.id_direccion, "DELETE");
        notify(d.calle_principal, "info", { title: "Dirección eliminada" });
        await account();
      }),
    );
    dList.append(li);
  }
  if (dirs.length) dirPanel.append(dList);
  dirPanel.append(
    form("Añadir dirección", fields, "Guardar dirección", async (b) => {
      await data(path, "POST", { ...b, es_predeterminada: !dirs.length });
      notify(b.calle_principal + ", " + b.ciudad, "exito", { title: "Dirección guardada" });
      await account();
    }),
  );

  // Devoluciones
  const retPanel = panel("↩ Mis devoluciones");
  const rList = node("ul", null, { class: "lista-simple" });
  for (const d of returns) {
    const li = node("li");
    li.append(node("span", d.motivo), badge(d.estado));
    rList.append(li);
  }
  retPanel.append(returns.length ? rList : node("p", "Sin devoluciones.", { class: "vacio-mini" }));

  grid.append(ordersPanel, favPanel, dirPanel, retPanel);
  main.append(node("section", null, { id: "order", class: "panel", hidden: "" }));
  const selected = params.get("pedido");
  if (selected) await order(selected);
}
if (!session()) credentials();
else
  account().catch((e) => notify(e.message, "error", { title: "No se pudo cargar tu cuenta" }));
