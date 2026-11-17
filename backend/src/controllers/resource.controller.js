import { Prisma } from "@prisma/client";
function serialize(value) {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (typeof value === "bigint")
    return value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : String(value);
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object" && !(value instanceof Date))
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serialize(v)]),
    );
  return value;
}
export function controller(service, status) {
  return async (req, res, next) => {
    try {
      const result = await service(req.input);
      if (status === 204) return res.status(status).end();
      res
        .status(status)
        .json(
          serialize(
            result?.meta
              ? { success: true, ...result }
              : { success: true, data: result },
          ),
        );
    } catch (error) {
      next(error);
    }
  };
}
