# TechStore Pro — Implementación completa y despliegue en Render

> **Instrucciones maestras para el agente de IA.** Tu misión: dejar **todo el proyecto funcionando de punta a punta** (base de datos + backend + frontend conectado) **y listo para desplegar en Render**, sin intervención manual salvo los pasos de la sección 14 que solo el dueño puede hacer en el panel de Render.
>
> **Orden de lectura obligatorio (los tres documentos forman un solo sistema):**
> 1. `TechStore_Pro_Contexto_BD.md` → modelo de datos, reglas de negocio, script SQL. **Manda en datos y reglas de negocio.**
> 2. `ARQUITECTURA_BACKEND_TechStore_Pro.md` → arquitectura, capas, patrones, estructura de carpetas, formato de respuestas. **Manda en cómo se escribe el código.**
> 3. Este documento → endpoints, flujos, integración del frontend, despliegue. **Manda en el detalle de cada módulo y en el despliegue.**
>
> Si dos documentos se contradicen: contexto BD > arquitectura > este documento, **salvo** en lo que este documento declara expresamente como *decisión* (secciones marcadas con 🔶). Cualquier desviación se anota en el `README.md` final.

---

## 0. Resultado esperado (definición de "terminado")

1. Monorepo en Git con la estructura de la sección 2.
2. Base de datos `techstore_pro` creada y con datos demo, **tanto en local como en Render**.
3. Backend Express + Prisma (según el documento de arquitectura) con **todos** los endpoints de la sección 7.
4. Frontend existente (vistas estáticas) **conectado a la API real**: nada de datos escritos a mano en el HTML/JS.
5. Un solo comando local levanta todo (`npm run dev` dentro de `backend/`, que sirve también el frontend).
6. `render.yaml` (Blueprint) + Dockerfile de MySQL listos para desplegar.
7. `README.md` con pasos, URLs, usuarios demo y lista de desviaciones.
8. El script de humo (`npm run smoke`) pasa completo contra local y contra Render.

---

## 1. Decisiones de despliegue en Render 🔶

| # | Decisión | Motivo |
|---|---|---|
| D1 | **MySQL 8 como *Private Service* (Docker) con *Disk* persistente** en Render, montado en `/var/lib/mysql`. | La BD del proyecto es MySQL/MariaDB. Según la documentación de Render, MySQL se despliega así (accesible solo desde la red privada de Render). El MariaDB 10.11 local del dueño es compatible con el script; en Render corre MySQL 8. |
| D2 | **Un solo Web Service** (Node) que sirve la API en `/api` **y** el frontend estático. | Mismo origen → sin problemas de CORS, un solo despliegue, un solo dominio `https://<app>.onrender.com`. |
| D3 | El esquema se crea con **scripts SQL de inicialización** (`/docker-entrypoint-initdb.d`) en el contenedor de MySQL, **no** con migraciones de Prisma. | Coherente con la regla "no `migrate` / no `db push`" de la arquitectura. La BD privada de Render no es accesible desde HeidiSQL. |
| D4 | `prisma/schema.prisma` se genera **en local** con `prisma db pull` y **se commitea**. En Render solo se ejecuta `prisma generate`. | Durante el *build* la BD privada no es alcanzable, así que no se puede introspeccionar allí. |
| D5 | Los datos demo se cargan con el seed **idempotente**, ejecutado automáticamente al arrancar si `AUTO_SEED=true`. | No depender de acceso por Shell a Render. |

**Requisitos de plan (verificar precios vigentes en `render.com/pricing`):** un *Private Service* y un *Disk* requieren una instancia de pago; un Web Service gratuito se duerme tras inactividad y no es adecuado para una tienda. Se necesita, por tanto, **plan de pago para el servicio MySQL** y recomendable para el Web Service.

**Plan B (si el dueño no quiere pagar el MySQL en Render):** usar cualquier MySQL 8 externo accesible por internet y poner su cadena en `DATABASE_URL` del Web Service (con SSL si el proveedor lo exige). No cambia nada del código; solo se omite el servicio `techstore-mysql` del Blueprint y el script SQL se ejecuta una vez contra ese servidor desde el equipo del dueño.

---

## 2. Estructura del monorepo

```
techstore-pro/
├─ backend/                      # según ARQUITECTURA_BACKEND (carpeta src/, prisma/, etc.)
│  └─ scripts/smoke-test.js      # prueba de humo end-to-end (sección 12)
├─ frontend/                     # esqueleto existente (NO rediseñar; solo conectar)
│  └─ js/                        # api.js, auth.js, ui.js… (sección 9)
├─ database/
│  ├─ techstore_pro.sql          # script COMPLETO (con DROP/CREATE DATABASE) — para local/HeidiSQL
│  └─ techstore_pro.deploy.sql   # mismo script SIN `DROP DATABASE` ni `CREATE DATABASE` (para Render)
├─ deploy/
│  └─ mysql/
│     ├─ Dockerfile
│     └─ init/01_schema.sql      # copia de techstore_pro.deploy.sql
├─ render.yaml                   # Blueprint (sección 13)
├─ .gitignore                    # node_modules, .env, etc.
└─ README.md
```

