//Server Side\src\signalwire\signalwire.database.ts
import { QueryResult, QueryResultRow } from "pg";
import { Logger } from "../shared/logger";

/**
 * Executes a SQL query against the global.signalWirePool.
 * @param text - The SQL query string.
 * @param params - Query parameters, if any.
 */
export async function query(text: string, params?: any[]): Promise<any> {
  // Make sure the global pool is defined
  if (!global.signalWirePool) {
    throw new Error("SignalWire pool not initialized. Check your app setup.");
  }

  const start = Date.now();
  try {
    const res = await global.signalWirePool.query(text, params);
    const duration = Date.now() - start;
    Logger.info(`Executed query in ${duration}ms`);
    return res;
  } catch (err) {
    if (err instanceof Error) {
      Logger.error(`Error executing query: ${err.message}`);
    } else {
      Logger.error("Unknown error occurred during query execution");
    }
    throw err; // Rethrow for proper handling
  }
}
