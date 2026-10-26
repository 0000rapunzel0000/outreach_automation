import { Prisma, PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { __prisma?: PrismaClient };

export const db = g.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.__prisma = db;

export type Tx = Prisma.TransactionClient;
export type DbOrTx = PrismaClient | Tx;