- Los scripts SQL se **copian literalmente** del bloque ```` ```sql ```` del documento de contexto de BD. Para `deploy.sql`, eliminar solo las líneas `DROP DATABASE IF EXISTS techstore_pro;` y `CREATE DATABASE …;` (mantener `USE techstore_pro;`).
- Si el frontend actual no está en `frontend/`, moverlo allí (o apuntar `STATIC_DIR` a su ubicación) y registrarlo en el README.

---

## 3. Fase 0 — Reconocimiento (antes de escribir código)

1. **Inspeccionar el frontend existente:** listar cada archivo/vista, identificar si es HTML/CSS/JS plano o un framework con *build* (React/Vite/etc.), qué librerías externas usa (CDN de CSS/JS, fuentes, íconos) y cómo navega (multi-página o SPA).
2. Crear una tabla **Pantalla → endpoints** (sección 9.3) y guardarla en el README.
3. Confirmar el entorno local: Node ≥ 20, MariaDB/MySQL corriendo (el dueño usa MariaDB 10.11 en Windows con HeidiSQL). Si no hay MariaDB/MySQL local, indicar al dueño qué instalar; no inventar otra BD.

---

## 4. Fase 1 — Base de datos local

1. Ejecutar `database/techstore_pro.sql` (CLI `mysql < archivo.sql` o HeidiSQL). Verificar 32 tablas.
2. En `backend/`: `npm init`, instalar dependencias (arquitectura §2), `npx prisma init --datasource-provider mysql`, configurar `.env`, `npx prisma db pull`, `npx prisma generate`.
3. Revisar `schema.prisma` (arquitectura §6) y **commitearlo**.

---

## 5. Convenciones de negocio adicionales 🔶

Resuelven ambigüedades del modelo de datos para que todo el código sea consistente.

### 5.1 Dinero e impuestos
- `producto.precio_venta` es **sin IVA**. El IVA se suma por línea con `producto.porcentaje_iva` (por defecto 15 %).
- Redondeo a 2 decimales (half-up) **por línea**; el IVA de cabecera es la **suma de los IVA de línea**.
- Cálculos internos con `Prisma.Decimal`; nunca con `Number`.

### 5.2 Cupón y reparto del descuento
- `pedido.subtotal` = Σ (cantidad × precio_unitario) **bruto**.
- `pedido.descuento` = descuento del cupón: `porcentaje` → `subtotal × valor/100`; `monto_fijo` → `min(valor, subtotal)`.
- El descuento se **reparte proporcionalmente** en `detalle_pedido.descuento` (proporcional al bruto de cada línea; la última línea absorbe el residuo de redondeo).
- `detalle_pedido.subtotal` = `cantidad × precio_unitario − descuento`; `detalle_pedido.iva` = `subtotal × porcentaje_iva / 100`.
- `pedido.iva` = Σ `detalle_pedido.iva`; `pedido.total = subtotal − descuento + iva + costo_envio`.
- Se incrementa `cupon.usos_actuales` al crear el pedido y se **decrementa** si el pedido se cancela antes del pago.

### 5.3 Signos y valoración en inventario/kardex
- `movimiento_inventario.cantidad` y `kardex.cantidad` van **con signo** (positivo = entrada, negativo = salida). `kardex.costo_total = cantidad × costo_unitario` (también con signo).
- Algoritmo único (`inventario.service.registrarMovimiento`), con la fila de `inventario` ya bloqueada (`FOR UPDATE`):
  ```
  saldo_ant = última fila de kardex del producto (o 0/0/0 si no existe)
  ENTRADA (cantidad > 0):
      costo_unitario = costo recibido
      saldo_valor    = saldo_valor_ant + cantidad × costo_unitario
      saldo_cantidad = saldo_cantidad_ant + cantidad
      saldo_costo_promedio = saldo_valor / saldo_cantidad
  SALIDA (cantidad < 0):
      exigir saldo_cantidad_ant + cantidad >= 0  (si no: AppError 409 "Stock insuficiente")
      costo_unitario = saldo_costo_promedio_ant            (el promedio no cambia)
      saldo_cantidad = saldo_cantidad_ant + cantidad
      saldo_valor    = round(saldo_cantidad × saldo_costo_promedio, 2)
      (si saldo_cantidad = 0 se conserva el promedio anterior)
  inventario.stock_actual = saldo_cantidad
  ```
- Después de **cada entrada por compra** se actualiza `producto.costo = saldo_costo_promedio`.
- Mapeo de `tipo_documento`: seed → `inventario_inicial`; recepción → `recepcion_compra`; pago aprobado → `venta`; devolución con reingreso → `devolucion_cliente`; **anulación de recepción → `devolucion_proveedor`** (con `detalle` = "Anulación de recepción <numero>"); ajuste manual → `ajuste_positivo` / `ajuste_negativo`.
- `movimiento_inventario.tipo`: `entrada` (recepción, devolución cliente, inventario inicial), `salida` (venta, anulación de recepción), `ajuste` (ajustes manuales).

### 5.4 Números de documento
Para evitar carreras: insertar con un **valor temporal único** (`TMP-<uuid>` recortado a la longitud de la columna) y, dentro de la misma transacción, actualizar con el valor definitivo basado en el id autoincremental:
`PED-AAAA-000123` · `OC-AAAA-000045` · `REC-AAAA-000012` · factura `001-001-000000123` (17 caracteres).

### 5.5 Método de envío del pedido 🔶 (vacío del modelo)
La tabla `pedido` **no tiene columna `id_metodo_envio`**, pero el checkout necesita elegir el método para calcular `costo_envio`, y `envio` (que lo exige) se crea recién en `preparando`. **Sin alterar el esquema:**
- En el checkout se guarda el método elegido en el comentario de la **primera fila de `historial_estado_pedido`** con formato legible por máquina: `[envio:<id_metodo_envio>] Pedido creado`.
- Al pasar a `preparando`, el service lee ese valor; si no existe, exige `id_metodo_envio` en el body. El `costo` de `envio` es el `pedido.costo_envio` ya cobrado (no se recalcula).
- *(Alternativa limpia si el dueño acepta tocar la BD: agregar `pedido.id_metodo_envio`. Solo hacerlo si el dueño lo aprueba por escrito.)*

### 5.6 Pagos simulados 🔶
No hay pasarela real. **Jamás recibir, guardar ni registrar número de tarjeta, CVV ni vencimiento.**
- `metodo_pago.tipo` en el seed: `tarjeta`, `transferencia`, `efectivo`.
- `POST /pedidos/:id/pagos`: tipo `tarjeta` → `pago` queda `aprobado` al instante (simulación); `transferencia` y `efectivo` → `pendiente` hasta que un admin lo confirme con `PUT /admin/pagos/:id/estado`.
- Cuando la suma de pagos `aprobado` ≥ `pedido.total` se ejecuta la transición a `pagado` (sección 8.3).

### 5.7 Factura y clave de acceso (simulado al estilo SRI)
- Una factura por pedido pagado. `identificacion_cliente` = `usuario.identificacion`; `razon_social_cliente` = `nombres + ' ' + apellidos`; montos copiados del pedido.
- `clave_acceso` (49 dígitos) = `ddmmaaaa`(8) + `01`(2) + RUC emisor (13, env `EMISOR_RUC`, por defecto `9999999999001`) + ambiente `1`(1) + serie `001001`(6) + secuencial 9 dígitos (= `id_factura`) + código numérico 8 dígitos aleatorios + tipo emisión `1`(1) = 48 dígitos, **+ dígito verificador módulo 11** (pesos 2..7 repetidos de derecha a izquierda; resultado 11 → 0, 10 → 1).

### 5.8 Estados y transiciones de pedido (única fuente de verdad)
| Desde | Hacia | Quién / cómo |
|---|---|---|
| `pendiente` | `pagado` | Automático al completarse el pago (§5.6) |
| `pendiente` | `cancelado` | Cliente dueño (`POST /pedidos/:id/cancelar`) o admin → libera reserva y revierte cupón |
| `pagado` | `preparando` | Admin/Vendedor → crea `envio` |
| `preparando` | `enviado` | Admin/Vendedor (`numero_guia` opcional) → `envio.estado='despachado'`, `fecha_despacho=now` |
| `enviado` | `entregado` | Admin/Vendedor → `envio.estado='entregado'`, `fecha_entrega=now` |
| `entregado` | `devuelto` | Automático cuando **todas** las unidades del pedido están devueltas (devolución `completada`) |
Cualquier otra transición → `409`. **Cada** cambio inserta fila en `historial_estado_pedido`. (`pagado → cancelado` no se permite; un pedido pagado se resuelve por devolución.)

---

## 6. Variables de entorno (resumen final)

`backend/.env.example` (completar el de la arquitectura §5 con estas):

```
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=techstore_pro
DATABASE_URL="mysql://USUARIO:CONTRASENA@localhost:3306/techstore_pro"
JWT_SECRET=
JWT_EXPIRES_IN=8h
BCRYPT_ROUNDS=10
FRONTEND_URL=http://localhost:3000
STATIC_DIR=../frontend
ADMIN_EMAIL=admin@techstore.local
ADMIN_PASSWORD=
DEMO_USERS_PASSWORD=
EMISOR_RUC=9999999999001
AUTO_SEED=false
```

Reglas de `config/env.js`:
- Si `DATABASE_URL` no está definida, **construirla** a partir de `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` usando `encodeURIComponent` en usuario y contraseña, y asignarla a `process.env.DATABASE_URL` **antes** de que `models/prisma.client.js` cree el `PrismaClient` (importar `env.js` primero). Así en Render basta con definir las `DB_*`.
- `trust proxy`: `app.set('trust proxy', 1)` (Render está detrás de un proxy; imprescindible para el rate limit y la IP).
- **Reintento de conexión al arrancar:** hasta 10 intentos, 5 s entre ellos (`prisma.$connect()`), porque el servicio MySQL puede estar iniciando. Si falla, salir con error claro.

---

## 7. Endpoints (contrato completo)

Base: `/api`. Formato de respuesta, paginación y códigos HTTP: arquitectura §8. Todos los cuerpos `POST/PUT` se validan con Zod. **Rol** indica quién puede llamar; "propio" = el recurso debe pertenecer al usuario del token (si no, 403). `A` = Administrador, `B` = Bodeguero, `V` = Vendedor, `C` = Cliente.

### 7.1 Auth y usuarios
| Método y ruta | Rol | Body / params | Lógica y respuestas |
|---|---|---|---|
| `POST /auth/registro` | público | `identificacion`, `nombres`, `apellidos`, `email`, `password` (≥ 8), `telefono?`, `fecha_nacimiento?` | Rol `Cliente`, hash bcrypt. `201` con usuario (sin hash) + `token`. `409` si email o identificación existen. |
| `POST /auth/login` | público | `email`, `password` | Solo `estado='activo'`. Actualiza `ultimo_acceso`. `200 { token, usuario{id_usuario,nombres,apellidos,email,rol} }`. `401` credenciales inválidas. |
| `GET /auth/me` | autenticado | — | Usuario actual con su rol. |
| `GET /usuarios/:id` | propio / A | — | Datos del usuario. |
| `PUT /usuarios/:id` | propio / A | `nombres, apellidos, telefono, fecha_nacimiento` (+ `password` opcional) | Cliente no puede cambiar email, rol ni estado. |
| `GET /usuarios/:id/direcciones` | propio / A | — | Lista. |
| `POST /usuarios/:id/direcciones` | propio / A | campos de `direccion` | Si `es_predeterminada=1`, desmarca las demás (transacción). `201`. |
| `PUT /usuarios/:id/direcciones/:idDireccion` | propio / A | idem | Misma regla de predeterminada. |
| `DELETE /usuarios/:id/direcciones/:idDireccion` | propio / A | — | `204`; `409` si está usada por un pedido. |
| `GET /admin/usuarios` | A | `?q=&rol=&estado=&pagina=` | Paginado. |
| `PUT /admin/usuarios/:id` | A | `id_rol?, estado?` | Cambia rol/estado. |
| `GET /admin/roles` | A | — | Lista de roles. |

### 7.2 Catálogo público
| Ruta | Detalle |
|---|---|
| `GET /productos` | Filtros: `categoria` (incluye **descendientes** de esa categoría), `marca`, `q` (nombre/sku/descripcion), `precio_min`, `precio_max`, `destacado=1`, `orden` ∈ `relevancia\|precio_asc\|precio_desc\|recientes\|nombre`, `pagina`, `limite`. Solo `estado='activo'`. Cada ítem: columnas de `producto` + `marca{id_marca,nombre}`, `categoria{id_categoria,nombre}`, `imagen_principal`, `rating_promedio`, `total_resenas` (solo reseñas aprobadas), `stock_disponible = max(0, stock_actual − stock_reservado)`. |
| `GET /productos/:id` | Lo anterior + `descripcion`, `garantia_meses`, `peso_kg`, `imagenes[]` (ordenadas por `orden`), `especificaciones[]`. `404` si no existe o no está activo. |
| `GET /categorias` | **Árbol** anidado (`hijos[]`) de categorías `activa=1`. |
| `GET /marcas` | Lista. |
| `GET /metodos-envio`, `GET /metodos-pago` | Activos (los usa el checkout). |

### 7.3 Catálogo admin (V, A)
| Ruta | Detalle |
|---|---|
| `GET /admin/productos` | Todos los estados, con `stock_actual`, `stock_reservado`, `stock_minimo`. Filtros `q`, `estado`, `categoria`, paginado. |
| `POST /admin/productos` | `id_categoria, id_marca, sku, nombre, descripcion?, precio_venta, costo?, porcentaje_iva?, garantia_meses?, peso_kg?, destacado?, estado?, imagenes[{url,texto_alternativo,orden,es_principal}], especificaciones[{nombre,valor,unidad?}], stock_minimo?, ubicacion_bodega?`. En **una transacción**: crea producto, imágenes, especificaciones y fila de `inventario` con stock 0. `409` si SKU duplicado. |
| `PUT /admin/productos/:id` | Actualiza campos; si llegan `imagenes`/`especificaciones`, **reemplaza** las colecciones. Nunca modifica stock. |
| `DELETE /admin/productos/:id` | **Borrado lógico**: `estado='inactivo'`. `204`. |
| `POST/PUT/DELETE /admin/categorias` | `DELETE` = `activa=0`. Validar que no se cree un ciclo en `id_categoria_padre`. |
| `POST/PUT/DELETE /admin/marcas` | `DELETE` físico; `409` si tiene productos. |

### 7.4 Favoritos y reseñas
| Ruta | Rol | Lógica |
|---|---|---|
| `GET /favoritos` | C | Productos favoritos con datos de lista. |
| `POST /favoritos` | C | `{id_producto}`; idempotente. `201`. |
| `DELETE /favoritos/:idProducto` | C | `204`. |
| `GET /productos/:id/resenas` | público | Solo `aprobada`, paginado, con nombre del autor (solo nombre, nunca email). |
| `POST /productos/:id/resenas` | C | `{calificacion 1-5, titulo?, comentario?}`. `compra_verificada=1` si el usuario tiene un `detalle_pedido` de ese producto en un pedido `pagado/preparando/enviado/entregado`. Una reseña por usuario y producto (`409`). Estado inicial `pendiente`. |
| `GET /admin/resenas` | V, A | `?estado=`. |
| `PUT /admin/resenas/:id/moderar` | V, A | `{estado_moderacion: aprobada\|rechazada}`. |

### 7.5 Carrito y cupones (C)
| Ruta | Lógica |
|---|---|
| `GET /carrito` | Devuelve (creando si hace falta) el carrito `activo` del usuario: `items[{id_item,id_producto,nombre,sku,imagen,cantidad,precio_unitario,precio_actual,precio_cambio(bool),porcentaje_iva,stock_disponible,subtotal}]` y `resumen{subtotal,iva,total,total_items}` calculados con `precio_actual`. |
| `POST /carrito/items` | `{id_producto, cantidad ≥ 1}`. Producto debe estar `activo`. Si ya existe en el carrito, **suma** cantidades. Valida `cantidad ≤ stock_disponible` (`409`). Guarda `precio_unitario = precio_venta` actual. |
| `PUT /carrito/items/:id` | `{cantidad}`; valida stock y que el ítem sea del usuario. |
| `DELETE /carrito/items/:id` | `204`. |
| `DELETE /carrito` | Vacía el carrito. `204`. |
| `POST /cupones/validar` | `{codigo}` → valida contra el subtotal del carrito actual (§5.2 y contexto §5.4). `200 { codigo, tipo_descuento, descuento_calculado }`; `422` con el motivo (inactivo, vencido, agotado, monto mínimo). |
| `GET/POST/PUT/DELETE /admin/cupones` | V, A. `DELETE` = `activo=0`. `codigo` único en mayúsculas. |

### 7.6 Pedidos, pagos, facturas y envíos
| Ruta | Rol | Lógica |
|---|---|---|
| `POST /pedidos` | C | Body `{id_direccion_envio, id_direccion_facturacion, id_metodo_envio, codigo_cupon?, observaciones?}`. **Checkout transaccional** (§8.1). `201` con el pedido completo. |
| `GET /pedidos` | C | Pedidos propios, paginado, más recientes primero. |
| `GET /pedidos/:id` | propio / V / A | Pedido + `detalles[{…, producto{nombre,sku,imagen}}]`, `historial[]`, `pagos[]`, `envio`, `factura`, direcciones. |
| `POST /pedidos/:id/cancelar` | propio / V / A | Solo `pendiente`. Ver §8.4. |
| `POST /pedidos/:id/pagos` | propio | `{id_metodo_pago, referencia_transaccion?}`. El monto es siempre `total − pagos aprobados` (el cliente no envía monto). Aplica §5.6. |
| `GET /pedidos/:id/factura` | propio / V / A | `404` si aún no existe. |
| `GET /pedidos/:id/envio` | propio / V / A | `404` si aún no existe. |
| `GET /admin/pedidos` | V, A | `?estado=&q=&desde=&hasta=&pagina=` (q: número de pedido o email). |
| `PUT /admin/pedidos/:id/estado` | V, A | `{estado, comentario?, id_transportista?, id_metodo_envio?, numero_guia?}` según §5.8. Para `preparando` exige `id_transportista`. |
| `PUT /admin/pagos/:id/estado` | A | `{estado: aprobado\|rechazado}` para pagos `pendiente`. Si queda `aprobado`, ejecuta §8.3. |
| `PUT /admin/envios/:id` | V, A | `{estado?, numero_guia?, id_transportista?, fecha_entrega_estimada?}`. Si pasa a `entregado`, sincroniza `pedido.estado` (§5.8). |
| `GET /admin/transportistas` | V, A | Lista. |

### 7.7 Devoluciones
| Ruta | Rol | Lógica |
|---|---|---|
| `POST /devoluciones` | C | `{id_detalle, motivo, descripcion?, cantidad}`. El detalle debe ser de un pedido **propio** en estado `entregado`; `cantidad + devoluciones previas no rechazadas ≤ cantidad comprada` (`422`). Estado `solicitada`. |
| `GET /devoluciones` | C | Propias. |
| `GET /admin/devoluciones` | V, A | `?estado=`. |
| `PUT /admin/devoluciones/:id` | V, A | `{estado: aprobada\|rechazada\|completada, monto_reembolso?, reingresa_stock?: bool}`. Flujo `solicitada→aprobada/rechazada`, `aprobada→completada`. Al completar: ver §8.5. |

### 7.8 Inventario y kardex (B, A)
| Ruta | Lógica |
|---|---|
| `GET /admin/inventario` | `?q=&bajo_stock=true&pagina=`. Por producto: `stock_actual, stock_reservado, stock_disponible, stock_minimo, ubicacion_bodega, costo_promedio` (último kardex), `valor_inventario`, `bajo_stock = stock_actual < stock_minimo`. **Este mismo endpoint es el reporte de reposición.** |
| `PUT /admin/inventario/:idProducto` | `{stock_minimo?, ubicacion_bodega?}` (no toca stock). |
| `GET /admin/inventario/:idProducto/kardex` | `?desde=&hasta=`. Devuelve `producto`, `saldo_actual` y `movimientos[]` ordenados por `id_kardex`, con usuario que lo registró. |
| `POST /admin/inventario/ajustes` | `{id_producto, tipo: positivo\|negativo, cantidad > 0, motivo (obligatorio), costo_unitario?}`. `positivo` usa `costo_unitario` o, si falta, el promedio vigente o `producto.costo`. Llama a `registrarMovimiento` con `tipo_documento = ajuste_positivo/ajuste_negativo`. `409` si el negativo deja stock < 0 o por debajo de lo reservado. |

### 7.9 Compras (B, A)
| Ruta | Lógica |
|---|---|
| `CRUD /admin/proveedores` | `ruc` único (13 dígitos). `DELETE` = `activo=0`. |
| `GET/POST/DELETE /admin/proveedores/:id/productos` | Gestiona `producto_proveedor` (`id_producto, costo_compra, plazo_entrega_dias`). |
| `GET /admin/ordenes-compra` | `?estado=&id_proveedor=&pagina=`. |
| `GET /admin/ordenes-compra/:id` | Con detalles, proveedor y recepciones. |
| `POST /admin/ordenes-compra` | `{id_proveedor, fecha_entrega_esperada?, observaciones?, detalles[{id_producto, cantidad_solicitada, costo_unitario}]}`. Estado `borrador`. Calcula `subtotal`, `iva` (por línea con el IVA del producto) y `total`. No repetir producto en la misma orden. |
| `PUT /admin/ordenes-compra/:id` | Solo `borrador`; reemplaza detalles y recalcula. |
| `DELETE /admin/ordenes-compra/:id` | `borrador` o `enviada` sin recepciones completadas → `estado='cancelada'`. |
| `POST /admin/ordenes-compra/:id/enviar` | `borrador → enviada` (requiere ≥ 1 detalle). |
| `POST /admin/ordenes-compra/:id/recepciones` | `{guia_remision_proveedor?, observaciones?, detalles[{id_detalle_oc, cantidad_recibida, cantidad_rechazada}]}`. Orden `enviada` o `recibida_parcial`. Valida `cantidad_recibida ≤ solicitada − ya_recibida` (`422`). Crea la recepción **completada** y aplica el flujo de §8.2 en una transacción. `201`. |
| `GET /admin/recepciones`, `GET /admin/recepciones/:id` | Lectura. |
| `POST /admin/recepciones/:id/anular` | Ver §8.2 (reversión). |

### 7.10 Panel admin
| Ruta | Rol | Respuesta |
|---|---|---|
| `GET /admin/dashboard` | V, B, A | `{ ventas_mes, pedidos_pendientes, pedidos_por_estado{}, productos_stock_bajo, valor_inventario, top_productos[5], ventas_ultimos_30_dias[{fecha,total}] }` (ventas = pedidos `pagado` y posteriores, sin `cancelado`/`devuelto`). |

---

## 8. Flujos transaccionales (obligatorios)

Todos usan `prisma.$transaction` + `FOR UPDATE` sobre `inventario` (bloqueando **por `id_producto` ascendente**) y **todo cambio de stock pasa por `inventario.service.registrarMovimiento`** (§5.3). Reintentar una vez ante `P2034`.

### 8.1 Checkout (`POST /pedidos`)
1. Cargar carrito `activo` con ítems (si está vacío: `422`).
2. Validar pertenencia de ambas direcciones y que `id_metodo_envio` esté activo.
3. Por cada ítem: producto `activo`; bloquear inventario; `stock_actual − stock_reservado ≥ cantidad` o `409` indicando el producto. **Re-precio** con `precio_venta` actual.
4. Calcular totales (§5.1–5.2), validar cupón si llegó `codigo_cupon`.
5. Insertar `pedido` (número temporal → definitivo, §5.4), `detalle_pedido`, `+stock_reservado`, `cupon.usos_actuales+1`, `carrito.estado='convertido'`, primera fila de historial `pendiente` con `[envio:<id>]` (§5.5).
6. `201` con el pedido.

### 8.2 Recepción de compra y su anulación
**Crear recepción:** insertar `recepcion_compra` (`completada`) + `detalle_recepcion`; por cada línea con `cantidad_recibida > 0`: `registrarMovimiento` (+entrada, `recepcion_compra`, `id_documento = id_recepcion`, costo = `detalle_orden_compra.costo_unitario`), `detalle_orden_compra.cantidad_recibida += n`, `producto.costo = promedio`. `cantidad_rechazada` solo se registra. Orden → `recibida_total` si todas las líneas están completas; si no, `recibida_parcial`.
**Anular (`completada → anulada`):** por cada línea con recibida > 0: `registrarMovimiento` (−salida, `devolucion_proveedor`, `detalle` "Anulación de recepción N"); si `stock_actual` no alcanza → `409` y todo se revierte; `detalle_orden_compra.cantidad_recibida −= n`; orden → `enviada` si el total recibido queda en 0, o `recibida_parcial`. Nunca borrar filas de kardex.

### 8.3 Pago aprobado → pedido pagado
Cuando la suma de pagos `aprobado` ≥ `pedido.total`:
1. `pedido.estado='pagado'` + historial.
2. Por cada detalle: bloquear inventario, `stock_reservado −= cantidad`, `registrarMovimiento` (−cantidad, `venta`, `id_documento = id_pedido`).
3. Generar `factura` (§5.7), una sola vez.

### 8.4 Cancelación de pedido `pendiente`
`stock_reservado −= cantidad` por detalle; `cupon.usos_actuales −= 1` si había cupón; `pedido.estado='cancelado'` + historial; pagos `pendiente` pasan a `rechazado`.

### 8.5 Devolución completada
1. Validar estado `aprobada`.
2. Si `reingresa_stock`: `registrarMovimiento` (+entrada, `devolucion_cliente`, `id_documento = id_devolucion`, costo = promedio vigente).
3. Reembolso: `monto_reembolso` (por defecto `(detalle.subtotal + detalle.iva) × cantidad / detalle.cantidad`); insertar `pago` con `estado='reembolsado'` y ese monto, usando el método del último pago aprobado.
4. `devolucion.estado='completada'`, `fecha_resolucion=now`.
5. Si todas las unidades de todos los detalles del pedido quedaron devueltas → `pedido.estado='devuelto'` + historial.

---

## 9. Frontend: conexión a la API

### 9.1 Reglas
- **No rediseñar.** Mantener HTML/CSS/estructura existentes; solo reemplazar datos escritos a mano por datos de la API y añadir los comportamientos que falten (login, carrito, checkout…).
- Crear `frontend/js/api.js`: cliente `fetch` con **base relativa `/api`** (funciona en local y en Render sin cambios), cabecera `Authorization: Bearer <token>` automática, parseo del formato de respuesta (arquitectura §8.2) y manejo central: `401` → limpiar sesión y redirigir al login; otros errores → mostrar `error.mensaje` y, si hay, `detalles` por campo.
- `frontend/js/auth.js`: guarda `token` y `usuario` en `localStorage`; guardas de ruta por rol (las páginas del panel admin solo para `Administrador/Bodeguero/Vendedor`; el servidor igual valida). Mostrar/ocultar menús según el rol.
- `frontend/js/ui.js`: formateo de dinero (`Intl.NumberFormat('es-EC',{style:'currency',currency:'USD'})`), fechas locales, *toasts*, estados de **carga**, **vacío** y **error** en cada listado.
- Todas las pantallas deben funcionar con datos reales: sin precios, productos ni usuarios "hardcodeados".
- Los textos de la interfaz siguen en español.

### 9.2 Si el frontend tiene *build* (React/Vite u otro)
Compilarlo en el *build* de Render (`cd frontend && npm ci && npm run build`) y apuntar `STATIC_DIR` a su carpeta de salida (`../frontend/dist`). Si la app es SPA con rutas del lado del cliente, añadir en Express un *fallback* a `index.html` para `GET` que no empiecen por `/api`.

### 9.3 Pantallas → endpoints (adaptar a los archivos reales encontrados en la Fase 0)
| Pantalla | Endpoints |
|---|---|
| Inicio (destacados, categorías) | `GET /productos?destacado=1`, `GET /categorias` |
| Listado con filtros/orden/paginación | `GET /productos`, `GET /marcas`, `GET /categorias` |
| Detalle de producto | `GET /productos/:id`, `GET /productos/:id/resenas`, `POST /carrito/items`, `POST /favoritos`, `POST /productos/:id/resenas` |
| Login / Registro | `POST /auth/login`, `POST /auth/registro` |
| Carrito | `GET/PUT/DELETE /carrito…`, `POST /cupones/validar` |
| Checkout | `GET /usuarios/:id/direcciones` (+ alta), `GET /metodos-envio`, `GET /metodos-pago`, `POST /pedidos`, `POST /pedidos/:id/pagos` |
| Mis pedidos / detalle | `GET /pedidos`, `GET /pedidos/:id`, `POST /pedidos/:id/cancelar`, `GET /pedidos/:id/factura` |
| Mis direcciones / perfil | `/usuarios/:id…` |
| Favoritos | `GET/DELETE /favoritos` |
| Devoluciones (cliente) | `POST/GET /devoluciones` |
| Admin: dashboard | `GET /admin/dashboard` |
| Admin: productos/categorías/marcas | `/admin/productos`, `/admin/categorias`, `/admin/marcas` |
| Admin: inventario y kardex | `GET /admin/inventario`, `GET …/kardex`, `POST …/ajustes`, `PUT …/:idProducto` |
| Admin: proveedores, órdenes de compra, recepciones | `/admin/proveedores`, `/admin/ordenes-compra…`, `/admin/recepciones…` |
| Admin: pedidos, envíos, pagos | `/admin/pedidos`, `PUT /admin/pedidos/:id/estado`, `/admin/envios/:id`, `/admin/pagos/:id/estado` |
| Admin: cupones, reseñas, devoluciones, usuarios | `/admin/cupones`, `/admin/resenas`, `/admin/devoluciones`, `/admin/usuarios` |

Si el esqueleto no tiene alguna pantalla de la tabla, **crearla** reutilizando el estilo existente.

### 9.4 Seguridad de cabeceras con el frontend (error frecuente)
`helmet` aplica por defecto una *Content-Security-Policy* estricta que **bloquea** scripts inline, imágenes remotas, fuentes e íconos de CDN. El agente debe **escanear el frontend** y configurar la CSP (`contentSecurityPolicy.directives`) para permitir exactamente lo que usa (`img-src 'self' data: https:`, los dominios de CDN/fuentes que existan, y `'unsafe-inline'` solo si hay scripts/estilos inline que no se puedan externalizar). Verificar en el navegador que la consola no muestre errores de CSP.

---

## 10. Datos semilla (`prisma/seed.js`, idempotente)

Exportar `runSeed()` y un CLI (`npm run seed`). `server.js` la invoca al arrancar si `AUTO_SEED=true` (después de conectar a la BD). Usa `upsert`/búsquedas por clave única; **correrlo dos veces no duplica nada**.

- **Roles:** `Administrador`, `Bodeguero`, `Vendedor`, `Cliente`.
- **Usuarios:** admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) y demo `bodeguero@techstore.local`, `vendedor@techstore.local`, `cliente@techstore.local` con `DEMO_USERS_PASSWORD`. Si falta alguna contraseña en el entorno, el seed **no crea** esos usuarios y avisa en consola (nunca contraseñas escritas en el código). El cliente demo con una dirección predeterminada.
- **Métodos de pago:** Tarjeta (`tarjeta`), Transferencia (`transferencia`), Efectivo (`efectivo`). **Métodos de envío:** Estándar, Express, Retiro en tienda (costos y días distintos). **Transportistas:** 2 o 3.
- **Catálogo demo:** ≥ 6 categorías (con al menos una subcategoría), ≥ 5 marcas, ≥ 15 productos realistas de tecnología con SKU, precios, garantía, 1–3 imágenes y 3–5 especificaciones. Las imágenes deben cargar sin depender de rutas inexistentes: usar archivos del propio frontend o URL públicas permitidas por la CSP.
- **Proveedores:** 2, con `producto_proveedor`.
- **Inventario inicial:** para cada producto, vía `inventario.service.registrarMovimiento` con `inventario_inicial` (así el kardex nace consistente), con costos < precio de venta, y **al menos 2 productos con `stock_actual < stock_minimo`** para demostrar la alerta.
- **Cupones:** `BIENVENIDO10` (10 %) y `DESC5` (monto fijo 5 USD, mínimo 50).

---

## 11. Fase de construcción (orden)

1. Fases 0 y 1 (reconocimiento + BD local + Prisma).
2. Núcleo del backend (arquitectura §13 pasos 1–3).
3. Auth y usuarios → Catálogo → **Inventario/kardex** → Compras → Carrito/Cupones/Checkout → Pagos/Facturas/Envíos → Devoluciones → Dashboard.
4. Seed.
5. Frontend (§9), módulo por módulo, probando cada uno en el navegador.
6. `scripts/smoke-test.js` (§12) y corrección de fallos.
7. Artefactos de despliegue (§13) y README.

---

## 12. Pruebas de humo (`npm run smoke`)

Script Node (usa `fetch` nativo) que recibe `BASE_URL` (por defecto `http://localhost:3000`) y falla con código ≠ 0 ante cualquier verificación. Escenario completo:

