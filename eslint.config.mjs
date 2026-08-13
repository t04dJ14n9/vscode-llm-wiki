import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const javascriptFiles = ['**/*.{js,mjs,cjs}'];
const typescriptFiles = ['**/*.ts'];
const lintableFiles = [...javascriptFiles, ...typescriptFiles];
const typedSourceFiles = [
  'packages/*/src/**/*.ts',
  'packages/*/webview-src/**/*.ts',
];
const testFiles = [
  '**/test/**/*.{js,mjs,cjs,ts}',
  '**/*.spec.ts',
  '**/*.test.{js,mjs,cjs,ts}',
];
const intentionalAskPdfDeferralMarker =
  'TODO(ask-pdf): Re-enable after the provider-neutral “More detail” workflow and backend policy are specified.';
const warningCommentTerm = /\b(?:todo|fixme|hack|xxx)\b/i;
const intentionalAskPdfDeferralPlugin = {
  rules: {
    'only-intentional-todo': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          unexpectedWarningComment: 'Unexpected warning comment.',
        },
      },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              const text = comment.value.trim();
              if (text === intentionalAskPdfDeferralMarker) continue;
              if (warningCommentTerm.test(text)) {
                context.report({
                  loc: comment.loc,
                  messageId: 'unexpectedWarningComment',
                });
              }
            }
          },
        };
      },
    },
  },
};

// These integration boundaries still expose untyped third-party data. Keep the
// exception list explicit so new modules start with no-explicit-any enabled.
const legacyUntypedFiles = [
  'packages/pdf-editor/src/webview/domain/pdfNavigation.ts',
  'packages/pdf-editor/src/webview/domain/pdfSearch.ts',
  'packages/pdf-editor/src/webview/domain/pdfSelection.ts',
  'packages/pdf-editor/src/webview/domain/pdfTextExtraction.ts',
  'packages/pdf-editor/src/webview/pdfAskPanel.ts',
  'packages/pdf-editor/src/webview/pdf-viewer.ts',
  'packages/vscode-extension/src/markdownEditorProvider.ts',
  'packages/vscode-extension/src/pdfDiscussionController.ts',
  'packages/vscode-extension/src/pdfEditorProvider.ts',
  'packages/vscode-extension/webview-src/extensions/hybridMath.ts',
  'packages/vscode-extension/webview-src/markdown-editor.ts',
];

function scope(configs, files) {
  return configs.map((config) => ({ ...config, files }));
}

export default [
  {
    name: 'workspace/ignores',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.vscode-test/**',
      '.cache/**',
      '.codegraph/**',
      '.playwright-cli/**',
      '.pnpm-store/**',
      '.superpowers/**',
      'artifacts/**',
      'demos/**',
      'packages/vscode-extension/test-results/**',
      'packages/vscode-extension/playwright-report/**',
      'packages/vscode-extension/test/vscode-e2e/fixtures/**',
      'reference/**',
    ],
  },
  {
    name: 'workspace/linter-policy',
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    ...eslint.configs.recommended,
    name: 'workspace/javascript-recommended',
    files: javascriptFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...eslint.configs.recommended.rules,
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  ...scope(tseslint.configs.recommended, typescriptFiles),
  ...scope(tseslint.configs.recommendedTypeCheckedOnly, typedSourceFiles),
  {
    name: 'workspace/type-aware-source',
    files: typedSourceFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          fixStyle: 'inline-type-imports',
          prefer: 'type-imports',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        {
          allowDefaultCaseForExhaustiveSwitch: false,
          considerDefaultExhaustiveForUnions: true,
        },
      ],
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    name: 'workspace/common-quality',
    files: lintableFiles,
    rules: {
      'array-callback-return': 'error',
      'complexity': ['error', { max: 65 }],
      'curly': ['error', 'multi-line'],
      'default-case-last': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'max-depth': ['error', 6],
      'max-params': ['error', 8],
      'no-eval': 'error',
      'no-lonely-if': 'error',
      'no-new-func': 'error',
      'no-self-compare': 'error',
      'no-unneeded-ternary': 'error',
      'no-useless-return': 'error',
      'no-warning-comments': [
        'error',
        {
          location: 'anywhere',
          terms: ['todo', 'fixme', 'hack', 'xxx'],
        },
      ],
      'object-shorthand': ['error', 'always'],
      'prefer-object-spread': 'error',
      'prefer-promise-reject-errors': ['error', { allowEmptyReject: false }],
      'radix': 'error',
    },
  },
  {
    name: 'workspace/intentional-ask-pdf-deferral-marker',
    files: ['packages/vscode-extension/src/extension.ts'],
    plugins: {
      'workspace-deferral': intentionalAskPdfDeferralPlugin,
    },
    rules: {
      'no-warning-comments': 'off',
      'workspace-deferral/only-intentional-todo': 'error',
    },
  },
  {
    name: 'workspace/source-size-guardrails',
    files: typedSourceFiles,
    rules: {
      'max-lines': [
        'error',
        {
          max: 5000,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'max-lines-per-function': [
        'error',
        {
          IIFEs: true,
          max: 1000,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
  {
    name: 'workspace/test-relaxations',
    files: testFiles,
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'max-lines-per-function': 'off',
      'no-new-func': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.type="MemberExpression"][callee.property.name="only"]',
          message:
            'Focused tests must not be committed; remove .only before committing.',
        },
      ],
    },
  },
  {
    name: 'workspace/legacy-untyped-boundaries',
    files: legacyUntypedFiles,
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  },
  {
    name: 'workspace/ambient-webview-entrypoints',
    files: [
      'packages/pdf-editor/src/webview/pdf-viewer.ts',
      'packages/vscode-extension/webview-src/markdown-editor.ts',
    ],
    rules: {
      '@typescript-eslint/triple-slash-reference': 'off',
    },
  },
];
