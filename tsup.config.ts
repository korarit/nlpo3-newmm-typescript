import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: ['src/index.ts'],
        format: 'esm',
        outDir: 'dist',
        platform: 'node',
        target: 'es2020',
        dts: true,
        clean: true,
    },
    {
        entry: ['src/index.ts'],
        format: 'cjs',
        outDir: 'dist',
        platform: 'node',
        target: 'es2016',
        dts: false,
        clean: false,
    },
]);
