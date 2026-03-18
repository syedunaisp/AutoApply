// Drizzle ORM + D1 connection helper

import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@autoapply/db'

/**
 * Create a Drizzle ORM client bound to a D1 database.
 * Each Worker invocation opens a fresh connection (D1 has no connection pooling).
 */
export function createDbClient(d1: D1Database) {
  return drizzle(d1, { schema })
}

export type DbClient = ReturnType<typeof createDbClient>
