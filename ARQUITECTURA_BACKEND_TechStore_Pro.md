# TechStore Pro — Arquitectura del Backend

> **Documento para agentes de IA / desarrolladores.** Define la arquitectura, la estructura de carpetas, los patrones de diseño y las convenciones del backend de TechStore Pro. Debe leerse **junto con** `TechStore_Pro_Contexto_BD.md` (modelo de datos, reglas de negocio y script SQL). Si algo de este documento contradice al contexto de BD en materia de **datos o reglas de negocio**, manda el contexto de BD; en materia de **arquitectura y código**, manda este documento.
>
> El siguiente documento (`BACKEND_IMPLEMENTACION.md`) detallará módulo por módulo los endpoints y la lógica. Este define las reglas del juego que ese documento y el código deben respetar.

---

## 1. Objetivo y alcance

El proyecto ya tiene un **frontend base con vistas estáticas** (tienda de cliente + panel administrativo). El backend debe:

1. Exponer una **API REST en JSON** que dé vida a todas esas vistas.
2. Conectarse a la base de datos existente `techstore_pro` (MySQL/MariaDB, 32 tablas) mediante **Prisma ORM**.
3. Implementar las reglas de negocio del contexto de BD (kardex, compras, carrito, checkout, cupones, pagos, envíos, devoluciones).
4. Poder **levantarse con un solo comando** (`npm run dev` / `npm start`).

**Fuera de alcance:** modificar el esquema de la BD, cambiar el frontend (solo se consume la API), integrar pasarelas de pago reales (se simula el pago; ver módulo Pagos).

---

## 2. Stack tecnológico (decisiones cerradas)

| Aspecto | Decisión |
|---|---|
| Runtime | **Node.js LTS (>= 20)** |
| Framework HTTP | **Express 4.x** |
| Lenguaje | JavaScript (CommonJS o ESM: usar **ESM** con `"type": "module"` y mantenerlo en todo el proyecto) |
| ORM | **Prisma 6.x** (fijar versión mayor 6 en `package.json` para usar `prisma-client-js` y `url = env("DATABASE_URL")`; si se decide usar Prisma 7, el agente debe seguir su documentación de driver adapters y avisarlo) |
| BD | MySQL / MariaDB 10.11 → en Prisma se usa `provider = "mysql"` |
| Autenticación | **JWT** (`jsonwebtoken`) + hash con **`bcryptjs`** (sin compilación nativa, evita problemas en Windows) |
| Validación | **Zod** (esquemas por endpoint) |
| Sanitización | **`xss`** (limpieza de strings) + recorte de espacios |
| Seguridad HTTP | `helmet`, `cors`, `express-rate-limit` |
| Config | `dotenv` + validación de variables al arrancar (Zod) |
| Logging | `morgan` (HTTP) + `console` estructurado en el manejador de errores |
| Desarrollo | `nodemon` |

Dependencias de producción: `express`, `@prisma/client`, `jsonwebtoken`, `bcryptjs`, `zod`, `xss`, `helmet`, `cors`, `express-rate-limit`, `morgan`, `dotenv`.
Dependencias de desarrollo: `prisma`, `nodemon`.

---

## 3. Estilo y patrón arquitectónico

### 3.1 Estilo: N capas + REST

La aplicación se divide en capas con **dependencias solo hacia abajo** (una capa solo puede llamar a la inmediatamente inferior):

```
┌──────────────────────────────────────────────────────────┐
│ CAPA 1 · PRESENTACIÓN (HTTP)                             │
│   routes/  ·  middleware/  ·  controllers/               │
├──────────────────────────────────────────────────────────┤
│ CAPA 2 · LÓGICA DE NEGOCIO                               │
│   services/   (reglas de negocio y transacciones)        │
├──────────────────────────────────────────────────────────┤
│ CAPA 3 · ACCESO A DATOS                                  │
│   models/  (repositories + Prisma Client singleton)      │
├──────────────────────────────────────────────────────────┤
│ CAPA 4 · BASE DE DATOS  →  MySQL/MariaDB `techstore_pro` │
└──────────────────────────────────────────────────────────┘
```

