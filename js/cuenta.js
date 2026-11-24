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
  if (current !== "pedidos") show("pedidos");
  const p = await data("/pedidos/" + id),
    box = $("order");
  if (!box) return;
  for (const row of document.querySelectorAll(".pedido-fila"))
    row.toggleAttribute("aria-current", row.dataset.id === String(id));
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
    await order(id);
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
    await order(id);
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
    await order(id);
      }),
    );
  }
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

const SECTIONS = [
  ["resumen", "🏠", "Resumen"],
  ["pedidos", "📦", "Mis pedidos"],
  ["favoritos", "♥", "Mis favoritos"],
  ["direcciones", "📍", "Mis direcciones"],
  ["devoluciones", "↩", "Devoluciones"],
  ["perfil", "👤", "Mi perfil"],
];
let state = null;
let current = (location.hash || "").slice(1) || (params.get("pedido") ? "pedidos" : "resumen");

function empty(icon, text, link) {
  const box = node("div", null, { class: "vacio-seccion" });
  box.append(node("p", icon, { class: "vacio-icono", "aria-hidden": "true" }), node("p", text));
  if (link) box.append(node("a", link[0], { href: link[1], class: "btn-add btn-enlace" }));
  return box;
}

function section(title, subtitle) {
  const s = node("section", null, { class: "panel seccion-cuenta" });
  s.append(node("h2", title));
  if (subtitle) s.append(node("p", subtitle, { class: "nota" }));
  return s;
}

