import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client for the NodeByte Crawl app.
 * Used for persistent job storage (crawl/batch jobs survive restarts).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
