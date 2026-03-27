export {
  buildRepositoryInventory,
  generateRepositoryInventory,
} from "./generators/repository/index";

if (import.meta.url === `file://${process.argv[1]}`) {
  const { generateRepositoryInventory } = await import("./generators/repository/index");
  await generateRepositoryInventory();
}
