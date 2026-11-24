import {
  $,
  data,
  money,
  node,
  session,
  task,
  notify,
  confirmar,
  setBadge,
  canBuy,
} from "./api.js";

let cart = null,
  coupon = null,
  catalogs = null;

function image(src, alt) {
  const img = node("img", null, { src: src || "assets/img/placeholder.svg", alt, loading: "lazy" });
  img.addEventListener("error", () => (img.src = "assets/img/placeholder.svg"), { once: true });
  return img;
}
const button = (label, cls, fn, attrs = {}) => {
  const b = node("button", label, { type: "button", class: cls, ...attrs });
  b.addEventListener("click", task(fn));
  return b;
};
const selected = (name) =>
  document.querySelector('input[name="' + name + '"]:checked')?.value;

function shipping() {
  const id = Number(selected("id_metodo_envio"));
  return catalogs?.shipping.find((m) => m.id_metodo_envio === id);
}

// Totales en pantalla: carrito + cupón + envío elegido
function totals() {
  const r = cart.resumen,
    ship = shipping();
  const discount = Number(coupon?.descuento_calculado || 0),
    iva = Number(coupon ? coupon.iva : r.iva),
    base = Number(coupon ? coupon.total : r.total),
    total = base + Number(ship?.costo_base || 0);
  $("unidades").textContent = r.total_items;
  $("subtotal").textContent = money(r.subtotal);
  $("fila-descuento").hidden = !coupon;
  $("descuento").textContent = "−" + money(discount);
  $("iva").textContent = money(iva);
  $("envio").textContent = ship
    ? ship.costo_base > 0
      ? money(ship.costo_base)
      : "Gratis"
    : "Elige un método";
  $("total").textContent = money(total);
  const confirm = $("btn-confirmar");
  if (confirm) confirm.textContent = "✓ Confirmar compra · " + money(total);
  return { discount, iva, total, ship };
}

function renderItems() {
  const rows = $("lista-carrito");
  rows.replaceChildren();
  for (const i of cart.items) {
    const li = node("li", null, { class: "item-carrito" });
    const info = node("div");
    info.append(node("h3", i.nombre), node("p", money(i.precio_actual) + " c/u", { class: "unitario" }));
    const controls = node("div", null, { class: "item-controles", role: "group", "aria-label": "Cantidad de " + i.nombre });
    const less = button("−", "btn-qty", () => change(i, i.cantidad - 1), {
      "aria-label": "Quitar una unidad de " + i.nombre,
    });
    const more = button("+", "btn-qty", () => change(i, i.cantidad + 1), {
      "aria-label": "Añadir una unidad de " + i.nombre,
    });
    more.disabled = i.cantidad >= i.stock_disponible;
    controls.append(
      less,
      node("span", String(i.cantidad), { class: "cantidad-valor", "aria-live": "polite" }),
      more,
      button("✕ Quitar", "btn-peligro-suave", () => remove(i)),
    );
    li.append(image(i.imagen, i.nombre), info, node("p", money(i.subtotal), { class: "linea-total" }), controls);
    if (i.precio_cambio)
      li.append(node("p", "⚠ El precio cambió desde que lo añadiste.", { class: "aviso-precio" }));
    rows.append(li);
  }
}

async function change(item, quantity) {
  if (quantity < 1) return remove(item);
  await data("/carrito/items/" + item.id_item, "PUT", { cantidad: quantity });
  await refresh();
  notify(item.nombre + " · " + quantity + (quantity === 1 ? " unidad" : " unidades"), "exito", {
    title: "Cantidad actualizada",
    duration: 2000,
  });
}

async function remove(item) {
  const ok = await confirmar({
    title: "¿Quitar este producto?",
    message: item.nombre + " se eliminará de tu carrito.",
    accept: "Sí, quitar",
    cancel: "No, conservar",
    danger: true,
  });
  if (!ok) return;
  await data("/carrito/items/" + item.id_item, "DELETE");
  await refresh();
  notify(item.nombre, "info", { title: "Producto quitado del carrito" });
}

