# Superpower OSS

Desktop automation dashboard built with Tauri, React, TypeScript, and Bun.

Superpower OSS lets you write Bun-powered automations, attach triggers, inspect run history, and manage notifications from a local desktop app with a SaaS-style dashboard UI.

## What It Does

- Create and edit automation scripts in a Monaco-based TypeScript editor
- Trigger scripts manually or through:
  - cron schedules
  - uptime checks
  - file watchers
  - API polling
- Review grouped run history and execution logs
- Configure notification channels:
  - native desktop
  - Slack webhook
  - Discord webhook
  - SMTP
  - custom HTTP
- Pause or resume scheduling
- Check for app updates
- Import and export script packages

## Stack

- Tauri 2
- React 19
- TypeScript
- Vite
- TanStack Query
- Zustand
- Bun runtime for user automations

## Requirements

- Bun
- Rust
- Tauri system prerequisites for your OS

Tauri prerequisite guide:
- https://v2.tauri.app/start/prerequisites/

## Development

Install dependencies:

```bash
bun install
```

Run the web app only:

```bash
bun run dev
```

Run the Tauri desktop app in development:

```bash
bun run tauri dev
```

Run tests:

```bash
bun run test
```

Build the frontend:

```bash
bun run build
```

Build the desktop app:

```bash
bun run tauri build
```

## Available Scripts

- `bun run dev`: start the Vite dev server
- `bun run build`: type-check and build the frontend
- `bun run test`: run the Vitest suite
- `bun run test:watch`: run Vitest in watch mode
- `bun run preview`: preview the production frontend build
- `bun run tauri dev`: launch the desktop app in dev mode
- `bun run tauri build`: create a packaged desktop build
- `bun run check:versions`: verify version sync
- `bun run sync:version`: sync version metadata
- `bun run fetch:bun`: fetch bundled Bun runtime assets
- `bun run generate:updater-manifest`: generate updater metadata

## App Structure

- `Home`: overview dashboard with runtime, activity, and shortcuts
- `Scripts`: automation catalog plus editor, metadata, policies, and triggers
- `Runs`: grouped execution history and logs
- `Settings`: runtime controls, updates, imports/exports, and notification channels

## Project Structure

- `src/`: React frontend
- `src-tauri/`: Tauri and Rust backend
- `src/features/`: page-level app features
- `src/components/`: shared React components
- `src-tauri/icons/`: generated desktop app icons
- `logos/`: source branding assets

## Notes

- The desktop window is configured in `src-tauri/tauri.conf.json`.
- The app icon set is generated into `src-tauri/icons` from the source logo assets in `logos/`.
- Web favicon/title branding is defined in `index.html`.

## Recommended IDE Setup

- VS Code
- Tauri VS Code extension
- rust-analyzer
