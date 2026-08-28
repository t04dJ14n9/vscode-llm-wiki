const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

const dist = path.resolve(__dirname, 'dist');
const webviewBundleBudget = 7 * 1024 * 1024;

const tsRule = (configFile = 'tsconfig.json', compilerOptions = {}) => ({
  test: /\.ts$/,
  exclude: /node_modules/,
  use: [{
    loader: 'ts-loader',
    options: {
      configFile,
      onlyCompileBundledFiles: true,
      compilerOptions: {
        composite: false,
        declaration: false,
      declarationMap: false,
      incremental: false,
      ...compilerOptions,
      },
    },
  }],
});

const resolveFromPackage = (anchorPackage, request = anchorPackage) => (
  require.resolve(request, {
    paths: [path.dirname(require.resolve(anchorPackage, { paths: [__dirname] }))],
  })
);

const markdownEditorAliases = {
  '@codemirror/commands$': resolveFromPackage('@codemirror/commands'),
  '@codemirror/language$': resolveFromPackage('@codemirror/language'),
  '@codemirror/state$': resolveFromPackage('@codemirror/state'),
  '@codemirror/view$': resolveFromPackage('@codemirror/view'),
  '@lezer/common$': resolveFromPackage('@codemirror/language', '@lezer/common'),
  '@lezer/highlight$': resolveFromPackage('@codemirror/language', '@lezer/highlight'),
  '@lezer/lr$': resolveFromPackage('@codemirror/language', '@lezer/lr'),
  '@lezer/markdown$': resolveFromPackage('@codemirror/lang-markdown', '@lezer/markdown'),
};

const pdfEditorWebviewEntry = require.resolve('@llm-wiki/pdf-editor/webview', {
  paths: [__dirname],
});
const pdfEditorPackageRoot = path.resolve(path.dirname(pdfEditorWebviewEntry), '../..');
const pdfEditorWebviewTsConfig = path.join(pdfEditorPackageRoot, 'tsconfig.webview.json');
const pdfiumPackageRoot = path.resolve(path.dirname(require.resolve(
  '@embedpdf/pdfium',
  { paths: [pdfEditorPackageRoot] },
)), '..');

const webviewPerformance = {
  maxAssetSize: webviewBundleBudget,
  maxEntrypointSize: webviewBundleBudget,
};

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
    entry: pdfEditorWebviewEntry,
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
        tsRule(pdfEditorWebviewTsConfig),
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
            from: path.join(pdfiumPackageRoot, 'dist/pdfium.wasm'),
            to: 'pdfium.wasm',
          },
        ],
      }),
    ],
    performance: webviewPerformance,
    devtool: 'source-map',
  },
  {
    name: 'markdown-editor',
    target: 'web',
    entry: './webview-src/markdown-editor.ts',
    output: {
      path: dist,
      filename: 'markdown-editor.js',
      chunkFilename: 'markdown-[name].[contenthash:8].js',
      publicPath: '',
    },
    optimization: {
      splitChunks: false,
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: markdownEditorAliases,
    },
    module: {
      rules: [tsRule('tsconfig.json', { module: 'ESNext' })],
    },
    performance: webviewPerformance,
    devtool: 'source-map',
  },
  {
    name: 'experimental-owned-browser',
    target: 'web',
    entry: './webview-src/experimental-owned-browser.ts',
    output: {
      path: dist,
      filename: 'experimental-owned-browser.js',
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
    performance: webviewPerformance,
    devtool: 'source-map',
  },
];
