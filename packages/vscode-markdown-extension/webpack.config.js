const path = require('path');

const dist = path.resolve(__dirname, 'dist');
const legacyExtensionRoot = path.resolve(__dirname, '../vscode-extension');
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

const resolveFromPackage = (anchorPackage, request = anchorPackage) => (
  require.resolve(request, {
    paths: [
      path.dirname(resolveWorkspaceModule(anchorPackage)),
      __dirname,
      legacyExtensionRoot,
    ],
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

const resolveOptions = {
  extensions: ['.ts', '.js'],
  modules: [
    path.resolve(__dirname, 'node_modules'),
    path.resolve(legacyExtensionRoot, 'node_modules'),
    'node_modules',
  ],
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
      'sql.js': 'commonjs sql.js',
    },
    resolve: resolveOptions,
    module: {
      rules: [tsRule()],
    },
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
      ...resolveOptions,
      alias: markdownEditorAliases,
    },
    module: {
      rules: [tsRule()],
    },
    performance: {
      maxAssetSize: webviewBundleBudget,
      maxEntrypointSize: webviewBundleBudget,
    },
    devtool: 'source-map',
  },
];