> **Nota de diseño (adición a lo solicitado):** el patrón MVC pedido es Models + Controllers + Middleware + Routes + Express. Para cumplir correctamente el estilo **N capas** se añade la carpeta `services/` como capa de lógica de negocio. Así los controllers quedan delgados (solo HTTP) y las transacciones complejas de inventario/compras/checkout viven en un solo lugar. Si no se quisiera esta capa, esa lógica tendría que ir en los controllers o en los models, lo cual rompe la separación de responsabilidades.

**REST:** recursos como sustantivos en plural (`/productos`, `/pedidos`), verbos HTTP con su semántica (`GET` leer, `POST` crear, `PUT` actualizar, `DELETE` eliminar), sin estado en el servidor (la sesión viaja en el JWT), respuestas en JSON.

### 3.2 Patrón: MVC adaptado a API

| Componente | Carpeta | Responsabilidad | NO debe hacer |
|---|---|---|---|
| **Model** | `src/models/` | Trabajar contra la BD vía Prisma: repositorios con consultas/escrituras | Lógica de negocio, conocer `req`/`res` |
| **View** | — | En una API la "vista" es la **respuesta JSON** que arma el controller | — |
| **Controller** | `src/controllers/` | Recibir `req`, llamar al service, responder **JSON con el código HTTP correcto** | Acceder a Prisma directamente, reglas de negocio |
| **Middleware** | `src/middleware/` | Validaciones, sanitización, CORS, autenticación, autorización, errores | Lógica de negocio |
| **Routes** | `src/routes/` | Declarar **todas las rutas** del sistema y encadenar sus middlewares | Lógica |
| **Servidor** | `src/app.js` + `src/server.js` | Express: configurar y **levantar la app** | — |

---

## 4. Estructura de carpetas (obligatoria)

```
backend/
├─ prisma/
│  ├─ schema.prisma            # generado con `prisma db pull` (ver §6)
│  └─ seed.js                  # datos semilla (roles, métodos, admin…)
├─ src/
│  ├─ server.js                # arranque: app.listen + graceful shutdown
│  ├─ app.js                   # crea y configura Express (middlewares globales + rutas)
│  ├─ config/
│  │  ├─ env.js                # lee y valida variables de entorno
│  │  └─ constants.js          # roles, estados, tipos de documento (enums de negocio)
│  ├─ models/
│  │  ├─ prisma.client.js      # SINGLETON de PrismaClient
│  │  ├─ base.repository.js    # clase base de los repositorios
│  │  └─ repositories/
│  │     ├─ usuario.repository.js
│  │     ├─ producto.repository.js
│  │     ├─ inventario.repository.js
│  │     ├─ kardex.repository.js
│  │     └─ …(uno por agregado, ver §7.3)
│  ├─ services/
│  │  ├─ auth.service.js
│  │  ├─ inventario.service.js   # ajustes + kardex (costo promedio ponderado)
│  │  ├─ compras.service.js      # orden de compra → recepción
│  │  ├─ checkout.service.js     # carrito → pedido
│  │  ├─ pago.service.js
│  │  └─ …
│  ├─ controllers/
│  │  ├─ auth.controller.js
│  │  ├─ producto.controller.js
│  │  └─ …(uno por recurso)
│  ├─ middleware/
│  │  ├─ security.middleware.js  # helmet, cors, rate limit
│  │  ├─ sanitize.middleware.js
│  │  ├─ validate.middleware.js  # valida con Zod
│  │  ├─ auth.middleware.js      # authenticate (JWT)
│  │  ├─ role.middleware.js      # authorize(...roles)
│  │  ├─ notFound.middleware.js
│  │  └─ error.middleware.js     # manejador global de errores
│  ├─ validators/                # esquemas Zod por recurso (auth.schema.js, producto.schema.js…)
│  ├─ routes/
│  │  ├─ index.js                # monta todas las rutas bajo /api
│  │  └─ auth.routes.js, producto.routes.js, …
│  └─ utils/
│     ├─ AppError.js             # error de negocio con statusCode
│     ├─ response.js             # helpers ok(), created(), paginated()
│     ├─ asyncHandler.js         # envuelve controllers async
│     ├─ serialize.js            # Decimal/BigInt → JSON
│     └─ numeros.js              # helpers de redondeo monetario
├─ .env.example
├─ package.json
└─ README.md
```

