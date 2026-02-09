import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'playwright-report', 'test-results'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { 
          allowConstantExport: true,
          // Allow common variant/utility exports from shadcn/ui components
          allowExportNames: [
            'badgeVariants',
            'buttonVariants',
            'toggleVariants',
            'navigationMenuTriggerStyle',
            'useFormField',
            'Form',
            'FormItem',
            'FormLabel',
            'FormControl',
            'FormDescription',
            'FormMessage',
            'FormField',
            'useSidebar',
            'SidebarProvider',
            // MarkdownText utilities
            'markdownToHtml',
            'extractSections',
            'cleanMalformedMarkdown',
            'cleanProfileName',
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Disable react-refresh for shadcn/ui components (library code with intentional patterns)
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
