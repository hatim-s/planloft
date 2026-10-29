import { defineConfig } from "tsup";

export default defineConfig({
  banner: {
    js: "import { createRequire as __planloftCreateRequire } from 'node:module'; const require = __planloftCreateRequire(import.meta.url);",
  },
  noExternal: [
    "commander",
    "gray-matter",
    "marked",
    "nanoid",
    "picocolors",
  ],
});
