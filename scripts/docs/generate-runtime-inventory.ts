export {
  buildAgentGuidanceCatalog,
  buildRuntimeInventory,
  generateRuntimeInventory,
} from "./generators/runtime/index";

if (import.meta.url === `file://${process.argv[1]}`) {
  const { generateRuntimeInventory } = await import("./generators/runtime/index");
  await generateRuntimeInventory();
}