1. `GET /api/health` → 200.
2. Login admin; crear proveedor, producto nuevo, orden de compra (`borrador → enviada`), **recepción parcial y luego total** (verificar estados `recibida_parcial` → `recibida_total`).
3. **Consistencia:** para ese producto, `kardex.saldo_cantidad` del último registro == `inventario.stock_actual`, y el costo promedio coincide con el cálculo ponderado manual.
4. Registrar un cliente nuevo; agregar al carrito más de lo disponible → `409`; cantidad válida → 200.
5. Validar cupón `BIENVENIDO10`; crear dirección; checkout → verificar `stock_reservado` aumentó y que `total = subtotal − descuento + iva + costo_envio`.
6. Pago con `tarjeta` → pedido `pagado`; `stock_actual` bajó, `stock_reservado` volvió, existe kardex `venta` y **factura** con `clave_acceso` de 49 dígitos.
7. Admin: `preparando` (con transportista) → `enviado` → `entregado`; el historial tiene todas las transiciones.
8. Devolución parcial: solicitar → aprobar → completar con reingreso; verificar kardex `devolucion_cliente` y pago `reembolsado`.
9. Anular la recepción de compra del paso 2 → kardex con filas inversas; el saldo sigue coincidiendo con `stock_actual`.
10. Un `Cliente` llamando a `/admin/...` → `403`; sin token → `401`; la respuesta de `GET /auth/me` **no** contiene `contrasena_hash`.
11. Pedido `pendiente` cancelado → reserva liberada y `usos_actuales` del cupón revertido.