**Convenciones de nombres:** archivos `nombre.capa.js` (`producto.controller.js`); funciones en `camelCase`; clases en `PascalCase`; nombres de **tablas y columnas tal cual están en la BD** (`snake_case`, español). Los textos de error y mensajes al cliente van **en español**.

---

## 5. Variables de entorno

`.env.example` debe contener (sin credenciales reales):

```
NODE_ENV=development
PORT=3000

# Base de datos (nombres definidos en el contexto de BD)
DB_HOST=localhost
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=techstore_pro
# Prisma lee ESTA variable. Si la contraseña tiene caracteres especiales, codificarla (URL-encode).
DATABASE_URL="mysql://USUARIO:CONTRASENA@localhost:3306/techstore_pro"

# Auth
JWT_SECRET=cambiar_por_un_secreto_largo
JWT_EXPIRES_IN=8h
BCRYPT_ROUNDS=10

# CORS / frontend
FRONTEND_URL=http://localhost:5500
# Opcional: carpeta del frontend estático para servirlo desde Express
STATIC_DIR=
```

`config/env.js` valida estas variables con Zod al arrancar y **detiene el proceso** con un mensaje claro si falta alguna obligatoria (`DATABASE_URL`, `JWT_SECRET`).

---

## 6. Integración con la base de datos mediante Prisma

La BD **ya existe** (se creó con el script SQL del contexto). Por eso **NO se usan migraciones de Prisma para crear tablas**: se introspecciona.

Pasos obligatorios:

1. `npx prisma init --datasource-provider mysql`
2. Configurar `DATABASE_URL` en `.env`.
3. `npx prisma db pull` → genera `prisma/schema.prisma` desde la BD real.
4. `npx prisma generate` → genera el cliente.
5. **Nunca** ejecutar `prisma migrate dev` ni `prisma db push` contra esta BD (podrían alterar el esquema). Si el esquema debe cambiar, se hace en el script SQL y se vuelve a ejecutar `db pull`.

Reglas sobre el esquema Prisma generado:

- **Los nombres de modelo son los nombres de tabla** (`prisma.usuario`, `prisma.detalle_pedido`, `prisma.orden_compra`…). No renombrar modelos ni campos escalares.
- Se permite renombrar **campos de relación ambiguos** (por ejemplo, las dos relaciones de `pedido` hacia `direccion`: envío y facturación; o las relaciones de `kardex`) a nombres legibles; documentarlo con un comentario en `schema.prisma`.
- PK compuestas (`favorito`, `producto_proveedor`) se acceden con el identificador compuesto generado por Prisma (p. ej. `id_usuario_id_producto`). Verificarlo en el esquema generado antes de usarlo.
- `DECIMAL` llega como `Prisma.Decimal`; `kardex.id_kardex` es `BigInt`. **Ambos requieren serialización** (§10.4).
- Prisma no modela los `CHECK` (p. ej. `resena.calificacion` 1–5): **esa regla se valida en Zod** y además la BD la protege.
- Las fechas se manejan en **UTC** y la API las entrega en ISO 8601; el frontend las convierte a la hora local (Ecuador, UTC−5).

---

## 7. Patrones de diseño

### 7.1 Singleton — instancia única de Prisma (en `models/`)

Debe existir **una sola** instancia de `PrismaClient` en toda la app (varias instancias agotan conexiones). Todos los repositorios la importan desde un único módulo:

```js
// src/models/prisma.client.js
import { PrismaClient } from '@prisma/client';

class Database {
  static #instance = null;
  static getInstance() {
    if (!Database.#instance) {
      Database.#instance = new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      });
    }
    return Database.#instance;
  }
}

export const prisma = Database.getInstance();
```

Regla: **prohibido** hacer `new PrismaClient()` fuera de este archivo. `server.js` llama a `prisma.$disconnect()` en el apagado ordenado.

### 7.2 Repository — acceso a datos (en `models/repositories/`)

