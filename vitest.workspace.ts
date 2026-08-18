import { defineWorkspace } from "vitest/config";
import { fileURLToPath } from "node:url";

const alias: Record<string, string> = {
  "@hermes/config": fileURLToPath(new URL("./packages/config/src/index.ts", import.meta.url)),
  "@hermes/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
  "@hermes/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
  "@hermes/identity": fileURLToPath(new URL("./packages/identity/src/index.ts", import.meta.url)),
  "@hermes/google": fileURLToPath(new URL("./packages/google/src/index.ts", import.meta.url)),
  "@hermes/policy": fileURLToPath(new URL("./packages/policy/src/index.ts", import.meta.url)),
  "@hermes/knowledge": fileURLToPath(new URL("./packages/knowledge/src/index.ts", import.meta.url)),
  "@hermes/memory": fileURLToPath(new URL("./packages/memory/src/index.ts", import.meta.url)),
  "@hermes/ssot": fileURLToPath(new URL("./packages/ssot/src/index.ts", import.meta.url)),
  "@hermes/actions": fileURLToPath(new URL("./packages/actions/src/index.ts", import.meta.url)),
  "@hermes/llm": fileURLToPath(new URL("./packages/llm/src/index.ts", import.meta.url)),
  "@hermes/audit": fileURLToPath(new URL("./packages/audit/src/index.ts", import.meta.url)),
  "@hermes/observability": fileURLToPath(
    new URL("./packages/observability/src/index.ts", import.meta.url),
  ),
};

const shared = { resolve: { alias } };

export default defineWorkspace([
  {
    ...shared,
    test: {
      name: "unit",
      include: ["packages/**/src/**/*.test.ts", "apps/**/test/**/*.test.ts"],
      environment: "node",
      setupFiles: ["test/setup.ts"],
    },
  },
  {
    ...shared,
    test: {
      name: "integration",
      include: ["test/integration/**/*.test.ts", "test/security/**/*.test.ts"],
      environment: "node",
      setupFiles: ["test/setup.ts"],
    },
  },
]);
