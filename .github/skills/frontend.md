Agent Skill: Frontend Standards

This skill defines the rules for modifying the React/TypeScript frontend located in apps/web/.

### 1. React & TypeScript Rules

- Components: Strictly use functional components with hooks. Do not use class components.
- Linting: Respect eslint-plugin-react-hooks. Currently, 5 strict v7 rules are downgraded to warn (issue #256). Do not introduce new violations.
- Dependencies: All package.json changes must be made via bun add <package>. You must commit the updated bun.lock alongside package.json.
- Imports: Imports from lucide-react must use the public package path, never private dist paths.

### 2. UI & Design Standards

- Responsiveness: All new UI must be mobile-first, then scale to tablet and desktop.
- Pour-Over View: Ensure no overflow at intermediate viewport widths. It has distinct mobile (single-column) and desktop (multi-column) layouts.
- Component Library: Components mapped in apps/web/src/components/ui/ are from shadcn/ui. Extend these existing components; do not replace them with custom implementations.