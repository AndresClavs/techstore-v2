import "dotenv/config";
import { z } from "zod";
if (!process.env.DATABASE_URL && process.env.DB_USER) {
  const {
    DB_USER,
    DB_PASSWORD = "",
    DB_HOST = "localhost",
    DB_PORT = "3306",
    DB_NAME = "techstore_pro",
  } = process.env;
  process.env.DATABASE_URL =
    "mysql://" +
    encodeURIComponent(DB_USER) +
    ":" +
    encodeURIComponent(DB_PASSWORD) +
    "@" +
    DB_HOST +
    ":" +
    DB_PORT +
    "/" +
    DB_NAME;
}
export const env = z
  .object({
    DATABASE_URL: z.string().startsWith("mysql://"),
    JWT_SECRET: z.string().min(32),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  })
  .parse(process.env);