---

## 13. Despliegue en Render

### 13.1 `deploy/mysql/Dockerfile`
Basarlo en el repo oficial de ejemplo de Render para MySQL (`render-examples/mysql`, rama `master` = MySQL 8), que ya resuelve el arranque sobre el disco persistente, y añadir:

```dockerfile
# ... (contenido base del ejemplo de Render para MySQL 8)
COPY init/ /docker-entrypoint-initdb.d/
# Servidor en utf8mb4 (igual que la BD del proyecto)
CMD ["--character-set-server=utf8mb4", "--collation-server=utf8mb4_unicode_ci"]
```
Los scripts de `/docker-entrypoint-initdb.d` **solo se ejecutan en el primer arranque con el directorio de datos vacío**. Si hay que reinicializar, se vacía/recrea el disco.

### 13.2 `render.yaml` (Blueprint)

> Validar nombres de campos y valores de `plan` contra la especificación vigente de Blueprints de Render (`render.com/docs/blueprint-spec`) antes de entregar.

```yaml
services:
  # Base de datos MySQL 8 (red privada + disco persistente)
  - type: pserv
    name: techstore-mysql
    runtime: docker
    dockerfilePath: ./deploy/mysql/Dockerfile
    dockerContext: ./deploy/mysql
    plan: starter            # requiere plan de pago; verificar
    disk:
      name: mysql-data
      mountPath: /var/lib/mysql   # obligatorio exactamente así
      sizeGB: 10
    envVars:
      - key: MYSQL_DATABASE
        value: techstore_pro
      - key: MYSQL_USER
        value: techstore
      - key: MYSQL_PASSWORD
        generateValue: true
      - key: MYSQL_ROOT_PASSWORD
        generateValue: true

  # API + frontend
  - type: web
    name: techstore-app
    runtime: node
    plan: starter            # verificar; el plan gratuito se duerme
    buildCommand: cd backend && npm ci && npx prisma generate     # + build del frontend si aplica (§9.2)
    startCommand: cd backend && node src/server.js
    healthCheckPath: /api/health
    envVars:
      - key: NODE_VERSION
        value: "20"
      - key: NODE_ENV
        value: production
      - key: DB_HOST
        fromService: { type: pserv, name: techstore-mysql, property: host }
      - key: DB_PORT
        value: "3306"
      - key: DB_NAME
        value: techstore_pro
      - key: DB_USER
        value: techstore
      - key: DB_PASSWORD
        fromService: { type: pserv, name: techstore-mysql, envVarKey: MYSQL_PASSWORD }
      - key: JWT_SECRET
        generateValue: true
      - key: JWT_EXPIRES_IN
        value: 8h
      - key: STATIC_DIR
        value: ../frontend
      - key: AUTO_SEED
        value: "true"
      - key: ADMIN_EMAIL
        value: admin@techstore.local
      - key: ADMIN_PASSWORD
        sync: false          # el dueño la escribe en el panel de Render
      - key: DEMO_USERS_PASSWORD
        sync: false
      - key: EMISOR_RUC
        value: "9999999999001"
```
Notas:
- **No** usar `rootDir` en el Web Service: el backend necesita acceder a `../frontend` y el repo se clona completo.
- No definir `DATABASE_URL` en Render; `env.js` la construye (§6). `FRONTEND_URL` no es necesaria al servir el frontend desde el mismo servicio.
- Tras el primer despliegue exitoso, el dueño puede poner `AUTO_SEED=false` (el seed es idempotente, no es obligatorio).
- `package.json` del backend debe declarar `"engines": { "node": ">=20" }`.

