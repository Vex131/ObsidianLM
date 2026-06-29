# ObsidianLM

ObsidianLM is a lightweight local AI runtime manager. It is a control plane for configuring, monitoring, and eventually managing local AI runtimes while tools such as OpenCode and Illustria connect directly to the runtime API.

## Package Manager

This project uses npm only with npm workspaces. Commit `package-lock.json` and do not use pnpm, Yarn, Bun, Docker, Electron, or Next.js for this project foundation.

## Setup

```bash
npm install
npm run dev
```

Build and run the compiled service/UI:

```bash
npm run build
npm run start
```

## Default Ports

- ObsidianLM UI/API: `8090`
- llama.cpp API: `8085` reserved for the future managed runtime

## Phase 0 Status

Phase 0 provides the npm monorepo foundation, a Fastify TypeScript service, a Vite + Svelte dashboard shell, shared TypeScript types/constants, JSON storage defaults, and `GET /api/status`.

llama.cpp process management is not implemented yet. ObsidianLM does not start, stop, scan, kill, or manage llama.cpp processes in Phase 0.

## Project Plan

See [docs/ObsidianLM_Project_Plan.md](docs/ObsidianLM_Project_Plan.md).

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
