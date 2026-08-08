import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [
    {
      // Vite's bundled list of Node builtins predates node:sqlite, so without
      // this it tries to resolve the specifier as a source file.
      name: 'externalize-node-sqlite',
      enforce: 'pre',
      resolveId(id) {
        return id === 'node:sqlite' || id === 'sqlite'
          ? { id: 'node:sqlite', external: true }
          : null;
      },
    },
  ],
  resolve: {
    alias: {
      '@attest/core': src('core'),
      '@attest/blueprint': src('blueprint'),
      '@attest/cardano': src('cardano'),
      '@attest/keri': src('keri'),
      '@attest/verifier': src('verifier'),
    },
  },
  ssr: {
    external: ['node:sqlite'],
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    server: {
      deps: {
        external: [/node:sqlite/],
      },
    },
  },
});
