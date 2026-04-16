# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ThoughtLite — a modern Astro blog theme focused on content creation with i18n support (en, zh-cn, ja). Built with Astro 5, Svelte 5, Tailwind CSS 4, and TypeScript.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start dev server at http://localhost:4321 |
| `pnpm build` | Production build |
| `pnpm preview` | Preview built site |
| `pnpm check` | TypeScript type checking via `astro check` |
| `pnpm format` | Format code with Biome (`biome format --write`) |
| `pnpm lint` | Lint code with Biome (`biome lint`) |
| `pnpm new` | Interactive CLI to create new content |

Package manager: **pnpm** (v10.30.1). There are no test frameworks configured.

## Architecture

### Content Collections (`src/content/`)

Four collections defined in `src/content.config.ts`, organized by locale subdirectories:

- **note** — Long-form articles (15 per page). Supports `series`, `toc`, `draft`, `sensitive`, `top` priority fields.
- **jotting** — Short posts / micro-blog (24 per page). Lighter schema, no `series` or `toc`.
- **preface** — Homepage intro cards. Minimal schema (only `timestamp`).
- **information** — Static pages (about, policy). Supports `.md`, `.mdx`, and `.yaml` formats.

Files prefixed with `_` are excluded from builds (private/draft). All content uses glob loaders.

### Routing (`src/pages/`)

Dynamic routes under `[...locale]/` handle all locale-aware pages. Default locale (`en`) is omitted from URLs via `prefixDefaultLocale: false`. Key routes: `/note/`, `/jotting/`, `/about`, `/policy`, `/preface`.

### Internationalization (`src/i18n/`)

Custom i18n system using YAML files per locale (`index.yaml`, `script.yaml`, `linkroll.yaml`). Entry point at `src/i18n/index.ts`. VS Code i18n-ally integration is configured.

### Key Config Files

- `site.config.ts` — Site metadata, i18n locales, pagination, feed, heatmap settings. Uses type-safe `siteConfig()` helper from `src/lib/config.ts`.
- `astro.config.ts` — Astro framework config with extensive remark/rehype plugin chain for markdown processing (GFM, math/KaTeX, code copy, image figures, sectionize, etc.). Also configures Swup for SPA transitions, Google/ZeoSeven fonts, and Tailwind via Vite plugin.
- `biome.json` — Formatting and linting rules (see Code Style below).

### Component Layers

- `src/layouts/` — Astro layout components (Base.astro, App.astro, header/)
- `src/components/` — Reusable UI components (mix of Astro and Svelte)
- `src/graph/` — Heatmap data visualization (Svelte)
- `src/icons/` — SVG icon components
- `src/lib/` — Utility functions (config, time, reading-time)
- `src/styles/` — Global CSS and markdown-specific styles
- `src/fonts/` — Custom font provider (ZeoSeven)

## Code Style

Configured via Biome (`biome.json`):

- **Indentation**: Tabs, width 4
- **Line width**: 150 characters
- **Quotes**: Double quotes, semicolons always, no trailing commas
- **Arrow parens**: Only as needed
- **HTML line width**: 320 characters
- **CSS**: Tailwind directives enabled in parser
- **Astro/Svelte overrides**: Relaxed linting (unused vars/imports off, `useConst` off, `useImportType` off)
- Pre-commit hook via Husky + lint-staged runs `biome check --write` on staged files

## Content Creation

Use `pnpm new` for an interactive CLI (powered by `@clack/prompts`). Content frontmatter schema is defined in `src/content.config.ts` with Zod validation.