Cada agregado tiene un repositorio que **encapsula todas las consultas Prisma** de ese agregado. Los services nunca llaman a `prisma.<tabla>` directamente.

```js
// src/models/base.repository.js
import { prisma } from './prisma.client.js';

export class BaseRepository {
  constructor(modelName) { this.modelName = modelName; }
  // `tx` es opcional: si llega un cliente transaccional, se usa en vez del global
  db(tx) { return (tx ?? prisma)[this.modelName]; }
  findById(id, args = {}, tx)  { return this.db(tx).findUnique({ where: { [this.pk]: id }, ...args }); }
  findMany(args = {}, tx)      { return this.db(tx).findMany(args); }
  create(data, tx)             { return this.db(tx).create({ data }); }
  update(id, data, tx)         { return this.db(tx).update({ where: { [this.pk]: id }, data }); }
  count(where = {}, tx)        { return this.db(tx).count({ where }); }
}
```

Reglas del Repository:

- **Todo método acepta un parámetro final opcional `tx`** (cliente transaccional de Prisma). Así un service puede componer varios repositorios dentro de **una sola transacción**.
- Los repositorios devuelven datos de BD; **no** lanzan errores HTTP ni hacen cálculos de negocio.
- Repositorios mínimos (uno por agregado): `usuario`, `rol`, `direccion`, `categoria`, `marca`, `producto` (incluye imágenes y especificaciones), `resena`, `favorito`, `inventario`, `movimiento_inventario`, `kardex`, `proveedor`, `orden_compra` (con sus detalles), `recepcion_compra` (con sus detalles), `carrito` (con ítems), `cupon`, `pedido` (con detalles e historial), `pago`, `factura`, `envio`, `metodo_pago`, `metodo_envio`, `transportista`, `devolucion`.
- Los repositorios se exportan como **instancias únicas** (`export const productoRepository = new ProductoRepository()`), coherente con el patrón Singleton.

### 7.3 Chain of Responsibility — cadena de middlewares (en `middleware/`)

Cada middleware es un **eslabón**: procesa la petición y decide entre **pasarla al siguiente** (`next()`) o **cortar la cadena** respondiendo con error (`next(new AppError(...))`). Una petición solo llega al controller si supera todos los eslabones.

**Cadena global** (en `app.js`, en este orden exacto):

```
1. helmet                → cabeceras de seguridad
2. cors                  → solo orígenes permitidos (FRONTEND_URL)
3. rate limit            → límite de peticiones (más estricto en /auth)
4. morgan                → log de la petición
5. express.json (límite 1mb)
6. sanitize              → limpia strings de body, query y params
7. routes (/api/...)
8. notFound              → 404 para rutas inexistentes
9. errorHandler          → único punto que convierte errores en respuesta JSON
```

**Cadena por ruta** (declarada en cada archivo de `routes/`, en este orden):

```
authenticate  →  authorize(roles)  →  validate(schemaZod)  →  controller
 (401 si falla)   (403 si falla)       (422 si falla)
```

Ejemplo:

```js
router.post('/admin/inventario/ajustes',
  authenticate,
  authorize('Administrador', 'Bodeguero'),
  validate(ajusteInventarioSchema),
  asyncHandler(inventarioController.crearAjuste));
```

Reglas de la cadena:

- **Cada eslabón tiene una sola responsabilidad** (autenticar, autorizar, validar…).
- El orden es fijo: *sanitizar antes de validar*, *autenticar antes de autorizar*, *validar antes de ejecutar*.
- `validate(schema)` valida `body`, `query` y `params` según el esquema y reemplaza `req.body/query/params` con los datos ya parseados (tipos correctos).
- `authorize` recibe los nombres de rol permitidos (`Administrador`, `Bodeguero`, `Vendedor`, `Cliente`, definidos en `config/constants.js`).
- Un **cliente solo accede a sus propios recursos**: además del rol, el controller/service compara `req.user.id_usuario` con el dueño del recurso y responde 403 si no coincide.

---

## 8. Contrato de la API (reglas generales)

