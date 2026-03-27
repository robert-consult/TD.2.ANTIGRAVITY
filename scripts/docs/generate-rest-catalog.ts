export { buildRestCatalog, generateRestCatalog } from "./generators/rest/index";

if (import.meta.url === `file://${process.argv[1]}`) {
  const { generateRestCatalog } = await import("./generators/rest/index");
  await generateRestCatalog();
}
