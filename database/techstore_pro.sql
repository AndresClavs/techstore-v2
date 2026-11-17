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
