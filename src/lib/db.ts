import { PrismaNeon } from '@prisma/adapter-neon'
import { Pool } from '@neondatabase/serverless'
import { PrismaClient } from '@prisma/client'

export function createPrismaClient(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl })
  const adapter = new PrismaNeon(pool)
  // @ts-ignore - PrismaClient with adapter works at runtime
  return new PrismaClient({ adapter })
}

export type Database = ReturnType<typeof createPrismaClient>