### 13.3 Requisitos de código para Render (checklist)
- [ ] El servidor escucha `process.env.PORT` en `0.0.0.0`.
- [ ] `trust proxy` activo; el rate limit usa la IP real.
- [ ] Reintentos de conexión a BD al arrancar (§6).
- [ ] `GET /api/health` valida la conexión a BD y responde rápido.
- [ ] Cero credenciales en el repositorio; `.env` en `.gitignore`.
- [ ] `schema.prisma` commiteado; `prisma generate` en el build.
- [ ] CSP verificada con el frontend real (§9.4).
- [ ] Apagado ordenado (`SIGTERM`) que cierra el servidor y desconecta Prisma.

---

## 14. Pasos manuales del dueño en Render (el agente los deja redactados en el README)

1. Subir el monorepo a GitHub (sin `.env`).
2. En Render: **New → Blueprint** → conectar el repositorio → Render lee `render.yaml`.
3. Cuando lo pida, escribir los valores `sync: false`: `ADMIN_PASSWORD` y `DEMO_USERS_PASSWORD`.
4. Aprobar el plan de pago de `techstore-mysql` (y del Web Service) y crear.
5. Esperar el primer arranque de MySQL (tarda unos minutos; solo la primera vez), luego el del Web Service.
6. Abrir `https://<techstore-app>.onrender.com` y `…/api/health`.
7. Ejecutar la prueba de humo desde su PC: `BASE_URL=https://<techstore-app>.onrender.com npm run smoke` (dentro de `backend/`).
8. **Respaldos:** los snapshots del disco no sustituyen a un respaldo lógico; el README debe explicar cómo hacer `mysqldump` periódico (desde el Shell del servicio MySQL) y que **no** se debe restaurar la BD desde un snapshot del disco.