### 8.1 Base y versionado
- Base path: **`/api`**. Los paths de cada recurso son **exactamente los de la sección 6 del contexto de BD** (por ejemplo `POST /api/auth/login`, `GET /api/productos`, `POST /api/admin/inventario/ajustes`). No inventar rutas alternativas.
- `GET /api/health` → `200 { "success": true, "data": { "status": "ok" } }` (verifica también la conexión a BD con una consulta trivial).

### 8.2 Formato de respuesta (siempre JSON)

Éxito:
```json
{ "success": true, "message": "Producto creado", "data": { … } }
```
Listados paginados (parámetros `?pagina=1&limite=12`; por defecto 1 y 12; máximo 100):
```json
{ "success": true, "data": [ … ], "meta": { "pagina": 1, "limite": 12, "total": 87, "totalPaginas": 8 } }
```
Error:
```json
{ "success": false, "error": { "codigo": "VALIDACION", "mensaje": "Datos inválidos", "detalles": [ { "campo": "email", "mensaje": "Email no válido" } ] } }
```

### 8.3 Códigos HTTP (los controllers deben usarlos correctamente)

| Código | Cuándo |
|---|---|
| `200 OK` | Lectura o actualización exitosa |
| `201 Created` | Recurso creado (`POST` que crea) |
| `204 No Content` | Eliminación exitosa sin cuerpo |
| `400 Bad Request` | JSON malformado, parámetro imposible de interpretar |
| `401 Unauthorized` | Falta token, token inválido o expirado, credenciales incorrectas |
| `403 Forbidden` | Rol insuficiente o recurso de otro usuario |
| `404 Not Found` | Recurso o ruta inexistente |
| `409 Conflict` | Duplicados (email, SKU, RUC, código de cupón), stock insuficiente, estado que no permite la operación, conflicto de transacción |
| `422 Unprocessable Entity` | Falla la validación Zod o una regla de negocio de formato (rango, cantidad excedida) |
| `429 Too Many Requests` | Rate limit |
| `500 Internal Server Error` | Error no controlado (nunca exponer el stack al cliente) |

### 8.4 Manejo de errores
- Los services lanzan `AppError(statusCode, codigo, mensaje, detalles?)`.
- `asyncHandler` envía cualquier excepción al `errorHandler` global (los controllers **no** llevan `try/catch` repetido).
- El `errorHandler` traduce además errores de Prisma: `P2002` → 409 (duplicado), `P2025` → 404, `P2003` → 409 (violación de FK), `P2034` → 409 (conflicto/deadlock de transacción, reintentable). Cualquier otro → 500 con mensaje genérico y log interno.

### 8.5 Seguridad
- Contraseñas con `bcryptjs`; **`contrasena_hash` jamás se devuelve** en ninguna respuesta (usar `select`/omit en el repositorio de usuario).
- JWT con payload `{ sub: id_usuario, rol }`; `GET /auth/me` consulta la BD para devolver el usuario actual. En el login se actualiza `usuario.ultimo_acceso` y solo se permite `estado = 'activo'`.
- CORS: solo `FRONTEND_URL` (y credenciales según necesidad). Nunca `*` en producción.
- Prohibido concatenar SQL. Si se necesita SQL crudo (solo para `SELECT … FOR UPDATE`), usar **`prisma.$queryRaw` con template tag** (parametrizado).

### 8.6 Matriz de acceso por rol

| Grupo de rutas | Público | Cliente | Vendedor | Bodeguero | Administrador |
|---|:-:|:-:|:-:|:-:|:-:|
| `/auth/registro`, `/auth/login` | ✔ | | | | |
| Catálogo (`GET /productos`, `/categorias`, `/marcas`, reseñas aprobadas) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Carrito, favoritos, pedidos propios, direcciones, devoluciones propias, reseñas | | ✔ | | | ✔ |
| `/admin/productos`, `/admin/categorias`, `/admin/marcas`, `/admin/cupones` | | | ✔ | | ✔ |
| `/admin/pedidos`, `/admin/envios`, `/admin/devoluciones`, `/admin/resenas` | | | ✔ | | ✔ |
| `/admin/inventario`, kardex y ajustes | | | | ✔ | ✔ |
| `/admin/proveedores`, `/admin/ordenes-compra`, `/admin/recepciones` | | | | ✔ | ✔ |
| Usuarios y roles | | | | | ✔ |

