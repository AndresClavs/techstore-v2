import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { repos, transaction } from "../src/models/base.repository.js";
import { prisma } from "../src/models/prisma.client.js";
import {
  registrarMovimiento,
  round,
  decimal,
} from "../src/services/inventario.service.js";
export async function runSeed() {
  const catalog = JSON.parse(
    await readFile(
      new URL("../../data/productos.json", import.meta.url),
      "utf8",
    ),
  );
  const names = [
    "Sony",
    "Keychron",
    "LG",
    "Logitech",
    "Samsung",
    "Apple",
    "Samsung",
    "JBL",
    "Apple",
  ];
  const extras = [
    [
      "MX Keys Mini",
      "Logitech",
      "Periféricos",
      99,
      "Teclado inalámbrico compacto",
    ],
    [
      "WH-CH720N",
      "Sony",
      "Audio",
      129,
      "Audífonos inalámbricos con cancelación de ruido",
    ],
    [
      "Galaxy Buds FE",
      "Samsung",
      "Audio",
      89,
      "Auriculares inalámbricos con estuche de carga",
    ],
    ["Magic Mouse", "Apple", "Periféricos", 79, "Ratón inalámbrico recargable"],
    ["Flip Essential 2", "JBL", "Audio", 85, "Parlante portátil Bluetooth"],
    [
      "UltraGear 24",
      "LG",
      "Pantallas",
      199,
      "Monitor de escritorio de 24 pulgadas",
    ],
  ];
  for (const [
    i,
    [modelo, marca, categoria, precio, descripcion],
  ] of extras.entries()) {
    names.push(marca);
    catalog.push({
      id: 200 + i,
      nombre: marca + " " + modelo,
      categoria,
      precio,
      descripcion,
      imagen: "assets/img/placeholder.svg",
    });
  }
  return transaction(async (tx) => {
    async function ensure(model, where, data) {
      const m = repos[model](tx);
      return (
        (await m.findFirst({ where })) ??
        m.create({ data: { ...where, ...data } })
      );
    }
    let admin;
    for (const [i, role] of [
      "Administrador",
      "Bodeguero",
      "Vendedor",
      "Cliente",
    ].entries()) {
      const rol = await ensure("rol", { nombre: role }, {});
      const password = i
        ? process.env.DEMO_USERS_PASSWORD
        : process.env.ADMIN_PASSWORD;
      if (!password) continue;
      const email = i
        ? role.toLowerCase() + "@techstore.local"
        : process.env.ADMIN_EMAIL || "admin@techstore.local";
      const user = await ensure(
        "usuario",
        { email },
        {
          id_rol: rol.id_rol,
          identificacion: "TS-DEMO-" + i,
          nombres: role,
          apellidos: "TechStore",
          contrasena_hash: await bcrypt.hash(password, 10),
        },
      );
      if (!i && user.id_rol === rol.id_rol) admin = user;
      if (i === 3)
        await ensure(
          "direccion",
          { id_usuario: user.id_usuario, alias: "Principal" },
          {
            destinatario: "Cliente TechStore",
            calle_principal: "Av. Principal",
            ciudad: "Quito",
            provincia: "Pichincha",
            es_predeterminada: true,
          },
        );
    }
    for (const [nombre, tipo] of [
      ["Tarjeta", "tarjeta"],
      ["Transferencia", "transferencia"],
      ["Efectivo", "efectivo"],
    ])
      await ensure("metodo_pago", { nombre }, { tipo });
    for (const [nombre, costo_base, dias_estimados] of [
      ["Estándar", 4, 3],
      ["Express", 8, 1],
      ["Retiro en tienda", 0, 0],
    ])
      await ensure("metodo_envio", { nombre }, { costo_base, dias_estimados });
    for (const nombre of ["Entrega local", "Envíos nacionales"])
      await ensure("transportista", { nombre }, {});
    for (const [
      codigo,
      tipo_descuento,
      valor_descuento,
      monto_minimo_compra,
    ] of [
      ["BIENVENIDO10", "porcentaje", 10, 0],
      ["DESC5", "monto_fijo", 5, 50],
    ])
      await ensure(
        "cupon",
        { codigo },
        {
          tipo_descuento,
          valor_descuento,
          monto_minimo_compra,
          fecha_inicio: new Date("2025-01-01"),
          fecha_fin: new Date("2035-01-01"),
        },
      );
    if (!admin) {
      console.log(
        "Catálogo de muestra pendiente: configura ADMIN_PASSWORD y ADMIN_EMAIL.",
      );
      return;
    }
    const perifericos = await ensure(
      "categoria",
      { nombre: "Periféricos" },
      {},
    );
    await ensure(
      "categoria",
      { nombre: "Teclados", id_categoria_padre: perifericos.id_categoria },
      {},
    );
    const proveedores = [];
    for (const [ruc, razon_social] of [
      ["1790000000001", "Distribución Andina Demo"],
      ["0990000000001", "Tecnología Costa Demo"],
    ])
      proveedores.push(await ensure("proveedor", { ruc }, { razon_social }));
    for (const [i, p] of catalog.entries()) {
      const categoria = await ensure("categoria", { nombre: p.categoria }, {}),
        marca = await ensure("marca", { nombre: names[i] || "TechStore" }, {});
      const sku = "TS-" + p.id;
      const existing = await repos.producto(tx).findUnique({ where: { sku } });
      const product =
        existing ??
        (await repos
          .producto(tx)
          .create({
            data: {
              sku,
              nombre: p.nombre,
              descripcion: p.descripcion,
              precio_venta: p.precio,
              costo: round(decimal(p.precio).times("0.7")),
              id_categoria: categoria.id_categoria,
              id_marca: marca.id_marca,
              garantia_meses: 12,
              destacado: i < 4,
              imagen_producto: {
                create: { url: p.imagen, es_principal: true },
              },
              inventario: { create: { stock_minimo: 5 } },
            },
          }));
      for (const [nombre, valor] of [
        ["Marca", marca.nombre],
        ["Categoría", categoria.nombre],
        ["Garantía", "12 meses"],
      ])
        await ensure(
          "especificacion",
          { id_producto: product.id_producto, nombre },
          { valor },
        );
      await ensure(
        "producto_proveedor",
        {
          id_proveedor: proveedores[i % 2].id_proveedor,
          id_producto: product.id_producto,
        },
        { costo_compra: product.costo, plazo_entrega_dias: 3 },
      );
      if (!existing)
        await registrarMovimiento(tx, {
          id_producto: product.id_producto,
          id_usuario: admin.id_usuario,
          cantidad: i < 2 ? 3 : 15,
          tipo_documento: "inventario_inicial",
        });
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runSeed();
    console.log("Datos iniciales verificados");
  } finally {
    await prisma.$disconnect();
  }
}