async function emptyCart() {
  const ok = await confirmar({
    title: "¿Vaciar el carrito?",
    message: "Se quitarán todos los productos. Esta acción no se puede deshacer.",
    accept: "Sí, vaciar",
    cancel: "Cancelar",
    danger: true,
  });
  if (!ok) return;
  await data("/carrito", "DELETE");
  coupon = null;
  await refresh();
  notify("Tu carrito quedó vacío.", "info", { title: "Carrito vaciado" });
}

function option(name, value, title, hint, price, checked) {
  const label = node("label", null, { class: "opcion" });
  const input = node("input", null, { type: "radio", name, value });
  input.checked = !!checked;
  input.addEventListener("change", totals);
  const text = node("span");
  text.append(node("strong", title));
  if (hint) text.append(node("small", hint));
  label.append(input, text, node("span", price ?? "", { class: "opcion-precio" }));
  return label;
}

function step(n, title) {
  const fs = node("fieldset", null, { class: "paso" });
  const legend = node("legend");
  legend.append(node("span", String(n), { class: "paso-num", "aria-hidden": "true" }), title);
  fs.append(legend);
  fs.addEventListener("change", () => fs.classList.add("completo"));
  return fs;
}

function addressForm() {
  const f = node("form", null, { class: "form-inline" });
  for (const [name, label, required, wide] of [
    ["destinatario", "Nombre de quien recibe", true, true],
    ["calle_principal", "Dirección (calle y número)", true, true],
    ["ciudad", "Ciudad", true],
    ["provincia", "Provincia", true],
    ["telefono_contacto", "Teléfono (opcional)", false, true],
  ]) {
    const l = node("label", label, wide ? { class: "ancho" } : {});
    const input = node("input", null, { name, autocomplete: "on" });
    input.required = required;
    l.append(input);
    f.append(l);
  }
  f.append(node("button", "Guardar dirección", { type: "submit", class: "btn-add" }));
  f.addEventListener(
    "submit",
    task(async () => {
      const body = { es_predeterminada: true };
      for (const el of f.elements) if (el.name && el.value.trim()) body[el.name] = el.value.trim();
      await data("/usuarios/" + session().usuario.id_usuario + "/direcciones", "POST", body);
      notify(body.calle_principal + ", " + body.ciudad, "exito", { title: "Dirección guardada" });
      catalogs = null;
      await renderCheckout();
    }),
  );
  return f;
}

async function applyCoupon(input, state) {
  const code = input.value.trim();
  if (!code) {
    notify("Escribe el código del cupón.", "aviso");
    return;
  }
  try {
    coupon = await data("/cupones/validar", "POST", { codigo: code });
    input.classList.add("ok");
    input.removeAttribute("aria-invalid");
    state.className = "cupon-estado ok";
    state.textContent = "✓ Cupón " + coupon.codigo + " aplicado: ahorras " + money(coupon.descuento_calculado);
    notify("Ahorras " + money(coupon.descuento_calculado), "exito", { title: "Cupón aplicado" });
  } catch (e) {
    coupon = null;
    input.classList.remove("ok");
    input.setAttribute("aria-invalid", "true");
    state.className = "cupon-estado mal";
    state.textContent = "✕ " + e.message;
    notify(e.message, "error", { title: "Cupón no válido" });
  }
  totals();
}

