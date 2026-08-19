import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // stdout 是 MCP 协议通道，任何写入都会破坏帧；日志一律走 src/logger.ts（stderr）。
      'no-console': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['PascalCase'] },
        // 上游 / MCP 协议字段名是外部契约（snake_case），不受本项目命名规范约束。
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'typeProperty', format: null },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
      ],
    },
  },
  {
    files: ['src/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // 本文件与其它 .js 配置不在 tsconfig 里，跳过需要类型信息的规则。
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
