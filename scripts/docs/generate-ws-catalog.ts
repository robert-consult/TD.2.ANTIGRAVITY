export { buildWsCatalog, generateWsCatalog } from "./generators/ws/index";

if (import.meta.url === `file://${process.argv[1]}`) {
  const { generateWsCatalog } = await import("./generators/ws/index");
  await generateWsCatalog();
}