async function renderCheckout() {
  const box = $("checkout-fields");
  catalogs ??= await (async () => {
    const [dirs, shippingList, methods] = await Promise.all([
      data("/usuarios/" + session().usuario.id_usuario + "/direcciones"),
      data("/metodos-envio"),
      data("/metodos-pago"),
    ]);
    return { dirs, shipping: shippingList, methods };
  })();
  box.replaceChildren();
  const { dirs, shipping: shippingList, methods } = catalogs;

  const s1 = step(1, "Dirección de entrega");
  if (!dirs.length) {
    s1.append(node("p", "Aún no tienes direcciones. Agrega una para continuar:", { class: "nota" }), addressForm());
    box.append(s1);
    totals();
    return;
  }
  const list = node("div", null, { class: "opciones" });
  dirs.forEach((d, i) =>
    list.append(
      option(
        "id_direccion_envio",
        d.id_direccion,
        d.destinatario,
        d.calle_principal + ", " + d.ciudad + " · " + d.provincia,
        "",
        d.es_predeterminada || i === 0,
      ),
    ),
  );
  s1.classList.add("completo");
  const same = node("label", null, { class: "nota" });
  const sameBox = node("input", null, { type: "checkbox", id: "misma-factura" });
  sameBox.checked = true;
  same.append(sameBox, " Usar la misma dirección para la factura");
  const billing = node("select", null, { id: "facturacion", "aria-label": "Dirección de facturación" });
  for (const d of dirs) billing.append(node("option", d.destinatario + " · " + d.calle_principal, { value: d.id_direccion }));
  billing.hidden = true;
  sameBox.onchange = () => (billing.hidden = sameBox.checked);
  const addOther = node("details");
  addOther.append(node("summary", "+ Agregar otra dirección"), addressForm());
  s1.append(list, same, billing, addOther);

  const s2 = step(2, "Método de envío");
  const ships = node("div", null, { class: "opciones" });
  for (const m of shippingList)
    ships.append(
      option(
        "id_metodo_envio",
        m.id_metodo_envio,
        m.nombre,
        m.dias_estimados ? "Llega en " + m.dias_estimados + (m.dias_estimados === 1 ? " día" : " días") : "Retira hoy mismo",
        m.costo_base > 0 ? money(m.costo_base) : "Gratis",
      ),
    );
  s2.append(ships);

  const s3 = step(3, "Forma de pago");
  const pays = node("div", null, { class: "opciones" });
  const icons = { tarjeta: "💳", transferencia: "🏦", efectivo: "💵" };
  for (const m of methods)
    pays.append(
      option(
        "id_metodo_pago",
        m.id_metodo_pago,
        (icons[m.tipo] || "•") + " " + m.nombre,
        m.tipo === "tarjeta" ? "Pago simulado con aprobación inmediata" : "Queda pendiente hasta que la tienda lo apruebe",
      ),
    );
  s3.append(pays);

  const s4 = step(4, "Cupón de descuento (opcional)");
  const row = node("div", null, { class: "cupon-fila" });
  const code = node("input", null, { id: "cupon", placeholder: "Ej. BIENVENIDO10", "aria-label": "Código de cupón" });
  const state = node("p", null, { class: "cupon-estado", role: "status" });
  if (coupon) {
    code.value = coupon.codigo;
    code.classList.add("ok");
    state.className = "cupon-estado ok";
    state.textContent = "✓ Cupón " + coupon.codigo + " aplicado";
  }
  row.append(code, button("Aplicar", "chip", () => applyCoupon(code, state)));
  s4.append(row, state);

  const confirm = node("button", "✓ Confirmar compra", { type: "button", class: "btn-confirmar", id: "btn-confirmar" });
  confirm.addEventListener("click", task(placeOrder));
  box.append(s1, s2, s3, s4, confirm, node("p", "🔒 Pago simulado: no se cobra dinero real.", { class: "nota-segura" }));
  totals();
}

