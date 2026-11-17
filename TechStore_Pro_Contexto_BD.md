# TechStore Pro — Contexto de base de datos para integración Backend + Frontend

> Documento para una IA (o desarrollador) que debe **analizar la base de datos y construir la conexión con el backend y el frontend** de un e-commerce de tecnología. Contiene el contexto del negocio, el modelo de datos, las reglas de negocio, el flujo de inventario/compras y el script SQL completo.

## 1. Objetivo de la tarea

1. Analizar el esquema de la base de datos (sección 8, script SQL completo).
2. Proponer y generar el **backend** (API REST) conectado a esta base de datos.
3. Proponer y generar el **frontend** (tienda para clientes + panel administrativo) que consuma esa API.
4. Respetar las reglas de negocio de las secciones 4 a 6.

**Stack no definido por el usuario.** Antes de generar código, confirma con el usuario el stack deseado. Si no responde, usa por defecto: Node.js + Express (o NestJS) + `mysql2`/Prisma para el backend, y React (o el framework que el usuario prefiera) para el frontend.

## 2. Información del motor de base de datos

- Motor: **MySQL / MariaDB** (el usuario trabaja con **HeidiSQL**; tiene MariaDB 10.11 instalado en Windows).
- Nombre de la base: `techstore_pro`
- Charset/collation: `utf8mb4` / `utf8mb4_unicode_ci`; todas las tablas son InnoDB.
- Convenciones: tablas y columnas en `snake_case` y en español; PK `id_<tabla>` autoincremental sin signo; FKs con nombre `fk_*`.
- La contraseña de usuario se guarda en `usuario.contrasena_hash` (usar bcrypt o argon2; **nunca** guardar texto plano).
- Moneda por defecto: USD. IVA por defecto: 15 % (`producto.porcentaje_iva`). País por defecto: Ecuador (facturación con RUC/clave de acceso al estilo SRI).
- Conexión (a completar por el usuario): host, puerto 3306, usuario, contraseña. **No incluir credenciales reales en el código; usar variables de entorno** (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=techstore_pro`).

## 3. Mapa de módulos y tablas (32 tablas)

| Módulo | Tablas |
|---|---|
| Seguridad / usuarios | `rol`, `usuario`, `direccion` |
| Catálogo | `categoria` (jerárquica), `marca`, `producto`, `imagen_producto`, `especificacion`, `resena`, `favorito` |
| Inventario | `inventario`, `movimiento_inventario`, `kardex` |
| Compras a proveedores | `proveedor`, `producto_proveedor`, `orden_compra`, `detalle_orden_compra`, `recepcion_compra`, `detalle_recepcion` |
| Carrito | `carrito`, `item_carrito` |
| Ventas | `cupon`, `pedido`, `detalle_pedido`, `historial_estado_pedido` |
| Pagos y facturación | `metodo_pago`, `pago`, `factura` |
| Logística | `metodo_envio`, `transportista`, `envio` |
| Postventa | `devolucion` |

## 4. Relaciones principales (resumen)

- `rol` 1—N `usuario`; `usuario` 1—N `direccion`, `carrito`, `pedido`, `resena`, `movimiento_inventario`, `orden_compra`, `recepcion_compra`, `kardex`.
- `categoria` se autorrelaciona (`id_categoria_padre` NULL = categoría raíz). `categoria` 1—N `producto`; `marca` 1—N `producto`.
- `producto` 1—N `imagen_producto`, `especificacion`, `resena`; `producto` 1—1 `inventario` (`inventario.id_producto` es UNIQUE).
- `usuario` N—M `producto` por `favorito`. `producto` N—M `proveedor` por `producto_proveedor` (`costo_compra`, `plazo_entrega_dias`).
- `carrito` 1—N `item_carrito` (único por carrito+producto).
- `pedido` pertenece a un `usuario`, a una dirección de envío y una de facturación (`id_direccion_envio`, `id_direccion_facturacion`) y opcionalmente a un `cupon`.
- `pedido` 1—N `detalle_pedido` (mínimo 1), `historial_estado_pedido`, `pago`, `envio`; `pedido` 1—0..1 `factura` (`factura.id_pedido` UNIQUE).
- `pago` → `metodo_pago`; `envio` → `metodo_envio` y `transportista`; `devolucion` → `detalle_pedido`.
- `orden_compra` → `proveedor`; 1—N `detalle_orden_compra`; 1—N `recepcion_compra`; `recepcion_compra` 1—N `detalle_recepcion` → `detalle_orden_compra`.
- `kardex` → `producto`, `movimiento_inventario` (opcional), `usuario`; referencia el documento origen con `tipo_documento` + `id_documento` (sin FK, es polimórfico).

## 5. Reglas de negocio que el backend DEBE implementar

Todo lo marcado como "transacción" debe ejecutarse dentro de **una sola transacción de base de datos** (`BEGIN … COMMIT/ROLLBACK`) y con bloqueo de fila (`SELECT … FOR UPDATE`) sobre `inventario` para evitar condiciones de carrera.

### 5.1 Inventario y Kardex
- `inventario.stock_actual` es el stock físico; `stock_reservado` es lo comprometido en pedidos pendientes; **stock disponible = `stock_actual − stock_reservado`**.
- Toda variación de stock debe generar **un `movimiento_inventario`** (`tipo`: entrada/salida/ajuste) **y una fila en `kardex`**. Nunca modificar `inventario.stock_actual` sin dejar rastro en el kardex.
- `kardex.cantidad` lleva signo: positiva = entrada, negativa = salida. `saldo_cantidad` es el stock resultante tras el movimiento; `saldo_costo_promedio` y `saldo_valor` se calculan con **costo promedio ponderado**:
  - En una entrada: `nuevo_promedio = (saldo_valor_anterior + costo_total_entrada) / (saldo_cantidad_anterior + cantidad)`.
  - En una salida: se valoriza al promedio vigente; el promedio no cambia.
- `kardex.tipo_documento` ∈ `inventario_inicial`, `recepcion_compra`, `venta`, `devolucion_cliente`, `devolucion_proveedor`, `ajuste_positivo`, `ajuste_negativo`; `id_documento` apunta al id del documento origen (`recepcion_compra.id_recepcion`, `pedido.id_pedido`, `devolucion.id_devolucion`…).
- Los ajustes manuales exigen `motivo` y un usuario con rol autorizado (ej. Administrador / Bodeguero).
- Si `stock_actual < stock_minimo` se debe alertar en el panel admin (reporte de reposición).
- Para el kardex de un producto, el último registro por `id_kardex` (o fecha) refleja el saldo actual y debe coincidir con `inventario.stock_actual`.

### 5.2 Compras: orden de compra → recepción
1. Crear `orden_compra` (estado `borrador`) con sus `detalle_orden_compra`; calcular `subtotal`, `iva`, `total`. Al enviarla al proveedor pasa a `enviada`.
2. Registrar `recepcion_compra` + `detalle_recepcion` contra una orden `enviada` o `recibida_parcial`. No permitir recibir más de `cantidad_solicitada − cantidad_recibida`.
3. Al **completar** una recepción (transacción):
   - Por cada línea con `cantidad_recibida > 0`: insertar `movimiento_inventario` tipo `entrada`, insertar fila en `kardex` (`tipo_documento = 'recepcion_compra'`, costo = `detalle_orden_compra.costo_unitario`), sumar a `inventario.stock_actual`, y sumar a `detalle_orden_compra.cantidad_recibida`.
   - `cantidad_rechazada` NO entra al stock (solo se registra).
   - Actualizar `orden_compra.estado`: `recibida_total` si todas las líneas están completas; si no, `recibida_parcial`.
   - Opcional: actualizar `producto.costo` con el costo promedio.
4. Una recepción `anulada` debe revertir sus movimientos con filas inversas en el kardex (no borrar historial).

### 5.3 Carrito y pedido
- Un usuario tiene como máximo un carrito `activo`. `item_carrito.precio_unitario` guarda el precio al agregarlo; al confirmar se debe **revalidar contra `producto.precio_venta`**.
- Checkout (transacción): validar stock disponible → crear `pedido` (con `numero_pedido` único) y `detalle_pedido` → aplicar cupón → incrementar `inventario.stock_reservado` → marcar carrito como `convertido` → insertar en `historial_estado_pedido`.
- Cálculos por línea: `subtotal = cantidad × precio_unitario − descuento`; `iva = subtotal × producto.porcentaje_iva / 100`. Cabecera: `pedido.subtotal`, `descuento`, `iva`, `costo_envio`, `total = subtotal − descuento + iva + costo_envio`.
- Cuando el pago pasa a `aprobado`: `pedido.estado = 'pagado'`, **descontar** `stock_actual` y liberar `stock_reservado`, generar movimiento `salida` y fila de kardex con `tipo_documento = 'venta'`.
- Si el pedido se cancela antes del pago: liberar `stock_reservado`.
- Cada cambio de `pedido.estado` inserta una fila en `historial_estado_pedido`.

### 5.4 Cupones
- Validar: `activo = 1`, fecha actual entre `fecha_inicio` y `fecha_fin`, `usos_actuales < usos_maximos` (si no es NULL) y `monto_minimo_compra` cumplido. `tipo_descuento` = `porcentaje` o `monto_fijo`. Incrementar `usos_actuales` al confirmar el pedido.

### 5.5 Pagos, facturación y envío
- Un pedido puede tener varios `pago` (reintentos). El pedido se considera pagado cuando la suma de pagos `aprobado` ≥ `pedido.total`.
- `factura` se genera una sola vez por pedido pagado (copia `identificacion_cliente` y `razon_social_cliente` como snapshot). `numero_factura` y `clave_acceso` (49 dígitos) son únicos.
- `envio` se crea cuando el pedido pasa a `preparando`; su costo sale de `metodo_envio.costo_base`. Al entregar: `envio.estado = 'entregado'`, `pedido.estado = 'entregado'`.

### 5.6 Devoluciones
- Solo sobre `detalle_pedido` de pedidos `entregado`; `cantidad` ≤ lo comprado. Al `completar`: si el producto vuelve a bodega, registrar entrada (`tipo_documento = 'devolucion_cliente'`) en kardex y generar reembolso (`pago` en estado `reembolsado` o actualizar `monto_reembolso`).

### 5.7 Reseñas y seguridad
- `resena.calificacion` entre 1 y 5 (CHECK). `compra_verificada = 1` si el usuario compró el producto. Solo mostrar reseñas `aprobada`.
- Roles sugeridos (tabla `rol`): `Administrador`, `Bodeguero`, `Vendedor`, `Cliente`. Proteger los endpoints administrativos por rol (JWT + middleware).
- Datos iniciales (seed) recomendados: roles, métodos de pago, métodos de envío, transportistas y un usuario administrador.

## 6. API REST sugerida (punto de partida)

| Recurso | Endpoints | Notas |
|---|---|---|
| Auth | `POST /auth/registro`, `POST /auth/login`, `GET /auth/me` | JWT, hash de contraseña, actualizar `ultimo_acceso` |
| Usuarios/Direcciones | `GET/PUT /usuarios/:id`, `CRUD /usuarios/:id/direcciones` | Una sola `es_predeterminada` por usuario |
| Catálogo | `GET /productos?categoria=&marca=&q=&orden=&pagina=`, `GET /productos/:id`, `GET /categorias` (árbol), `GET /marcas` | Incluir imágenes, especificaciones, rating promedio y stock disponible |
| Admin catálogo | `POST/PUT/DELETE /admin/productos`, `/admin/categorias`, `/admin/marcas` | Borrado lógico vía `estado`/`activa` |
| Favoritos y reseñas | `GET/POST/DELETE /favoritos`, `GET/POST /productos/:id/resenas`, `PUT /admin/resenas/:id/moderar` | |
| Carrito | `GET /carrito`, `POST /carrito/items`, `PUT/DELETE /carrito/items/:id` | |
| Checkout/Pedidos | `POST /pedidos` (desde carrito), `GET /pedidos`, `GET /pedidos/:id`, `PUT /admin/pedidos/:id/estado` | Transacción de la sección 5.3 |
| Cupones | `POST /cupones/validar`, `CRUD /admin/cupones` | |
| Pagos/Facturas | `POST /pedidos/:id/pagos`, `GET /pedidos/:id/factura` | Webhook de pasarela cuando aplique |
| Envíos | `GET /pedidos/:id/envio`, `PUT /admin/envios/:id` | |
| Devoluciones | `POST /devoluciones`, `PUT /admin/devoluciones/:id` | |
| Inventario | `GET /admin/inventario`, `GET /admin/inventario/:idProducto/kardex?desde=&hasta=`, `POST /admin/inventario/ajustes` | Reporte de stock bajo |
| Compras | `CRUD /admin/proveedores`, `CRUD /admin/ordenes-compra`, `POST /admin/ordenes-compra/:id/enviar`, `POST /admin/ordenes-compra/:id/recepciones`, `POST /admin/recepciones/:id/anular` | Transacción de la sección 5.2 |

## 7. Pantallas de frontend sugeridas

**Tienda (cliente):** inicio con destacados (`producto.destacado`), listado con filtros (categoría/marca/precio/búsqueda), detalle de producto (galería, especificaciones, reseñas, garantía), carrito, checkout (dirección, método de envío, cupón, método de pago), mis pedidos (con historial de estados), mis direcciones, favoritos, solicitud de devolución, login/registro.

**Panel administrativo:** dashboard (ventas, stock bajo, pedidos pendientes), productos/categorías/marcas, **inventario + kardex por producto**, ajustes de inventario, proveedores, **órdenes de compra**, **recepciones de mercadería**, pedidos y cambio de estado, envíos, cupones, devoluciones, moderación de reseñas, usuarios y roles.

## 8. Script SQL completo (`techstore_pro`)

Ejecutar completo en HeidiSQL (o `mysql < archivo.sql`). Advertencia: empieza con `DROP DATABASE IF EXISTS techstore_pro`.

## 9. Instrucciones para la IA que recibe este documento

1. Confirma el stack con el usuario (backend, frontend, ORM) o usa el predeterminado de la sección 1.
2. Genera primero el backend: configuración de conexión por variables de entorno, capa de acceso a datos, y los endpoints de la sección 6, empezando por Auth, Catálogo, Carrito y Pedidos.
3. Implementa las operaciones de inventario/compras **siempre con transacciones** y registrando kardex (secciones 5.1 y 5.2).
4. Valida todo input en el servidor, usa consultas parametrizadas (sin concatenar SQL), nunca expongas `contrasena_hash` en respuestas y maneja errores con códigos HTTP correctos.
5. Genera después el frontend consumiendo la API, empezando por catálogo, carrito y checkout, luego el panel admin.
6. Entrega un `README` con pasos para ejecutar, un archivo `.env.example` y datos semilla (seed).
7. Si algo del modelo es ambiguo (por ejemplo, qué dirección usa un pedido o cómo se valoriza el inventario), pregunta o documenta tu suposición en lugar de modificar el esquema sin avisar.

---

```sql
-- =====================================================================
-- TechStore Pro - Script de base de datos (MySQL / MariaDB - HeidiSQL)
-- Generado a partir del MCD "MCD_Tech.pdf"
-- =====================================================================

DROP DATABASE IF EXISTS techstore_pro;
CREATE DATABASE techstore_pro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE techstore_pro;

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- Usuarios y direcciones
-- ---------------------------------------------------------------------
CREATE TABLE rol (
    id_rol        INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nombre        VARCHAR(50)  NOT NULL,
    descripcion   VARCHAR(255) NULL,
    PRIMARY KEY (id_rol),
    UNIQUE KEY uq_rol_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE usuario (
    id_usuario       INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_rol           INT UNSIGNED NOT NULL,                       -- agrupa
    identificacion   VARCHAR(20)  NOT NULL,
    nombres          VARCHAR(100) NOT NULL,
    apellidos        VARCHAR(100) NOT NULL,
    email            VARCHAR(150) NOT NULL,
    telefono         VARCHAR(20)  NULL,
    contrasena_hash  VARCHAR(255) NOT NULL,
    fecha_nacimiento DATE         NULL,
    fecha_registro   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ultimo_acceso    DATETIME     NULL,
    estado           ENUM('activo','inactivo','bloqueado') NOT NULL DEFAULT 'activo',
    PRIMARY KEY (id_usuario),
    UNIQUE KEY uq_usuario_identificacion (identificacion),
    UNIQUE KEY uq_usuario_email (email),
    CONSTRAINT fk_usuario_rol FOREIGN KEY (id_rol) REFERENCES rol (id_rol)
) ENGINE=InnoDB;

CREATE TABLE direccion (
    id_direccion      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_usuario        INT UNSIGNED NOT NULL,                      -- registra
    alias             VARCHAR(50)  NULL,
    destinatario      VARCHAR(150) NOT NULL,
    telefono_contacto VARCHAR(20)  NULL,
    calle_principal   VARCHAR(150) NOT NULL,
    calle_secundaria  VARCHAR(150) NULL,
    numeracion        VARCHAR(20)  NULL,
    referencia        VARCHAR(255) NULL,
    ciudad            VARCHAR(100) NOT NULL,
    provincia         VARCHAR(100) NOT NULL,
    pais              VARCHAR(100) NOT NULL DEFAULT 'Ecuador',
    codigo_postal     VARCHAR(20)  NULL,
    es_predeterminada TINYINT(1)   NOT NULL DEFAULT 0,
    PRIMARY KEY (id_direccion),
    CONSTRAINT fk_direccion_usuario FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Catalogo
-- ---------------------------------------------------------------------
CREATE TABLE categoria (
    id_categoria        INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_categoria_padre  INT UNSIGNED NULL,                        -- es padre de (0,1)
    nombre              VARCHAR(100) NOT NULL,
    descripcion         VARCHAR(255) NULL,
    imagen              VARCHAR(255) NULL,
    activa              TINYINT(1)   NOT NULL DEFAULT 1,
    PRIMARY KEY (id_categoria),
    CONSTRAINT fk_categoria_padre FOREIGN KEY (id_categoria_padre) REFERENCES categoria (id_categoria)
) ENGINE=InnoDB;

CREATE TABLE marca (
    id_marca     INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nombre       VARCHAR(100) NOT NULL,
    logo         VARCHAR(255) NULL,
    pais_origen  VARCHAR(100) NULL,
    sitio_web    VARCHAR(255) NULL,
    PRIMARY KEY (id_marca),
    UNIQUE KEY uq_marca_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE producto (
    id_producto         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_categoria        INT UNSIGNED NOT NULL,                    -- clasifica
    id_marca            INT UNSIGNED NOT NULL,                    -- fabrica
    sku                 VARCHAR(50)  NOT NULL,
    nombre              VARCHAR(200) NOT NULL,
    descripcion         TEXT         NULL,
    precio_venta        DECIMAL(12,2) NOT NULL,
    costo               DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    porcentaje_iva      DECIMAL(5,2)  NOT NULL DEFAULT 15.00,
    garantia_meses      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    peso_kg             DECIMAL(8,3)  NULL,
    estado              ENUM('activo','inactivo','descontinuado') NOT NULL DEFAULT 'activo',
    destacado           TINYINT(1)   NOT NULL DEFAULT 0,
    fecha_creacion      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_producto),
    UNIQUE KEY uq_producto_sku (sku),
    CONSTRAINT fk_producto_categoria FOREIGN KEY (id_categoria) REFERENCES categoria (id_categoria),
    CONSTRAINT fk_producto_marca     FOREIGN KEY (id_marca)     REFERENCES marca (id_marca)
) ENGINE=InnoDB;

CREATE TABLE imagen_producto (
    id_imagen        INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_producto      INT UNSIGNED NOT NULL,                       -- muestra
    url              VARCHAR(255) NOT NULL,
    texto_alternativo VARCHAR(200) NULL,
    orden            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    es_principal     TINYINT(1)   NOT NULL DEFAULT 0,
    PRIMARY KEY (id_imagen),
    CONSTRAINT fk_imagen_producto FOREIGN KEY (id_producto) REFERENCES producto (id_producto)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE especificacion (
    id_especificacion INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_producto       INT UNSIGNED NOT NULL,                      -- detalla
    nombre            VARCHAR(100) NOT NULL,
    valor             VARCHAR(255) NOT NULL,
    unidad            VARCHAR(30)  NULL,
    PRIMARY KEY (id_especificacion),
    CONSTRAINT fk_especificacion_producto FOREIGN KEY (id_producto) REFERENCES producto (id_producto)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- Relacion 1:1 producto - inventario (posee)
CREATE TABLE inventario (
    id_inventario       INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_producto         INT UNSIGNED NOT NULL,
    stock_actual        INT NOT NULL DEFAULT 0,
    stock_reservado     INT NOT NULL DEFAULT 0,
    stock_minimo        INT NOT NULL DEFAULT 0,
    ubicacion_bodega    VARCHAR(100) NULL,
    fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_inventario),
    UNIQUE KEY uq_inventario_producto (id_producto),
    CONSTRAINT fk_inventario_producto FOREIGN KEY (id_producto) REFERENCES producto (id_producto)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE movimiento_inventario (
    id_movimiento    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_producto      INT UNSIGNED NOT NULL,                       -- registra
    id_usuario       INT UNSIGNED NOT NULL,                       -- autoriza
    tipo             ENUM('entrada','salida','ajuste') NOT NULL,
    cantidad         INT NOT NULL,
    motivo           VARCHAR(255) NULL,
    fecha_movimiento DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_movimiento),
    CONSTRAINT fk_movimiento_producto FOREIGN KEY (id_producto) REFERENCES producto (id_producto),
    CONSTRAINT fk_movimiento_usuario  FOREIGN KEY (id_usuario)  REFERENCES usuario (id_usuario)
) ENGINE=InnoDB;

CREATE TABLE proveedor (
    id_proveedor INT UNSIGNED NOT NULL AUTO_INCREMENT,
    razon_social VARCHAR(150) NOT NULL,
    ruc          VARCHAR(13)  NOT NULL,
    email        VARCHAR(150) NULL,
    telefono     VARCHAR(20)  NULL,
    direccion    VARCHAR(255) NULL,
    activo       TINYINT(1)   NOT NULL DEFAULT 1,
    PRIMARY KEY (id_proveedor),
    UNIQUE KEY uq_proveedor_ruc (ruc)
) ENGINE=InnoDB;

-- N:M suministra (costo_compra, plazo_entrega_dias)
CREATE TABLE producto_proveedor (
    id_producto         INT UNSIGNED NOT NULL,
    id_proveedor        INT UNSIGNED NOT NULL,
    costo_compra        DECIMAL(12,2) NOT NULL,
    plazo_entrega_dias  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id_producto, id_proveedor),
    CONSTRAINT fk_pp_producto  FOREIGN KEY (id_producto)  REFERENCES producto (id_producto)   ON DELETE CASCADE,
    CONSTRAINT fk_pp_proveedor FOREIGN KEY (id_proveedor) REFERENCES proveedor (id_proveedor) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- NUEVO: Orden de compra, recepcion de compra y kardex
-- ---------------------------------------------------------------------
CREATE TABLE orden_compra (
    id_orden_compra         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_proveedor            INT UNSIGNED NOT NULL,
    id_usuario              INT UNSIGNED NOT NULL,
    numero_orden            VARCHAR(30)  NOT NULL,
    fecha_emision           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_entrega_esperada  DATE         NULL,
    estado                  ENUM('borrador','enviada','recibida_parcial','recibida_total','cancelada') NOT NULL DEFAULT 'borrador',
    subtotal                DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    iva                     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total                   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    observaciones           VARCHAR(500) NULL,
    PRIMARY KEY (id_orden_compra),
    UNIQUE KEY uq_orden_compra_numero (numero_orden),
    CONSTRAINT fk_oc_proveedor FOREIGN KEY (id_proveedor) REFERENCES proveedor (id_proveedor),
    CONSTRAINT fk_oc_usuario   FOREIGN KEY (id_usuario)   REFERENCES usuario (id_usuario)
) ENGINE=InnoDB;

CREATE TABLE detalle_orden_compra (
    id_detalle_oc       INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_orden_compra     INT UNSIGNED NOT NULL,
    id_producto         INT UNSIGNED NOT NULL,
    cantidad_solicitada INT UNSIGNED NOT NULL,
    cantidad_recibida   INT UNSIGNED NOT NULL DEFAULT 0,
    costo_unitario      DECIMAL(12,2) NOT NULL,
    iva                 DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    subtotal            DECIMAL(12,2) NOT NULL,
    PRIMARY KEY (id_detalle_oc),
    UNIQUE KEY uq_doc_orden_producto (id_orden_compra, id_producto),
    CONSTRAINT fk_doc_orden    FOREIGN KEY (id_orden_compra) REFERENCES orden_compra (id_orden_compra) ON DELETE CASCADE,
    CONSTRAINT fk_doc_producto FOREIGN KEY (id_producto)     REFERENCES producto (id_producto)
) ENGINE=InnoDB;

CREATE TABLE recepcion_compra (
    id_recepcion            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_orden_compra         INT UNSIGNED NOT NULL,
    id_usuario              INT UNSIGNED NOT NULL,
    numero_recepcion        VARCHAR(30)  NOT NULL,
    fecha_recepcion         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    guia_remision_proveedor VARCHAR(50)  NULL,
    estado                  ENUM('pendiente','completada','anulada') NOT NULL DEFAULT 'pendiente',
    observaciones           VARCHAR(500) NULL,
    PRIMARY KEY (id_recepcion),
    UNIQUE KEY uq_recepcion_numero (numero_recepcion),
    CONSTRAINT fk_rc_orden   FOREIGN KEY (id_orden_compra) REFERENCES orden_compra (id_orden_compra),
    CONSTRAINT fk_rc_usuario FOREIGN KEY (id_usuario)      REFERENCES usuario (id_usuario)
) ENGINE=InnoDB;

CREATE TABLE detalle_recepcion (
    id_detalle_recepcion INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_recepcion         INT UNSIGNED NOT NULL,
    id_detalle_oc        INT UNSIGNED NOT NULL,
    cantidad_recibida    INT UNSIGNED NOT NULL DEFAULT 0,
    cantidad_rechazada   INT UNSIGNED NOT NULL DEFAULT 0,
    observaciones        VARCHAR(255) NULL,
    PRIMARY KEY (id_detalle_recepcion),
    UNIQUE KEY uq_dr_recepcion_detalle (id_recepcion, id_detalle_oc),
    CONSTRAINT fk_dr_recepcion FOREIGN KEY (id_recepcion)  REFERENCES recepcion_compra (id_recepcion) ON DELETE CASCADE,
    CONSTRAINT fk_dr_detalle   FOREIGN KEY (id_detalle_oc) REFERENCES detalle_orden_compra (id_detalle_oc)
) ENGINE=InnoDB;

-- cantidad > 0 entra mercaderia, cantidad < 0 sale mercaderia
CREATE TABLE kardex (
    id_kardex            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_producto          INT UNSIGNED NOT NULL,
    id_movimiento        INT UNSIGNED NULL,
    id_usuario           INT UNSIGNED NOT NULL,
    fecha_kardex         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tipo_documento       ENUM('inventario_inicial','recepcion_compra','venta','devolucion_cliente','devolucion_proveedor','ajuste_positivo','ajuste_negativo') NOT NULL,
    id_documento         INT UNSIGNED NULL,
    detalle              VARCHAR(255) NULL,
    cantidad             INT NOT NULL,
    costo_unitario       DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
    costo_total          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    saldo_cantidad       INT NOT NULL,
    saldo_costo_promedio DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
    saldo_valor          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    PRIMARY KEY (id_kardex),
    KEY idx_kardex_producto_fecha (id_producto, fecha_kardex),
    KEY idx_kardex_documento (tipo_documento, id_documento),
    CONSTRAINT fk_kardex_producto   FOREIGN KEY (id_producto)   REFERENCES producto (id_producto),
    CONSTRAINT fk_kardex_movimiento FOREIGN KEY (id_movimiento) REFERENCES movimiento_inventario (id_movimiento),
    CONSTRAINT fk_kardex_usuario    FOREIGN KEY (id_usuario)    REFERENCES usuario (id_usuario)
) ENGINE=InnoDB;

-- N:M guarda como favorito (fecha_agregado)
CREATE TABLE favorito (
    id_usuario     INT UNSIGNED NOT NULL,
    id_producto    INT UNSIGNED NOT NULL,
    fecha_agregado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_usuario, id_producto),
    CONSTRAINT fk_fav_usuario  FOREIGN KEY (id_usuario)  REFERENCES usuario (id_usuario)   ON DELETE CASCADE,
    CONSTRAINT fk_fav_producto FOREIGN KEY (id_producto) REFERENCES producto (id_producto) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE resena (
    id_resena         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_usuario        INT UNSIGNED NOT NULL,                      -- escribe
    id_producto       INT UNSIGNED NOT NULL,                      -- recibe
    calificacion      TINYINT UNSIGNED NOT NULL,
    titulo            VARCHAR(150) NULL,
    comentario        TEXT NULL,
    fecha_resena      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    compra_verificada TINYINT(1) NOT NULL DEFAULT 0,
    estado_moderacion ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
    PRIMARY KEY (id_resena),
    CONSTRAINT ck_resena_calificacion CHECK (calificacion BETWEEN 1 AND 5),
    CONSTRAINT fk_resena_usuario  FOREIGN KEY (id_usuario)  REFERENCES usuario (id_usuario)   ON DELETE CASCADE,
    CONSTRAINT fk_resena_producto FOREIGN KEY (id_producto) REFERENCES producto (id_producto) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Carrito
-- ---------------------------------------------------------------------
CREATE TABLE carrito (
    id_carrito          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_usuario          INT UNSIGNED NOT NULL,                    -- posee
    estado              ENUM('activo','convertido','abandonado') NOT NULL DEFAULT 'activo',
    fecha_creacion      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_carrito),
    CONSTRAINT fk_carrito_usuario FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE item_carrito (
    id_item         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_carrito      INT UNSIGNED NOT NULL,                        -- contiene
    id_producto     INT UNSIGNED NOT NULL,                        -- aparece en
    cantidad        INT UNSIGNED NOT NULL DEFAULT 1,
    precio_unitario DECIMAL(12,2) NOT NULL,
    fecha_agregado  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_item),
    UNIQUE KEY uq_item_carrito_producto (id_carrito, id_producto),
    CONSTRAINT fk_item_carrito  FOREIGN KEY (id_carrito)  REFERENCES carrito (id_carrito)   ON DELETE CASCADE,
    CONSTRAINT fk_item_producto FOREIGN KEY (id_producto) REFERENCES producto (id_producto)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------
CREATE TABLE cupon (
    id_cupon            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    codigo              VARCHAR(30)  NOT NULL,
    descripcion         VARCHAR(255) NULL,
    tipo_descuento      ENUM('porcentaje','monto_fijo') NOT NULL,
    valor_descuento     DECIMAL(12,2) NOT NULL,
    monto_minimo_compra DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    fecha_inicio        DATETIME NOT NULL,
    fecha_fin           DATETIME NOT NULL,
    usos_maximos        INT UNSIGNED NULL,
    usos_actuales       INT UNSIGNED NOT NULL DEFAULT 0,
    activo              TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (id_cupon),
    UNIQUE KEY uq_cupon_codigo (codigo)
) ENGINE=InnoDB;

CREATE TABLE pedido (
    id_pedido                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_usuario                 INT UNSIGNED NOT NULL,             -- realiza
    id_direccion_envio         INT UNSIGNED NOT NULL,             -- recibe
    id_direccion_facturacion   INT UNSIGNED NOT NULL,             -- factura a
    id_cupon                   INT UNSIGNED NULL,                 -- descuenta (0,1)
    numero_pedido              VARCHAR(30) NOT NULL,
    fecha_pedido               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado                     ENUM('pendiente','pagado','preparando','enviado','entregado','cancelado','devuelto') NOT NULL DEFAULT 'pendiente',
    subtotal                   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    descuento                  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    iva                        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    costo_envio                DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total                      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    observaciones              VARCHAR(500) NULL,
    PRIMARY KEY (id_pedido),
    UNIQUE KEY uq_pedido_numero (numero_pedido),
    CONSTRAINT fk_pedido_usuario     FOREIGN KEY (id_usuario)               REFERENCES usuario (id_usuario),
    CONSTRAINT fk_pedido_dir_envio   FOREIGN KEY (id_direccion_envio)       REFERENCES direccion (id_direccion),
    CONSTRAINT fk_pedido_dir_factura FOREIGN KEY (id_direccion_facturacion) REFERENCES direccion (id_direccion),
    CONSTRAINT fk_pedido_cupon       FOREIGN KEY (id_cupon)                 REFERENCES cupon (id_cupon)
) ENGINE=InnoDB;

CREATE TABLE detalle_pedido (
    id_detalle      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_pedido       INT UNSIGNED NOT NULL,                        -- incluye (1,n)
    id_producto     INT UNSIGNED NOT NULL,                        -- se vende en
    cantidad        INT UNSIGNED NOT NULL,
    precio_unitario DECIMAL(12,2) NOT NULL,
    descuento       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    iva             DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    subtotal        DECIMAL(12,2) NOT NULL,
    PRIMARY KEY (id_detalle),
    CONSTRAINT fk_detalle_pedido   FOREIGN KEY (id_pedido)   REFERENCES pedido (id_pedido) ON DELETE CASCADE,
    CONSTRAINT fk_detalle_producto FOREIGN KEY (id_producto) REFERENCES producto (id_producto)
) ENGINE=InnoDB;

CREATE TABLE historial_estado_pedido (
    id_historial INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_pedido    INT UNSIGNED NOT NULL,                           -- cambia de
    estado       VARCHAR(30)  NOT NULL,
    comentario   VARCHAR(255) NULL,
    fecha_cambio DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_historial),
    CONSTRAINT fk_historial_pedido FOREIGN KEY (id_pedido) REFERENCES pedido (id_pedido) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Pagos y facturacion
-- ---------------------------------------------------------------------
CREATE TABLE metodo_pago (
    id_metodo_pago INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nombre         VARCHAR(100) NOT NULL,
    tipo           VARCHAR(50)  NOT NULL,
    activo         TINYINT(1)   NOT NULL DEFAULT 1,
    PRIMARY KEY (id_metodo_pago)
) ENGINE=InnoDB;

CREATE TABLE pago (
    id_pago                INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_pedido              INT UNSIGNED NOT NULL,                 -- recibe
    id_metodo_pago         INT UNSIGNED NOT NULL,                 -- se cobra con / procesa
    monto                  DECIMAL(12,2) NOT NULL,
    moneda                 CHAR(3) NOT NULL DEFAULT 'USD',
    estado                 ENUM('pendiente','aprobado','rechazado','reembolsado') NOT NULL DEFAULT 'pendiente',
    referencia_transaccion VARCHAR(100) NULL,
    fecha_pago             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_pago),
    CONSTRAINT fk_pago_pedido FOREIGN KEY (id_pedido)      REFERENCES pedido (id_pedido),
    CONSTRAINT fk_pago_metodo FOREIGN KEY (id_metodo_pago) REFERENCES metodo_pago (id_metodo_pago)
) ENGINE=InnoDB;

-- Relacion 1:1 (1,1)-(0,1) pedido genera factura
CREATE TABLE factura (
    id_factura             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_pedido              INT UNSIGNED NOT NULL,                 -- genera
    numero_factura         VARCHAR(20) NOT NULL,
    clave_acceso           VARCHAR(49) NOT NULL,
    fecha_emision          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    identificacion_cliente VARCHAR(20)  NOT NULL,
    razon_social_cliente   VARCHAR(200) NOT NULL,
    subtotal               DECIMAL(12,2) NOT NULL,
    iva                    DECIMAL(12,2) NOT NULL,
    total                  DECIMAL(12,2) NOT NULL,
    estado                 ENUM('emitida','anulada') NOT NULL DEFAULT 'emitida',
    PRIMARY KEY (id_factura),
    UNIQUE KEY uq_factura_pedido (id_pedido),
    UNIQUE KEY uq_factura_numero (numero_factura),
    UNIQUE KEY uq_factura_clave (clave_acceso),
    CONSTRAINT fk_factura_pedido FOREIGN KEY (id_pedido) REFERENCES pedido (id_pedido)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Envios y devoluciones
-- ---------------------------------------------------------------------
CREATE TABLE metodo_envio (
    id_metodo_envio INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nombre          VARCHAR(100) NOT NULL,
    costo_base      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    dias_estimados  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    activo          TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (id_metodo_envio)
) ENGINE=InnoDB;

CREATE TABLE transportista (
    id_transportista INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nombre           VARCHAR(100) NOT NULL,
    telefono         VARCHAR(20)  NULL,
    sitio_web        VARCHAR(255) NULL,
    activo           TINYINT(1)   NOT NULL DEFAULT 1,
    PRIMARY KEY (id_transportista)
) ENGINE=InnoDB;

CREATE TABLE envio (
    id_envio               INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_pedido              INT UNSIGNED NOT NULL,                 -- despacha
    id_metodo_envio        INT UNSIGNED NOT NULL,                 -- define
    id_transportista       INT UNSIGNED NOT NULL,                 -- entrega
    numero_guia            VARCHAR(50) NULL,
    estado                 ENUM('preparando','despachado','en_transito','entregado','fallido') NOT NULL DEFAULT 'preparando',
    costo                  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    fecha_despacho         DATETIME NULL,
    fecha_entrega_estimada DATE NULL,
    fecha_entrega          DATETIME NULL,
    PRIMARY KEY (id_envio),
    CONSTRAINT fk_envio_pedido        FOREIGN KEY (id_pedido)        REFERENCES pedido (id_pedido),
    CONSTRAINT fk_envio_metodo        FOREIGN KEY (id_metodo_envio)  REFERENCES metodo_envio (id_metodo_envio),
    CONSTRAINT fk_envio_transportista FOREIGN KEY (id_transportista) REFERENCES transportista (id_transportista)
) ENGINE=InnoDB;

CREATE TABLE devolucion (
    id_devolucion    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_detalle       INT UNSIGNED NOT NULL,                       -- origina
    motivo           VARCHAR(255) NOT NULL,
    descripcion      TEXT NULL,
    cantidad         INT UNSIGNED NOT NULL DEFAULT 1,
    estado           ENUM('solicitada','aprobada','rechazada','completada') NOT NULL DEFAULT 'solicitada',
    monto_reembolso  DECIMAL(12,2) NULL,
    fecha_solicitud  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_resolucion DATETIME NULL,
    PRIMARY KEY (id_devolucion),
    CONSTRAINT fk_devolucion_detalle FOREIGN KEY (id_detalle) REFERENCES detalle_pedido (id_detalle)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;
```