const views = {
  resumen() {
    const { orders, favorites, dirs, returns } = state;
    const s = section("Resumen de tu cuenta", "Elige una tarjeta para ver el detalle.");
    const stats = node("div", null, { class: "stats" });
    for (const [key, icon, label, value] of [
      ["pedidos", "📦", "Pedidos", orders.length],
      ["favoritos", "♥", "Favoritos", favorites.length],
      ["direcciones", "📍", "Direcciones", dirs.length],
      ["devoluciones", "↩", "Devoluciones", returns.length],
    ]) {
      const card = node("button", null, { type: "button", class: "stat" });
      card.append(
        node("span", icon, { class: "stat-icono", "aria-hidden": "true" }),
        node("strong", String(value)),
        node("span", label),
      );
      card.onclick = () => show(key);
      stats.append(card);
    }
    s.append(stats);
    const last = orders[0];
    if (last) {
      const box = node("div", null, { class: "ultimo-pedido" });
      const t = node("div");
      const line = node("strong", last.numero_pedido + " · " + money(last.total) + " ");
      line.append(badge(last.estado));
      t.append(node("p", "Tu último pedido", { class: "nota" }), line);
      box.append(
        t,
        button("Ver detalle", "chip", async () => {
          show("pedidos");
          await order(last.id_pedido);
        }),
      );
      s.append(box);
    } else s.append(empty("🛍", "Aún no has comprado nada. ¡Explora el catálogo!", ["Ir a la tienda", "index.html"]));
    return s;
  },
  pedidos() {
    const s = section("Mis pedidos", "Toca un pedido para ver su estado, factura y envío.");
    if (!state.orders.length) {
      s.append(empty("📦", "Aún no tienes pedidos.", ["Ir a la tienda", "index.html"]));
      return s;
    }
    const list = node("ul", null, { class: "lista-pedidos" });
    for (const p of state.orders) {
      const li = node("li");
      const b = node("button", null, { type: "button", class: "pedido-fila", "data-id": p.id_pedido });
      const left = node("span");
      const date = p.fecha_pedido || p.fecha_creacion;
      left.append(node("strong", p.numero_pedido));
      if (date) left.append(node("small", new Date(date).toLocaleDateString("es-EC")));
      const right = node("span", null, { class: "pedido-derecha" });
      right.append(node("strong", money(p.total)), badge(p.estado));
      b.append(left, right);
      b.addEventListener("click", task(() => order(p.id_pedido)));
      li.append(b);
      list.append(li);
    }
    s.append(list, node("section", null, { id: "order", class: "detalle-pedido", hidden: "" }));
    return s;
  },
  favoritos() {
    const s = section("Mis favoritos", "Productos que guardaste con ♥ en la tienda.");
    if (!state.favorites.length) {
      s.append(empty("♡", "Aún no tienes favoritos. En la tienda, toca el corazón de un producto.", ["Ir a la tienda", "index.html"]));
      return s;
    }
    const grid = node("div", null, { class: "favoritos-lista" });
    for (const p of state.favorites) {
      const card = node("article", null, { class: "mini-card" });
      const img = node("img", null, { src: p.imagen_principal || "assets/img/placeholder.svg", alt: p.nombre, loading: "lazy" });
      img.addEventListener("error", () => (img.src = "assets/img/placeholder.svg"), { once: true });
      const info = node("div");
      info.append(node("h3", p.nombre), node("p", money(p.precio_venta), { class: "precio" }));
      const actions = node("div", null, { class: "mini-acciones" });
      const add = button("🛒 Añadir", "btn-add", async () => {
        await data("/carrito/items", "POST", { id_producto: p.id_producto, cantidad: 1 });
        notify(p.nombre, "exito", { title: "Producto añadido al carrito", link: ["Ver carrito", "carrito.html"] });
      });
      add.disabled = p.stock_disponible === 0;
      actions.append(
        add,
        button("Quitar", "btn-peligro-suave", async () => {
          await data("/favoritos/" + p.id_producto, "DELETE");
          notify(p.nombre, "info", { title: "Quitado de tus favoritos" });
          await account();
        }),
      );
      card.append(img, info, actions);
      grid.append(card);
    }
    s.append(grid);
    return s;
  },
  direcciones() {
    const { u, dirs } = state;
    const path = "/usuarios/" + u.id_usuario + "/direcciones";
    const fields = [
      ["destinatario", "Destinatario"],
      ["calle_principal", "Calle principal"],
      ["ciudad", "Ciudad"],
      ["provincia", "Provincia"],
    ];
    const s = section("Mis direcciones", "Se usan para el envío y la factura de tus compras.");
    const list = node("div", null, { class: "direcciones" });
    for (const d of dirs) {
      const card = node("article", null, { class: "direccion-card" });
      const t = node("div");
      t.append(node("strong", d.destinatario), node("p", d.calle_principal), node("p", d.ciudad + ", " + d.provincia, { class: "nota" }));
      if (d.es_predeterminada) t.append(node("span", "Predeterminada", { class: "estado pagado" }));
      const acts = node("div", null, { class: "mini-acciones" });
      acts.append(
        button("Editar", "chip", () => {
          const f = form("Editar dirección", fields, "Guardar cambios", async (b) => {
            await data(path + "/" + d.id_direccion, "PUT", b);
            notify(b.calle_principal, "exito", { title: "Dirección actualizada" });
            await account();
          });
          for (const input of f.elements) if (input.name) input.value = d[input.name] || "";
          card.replaceChildren(f);
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
      card.append(t, acts);
      list.append(card);
    }
    if (!dirs.length) s.append(empty("📍", "Todavía no registras direcciones."));
    const add = node("details", null, { class: "agregar" });
    if (!dirs.length) add.open = true;
    add.append(
      node("summary", "+ Añadir nueva dirección"),
      form("", fields, "Guardar dirección", async (b) => {
        await data(path, "POST", { ...b, es_predeterminada: !dirs.length });
        notify(b.calle_principal + ", " + b.ciudad, "exito", { title: "Dirección guardada" });
        await account();
      }),
    );
    s.append(list, add);
    return s;
  },
  devoluciones() {
    const s = section("Mis devoluciones", "Puedes pedir una devolución desde el detalle de un pedido entregado.");
    if (!state.returns.length) {
      s.append(empty("↩", "No tienes devoluciones."));
      return s;
    }
    const list = node("ul", null, { class: "lista-simple" });
    for (const d of state.returns) {
      const li = node("li");
      li.append(node("span", d.motivo), badge(d.estado));
      list.append(li);
    }
    s.append(list);
    return s;
  },
  perfil() {
    const { u } = state;
    const s = section("Mi perfil", u.email + " · " + u.rol);
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
    s.append(profile);
    return s;
  },
};

const buyer = () => ["Cliente", "Administrador"].includes(state.u.rol);

function show(key) {
  if (!buyer() && key !== "perfil") key = "perfil";
  if (!views[key]) key = "resumen";
  current = key;
  history.replaceState(null, "", location.pathname + "#" + key);
  for (const b of document.querySelectorAll(".menu-cuenta button"))
    b.toggleAttribute("aria-current", b.dataset.key === key);
  $("contenido-cuenta").replaceChildren(views[key]());
}

async function account() {
  const u = await data("/auth/me");
  const canBuy = ["Cliente", "Administrador"].includes(u.rol);
  const path = "/usuarios/" + u.id_usuario + "/direcciones";
  const [dirs, orders, favorites, returns] = canBuy
    ? await Promise.all([data(path), data("/pedidos?limite=100"), data("/favoritos"), data("/devoluciones?limite=100")])
    : [[], [], [], []];
  state = { u, dirs, orders, favorites, returns };

  const head = node("section", null, { class: "panel cuenta-cabecera" });
  const who = node("div", null, { class: "quien" });
  const names = node("div");
  names.append(node("h2", "Hola, " + u.nombres + " " + u.apellidos), node("p", u.email + " · " + u.rol, { class: "nota" }));
  who.append(node("span", (u.nombres[0] || "?") + (u.apellidos[0] || ""), { class: "avatar", "aria-hidden": "true" }), names);
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

  const layout = node("div", null, { class: "cuenta-layout" });
  const menu = node("nav", null, { class: "menu-cuenta", "aria-label": "Secciones de mi cuenta" });
  const counts = { pedidos: orders.length, favoritos: favorites.length, direcciones: dirs.length, devoluciones: returns.length };
  for (const [key, icon, label] of SECTIONS) {
    if (!canBuy && key !== "perfil") continue;
    const b = node("button", null, { type: "button", "data-key": key });
    b.append(node("span", icon, { "aria-hidden": "true", class: "menu-icono" }), node("span", label));
    if (counts[key]) b.append(node("span", String(counts[key]), { class: "contador" }));
    b.onclick = () => show(key);
    menu.append(b);
  }
  layout.append(menu, node("div", null, { id: "contenido-cuenta" }));
  main.replaceChildren(head, layout);
  show(current);
}
if (!session()) credentials();
else
  account()
    .then(() => {
      const selected = params.get("pedido");
      if (selected && current === "pedidos") return order(selected);
    })
    .catch((e) => notify(e.message, "error", { title: "No se pudo cargar tu cuenta" }));