---

## 9. Reglas de las capas (resumen para el agente)

1. **Routes** solo declaran rutas + cadena de middlewares. Cero lógica.
2. **Controllers** extraen datos de `req`, llaman **un método de service**, y responden con `ok()/created()/paginated()` y el código HTTP correcto. Cero acceso directo a Prisma y cero reglas de negocio.
3. **Services** contienen las reglas de negocio del contexto de BD (§5), componen repositorios y **abren las transacciones**.
4. **Repositories (models)** son el único lugar donde aparece Prisma.
5. Una capa **nunca** importa de una capa superior (un repository no importa un service; un service no importa un controller).
6. Ningún archivo fuera de `models/prisma.client.js` instancia `PrismaClient`.

---

## 10. Transacciones y reglas críticas (vínculo con el contexto de BD)

### 10.1 Cómo se ejecuta una transacción
Los services usan `prisma.$transaction(async (tx) => { … })` y pasan `tx` a cada repositorio. Todo lo que el contexto de BD marca como "transacción" (§5.1 a §5.6) **debe** ir en una sola:

- Recepción de compra completada o anulada (§5.2)
- Checkout: carrito → pedido (§5.3)
- Pago aprobado: descontar stock y generar kardex (§5.3)
- Cancelación de pedido: liberar reserva (§5.3)
- Ajuste manual de inventario (§5.1)
- Devolución completada con reingreso a bodega (§5.6)

### 10.2 Bloqueo de fila sobre `inventario`
Antes de leer/modificar el stock de un producto, bloquear su fila dentro de la transacción:

```js
const [inv] = await tx.$queryRaw`
  SELECT id_inventario, stock_actual, stock_reservado
  FROM inventario WHERE id_producto = ${idProducto} FOR UPDATE`;
```
Si la transacción toca varios productos, **bloquearlos en orden ascendente de `id_producto`** para evitar deadlocks.

### 10.3 Un solo punto para mover stock
**Toda variación de stock pasa por `inventario.service.js`** (`registrarMovimiento`), que en la misma transacción: (1) bloquea la fila, (2) valida que el stock no quede negativo, (3) inserta `movimiento_inventario`, (4) inserta la fila de `kardex` con `saldo_cantidad`, `saldo_costo_promedio` y `saldo_valor` calculados por **costo promedio ponderado** según la fórmula del contexto de BD §5.1, (5) actualiza `inventario.stock_actual`. Los demás services (compras, checkout, devoluciones) **llaman a este método** y nunca tocan `stock_actual` por su cuenta. Esto garantiza que el último registro del kardex coincida siempre con `inventario.stock_actual`.

### 10.4 Serialización
`utils/serialize.js` y un `BigInt.prototype.toJSON` global resuelven los tipos que JSON no soporta:
- `Prisma.Decimal` → número con 2 decimales en las respuestas (los cálculos internos se hacen con `Decimal`, **no** con `Number`, y se redondea a 2 decimales al final; el costo del kardex usa 4).
- `BigInt` (`kardex.id_kardex`) → número.

### 10.5 Numeración de documentos
`numero_pedido`, `numero_orden`, `numero_recepcion` y `numero_factura` son únicos. Se generan en el service con un formato legible y secuencial dentro de la transacción (p. ej. `PED-2026-000123`, `OC-2026-000045`, `REC-2026-000012`), y ante un `P2002` se reintenta una vez. `clave_acceso` (49 dígitos) se genera en `pago.service.js`/`factura` con el formato simulado al estilo SRI; no se conecta con el SRI real.

---

## 11. Arranque del servidor (Express)

- `app.js` exporta la app configurada (sin escuchar puerto): facilita pruebas.
- `server.js` hace `app.listen(PORT)`, verifica la conexión a la BD al inicio (`prisma.$connect()`) y registra el apagado ordenado (`SIGINT`/`SIGTERM` → cerrar servidor → `prisma.$disconnect()`).
- Si `STATIC_DIR` está definido, Express sirve el frontend estático con `express.static(STATIC_DIR)` además de la API, para poder levantar todo con un comando. Las rutas `/api/*` tienen prioridad.
- Scripts de `package.json`:

