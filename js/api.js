import { apiBase } from "./deployment.js";
export const $ = (id) => document.getElementById(id);
export const money = (n) =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(
    n,
  );
export const session = () =>
  JSON.parse(localStorage.getItem("techstore.session") || "null");
export const saveSession = (data) =>
  localStorage.setItem("techstore.session", JSON.stringify(data));
export const logout = () => localStorage.removeItem("techstore.session");
export function node(tag, text, attrs = {}) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  for (const [k, v] of Object.entries(attrs))
    if (v !== undefined) el.setAttribute(k, v);
  return el;
}
export function status(message) {
  const el = $("status") || $("resumen") || $("mensaje");
  if (el) el.textContent = message;
}
export async function api(path, method = "GET", body) {
  if (!apiBase) throw Error("La tienda está en línea. La conexión con el servidor aún está pendiente.");
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (session()) headers.Authorization = "Bearer " + session().token;
  const response = await fetch(apiBase + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return {};
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && session()) {
      logout();
      location.assign("cuenta.html");
    }
    throw Error(
      (result.error?.mensaje || "Solicitud fallida") +
        (result.error?.detalles?.length
          ? " · " + result.error.detalles.map((d) => d.campo).join(", ")
          : ""),
    );
  }
  return result;
}
export const data = async (...args) => (await api(...args)).data;
const ICONS = { exito: "✓", error: "✕", info: "i", aviso: "!" };
// Notificación flotante: tipo "exito" (verde), "error" (rojo), "aviso" o "info".
export function notify(message, type = "exito", options = {}) {
  let stack = $("notificaciones");
  if (!stack) {
    stack = node("div", null, {
      id: "notificaciones",
      class: "notificaciones",
      "aria-live": "polite",
    });
    document.body.append(stack);
  }
  const item = node("div", null, {
    class: "notificacion " + type,
    role: type === "error" ? "alert" : "status",
  });
  const text = node("div", null, { class: "notificacion-texto" });
  text.append(node("strong", options.title || message));
  if (options.title) text.append(node("span", message));
  item.append(
    node("span", ICONS[type] || "i", { class: "notificacion-icono", "aria-hidden": "true" }),
    text,
  );
  if (options.link)
    item.append(node("a", options.link[0], { href: options.link[1], class: "notificacion-enlace" }));
  const close = node("button", "×", { type: "button", class: "notificacion-cerrar", "aria-label": "Cerrar aviso" });
  item.append(close);
  const remove = () => {
    item.classList.add("saliendo");
    setTimeout(() => item.remove(), 250);
  };
  close.onclick = remove;
  stack.append(item);
  while (stack.children.length > 3) stack.firstChild.remove();
  setTimeout(remove, options.duration || (type === "error" ? 6000 : 3500));
}
// Ventana de confirmación. danger=true pinta el botón de rojo; si no, verde.
export function confirmar({
  title,
  message = "",
  accept = "Confirmar",
  cancel = "Cancelar",
  danger = false,
  details,
}) {
  return new Promise((resolve) => {
    const dlg = node("dialog", null, { class: "dialogo" });
    dlg.append(
      node("div", danger ? "!" : "✓", {
        class: "dialogo-icono " + (danger ? "alerta" : "exito"),
        "aria-hidden": "true",
      }),
      node("h2", title),
    );
    if (message) dlg.append(node("p", message));
    if (details) {
      const dl = node("dl", null, { class: "resumen-pedido" });
      for (const [k, v, strong] of details) {
        dl.append(node("dt", k), node("dd", v, strong ? { class: "destacado" } : {}));
      }
      dlg.append(dl);
    }
    const actions = node("div", null, { class: "dialogo-acciones" });
    const no = node("button", cancel, { type: "button", class: "btn-secundario" });
    const yes = node("button", accept, {
      type: "button",
      class: danger ? "btn-peligro" : "btn-exito",
    });
    actions.append(no, yes);
    dlg.append(actions);
    let answer = false;
    no.onclick = () => dlg.close();
    yes.onclick = () => {
      answer = true;
      dlg.close();
    };
    dlg.onclose = () => {
      dlg.remove();
      resolve(answer);
    };
    document.body.append(dlg);
    dlg.showModal();
    no.focus();
  });
}
// Aviso modal con un solo botón (por ejemplo, políticas de la empresa).
export function avisar({ title, message, accept = "Entendido", type = "alerta" }) {
  return new Promise((resolve) => {
    const dlg = node("dialog", null, { class: "dialogo", role: "alertdialog" });
    dlg.append(
      node("div", type === "exito" ? "✓" : "!", {
        class: "dialogo-icono " + type,
        "aria-hidden": "true",
      }),
      node("h2", title),
      node("p", message),
    );
    const actions = node("div", null, { class: "dialogo-acciones" });
    const ok = node("button", accept, { type: "button", class: type === "exito" ? "btn-exito" : "btn-peligro" });
    ok.onclick = () => dlg.close();
    actions.append(ok);
    dlg.append(actions);
    dlg.onclose = () => {
      dlg.remove();
      resolve();
    };
    document.body.append(dlg);
    dlg.showModal();
    ok.focus();
  });
}
export function task(fn) {
  return async (event) => {
    event?.preventDefault();
    const button = event?.submitter || event?.currentTarget;
    if (button?.disabled) return;
    if (button) {
      button.disabled = true;
      button.classList.add("cargando");
      button.setAttribute("aria-busy", "true");
    }
    try {
      await fn(event);
    } catch (e) {
      notify(e.message, "error", { title: "No se pudo completar" });
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove("cargando");
        button.removeAttribute("aria-busy");
      }
    }
  };
}
export function action(label, fn) {
  const b = node("button", label, { type: "button", class: "chip" });
  b.addEventListener("click", task(fn));
  return b;
}
export function form(title, fields, submit, fn) {
  const f = node("form", null, { class: "panel store-form" });
  if (title) f.append(node("h3", title));
  for (const field of fields) {
    const [name, label, type = "text", options] = field;
    const lab = node("label", label);
    const input =
      type === "select"
        ? node("select")
        : node("input", null, {
            type: type.replace("?", ""),
            step: type.includes("number") ? "any" : undefined,
          });
    input.name = name;
    input.required = !type.includes("?");
    if (type === "select")
      for (const [value, text] of options)
        input.append(node("option", text, { value }));
    lab.append(input);
    f.append(lab);
  }
  f.append(node("button", submit, { class: "btn-add", type: "submit" }));
  f.addEventListener(
    "submit",
    task(async () => {
      const body = {};
      for (const el of f.elements)
        if (el.name && el.value !== "")
          body[el.name] = el.type === "number" ? Number(el.value) : el.value;
      await fn(body, f);
    }),
  );
  return f;
}
export function nav() {
  const links = document.querySelector("nav ul");
  if (!links) return;
  for (const [name, path] of [
    ...(canBuy() ? [["♥ Favoritos", "index.html#favoritos"]] : []),
    [session() ? "Mi cuenta" : "Iniciar sesión", "cuenta.html"],
    ...(["Administrador", "Vendedor", "Bodeguero"].includes(
      session()?.usuario.rol,
    )
      ? [["Gestión", "gestion.html"]]
      : []),
  ]) {
    if (!links.querySelector('a[href="' + path + '"]')) {
      const li = node("li");
      const link = node("a", name, { href: path, class: "nav-link" });
      if (location.pathname.endsWith("/" + path)) link.setAttribute("aria-current", "page");
      li.append(link);
      links.append(li);
    }
  }
}
export const canBuy = () =>
  ["Cliente", "Administrador"].includes(session()?.usuario.rol);
export async function counter() {
  if (!canBuy()) return;
  const c = await data("/carrito");
  setBadge(c.resumen.total_items);
}
export function setBadge(n) {
  const badge = $("cart-count");
  if (!badge) return;
  const changed = badge.textContent !== String(n);
  badge.textContent = n;
  $("enlace-carrito")?.setAttribute(
    "aria-label",
    "Carrito, " + n + (n === 1 ? " producto" : " productos"),
  );
  if (changed) {
    badge.classList.remove("rebote");
    void badge.offsetWidth;
    badge.classList.add("rebote");
  }
}
nav();
