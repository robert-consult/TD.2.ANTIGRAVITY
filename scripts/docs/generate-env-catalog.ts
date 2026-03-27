export { buildEnvCatalog, generateEnvCatalog } from "./generators/env/index";

if (import.meta.url === `file://${process.argv[1]}`) {
  const { generateEnvCatalog } = await import("./generators/env/index");
  await generateEnvCatalog();
}