```json
{
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",
    "prisma:pull": "prisma db pull",
    "prisma:generate": "prisma generate",
    "seed": "node prisma/seed.js"
  }
}
```

---

## 12. Datos semilla (`prisma/seed.js`)

Idempotente (usa `upsert`). Debe crear como mínimo: los 4 roles (`Administrador`, `Bodeguero`, `Vendedor`, `Cliente`), métodos de pago, métodos de envío, transportistas y **un usuario administrador** (credenciales tomadas de variables de entorno `ADMIN_EMAIL` / `ADMIN_PASSWORD`, nunca escritas en el código). Opcionalmente categorías, marcas y algunos productos con su registro de `inventario` para poder probar la tienda.

---

## 13. Orden de implementación para el agente

1. **Base:** `package.json`, estructura de carpetas, `config/env.js`, Express (`app.js`/`server.js`), `health`.
2. **Prisma:** `db pull`, `generate`, singleton, `BaseRepository`.
3. **Utilidades y middlewares:** `AppError`, `asyncHandler`, respuestas, serialización, seguridad, sanitize, validate, authenticate, authorize, notFound, errorHandler.
4. **Auth y usuarios/direcciones.**
5. **Catálogo** (categorías en árbol, marcas, productos con imágenes/especificaciones/rating/stock disponible), favoritos y reseñas.
6. **Inventario y kardex** (`inventario.service` primero: lo usan los demás).
7. **Compras** (proveedores → orden de compra → recepción/anulación).
8. **Carrito, cupones y checkout/pedidos** (+ historial de estados).
9. **Pagos, facturas y envíos.**
10. **Devoluciones.**
11. **Panel admin:** reportes (stock bajo, dashboard).
12. **Seed, `.env.example` y `README.md`** con los pasos para ejecutar.

---

## 14. Criterios de aceptación

- [ ] `npm install && npx prisma db pull && npx prisma generate && npm run dev` levanta el servidor sin errores y `GET /api/health` responde `200`.
- [ ] Existe una única instancia de `PrismaClient` (búsqueda de `new PrismaClient` solo da `prisma.client.js`).
- [ ] Ningún controller importa Prisma ni repositorios; ningún service usa `prisma.<tabla>` directamente.
- [ ] Todas las rutas del contexto de BD §6 existen con la cadena `authenticate → authorize → validate → controller` según la matriz §8.6.
- [ ] Todas las respuestas siguen el formato §8.2 y los códigos §8.3.
- [ ] `contrasena_hash` no aparece en ninguna respuesta.
- [ ] Ningún cambio de stock ocurre fuera de `inventario.service.js`; tras cualquier operación, el último `kardex` de un producto coincide con `inventario.stock_actual`.
- [ ] Recepciones, checkout, pago aprobado, cancelación, ajustes y devoluciones se ejecutan en una sola transacción con bloqueo de fila.
- [ ] No se modificó el esquema de la BD ni se ejecutó `migrate`/`db push`.
- [ ] El repositorio incluye `.env.example`, `README.md` y el seed.

---

## 15. Reglas de oro para el agente

1. **No cambiar el esquema de la BD.** Si algo parece faltar, documentar la suposición y preguntar.
2. **Seguir exactamente los nombres** de tablas, columnas, estados y rutas del contexto de BD.
3. Si este documento y el código existente del frontend chocan en una ruta o un formato de campo, **no adivinar**: adaptar el backend a lo definido aquí y listar las diferencias en el `README.md` para que se ajuste el frontend.
4. Mensajes y errores al usuario en **español**; identificadores de código tal como están en la BD.
5. Antes de dar una tarea por terminada, recorrer la checklist de la sección 14.

---

## 16. Topología distribuida propuesta: Quito, Guayaquil y Cuenca

### Estado actual

La conexión de la aplicación es una sola (`DATABASE_URL`) y Prisma usa un único `PrismaClient`. La interfaz de Gestión muestra el diseño propuesto, pero **no configura, monitorea ni demuestra que existan réplicas**. La base MariaDB existente en Quito se conserva como primaria; Guayaquil y Cuenca serán réplicas de lectura cuando se provisionen y configuren. No se debe cambiar la conexión de producción ni afirmar que hay alta disponibilidad hasta completar y probar los pasos siguientes.

