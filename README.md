# TechStore Pro

Tienda y panel administrativo en español. Express 4 sirve las páginas y la API en el mismo origen. Prisma 6 usa las 32 tablas existentes de MariaDB y el frontend conserva el HTML y los estilos del catálogo original.

## Ejecutar localmente

Requiere Node.js 20 o superior, npm y MySQL/MariaDB con el esquema `techstore_pro`. Desde la raíz:

```powershell
cd backend
npm.cmd ci
# Solo en una instalación nueva:
Copy-Item .env.example .env
```

Configura `DATABASE_URL` con tus credenciales y `JWT_SECRET` con un secreto aleatorio de al menos 32 caracteres. Configura `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `DEMO_USERS_PASSWORD` antes de sembrar los usuarios. La semilla conserva las cuentas existentes. Para conectarse mediante variables individuales, omite `DATABASE_URL` y configura `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`.

```powershell
npm.cmd run prisma:pull
npm.cmd run prisma:generate
npm.cmd run db:check
npm.cmd run seed
npm.cmd start
```

Abre [la tienda](http://localhost:3000/), [Mi cuenta](http://localhost:3000/cuenta.html) o [Gestión](http://localhost:3000/gestion.html). El usuario administrativo local es `admin@techstore.local`. Su contraseña se encuentra en `backend/.env` bajo `ADMIN_PASSWORD`. Las cuentas `bodeguero@techstore.local`, `vendedor@techstore.local` y `cliente@techstore.local` usan `DEMO_USERS_PASSWORD`. El registro público asigna el rol Cliente.

## Pantallas y API

| Pantalla | Operaciones principales |
|---|---|
| Catálogo y detalle | Productos, búsqueda por categoría/marca/precio, galería, especificaciones, favoritos, reseñas y carrito |
| Carrito | Cantidades, precios vigentes, IVA, cupón, dirección de envío/facturación, entrega y pago simulado |
| Mi cuenta | Registro, sesión, perfil, direcciones, favoritos, pedidos, pagos, facturas y devoluciones |
| Gestión comercial | Productos, categorías, marcas, cupones, pedidos, pagos, envíos, transportistas y moderación |
| Gestión de bodega | Inventario, kardex, ajustes, proveedores, órdenes, recepciones y anulaciones |
| Administración | Indicadores, usuarios, roles y los módulos de venta y bodega |

Los grupos de rutas se encuentran en `backend/src/routes`. El contrato detallado de métodos, campos y permisos está en la sección 7 de `IMPLEMENTACION_Y_DESPLIEGUE_TechStore_Pro.md`. Las respuestas de lista paginada incluyen `data` y `meta`. Los errores tienen `error.codigo` y `error.mensaje`. La autenticación usa `Authorization: Bearer <token>`.

## Comprobaciones

Desde `backend`, con el servidor en marcha y los datos iniciales cargados:

```powershell
npm.cmd run smoke
npm.cmd run test:browser
```

Las pruebas de API crean registros identificados como pruebas, contabilizan sus movimientos e inactivan el producto y proveedor creados al finalizar. El historial permanece en la base utilizada. Usa una base de desarrollo. La prueba visual usa Chrome o Edge local y requiere una cuenta administrativa con la contraseña configurada. Define `BASE_URL` para probar otro puerto y `BROWSER_PATH` para elegir el ejecutable del navegador.

## Decisiones de integración

- Las páginas existentes siguen en la raíz. Express publica las cuatro páginas, los módulos JS y los recursos visuales. Los archivos de configuración y SQL quedan fuera de las rutas estáticas.
- La API toma precios, impuestos y existencias de MariaDB. El JSON histórico se utiliza únicamente al sembrar productos de muestra.
- El checkout reserva inventario. Un pago aprobado registra la salida física, el movimiento y el kardex en una sola transacción. Los pagos con tarjeta y la factura son simulados. Las transferencias y el efectivo requieren aprobación administrativa.
- El método de envío elegido se conserva en el primer evento del historial del pedido, según el contrato del proyecto. Las cantidades y valores de salida llevan signo negativo.
- El SQL local completo incluye `DROP DATABASE`. Se usa solo para inicializar desde cero. En una instalación existente usa la introspección y la verificación.
## Despliegue actual (gratuito)

- Tienda: https://techstore-app-jb38.onrender.com (servicio web Render, plan free; tras unos 15 minutos sin uso tarda ~50 s en despertar).
- Base de datos: MySQL 8.4 en Aiven (plan Developer-1 con créditos de prueba, sin tarjeta). La prueba de Aiven dura 30 días; al terminar el servicio se apaga si no se agrega un método de pago o se migra a otro MySQL.
- `render.yaml` despliega solo el servicio web y recibe `DATABASE_URL` (con `sslaccept=accept_invalid_certs`, porque el CA de Aiven no es público). La variante con MySQL privado de pago está en `deploy/render.paid.yaml`.
- El esquema se cargó con `database/techstore_pro.deploy.sql` y los datos demo con `npm run seed` desde el equipo local (`AUTO_SEED=false` en Render). `TX_TIMEOUT_MS` amplía el tiempo de las transacciones con bases remotas.
- Las credenciales del entorno publicado están en `backend/.env.render` (excluido de git).

## Despliegue en Render (variante de pago)

1. Abre el panel de Render y elige **New → Blueprint**. Conecta GitHub, autoriza el repositorio público `AndresClavs/techstore-v2` y selecciona la rama `main`.
2. Revisa los recursos de pago que propone `render.yaml`: un servicio web Node, un MySQL privado y un disco persistente de 10 GB. Introduce contraseñas nuevas para `ADMIN_PASSWORD` y `DEMO_USERS_PASSWORD` en el panel. Render genera las claves de MySQL y JWT. Confirma la creación cuando aceptes el importe mostrado.
3. El primer arranque de MySQL 8.4 crea las tablas en el disco vacío. El servicio web instala dependencias, genera Prisma Client para Linux y carga el catálogo inicial. La base de Render empieza con datos de muestra. Los pedidos y clientes locales permanecen en MariaDB local.
4. Espera a que ambos servicios indiquen **Live** y usa la URL real del servicio web. Comprueba `/api/health`, abre el catálogo e inicia sesión en `/cuenta.html`. En el primer despliegue, antes de recibir clientes, ejecuta desde `backend` las pruebas con `BASE_URL` y las credenciales **del entorno remoto**. Las pruebas de humo registran pedidos y movimientos de prueba.
5. Tras verificar el primer arranque puedes cambiar `AUTO_SEED` a `false` en el Blueprint. El frontend se sirve desde la raíz del repositorio. El proceso usa el puerto asignado por Render y consulta MySQL para responder al chequeo de salud.

### Respaldos

Desde el Shell del servicio privado de MySQL, ejecuta periódicamente el siguiente respaldo lógico y guarda una copia cifrada fuera del servicio. Introduce la contraseña del usuario de aplicación cuando el cliente la solicite. Usa una instancia de prueba para verificar la restauración antes de utilizar una copia en producción.

```sh
mysqldump -u "$MYSQL_USER" -p --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE" > "/tmp/techstore-$(date +%F).sql"
```

Para recuperar datos, importa un respaldo lógico con el cliente MySQL. Render desaconseja restaurar MySQL mediante un snapshot del disco por el riesgo de corrupción. [Guía de MySQL en Render](https://render.com/docs/deploy-mysql).

GitHub Pages publica las cuatro vistas mediante Actions. Configura la variable de repositorio RENDER_API_ORIGIN con el origen HTTPS real del servicio web de Render y vuelve a ejecutar Publicar tienda para conectar el catálogo.
