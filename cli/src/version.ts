import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Read at runtime so the built dist/ and the source tree agree with package.json.
export const VERSION: string = (require("../package.json") as { version: string }).version;
