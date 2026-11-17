import { prisma } from "../src/models/prisma.client.js";
import { readFile } from "node:fs/promises";

try {
  const ddl = await readFile(
    new URL("../../database/techstore_pro.sql", import.meta.url),
    "utf8",
  );
  const expected = [...ddl.matchAll(/^CREATE TABLE (\w+)/gm)].map(
    (match) => match[1],
  );
  const [database] = await prisma.$queryRaw`SELECT DATABASE() AS nombre`;
  if (database.nombre !== "techstore_pro") throw new Error("BASE_INCORRECTA");
  const tables = await prisma.$queryRaw`
    SELECT TABLE_NAME AS nombre FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`;
  const missing = expected.filter(
    (name) => !tables.some((row) => row.nombre === name),
  );
  if (missing.length) throw new Error("Faltan tablas: " + missing.join(", "));
  console.log(
    "Conexión verificada. Tablas del modelo presentes:",
    expected.length,
  );
} catch (error) {
  console.error(
    "Error de verificación:",
    error.code ||
      error.errorCode ||
      (error.message.startsWith("Faltan tablas:")
        ? error.message
        : "Verifica DATABASE_URL y los permisos de acceso."),
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
