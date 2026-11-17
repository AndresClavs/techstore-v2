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
} from "./api.js";
let category = "",
  page = 1,
  version = 0;
const grid = $("grid-productos"),
  filters = $("filtros");
function signed() {
  if (!session()) {
    location.assign("/cuenta.html");
    return false;
  }
  return true;
}
async function detail(p) {
  const [product, reviews] = await Promise.all([
    data("/productos/" + p.id_producto),
    data("/productos/" + p.id_producto + "/resenas"),
  ]);
  const dlg = node("dialog", null, { class: "dialogo" });
  dlg.append(
    node("h2", p.nombre),
    node("p", p.descripcion),
    node("p", "Garantía: " + product.garantia_meses + " meses"),
  );
  for (const image of product.imagenes)
    dlg.append(
      node("img", null, {
        src: image.url,
        alt: image.texto_alternativo || p.nombre,
        width: 160,
        loading: "lazy",
      }),
    );
  for (const s of product.especificaciones)
    dlg.append(node("p", s.nombre + ": " + s.valor + " " + (s.unidad || "")));
  for (const r of reviews)
    dlg.append(
      node(
        "p",
        r.calificacion +
          "/5 · " +
          r.usuario.nombres +
          " · " +
          (r.comentario || ""),
      ),
    );
  if (session())
    dlg.append(
      form(
        "Reseña",
        [
          ["calificacion", "Calificación del 1 al 5", "number"],
          ["comentario", "Comentario"],
        ],
        "Enviar",
        async (body) => {
          await data("/productos/" + p.id_producto + "/resenas", "POST", body);
          dlg.close();
          status("Reseña enviada para moderación");
        },
      ),
    );
  dlg.append(action("Cerrar", () => dlg.close()));
  document.body.append(dlg);
  dlg.onclose = () => dlg.remove();
  dlg.showModal();
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
  grid.replaceChildren();
  for (const p of result.data) {
    const card = node("article", null, { class: "producto-card" }),
      image = node("div", null, { class: "img-contenedor" }),
      img = node("img", null, {
        class: "img-producto",
        src: p.imagen_principal || "assets/img/placeholder.svg",
        alt: p.nombre,
        loading: "lazy",
      });
    img.addEventListener(
      "error",
      () => {
        img.src = "assets/img/placeholder.svg";
      },
      { once: true },
    );
    image.append(img, node("span", p.categoria.nombre, { class: "categoria" }));
    const info = node("div", null, { class: "producto-info" });
    info.append(
      node("h3", p.nombre),
      node("p", p.descripcion, { class: "descripcion" }),
      node("p", money(p.precio_venta), { class: "precio" }),
      node("p", "Disponibles: " + p.stock_disponible),
    );
    const add = action("Añadir", async () => {
      if (!signed()) return;
      await data("/carrito/items", "POST", {
        id_producto: p.id_producto,
        cantidad: 1,
      });
      await counter();
      status(p.nombre + " añadido al carrito");
    });
    add.disabled = p.stock_disponible === 0;
    info.append(
      add,
      action("Detalles", () => detail(p)),
      action("Guardar favorito", async () => {
        if (signed()) {
          await data("/favoritos", "POST", { id_producto: p.id_producto });
          status("Guardado en favoritos");
        }
      }),
    );
    card.append(image, info);
    grid.append(card);
  }
  status(
    result.meta.total
      ? result.meta.total + " productos · Página " + page
      : "Sin productos para estos filtros",
  );
  const pages = $("pages");
  pages.replaceChildren();
  if (page > 1)
    pages.append(
      action("Anterior", () => {
        page--;
        return render();
      }),
    );
  if (page < result.meta.totalPaginas)
    pages.append(
      action("Siguiente", () => {
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
  ]);
  const more = node("div", null, { class: "herramientas" });
  filters.after(more);
  for (const [key, label, choices] of [
    [
      "marca",
      "Marca",
      [["", "Todas"], ...brands.map((b) => [b.id_marca, b.nombre])],
    ],
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
    if (choices)
      for (const [value, label] of choices)
        input.append(node("option", label, { value }));
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
  const filter = (label, value) =>
    action(label, () => {
      category = value;
      page = 1;
      return render();
    });
  filters.append(filter("Todas", ""));
  function add(rows) {
    for (const c of rows) {
      filters.append(filter(c.nombre, c.id_categoria));
      add(c.hijos);
    }
  }
  add(items);
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
}
start().catch((e) => status(e.message));
