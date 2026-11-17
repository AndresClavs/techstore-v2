import { app } from "./app.js";
import { prisma } from "./models/prisma.client.js";

try {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await prisma.$connect();
      break;
    } catch (error) {
      if (attempt === 10 || error.errorCode !== "P1001") throw error;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  if (process.env.AUTO_SEED === "true") {
    const { runSeed } = await import("../prisma/seed.js");
    await runSeed();
  }
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, "0.0.0.0", () =>
    console.log("API disponible en el puerto", port),
  );
  const shutdown = () =>
    server.close(async () => {
      await prisma.$disconnect();
    });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch {
  console.error(
    "No se pudo iniciar la API. Revisa la conexión configurada en DATABASE_URL.",
  );
  await prisma.$disconnect();
  process.exitCode = 1;
}

