export { validateDocs } from "./validators/index";

if (import.meta.url === `file://${process.argv[1]}`) {
  const { validateDocs } = await import("./validators/index");
  await validateDocs();
}
