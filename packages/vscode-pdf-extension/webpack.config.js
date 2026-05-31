const path = require('path');

const legacyExtensionRoot = path.resolve(__dirname, '../vscode-extension');
const CopyPlugin = require(require.resolve('copy-webpack-plugin', {
  paths: [__dirname, legacyExtensionRoot],
}));

const dist = path.resolve(__dirname, 'dist');
const webviewBundleBudget = 7 * 1024 * 1024;

const resolveWorkspaceModule = (request) => (
  require.resolve(request, { paths: [__dirname, legacyExtensionRoot] })
);

const tsRule = () => ({
  test: /\.ts$/,
  exclude: /node_modules/,
  use: [{
    loader: resolveWorkspaceModule('ts-loader'),
    options: { configFile: path.resolve(__dirname, 'tsconfig.json') },
  }],
});

const resolveOptions = {
  extensions: ['.ts', '.js'],
  modules: [
    path.resolve(__dirname, 'node_modules'),
    path.resolve(legacyExtensionRoot, 'node_modules'),
    'node_modules',
  ],
  fallback: {
    crypto: false,
  },
};

const pdfiumPackageRoot = path.resolve(path.dirname(resolveWorkspaceModule('@embedpdf/pdfium')), '..');

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
      modules: resolveOptions.modules,
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
    resolve: resolveOptions,
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
            from: path.join(pdfiumPackageRoot, 'dist', 'pdfium.wasm'),
            to: 'pdfium.wasm',
          },
          {
            from: resolveWorkspaceModule('sql.js/dist/sql-wasm.wasm'),
            to: 'sql-wasm.wasm',
            noErrorOnMissing: true,
          },
        ],
      }),
    ],
    performance: {
      maxAssetSize: webviewBundleBudget,
      maxEntrypointSize: webviewBundleBudget,
    },
    devtool: 'source-map',
  },
];
