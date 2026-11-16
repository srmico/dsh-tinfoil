import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    registry: 'src/registry.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  clean: true,
  dts: {
    resolver: 'tsc',
  },
  deps: {
    neverBundle: true,
    alwaysBundle: ['@srmico/dsh-tinfoil-lib'],
    dts: {
      alwaysBundle: ['@srmico/dsh-tinfoil-lib'],
    },
  },
})
