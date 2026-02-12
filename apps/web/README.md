# MeticAI Web Interface

React + TypeScript frontend for MeticAI, built with Vite and Bun.

> **Deployment:** The web app is built as part of the unified Docker container (`docker/Dockerfile.unified`). See the root [README](../../README.md) for deployment instructions.

## Local Development

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.0

### Setup

```bash
cd apps/web
bun install
bun run dev        # → http://localhost:5173
```

The dev server proxies `/api` requests to the backend at `http://localhost:8000`.

### Build

```bash
bun run build      # Production build → dist/
bun run preview    # Preview the build locally
```

## Testing

```bash
bun test              # Unit tests (watch mode)
bun run test:run      # Unit tests (CI)
bun run test:coverage # Coverage report
bun run e2e           # Playwright E2E tests
bun run e2e:headed    # E2E with visible browser
```

For details: [TESTING.md](./TESTING.md) · [ACCESSIBILITY_TESTING.md](./ACCESSIBILITY_TESTING.md)

## Tech Stack

- **React 18** + TypeScript
- **Vite** (build tool)
- **Tailwind CSS v4** with CSS variables
- **shadcn/ui** (New York style) + Radix UI primitives
- **Framer Motion** for animations
- **Phosphor Icons** for iconography
- **Vitest** + **Playwright** for testing

## Project Structure

```
src/
├── components/       # React components
│   └── ui/          # shadcn/ui components
├── hooks/           # Custom React hooks
├── i18n/            # Internationalization
├── lib/             # Utilities
├── styles/          # Additional styles
├── App.tsx          # Main app component
├── main.tsx         # Entry point
└── main.css         # Global styles + Tailwind
```

## Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Dev server with HMR |
| `bun run build` | Production build |
| `bun run preview` | Preview production build |
| `bun run lint` | ESLint check |
| `bun test` | Unit tests (watch) |
| `bun run test:run` | Unit tests (CI) |
| `bun run test:coverage` | Coverage report |
| `bun run e2e` | Playwright E2E tests |

## Contributing

1. Fork → branch → code → test → PR
2. Follow existing code style and TypeScript conventions
3. Use `@/` path aliases for imports
4. Place reusable UI in `src/components/ui/`
