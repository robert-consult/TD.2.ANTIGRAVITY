import { validateDocs } from "./validators/index";

if (import.meta.url === `file://${process.argv[1]}`) {
  await validateDocs();
}
