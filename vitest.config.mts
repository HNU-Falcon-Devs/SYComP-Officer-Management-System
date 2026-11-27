import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    test: {
        environment: "node",
        setupFiles: ["./src/test/vitest-setup.ts"],
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        fileParallelism: false,
        passWithNoTests: false,
    },
});
