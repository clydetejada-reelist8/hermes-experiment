import { Prisma, PrismaClient } from "./generated/client/index.js";

/**
 * Shared Prisma client singleton for the Hermes Knowledge Control Plane.
 *
 * The generated client lives under `src/generated/client` (gitignored) and is
 * produced by `prisma generate` (run automatically on postinstall).
 */
export const db = new PrismaClient();
export { Prisma };
export { PrismaClient } from "./generated/client/index.js";
export type { Prisma as PrismaTypes } from "./generated/client/index.js";
