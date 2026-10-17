import { db } from "../db/client.ts";
import { client } from "../db/schema.ts";
import { validateClientOwnedDeployment } from "./deploymentScope.ts";

/** A production process may only attach to a database provisioned for one client. */
export async function assertClientOwnedDeployment(): Promise<void> {
  const rows = await db.select({ id: client.id, slug: client.slug }).from(client).limit(2);
  validateClientOwnedDeployment(process.env, rows);
}