### Topología y reglas de escritura

```text
Tienda/API
    │ lecturas y escrituras
    ▼
Quito · MariaDB primaria
    ├── replicación asíncrona ──► Guayaquil · réplica, solo lectura
    └── replicación asíncrona ──► Cuenca · réplica, solo lectura
```

- Quito es el único escritor. Guayaquil y Cuenca reciben el conjunto de datos mediante replicación; no son bases independientes por sucursal.
- La replicación asíncrona puede tener retraso. Consultas que deben reflejar una escritura recién confirmada, checkout, stock, pagos y cualquier transacción se leen/escriben en Quito.
- Una réplica no es por sí sola un respaldo ni un mecanismo de failover automático. Definir recuperación, promoción controlada, respaldos y monitorización antes de usarla en producción.

### Pasos de configuración de MariaDB

1. **Acordar infraestructura y red.** Aprovisionar dos servidores MariaDB 10.11 compatibles con Quito. Establecer red privada o VPN entre sedes, cifrado en tránsito y reglas de firewall que permitan el puerto 3306 solo entre direcciones autorizadas; no exponer MariaDB directamente a Internet.
2. **Configurar identificadores y binlog.** Asignar un `server_id` entero distinto a cada instancia. En Quito habilitar `log_bin` y `binlog_format=ROW`; conservar binlogs el tiempo suficiente para cubrir indisponibilidades previstas. Reiniciar según la política del servidor y comprobar `SHOW VARIABLES LIKE 'log_bin';` y `SHOW MASTER STATUS;`.
3. **Crear una cuenta de replicación restringida en Quito.** Limitar su host a las IP de las réplicas, usar una contraseña fuerte fuera del repositorio y conceder únicamente el privilegio `REPLICATION SLAVE`. No reutilizar la cuenta de la aplicación ni `root`.
4. **Inicializar las réplicas desde una copia consistente.** Tomar un respaldo lógico o físico compatible con el tamaño y actividad de la base, restaurarlo en ambos servidores y conservar el estado/posición GTID que corresponda. No copiar archivos de una base activa sin el mecanismo de respaldo consistente.
5. **Configurar Guayaquil y Cuenca como seguidoras GTID.** En cada nodo usar su `server_id`, configurar como fuente la dirección privada de Quito y las credenciales de replicación protegidas, activar `read_only=ON` e iniciar la réplica con el mecanismo GTID compatible con la versión instalada de MariaDB. No ejecutar escrituras de aplicación en los nodos secundarios.
6. **Validar y monitorear.** Revisar `SHOW SLAVE STATUS\G` (o la sintaxis equivalente de la versión), confirmar que los hilos IO y SQL estén activos, revisar errores/GTID/retraso y comparar datos. Configurar alertas, rotación/retención de binlogs y respaldos restaurables. Ensayar caída de red y recuperación sin promover nodos automáticamente.
7. **Habilitar la aplicación en una entrega separada.** Mantener Quito como conexión de escritura. Añadir conexiones/configuración de lectura para las réplicas únicamente cuando se defina qué consultas toleran retraso, y enrutar allí solo esas consultas. Probar transacciones y lecturas posteriores a escritura contra Quito. No reutilizar `DATABASE_URL` como si realizara el balanceo: Prisma y el backend actuales no seleccionan réplicas.
8. **Documentar recuperación y activar gradualmente.** Definir responsable y pasos de promoción/failback, medir retraso y carga, probar restauraciones y desplegar primero consultas no críticas. La aplicación debe seguir operando en modo solo Quito si una réplica no está disponible.

La topología no requiere nuevas tablas ni cambios al esquema de `techstore_pro`: la replicación se configura en los servidores MariaDB. No ejecutar `prisma migrate` ni `prisma db push` para este trabajo. Antes de activar la lectura distribuida deben implementarse en el backend la selección explícita de conexiones y la observabilidad del estado; el módulo de interfaz es por ahora documentación del diseño, no un panel de salud en tiempo real.