async function placeOrder() {
  const envio = selected("id_direccion_envio"),
    metodo = selected("id_metodo_envio"),
    pago = selected("id_metodo_pago");
  const missing = [!envio && "la dirección", !metodo && "el método de envío", !pago && "la forma de pago"].filter(Boolean);
  if (missing.length) {
    notify("Elige " + missing.join(", ") + " para continuar.", "aviso", { title: "Faltan datos" });
    return;
  }
  const t = totals();
  const method = catalogs.methods.find((m) => m.id_metodo_pago === Number(pago));
  const ok = await confirmar({
    title: "¿Confirmas tu compra?",
    message: "Revisa el resumen antes de pagar.",
    accept: "Sí, comprar",
    cancel: "Revisar",
    details: [
      ["Productos", cart.resumen.total_items + " unidades"],
      ["Subtotal", money(cart.resumen.subtotal)],
      ...(coupon ? [["Descuento", "−" + money(t.discount)]] : []),
      ["IVA", money(t.iva)],
      ["Envío", t.ship.nombre + " · " + (t.ship.costo_base > 0 ? money(t.ship.costo_base) : "Gratis")],
      ["Pago", method.nombre],
      ["Total", money(t.total), true],
    ],
  });
  if (!ok) return;
  const overlay = node("div", "Procesando tu compra…", { class: "procesando", role: "status" });
  document.body.append(overlay);
  let order;
  try {
    const body = {
      id_direccion_envio: Number(envio),
      id_direccion_facturacion: Number($("misma-factura").checked ? envio : $("facturacion").value),
      id_metodo_envio: Number(metodo),
    };
    if (coupon) body.codigo_cupon = coupon.codigo;
    order = await data("/pedidos", "POST", body);
    let payment = null;
    try {
      payment = await data("/pedidos/" + order.id_pedido + "/pagos", "POST", { id_metodo_pago: Number(pago) });
    } catch (e) {
      notify("Tu pedido quedó registrado, pero el pago falló: " + e.message, "error", {
        link: ["Ver pedido", "cuenta.html?pedido=" + order.id_pedido],
      });
    }
    coupon = null;
    setBadge(0);
    showSuccess(order, payment, method);
    await refresh();
  } finally {
    overlay.remove();
  }
}

function showSuccess(order, payment, method) {
  const approved = payment?.estado === "aprobado";
  $("t-exito").textContent = approved ? "¡Compra realizada!" : "¡Pedido registrado!";
  $("d-exito").textContent = approved
    ? "Tu pago fue aprobado. Te avisaremos cuando enviemos tu pedido."
    : "Tu pedido quedó reservado. El pago por " + method.nombre.toLowerCase() + " está pendiente de aprobación.";
  const dl = $("resumen-pedido");
  dl.replaceChildren();
  for (const [k, v] of [
    ["Pedido", order.numero_pedido],
    ["Total", money(order.total)],
    ["Pago", approved ? "Aprobado ✓" : "Pendiente"],
  ])
    dl.append(node("dt", k), node("dd", v));
  $("ver-pedido").href = "cuenta.html?pedido=" + order.id_pedido;
  $("dialogo-exito").showModal();
}

async function refresh() {
  cart = await data("/carrito");
  setBadge(cart.resumen.total_items);
  $("vista-vacia").hidden = !!cart.items.length;
  $("vista-carrito").hidden = !cart.items.length;
  $("ultima-actualizacion").textContent = new Date().toLocaleString("es-EC");
  if (!cart.items.length) return;
  renderItems();
  if (coupon)
    try {
      coupon = await data("/cupones/validar", "POST", { codigo: coupon.codigo });
    } catch {
      coupon = null;
      notify("El cupón ya no aplica a este carrito.", "aviso");
    }
  if (!$("btn-confirmar")) await renderCheckout();
  else totals();
}

async function start() {
  if (!session()) {
    location.replace("cuenta.html?volver=carrito.html");
    return;
  }
  if (!canBuy()) {
    $("error-carga").hidden = false;
    $("error-carga").textContent = "Tu rol no puede comprar. Inicia sesión con una cuenta de cliente.";
    return;
  }
  $("btn-vaciar").addEventListener("click", task(emptyCart));
  await refresh();
}
start().catch((e) => {
  const err = $("error-carga");
  err.hidden = false;
  err.textContent = e.message;
  notify(e.message, "error");
});
