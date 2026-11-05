import type { TestProject } from "vitest/node";
import { startDatabaseServer } from "./database";

/** Un seul serveur Postgres pour tous les fichiers de tests : chacun y prend sa propre base. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const server = await startDatabaseServer();
  project.provide("pgPort", server.port);
  return server.stop;
}

declare module "vitest" {
  export interface ProvidedContext {
    pgPort: number;
  }
}
