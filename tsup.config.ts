import { defineConfig } from "tsup";

export default defineConfig({
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  noExternal: [
    "commander",
    "gray-matter",
    "marked",
    "nanoid",
    "picocolors",
  ],
});