---

## 15. Criterios de aceptación finales

Además de la checklist de la arquitectura (§14 de ese documento):

- [ ] `database/techstore_pro.sql` crea 32 tablas; `techstore_pro.deploy.sql` y `deploy/mysql/init/01_schema.sql` son equivalentes sin `DROP/CREATE DATABASE`.
- [ ] Todos los endpoints de la sección 7 existen, con su rol y validación.
- [ ] Los flujos de la sección 8 son transaccionales; el kardex siempre coincide con `inventario.stock_actual`.
- [ ] El frontend no contiene datos escritos a mano y todas las pantallas de §9.3 funcionan; la consola del navegador está limpia (sin errores de CSP, CORS ni 404 de recursos).
- [ ] `npm run smoke` pasa 100 % en local **y** contra la URL de Render.
- [ ] `render.yaml` validado; el despliegue desde cero (Blueprint) levanta MySQL, crea el esquema, siembra datos y deja la tienda utilizable.
- [ ] `README.md` incluye: requisitos, instalación local paso a paso, variables de entorno, usuarios demo, tabla Pantalla→Endpoints, pasos de §14, respaldos y **lista de desviaciones/suposiciones**.
- [ ] Ninguna tarjeta, CVV ni contraseña en claro se almacena o registra en logs.

---

## 16. Reglas de oro

1. **No alterar el esquema** de la BD sin aprobación escrita del dueño. Los vacíos del modelo se resuelven con las convenciones de la sección 5 y se documentan.
2. **No rediseñar el frontend**: conectarlo.
3. Todo stock se mueve **solo** por `inventario.service`.
4. Todo error al usuario en español, con el código HTTP correcto y el formato de la arquitectura §8.
5. Ante una ambigüedad no cubierta aquí: elegir la opción más simple y consistente con los tres documentos, **anotarla en el README** y continuar (no detenerse).
6. Entregar probado: no declarar "terminado" sin haber ejecutado el humo y revisado el navegador.
