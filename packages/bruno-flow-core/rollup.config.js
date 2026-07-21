const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const json = require('@rollup/plugin-json');
const typescript = require('@rollup/plugin-typescript');
const dts = require('rollup-plugin-dts');
const terser = require('@rollup/plugin-terser').default;
const peerDepsExternal = require('rollup-plugin-peer-deps-external');

const packageJson = require('./package.json');

const external = (id) => (
  id.startsWith('node:')
  || id === 'chokidar'
  || id === 'js-yaml'
  || id === 'ajv/dist/2020'
  || id.startsWith('crypto-js')
);

const createBuildConfig = ({ input, cjsOutput, esmOutput, dtsOutput }) => [
  {
    input,
    external,
    output: [
      { file: cjsOutput, format: 'cjs', sourcemap: true, exports: 'named' },
      { file: esmOutput, format: 'esm', sourcemap: true }
    ],
    plugins: [
      peerDepsExternal(),
      nodeResolve(),
      commonjs(),
      json(),
      typescript({ tsconfig: './tsconfig.json' }),
      terser()
    ],
    treeshake: { moduleSideEffects: false }
  },
  {
    input,
    external,
    output: { file: dtsOutput, format: 'es' },
    plugins: [dts.default({ tsconfig: './tsconfig.json' })]
  }
];

module.exports = [
  ...createBuildConfig({
    input: 'src/index.ts',
    cjsOutput: packageJson.main,
    esmOutput: packageJson.module,
    dtsOutput: packageJson.types
  }),
  ...createBuildConfig({
    input: 'src/persistence/index.ts',
    cjsOutput: 'dist/persistence/cjs/index.js',
    esmOutput: 'dist/persistence/esm/index.js',
    dtsOutput: 'dist/persistence/index.d.ts'
  })
];
