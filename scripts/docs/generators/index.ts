import { generateEnvCatalog } from "./env/index";
import { generateRepositoryInventory } from "./repository/index";
import { generateRestCatalog } from "./rest/index";
import { generateRuntimeInventory } from "./runtime/index";
import { generateWsCatalog } from "./ws/index";

export type DocsGeneratorTask = {
  id: string;
  description: string;
  run: () => Promise<void>;
};

export const DOCS_GENERATOR_TASKS: DocsGeneratorTask[] = [
  {
    id: "rest-catalog",
    description: "Build the REST API catalog from live route sources.",
    run: generateRestCatalog,
  },
  {
    id: "ws-catalog",
    description: "Build the WebSocket catalog from the canonical protocol sources.",
    run: generateWsCatalog,
  },
  {
    id: "env-catalog",
    description: "Build the environment catalog from .env and source references.",
    run: generateEnvCatalog,
  },
  {
    id: "runtime-inventory",
    description: "Build runtime and agent-guidance inventories.",
    run: generateRuntimeInventory,
  },
  {
    id: "repository-inventory",
    description: "Build the whole-repo inventory and source-doc index.",
    run: generateRepositoryInventory,
  },
];

export async function runAllDocsGenerators(): Promise<void> {
  for (const task of DOCS_GENERATOR_TASKS) {
    await task.run();
  }
}
