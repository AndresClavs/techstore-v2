import { z } from "zod";
export const id = z.coerce.number().int().positive().max(4294967295);
export const str = (n) => z.string().trim().min(1).max(n);
export const money = z.number().finite().nonnegative().max(9999999999.99);
export const failure = (status, message) =>
  Object.assign(new Error(message), { status });
export const roles = {
  client: ["Cliente", "Administrador"],
  sales: ["Vendedor", "Administrador"],
  warehouse: ["Bodeguero", "Administrador"],
  admin: ["Administrador"],
};
export const safeUser = {
  id_usuario: true,
  id_rol: true,
  nombres: true,
  apellidos: true,
  email: true,
  telefono: true,
  identificacion: true,
  fecha_nacimiento: true,
  estado: true,
  rol: { select: { nombre: true } },
};
export function page(query) {
  const pagina = id.parse(query.pagina ?? 1),
    limite = id.max(100).parse(query.limite ?? 12);
  return { pagina, limite, skip: (pagina - 1) * limite, take: limite };
}
export async function list(model, query, options = {}) {
  const { pagina, limite, skip, take } = page(query);
  const [data, total] = await Promise.all([
    model.findMany({ ...options, skip, take }),
    model.count({ where: options.where }),
  ]);
  return {
    data,
    meta: { pagina, limite, total, totalPaginas: Math.ceil(total / limite) },
  };
}
