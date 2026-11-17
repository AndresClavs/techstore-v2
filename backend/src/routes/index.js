import express from "express";
import { authRoutes } from "./auth.routes.js";
import { catalogRoutes } from "./catalogo.routes.js";
import { salesRoutes } from "./ventas.routes.js";
import { warehouseRoutes } from "./bodega.routes.js";
import { postventaRoutes } from "./postventa.routes.js";
export const router = express.Router();
for (const register of [
  authRoutes,
  catalogRoutes,
  salesRoutes,
  warehouseRoutes,
  postventaRoutes,
])
  register(router);
