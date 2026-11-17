import { $, data, action, form, status, money, node, session } from "./api.js";
async function render() {
  if (!session()) {
    location.replace("/cuenta.html");
    return;
  }
  const c = await data("/carrito");
  $("cart-count").textContent = c.resumen.total_items;
  $("vista-vacia").hidden = !!c.items.length;
  $("vista-carrito").hidden = !c.items.length;
  const rows = $("lista-carrito");
  rows.replaceChildren();
  for (const i of c.items) {
    const li = node("li", null, { class: "item-carrito" });
    li.append(
      node("h3", i.nombre),
      node(
        "p",
        money(i.precio_actual) + " × " + i.cantidad + " = " + money(i.subtotal),
      ),
    );
    for (const [label, n] of [
      ["−", i.cantidad - 1],
      ["+", i.cantidad + 1],
      ["Quitar", 0],
    ])
      li.append(
        action(label, async () => {
          await data(
            "/carrito/items/" + i.id_item,
            n ? "PUT" : "DELETE",
            n ? { cantidad: n } : undefined,
          );
          await render();
        }),
      );
    rows.append(li);
  }
  for (const key of ["subtotal", "iva", "total"])
    $(key).textContent = money(c.resumen[key]);
  $("unidades").textContent = c.resumen.total_items;
  $("ultima-actualizacion").textContent = new Date().toLocaleString("es-EC");
  $("btn-vaciar").onclick = async () => {
    if (confirm("¿Vaciar carrito?"))
      try {
        await data("/carrito", "DELETE");
        await render();
      } catch (e) {
        status(e.message);
      }
  };
  const checkout = $("checkout-fields");
  checkout.replaceChildren();
  if (!c.items.length) return;
  const [dirs, shipping, methods] = await Promise.all([
    data("/usuarios/" + session().usuario.id_usuario + "/direcciones"),
    data("/metodos-envio"),
    data("/metodos-pago"),
  ]);
  if (!dirs.length) {
    checkout.append(
      node("a", "Añadir dirección en Mi cuenta", { href: "cuenta.html" }),
    );
    return;
  }
  const addresses = dirs.map((d) => [
    d.id_direccion,
    d.destinatario + " · " + d.calle_principal,
  ]);
  checkout.append(
    form(
      "",
      [
        ["id_direccion_envio", "Dirección de envío", "select", addresses],
        [
          "id_direccion_facturacion",
          "Dirección de facturación",
          "select",
          addresses,
        ],
        [
          "id_metodo_envio",
          "Envío",
          "select",
          shipping.map((s) => [
            s.id_metodo_envio,
            s.nombre + " · " + money(s.costo_base),
          ]),
        ],
        ["codigo_cupon", "Cupón", "text?"],
        [
          "id_metodo_pago",
          "Pago simulado",
          "select",
          methods.map((m) => [m.id_metodo_pago, m.nombre]),
        ],
      ],
      "Confirmar pedido",
      async (body) => {
        const { id_metodo_pago, ...order } = body;
        const quote = order.codigo_cupon
          ? await data("/cupones/validar", "POST", {
              codigo: order.codigo_cupon,
            })
          : c.resumen;
        const delivery = shipping.find(
          (m) => m.id_metodo_envio === Number(order.id_metodo_envio),
        );
        const total = Number(quote.total) + Number(delivery.costo_base);
        if (
          !confirm(
            "Subtotal " +
              money(c.resumen.subtotal) +
              " · Descuento " +
              money(quote.descuento_calculado || 0) +
              " · IVA " +
              money(quote.iva) +
              " · Envío " +
              money(delivery.costo_base) +
              "\n¿Confirmar pedido por " +
              money(total) +
              "?",
          )
        )
          return;
        const p = await data("/pedidos", "POST", order);
        try {
          await data("/pedidos/" + p.id_pedido + "/pagos", "POST", {
            id_metodo_pago,
          });
        } finally {
          location.assign("/cuenta.html?pedido=" + p.id_pedido);
        }
      },
    ),
  );
}
render().catch((e) => {
  const err = $("error-carga");
  err.hidden = false;
  err.textContent = e.message;
});
