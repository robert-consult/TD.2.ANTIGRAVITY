import { DOCS_GENERATOR_TASKS, runAllDocsGenerators } from "./generators/index";

export async function generateDocs(): Promise<void> {
  await runAllDocsGenerators();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await generateDocs();
  console.log(`Generated ${DOCS_GENERATOR_TASKS.length} documentation task(s).`);
}
