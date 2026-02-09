<div align="center">

<img src="public/logo.svg" alt="MeticAI Logo" width="150" />

# MeticAI Web Interface

</div>

MeticAI is a web application that helps you generate customized espresso profiles based on coffee bag images and your taste preferences. Upload a photo of your coffee bag, describe your taste preferences, and get AI-powered espresso extraction recommendations.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [Docker Deployment](#docker-deployment)
- [Building for Production](#building-for-production)
- [Testing](#testing)
- [Development Guidelines](#development-guidelines)
- [Project Structure](#project-structure)
- [Available Commands](#available-commands)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

## Prerequisites

### For Local Development

Before you begin local development, ensure you have the following installed on your system:

- **Bun**: Version 1.0 or higher (tested with latest)

You can verify your installation by running:

```bash
bun --version
```

### Installing Bun

If you don't have Bun installed, you can install it with:

**macOS, Linux, and WSL:**
```bash
curl -fsSL https://bun.sh/install | bash
```

**Windows:**
```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

For more installation options, visit [Bun's official documentation](https://bun.sh/docs/installation).

### For Docker Deployment

If you plan to use Docker for deployment, you only need:

- **Docker**: Version 20.x or higher
- **Docker Compose**: Version 2.x or higher

**Bun is not required on the host machine** when using Docker, as the application is built inside the container.

## Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/hessius/MeticAI-web.git
   cd MeticAI-web
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

   This will install all required dependencies listed in `package.json`, including:
   - React 19
   - TypeScript
   - Vite (build tool)
   - Tailwind CSS
   - Radix UI components
   - And other project dependencies

## Configuration

### Server URL Configuration

The application needs to connect to a backend server for espresso profile generation. By default, it connects to `http://localhost:5000`, but you can configure this for different deployments.

#### Setting Up Configuration

1. **Create a configuration file** (optional):

   Copy the example configuration to the `public` directory:
   
   ```bash
   cp config.example.json public/config.json
   ```

2. **Edit `public/config.json`** to set your server URL:

   ```json
   {
     "serverUrl": "http://your-server-ip:port"
   }
   ```

   Examples:
   - Local development: `"serverUrl": "http://localhost:5000"`
   - Remote server: `"serverUrl": "http://192.168.1.100:8080"`
   - Production server: `"serverUrl": "https://api.example.com"`

3. **For production deployments:**
   - After building with `bun run build`, copy your `config.json` to the `dist` directory alongside `index.html`
   - Or configure your web server to serve `config.json` from the root path

**Note:** The `config.json` file is excluded from version control (via `.gitignore`) to allow environment-specific configurations. If no `config.json` is found, the application defaults to `http://localhost:5000`.

## Running the Application

### Development Server

To start the development server with hot module replacement (HMR):

```bash
bun run dev
```

The application will be available at `http://localhost:5173` (or another port if 5173 is in use).

### Preview Production Build

To preview the production build locally:

```bash
bun run preview
```

## Docker Deployment

The application can be deployed using Docker for easy containerization and deployment. This is the **recommended approach for production deployments**.

### Quick Start with Docker

**No Bun installation required!** The application is built entirely inside the Docker container.

**Option 1: Using the build script (easiest)**

```bash
./docker-build.sh
```

This script will:
1. Check for Docker and Docker Compose
2. Build the Docker image (including bun install and build inside the container)
3. Start the Docker containers

**Option 2: Using Docker Compose directly**

```bash
docker compose up -d
```

**Option 3: Manual Docker build**

```bash
docker build -t meticai-web .
docker run -p 3550:80 meticai-web
```

The application will be available at `http://localhost:3550`.

### Configuring Backend Server

To point the containerized app to your backend server, create a `config.json` file:

```json
{
  "serverUrl": "http://your-backend-server:5000"
}
```

Then run with the config mounted:

```bash
docker run -d -p 3550:80 \
  -v $(pwd)/config.json:/usr/share/nginx/html/config.json:ro \
  meticai-web
```

**For complete Docker documentation**, including:
- Detailed build and run instructions
- Network configuration for external server communication
- Production deployment best practices
- Troubleshooting guide

See [DOCKER.md](./DOCKER.md) for the comprehensive Docker deployment guide.

## Building for Production

To create an optimized production build:

```bash
bun run build
```

This command will:
1. Run TypeScript compiler checks
2. Bundle and optimize the application using Vite
3. Output the production-ready files to the `dist` directory

## Testing

This project has comprehensive test coverage including unit, integration, and end-to-end (E2E) tests.

### Running Tests

```bash
# Run all unit tests in watch mode
bun test

# Run tests once (CI mode)
bun run test:run

# Run tests with coverage report
bun run test:coverage

# Open Vitest UI for interactive testing
bun run test:ui

# Run E2E tests (requires dev server to be running)
bun run e2e

# Run E2E tests in UI mode
bun run e2e:ui

# Run E2E tests in headed mode (see the browser)
bun run e2e:headed

# Run accessibility tests
bun run e2e -- e2e/accessibility.spec.ts

# Run specific accessibility test category
bun run e2e -- e2e/accessibility.spec.ts -g "Keyboard Navigation"
```

### Test Coverage

The project includes:
- **Unit Tests** - Testing utility functions and individual components
- **Integration Tests** - Testing component interactions and user flows
- **E2E Tests** - Testing complete user journeys with Playwright
- **Accessibility Tests** - WCAG 2.1 AA compliance testing with axe-core

For detailed testing documentation, best practices, and examples, see [TESTING.md](./TESTING.md).

For comprehensive accessibility testing information, see [ACCESSIBILITY_TESTING.md](./ACCESSIBILITY_TESTING.md).

## Development Guidelines

### Code Style and Linting

The project includes ESLint in its dependencies for code quality and consistency. To lint your code:

```bash
bun run lint
```

**Note:** If you encounter an error about missing ESLint configuration, you may need to create an `eslint.config.js` file. Follow the [ESLint v9 migration guide](https://eslint.org/docs/latest/use/configure/migration-guide) for setup instructions. In the meantime, ensure your code follows TypeScript and React best practices.

### TypeScript

This project uses TypeScript for type safety. Key configurations:
- Target: ES2020
- JSX: React JSX transform
- Strict null checks enabled
- Path aliases: `@/*` maps to `src/*`

### Component Library

The project uses:
- **shadcn/ui** components (New York style)
- **Radix UI** primitives for accessible components
- **Tailwind CSS** for styling with CSS variables
- **Framer Motion** for animations
- **Phosphor Icons React** (`@phosphor-icons/react`) for iconography

### Code Organization

- Keep components focused and single-purpose
- Use TypeScript interfaces for props and data structures
- Follow the existing file structure and naming conventions
- Place reusable UI components in `src/components/ui/`
- Use path aliases (`@/`) for imports instead of relative paths

### Styling Guidelines

- Use Tailwind CSS utility classes for styling
- Leverage the design system defined in `theme.json`
- Use CSS variables for theming (defined in `main.css`)
- Follow the existing color palette and spacing scale

## Project Structure

```
MeticAI-web/
├── src/
│   ├── components/        # Reusable React components
│   │   └── ui/           # shadcn/ui components
│   ├── hooks/            # Custom React hooks
│   ├── lib/              # Utility functions and libraries
│   ├── styles/           # Additional styles
│   ├── test/             # Test setup files
│   ├── App.tsx           # Main application component
│   ├── main.tsx          # Application entry point
│   ├── main.css          # Global styles and Tailwind imports
│   └── vite-env.d.ts     # Vite type definitions
├── e2e/                  # End-to-end tests
├── index.html            # HTML template
├── package.json          # Project dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── vite.config.ts        # Vite configuration
├── vitest.config.ts      # Vitest test configuration
├── playwright.config.ts  # Playwright E2E configuration
├── eslint.config.js      # ESLint configuration
├── tailwind.config.js    # Tailwind CSS configuration
├── components.json       # shadcn/ui configuration
├── theme.json            # Design system theme
├── TESTING.md            # Testing documentation
└── README.md             # This file
```

## Available Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start development server with HMR |
| `bun run build` | Build for production |
| `bun run preview` | Preview production build locally |
| `bun run lint` | Run ESLint to check code quality |
| `bun run optimize` | Run Vite optimizer |
| `bun run kill` | Kill process running on port 5000 (Unix-like systems) |
| `bun test` | Run unit tests in watch mode |
| `bun run test:run` | Run unit tests once (CI mode) |
| `bun run test:coverage` | Generate coverage report |
| `bun run test:ui` | Open Vitest UI |
| `bun run e2e` | Run E2E tests |
| `bun run e2e:ui` | Run E2E tests in UI mode |
| `bun run e2e:headed` | Run E2E tests in headed mode |

## Roadmap

Want to see where MeticAI is heading? Check out our comprehensive [Development Roadmap](./ROADMAP.md) which includes:

- **Planned Features**: Profile history, enhanced image analysis, multi-language support, community features, and more
- **Interface Improvements**: Dark mode, mobile optimization, accessibility enhancements
- **Code Quality Initiatives**: Component refactoring, test coverage expansion, performance optimization
- **Timeline**: Quarterly roadmap with priorities and milestones

We welcome feedback and suggestions! Feel free to contribute to the roadmap by opening an issue or discussion.

## Contributing

We welcome contributions to MeticAI! Here's how you can help:

### Getting Started

1. Fork the repository
2. Create a new branch for your feature or bug fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Make your changes following the development guidelines above
4. Write tests for your changes
5. Test your changes thoroughly:
   ```bash
   bun run test:run  # Run unit tests
   bun run e2e       # Run E2E tests (if applicable)
   ```
6. Run linting to ensure code quality:
   ```bash
   bun run lint
   ```
7. Commit your changes with clear, descriptive commit messages
8. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
9. Open a Pull Request with a clear description of your changes

### Pull Request Guidelines

- Provide a clear description of the problem you're solving
- Include any relevant issue numbers
- Ensure all tests pass and linting is clean
- Keep changes focused and atomic
- Update documentation if needed
- Follow the existing code style and conventions

### Reporting Issues

If you find a bug or have a feature request:
1. Check if the issue already exists
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce (for bugs)
   - Expected vs actual behavior
   - Screenshots if applicable
   - Your environment details (OS, Bun version, etc.)

### Code Review Process

- All submissions require review before merging
- Reviewers may request changes or improvements
- Be responsive to feedback and willing to iterate
- Maintain a respectful and collaborative tone

## License

Please refer to the LICENSE file in the repository for licensing information.

## Support

For questions or support, please open an issue in the GitHub repository.

---

Happy coding! ☕✨
