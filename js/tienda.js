import {
  $,
  node,
  money,
  data,
  api,
  session,
  task,
  action,
  status,
  counter,
  form,
  notify,
  canBuy,
} from "./api.js";
let category = "",
  page = 1,
  version = 0;
const grid = $("grid-productos"),
  filters = $("filtros");
// Favoritos del usuario: id_producto -> producto
const favorites = new Map();

function image(src, alt) {
  const img = node("img", null, {
    src: src || "assets/img/placeholder.svg",
    alt,
    loading: "lazy",
  });
  img.addEventListener(
    "error",
    () => {
      img.src = "assets/img/placeholder.svg";
    },
    { once: true },
  );
  return img;
}

// Comprueba que haya una cuenta que pueda comprar; si no, explica qué hacer.
function canUseCart() {
  if (!session()) {
    notify("Inicia sesión o crea una cuenta para comprar y guardar favoritos.", "aviso", {
      title: "Necesitas una cuenta",
      link: ["Iniciar sesión", "cuenta.html?volver=index.html"],
    });
    return false;
  }
  if (!canBuy()) {
    notify("Tu rol no puede comprar. Usa una cuenta de cliente.", "aviso");
    return false;
  }
  return true;
}

async function addToCart(p, button) {
  if (!canUseCart()) return;
  await data("/carrito/items", "POST", {
    id_producto: p.id_producto,
    cantidad: 1,
  });
  await counter();
  status(p.nombre + " añadido al carrito");
  notify(p.nombre, "exito", {
    title: "Producto añadido al carrito",
    link: ["Ver carrito", "carrito.html"],
  });
  if (button) {
    const label = button.textContent;
    button.classList.add("agregado");
    button.textContent = "✓ Añadido";
    setTimeout(() => {
      button.classList.remove("agregado");
      button.textContent = label;
    }, 1600);
  }
}

function heart(p) {
  const saved = favorites.has(p.id_producto);
  const b = node("button", saved ? "♥" : "♡", {
    type: "button",
    class: "btn-fav",
    "aria-pressed": String(saved),
    "aria-label": (saved ? "Quitar de favoritos: " : "Guardar en favoritos: ") + p.nombre,
    title: saved ? "Quitar de favoritos" : "Guardar en favoritos",
  });
  b.addEventListener("click", task(() => toggleFavorite(p)));
  return b;
}

async function toggleFavorite(p) {
  if (!canUseCart()) return;
  if (favorites.has(p.id_producto)) {
    await data("/favoritos/" + p.id_producto, "DELETE");
    favorites.delete(p.id_producto);
    notify(p.nombre, "info", { title: "Quitado de tus favoritos" });
  } else {
    await data("/favoritos", "POST", { id_producto: p.id_producto });
    favorites.set(p.id_producto, p);
    notify(p.nombre, "exito", {
      title: "Guardado en favoritos ♥",
      link: ["Ver favoritos", "#favoritos"],
    });
  }
  refreshHearts();
  renderFavorites();
}

function refreshHearts() {
  for (const b of document.querySelectorAll(".btn-fav[data-id]")) {
    const id = Number(b.dataset.id),
      saved = favorites.has(id),
      name = b.dataset.nombre;
    b.textContent = saved ? "♥" : "♡";
    b.setAttribute("aria-pressed", String(saved));
    b.setAttribute("aria-label", (saved ? "Quitar de favoritos: " : "Guardar en favoritos: ") + name);
    b.title = saved ? "Quitar de favoritos" : "Guardar en favoritos";
  }
}

async function loadFavorites() {
  favorites.clear();
  if (!session() || !canBuy()) return;
  for (const p of await data("/favoritos")) favorites.set(p.id_producto, p);
}

function renderFavorites() {
  const section = $("favoritos");
  if (!section) return;
  section.hidden = !(session() && canBuy());
  if (section.hidden) return;
  const list = $("favoritos-lista");
  list.replaceChildren();
  $("favoritos-total").textContent = favorites.size
    ? favorites.size + (favorites.size === 1 ? " producto guardado" : " productos guardados")
    : "Toca el corazón ♡ de cualquier producto para guardarlo aquí.";
  for (const p of favorites.values()) {
    const card = node("article", null, { class: "mini-card" });
    const info = node("div");
    info.append(node("h3", p.nombre), node("p", money(p.precio_venta), { class: "precio" }));
    const actions = node("div", null, { class: "mini-acciones" });
    const add = node("button", "🛒 Añadir", { type: "button", class: "btn-add" });
    add.disabled = p.stock_disponible === 0;
    add.addEventListener("click", task(() => addToCart(p, add)));
    const remove = node("button", "Quitar", { type: "button", class: "btn-peligro-suave" });
    remove.addEventListener("click", task(() => toggleFavorite(p)));
    actions.append(add, remove);
    card.append(image(p.imagen_principal, p.nombre), info, actions);
    list.append(card);
  }
}

