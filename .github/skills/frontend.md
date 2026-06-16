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

### 3. Native (Capacitor) DirectMode Parity — MANDATORY

In the iOS/Capacitor build there is no Python backend; `apps/web/src/services/interceptor/DirectModeInterceptor.ts` intercepts machine/API calls and reproduces the server's behavior client-side (alongside `apps/web/src/services/ai/`, `apps/web/src/lib/directModeAI.ts`, `apps/web/src/lib/profileAnalysis.ts`).

- This is shared product logic, not server-only or native-only code. When you change analysis, profile generation, target-curve math, recommendations, dial-in, or any machine-API contract — in either the backend or the DirectMode layer — apply the equivalent change to the other runtime in the same PR, with tests on both sides.
- Shared React components (charts, views) already cover both runtimes; the parity risk is in the DirectMode service/lib layer. Always grep it when touching backend behavior. See `.github/CONVENTIONS.md` → Quality Gate #7.