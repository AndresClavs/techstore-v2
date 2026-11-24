import "dotenv/config";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const binary =
  process.env.BROWSER_PATH ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);
const browser = await chromium.launch({
  executablePath: binary,
  headless: true,
});
try {
  const page = await browser.newPage({
    baseURL: process.env.BASE_URL || "http://localhost:3000",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator(".producto-card").first().waitFor();
  await page
    .getByRole("button", { name: "Detalles", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.goto("/cuenta.html");
  const login = page.locator("form").first();
  await login.getByLabel("Correo").fill(process.env.ADMIN_EMAIL);
  await login.getByLabel("Contraseña").fill(process.env.ADMIN_PASSWORD);
  await login.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("link", { name: "Abrir gestión de tienda" }).click();
  await page.getByText("Resumen de la tienda").waitFor();
  for (const label of [
    "productos",
    "inventario",
    "ordenes compra",
    "recepciones",
    "usuarios",
  ]) {
    await page
      .locator("#modules")
      .getByRole("button", { name: label, exact: true })
      .click();
    await page.locator("#workspace h2").filter({ hasText: label }).waitFor();
  }
  await page
    .locator("#modules")
    .getByRole("button", { name: "bases distribuidas", exact: true })
    .click();
  await page
    .locator("#workspace h2")
    .filter({ hasText: "Bases de datos distribuidas" })
    .waitFor();
  await page.getByText("Quito", { exact: true }).waitFor();
  await page.getByText("Guayaquil", { exact: true }).waitFor();
  await page.getByText("Cuenca", { exact: true }).waitFor();
  await page.getByText("informativo").waitFor();
  await page.goto("/");
  await page
    .locator(".producto-card")
    .first()
    .getByRole("button", { name: "Añadir", exact: true })
    .click();
  await page.locator("#resumen").filter({ hasText: "añadido" }).waitFor();
  await page.goto("/carrito.html");
  await page.locator("#lista-carrito li").first().waitFor();
  await page
    .locator("#lista-carrito li")
    .first()
    .getByRole("button", { name: "−", exact: true })
    .click();
  assert.deepEqual(errors, []);
  console.log(
    "Navegador: catálogo, detalles, sesión, panel de gestión y carrito verificados.",
  );
} finally {
  await browser.close();
}