const stars = (n) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));

async function detail(p) {
  const [product, reviews] = await Promise.all([
    data("/productos/" + p.id_producto),
    data("/productos/" + p.id_producto + "/resenas"),
  ]);
  const dlg = node("dialog", null, { class: "dialogo detalle", "aria-label": p.nombre });
  const closeX = node("button", "×", { type: "button", class: "dialogo-cerrar", "aria-label": "Cerrar detalle" });
  closeX.onclick = () => dlg.close();
  const gridEl = node("div", null, { class: "detalle-grid" });
  const left = node("div");
  left.append(image(product.imagen_principal, p.nombre));
  const right = node("div");
  right.append(
    node("h2", p.nombre),
    node("p", p.descripcion),
    node("p", money(p.precio_venta) + " + IVA", { class: "precio" }),
  );
  if (product.rating_promedio)
    right.append(
      node("p", stars(product.rating_promedio) + " (" + product.total_resenas + " reseñas)", {
        class: "estrellas",
      }),
    );
  const specs = node("dl", null, { class: "detalle-specs" });
  specs.append(node("dt", "Garantía"), node("dd", product.garantia_meses + " meses"));
  for (const s of product.especificaciones)
    specs.append(node("dt", s.nombre), node("dd", s.valor + " " + (s.unidad || "")));
  specs.append(node("dt", "Disponibles"), node("dd", String(product.stock_disponible)));
  right.append(specs);
  const actions = node("div", null, { class: "detalle-acciones" });
  const add = node("button", "🛒 Añadir al carrito", { type: "button", class: "btn-add" });
  add.disabled = product.stock_disponible === 0;
  add.addEventListener("click", task(() => addToCart(product, add)));
  const fav = heart(product);
  fav.dataset.id = product.id_producto;
  fav.dataset.nombre = product.nombre;
  actions.append(add, fav);
  right.append(actions);
  gridEl.append(left, right);
  dlg.append(closeX, gridEl);
  const reviewBox = node("section");
  reviewBox.append(node("h3", "Reseñas"));
  for (const r of reviews) {
    const item = node("div", null, { class: "resena" });
    item.append(
      node("span", stars(r.calificacion) + " ", { class: "estrellas" }),
      node("strong", r.usuario.nombres),
      node("p", r.comentario || ""),
    );
    reviewBox.append(item);
  }
  if (!reviews.length) reviewBox.append(node("p", "Aún no hay reseñas.", { class: "nota" }));
  if (session())
    reviewBox.append(
      form(
        "Escribe una reseña",
        [
          ["calificacion", "Calificación del 1 al 5", "number"],
          ["comentario", "Comentario"],
        ],
        "Enviar reseña",
        async (body) => {
          await data("/productos/" + p.id_producto + "/resenas", "POST", body);
          dlg.close();
          notify("Se publicará cuando sea aprobada.", "exito", { title: "Reseña enviada" });
        },
      ),
    );
  dlg.append(reviewBox);
  const close = node("button", "Cerrar", { type: "button", class: "btn-secundario" });
  close.onclick = () => dlg.close();
  const foot = node("div", null, { class: "dialogo-acciones" });
  foot.append(close);
  dlg.append(foot);
  document.body.append(dlg);
  dlg.onclose = () => {
    dlg.remove();
    refreshHearts();
  };
  dlg.showModal();
}

