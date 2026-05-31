const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

const dist = path.resolve(__dirname, 'dist');

const tsRule = (configFile = 'tsconfig.json') => ({
  test: /\.ts$/,
  exclude: /node_modules/,
  use: [{ loader: 'ts-loader', options: { configFile } }],
});

module.exports = [
  {
    name: 'extension',
    target: 'node',
    entry: './src/extension.ts',
    output: {
      path: dist,
      filename: 'extension.js',
      libraryTarget: 'commonjs2',
    },
    externals: {
      vscode: 'commonjs vscode',
      'sql.js': 'commonjs sql.js',
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [tsRule()],
    },
    devtool: 'source-map',
  },
  {
    name: 'pdf-viewer',
    target: 'web',
    entry: './webview-src/pdf-viewer.ts',
    output: {
      path: dist,
      filename: 'pdf-viewer.js',
      publicPath: '',
    },
    resolve: {
      extensions: ['.ts', '.js'],
      fallback: {
        crypto: false,
      },
    },
    module: {
      rules: [
        tsRule(),
        {
          test: /\.wasm$/,
          type: 'asset/resource',
          generator: { emit: false },
        },
      ],
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          {
            from: 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm',
            to: 'pdfium.wasm',
          },
          {
            from: require.resolve('sql.js/dist/sql-wasm.wasm'),
            to: 'sql-wasm.wasm',
            noErrorOnMissing: true,
          },
        ],
      }),
    ],
    devtool: 'source-map',
  },
  {
    name: 'markdown-editor',
    target: 'web',
    entry: './webview-src/markdown-editor.ts',
    output: {
      path: dist,
      filename: 'markdown-editor.js',
      chunkLoading: false,
      publicPath: '',
    },
    optimization: {
      splitChunks: false,
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [tsRule()],
    },
    devtool: 'source-map',
  },
];
