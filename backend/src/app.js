import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import xss from "xss";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { router } from "./routes/index.js";
import { handleError, failure } from "./middleware/http.js";
import { prisma } from "./models/prisma.client.js";

export const app = express();
app.disable("x-powered-by");
if (process.env.RENDER) app.set("trust proxy", 1);
app.set("json replacer", (key, value) =>
  typeof value === "bigint" ? value.toString() : value,
);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        imgSrc: ["'self'", "https:", "data:"],
        upgradeInsecureRequests:
          process.env.NODE_ENV === "production" ? [] : null,
      },
    },
  }),
);
app.use(cors({ origin: process.env.FRONTEND_URL || false }));
const limit = (max) =>
  rateLimit({
    windowMs: 15 * 60000,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { codigo: "LIMITE", mensaje: "Demasiadas solicitudes" },
    },
  });
app.use("/api", limit(1200));
app.use("/api/auth/login", limit(80));
app.use("/api/auth/registro", limit(80));
app.use(morgan(":method :url :status :response-time ms"));
app.use(express.json({ limit: "1mb" }));
function clean(value, key) {
  if (typeof value === "string")
    return key === "password"
      ? value
      : xss(value.trim(), { whiteList: {}, stripIgnoreTag: true });
  if (Array.isArray(value)) return value.map((v) => clean(v, key));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, clean(v, k)]),
    );
  return value;
}
app.use((req, res, next) => {
  req.body = clean(req.body);
  next();
});
app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { status: "ok" } });
  } catch {
    res.status(503).json({
      success: false,
      error: {
        codigo: "BD_NO_DISPONIBLE",
        mensaje: "Base de datos no disponible",
      },
    });
  }
});
app.use("/api", router);
const root = fileURLToPath(new URL("../../", import.meta.url));
for (const folder of ["assets", "js"])
  app.use("/" + folder, express.static(resolve(root, folder)));
for (const page of ["index", "carrito", "cuenta", "gestion"])
  app.get("/" + page + ".html", (req, res) =>
    res.sendFile(resolve(root, page + ".html")),
  );
app.get("/", (req, res) => res.sendFile(resolve(root, "index.html")));
app.use((req, res, next) => next(failure(404, "Ruta inexistente")));
app.use(handleError);
