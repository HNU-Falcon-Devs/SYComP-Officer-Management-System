import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/config/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbExecutor = Database | DbTransaction;

export interface DbConnection {
    db: Database;
    client: postgres.Sql;
}

export function createDb(connectionUrl: string, options?: { max?: number }): DbConnection {
    // prepare: false prevents prepared-statement collisions behind Supavisor transaction pooler
    const client = postgres(connectionUrl, {
        prepare: false,
        max: options?.max ?? 5,
    });
    const db = drizzle(client, { schema });
    return { db, client };
}

const globalForDb = globalThis as unknown as {
    __sycompDbConnection?: DbConnection;
};

export function getDb(): Database {
    if (!globalForDb.__sycompDbConnection) {
        const connection = createDb(getEnv().DATABASE_URL);
        globalForDb.__sycompDbConnection = connection;
    }

    return globalForDb.__sycompDbConnection.db;
}
