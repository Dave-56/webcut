import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';
import { resolve, dirname } from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const allDependencies = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
];

// 根据环境变量选择构建配置
const buildType = process.env.BUILD_TYPE;

// 导出配置
export default defineConfig({
  plugins: [
    vue(),
    buildType !== 'webcomponents' ? dts({
      insertTypesEntry: true,
      cleanVueFileName: true,
      copyDtsFiles: false,
      include: ['src/**/*'],
      exclude: [
        'src/**/*.test.ts', 'src/**/*.spec.ts', 'src/**/*.md',
        'src/webcomponents.ts',
      ],
    }) : undefined,
  ].filter(Boolean),
  build: {
    lib: {
      entry: buildType === 'webcomponents' ? resolve(__dirname, 'src/webcomponents.ts') : resolve(__dirname, 'src/index.ts'),
      name: 'WebCut',
      fileName: () => 'index.js',
      formats: [buildType === 'webcomponents' ? 'iife' : 'es'],
    },
    sourcemap: true,
    minify: false,
    outDir: buildType === 'webcomponents' ? 'webcomponents' : 'esm',
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      external: buildType === 'webcomponents' ? [] : allDependencies,
    },
  },
});

