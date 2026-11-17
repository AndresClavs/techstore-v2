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
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (session()) headers.Authorization = "Bearer " + session().token;
  const response = await fetch("/api" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return {};
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && session()) {
      logout();
      location.assign("/cuenta.html");
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
export function task(fn) {
  return async (event) => {
    event?.preventDefault();
    const button = event?.submitter || event?.currentTarget;
    if (button) button.disabled = true;
    try {
      await fn(event);
    } catch (e) {
      status(e.message);
    } finally {
      if (button) button.disabled = false;
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
    ["Mi cuenta", "cuenta.html"],
    ...(["Administrador", "Vendedor", "Bodeguero"].includes(
      session()?.usuario.rol,
    )
      ? [["Gestión", "gestion.html"]]
      : []),
  ]) {
    if (!links.querySelector('a[href="' + path + '"]')) {
      const li = node("li");
      li.append(node("a", name, { href: path, class: "nav-link" }));
      links.append(li);
    }
  }
}
export async function counter() {
  if (
    !session() ||
    !["Cliente", "Administrador"].includes(session().usuario.rol)
  )
    return;
  const c = await data("/carrito");
  if ($("cart-count")) $("cart-count").textContent = c.resumen.total_items;
}
nav();