function card(p) {
  const article = node("article", null, { class: "producto-card" }),
    media = node("div", null, { class: "img-contenedor" }),
    img = image(p.imagen_principal, p.nombre);
  img.classList.add("img-producto");
  const fav = heart(p);
  fav.dataset.id = p.id_producto;
  fav.dataset.nombre = p.nombre;
  media.append(img, node("span", p.categoria.nombre, { class: "categoria" }), fav);
  const info = node("div", null, { class: "producto-info" });
  const stock = p.stock_disponible;
  const meta = node("div", null, { class: "meta" });
  meta.append(
    node("p", money(p.precio_venta), { class: "precio" }),
    node(
      "span",
      stock === 0 ? "Agotado" : stock <= 5 ? "¡Últimas " + stock + "!" : stock + " disponibles",
      { class: "stock" + (stock === 0 ? " agotado" : stock <= 5 ? " pocas" : "") },
    ),
  );
  info.append(node("h3", p.nombre), node("p", p.descripcion, { class: "descripcion" }), meta);
  const actions = node("div", null, { class: "card-acciones" });
  const add = node("button", stock === 0 ? "Agotado" : "🛒 Añadir al carrito", {
    type: "button",
    class: "btn-add",
  });
  add.disabled = stock === 0;
  add.addEventListener("click", task(() => addToCart(p, add)));
  actions.append(add, action("Ver detalles", () => detail(p)));
  info.append(actions);
  article.append(media, info);
  return article;
}

async function render() {
  const ticket = ++version;
  status("Cargando catálogo…");
  const q = new URLSearchParams({ pagina: page, q: $("buscador").value });
  if (category) q.set("categoria", category);
  for (const key of ["marca", "orden", "precio_min", "precio_max"])
    if ($(key)?.value) q.set(key, $(key).value);
  const result = await api("/productos?" + q);
  if (ticket !== version) return;
  grid.replaceChildren(...result.data.map(card));
  if (!result.data.length)
    grid.append(node("p", "No encontramos productos con esos filtros.", { class: "sin-resultados" }));
  status(
    result.meta.total
      ? result.meta.total + " productos · Página " + page + " de " + result.meta.totalPaginas
      : "Sin productos para estos filtros",
  );
  const pages = $("pages");
  pages.replaceChildren();
  if (page > 1)
    pages.append(
      action("← Anterior", () => {
        page--;
        return render();
      }),
    );
  if (page < result.meta.totalPaginas)
    pages.append(
      action("Siguiente →", () => {
        page++;
        return render();
      }),
    );
}

async function start() {
  const pages = node("div", null, { id: "pages" });
  grid.after(pages);
  const [items, brands] = await Promise.all([
    data("/categorias"),
    data("/marcas"),
    loadFavorites().catch(() => {}),
  ]);
  renderFavorites();
  const more = node("div", null, { class: "herramientas" });
  filters.after(more);
  for (const [key, label, choices] of [
    ["marca", "Marca", [["", "Todas"], ...brands.map((b) => [b.id_marca, b.nombre])]],
    [
      "orden",
      "Orden",
      [
        ["relevancia", "Relevancia"],
        ["precio_asc", "Menor precio"],
        ["precio_desc", "Mayor precio"],
        ["recientes", "Recientes"],
        ["nombre", "Nombre"],
      ],
    ],
    ["precio_min", "Precio mínimo"],
    ["precio_max", "Precio máximo"],
  ]) {
    const field = node("label", label);
    const input = choices
      ? node("select", null, { id: key })
      : node("input", null, { id: key, type: "number", min: 0, step: "0.01" });
    if (choices) for (const [value, text] of choices) input.append(node("option", text, { value }));
    input.addEventListener(
      "change",
      task(() => {
        page = 1;
        return render();
      }),
    );
    field.append(input);
    more.append(field);
  }
  const chips = [];
  const filter = (label, value) => {
    const b = action(label, () => {
      category = value;
      page = 1;
      for (const c of chips) c.setAttribute("aria-pressed", String(c === b));
      return render();
    });
    b.setAttribute("aria-pressed", String(value === category));
    chips.push(b);
    return b;
  };
  filters.append(filter("Todas", ""));
  (function add(rows) {
    for (const c of rows) {
      filters.append(filter(c.nombre, c.id_categoria));
      add(c.hijos);
    }
  })(items);
  let timer;
  $("buscador").oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(
      task(() => {
        page = 1;
        return render();
      }),
      180,
    );
  };
  await render();
  await counter();
  if (location.hash === "#favoritos") $("favoritos")?.scrollIntoView();
}
start().catch((e) => {
  status(e.message);
  notify(e.message, "error", { title: "No se pudo cargar el catálogo" });
});
