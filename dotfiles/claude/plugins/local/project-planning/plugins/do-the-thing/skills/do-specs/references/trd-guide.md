# TRD Structure Guide

Model the TRD on this structure. Adapt sections based on what the project actually needs -- not every project needs every section, but cover the relevant ones thoroughly. The bar for "thorough" is: someone could build the application from this document alone without needing to ask clarifying questions.

Every technical decision in the TRD should have been validated with the user via AskUserQuestion before writing. Do not select frameworks, libraries, or approaches unilaterally.

## Quality Standards

- Every library choice includes a rationale (why this over alternatives)
- Every API endpoint documents request AND response schemas with concrete JSON examples
- Data schemas show actual example records with realistic data, not just field descriptions
- State management documents the full store shape as a tree structure
- Architecture diagrams use ASCII art showing component relationships and data flow
- Performance considerations are inline with the component they affect, not in a separate section
- Environment variables have defaults and descriptions
- Project directory trees annotate every file's purpose

## TRD Sections

### 1. Architecture Overview

High-level system diagram showing all components and how they communicate. Use ASCII art.

**Depth expected:**
```
Request flow:
1. Browser loads the React SPA from FastAPI's static file serving
2. React app uses TanStack Query to poll GET /api/images every 5 seconds
3. Sidebar thumbnails are loaded from GET /api/images/{id}/thumbnail
4. Full-resolution images are loaded when placed into canvas frames
5. Project save/load goes through POST/GET/PUT/DELETE /api/projects
6. PNG export happens entirely client-side using Konva's toDataURL()
```

Not just "the frontend talks to the backend" -- trace the actual request path.

### 2. Frontend Technical Stack (if applicable)

#### Core Libraries Table

| Library | Version | Purpose |
| --- | --- | --- |
| React | 19.x | UI framework |
| TypeScript | 5.x | Type safety |

Every library needs a version (ranges like `5.x` or `>=0.115` are fine). If the choice isn't obvious, add a "Why this library" note explaining the decision over alternatives.

#### State Management

Document the full store structure as a tree:

```
projectStore
├── project metadata (name, style, version)
├── pages[] (array of page objects)
│   ├── layout (preset reference)
│   └── frames[] (array of frame objects)
│       └── image (nullable)
│           ├── src (file path)
│           ├── x, y (position)
│           └── scale
├── activePageIndex
└── selectedFrameIndex (nullable)
```

Explain what state is tracked, what triggers re-renders, and what gets persisted vs stays ephemeral.

#### Key Interaction Patterns

Document how major interactions work at the implementation level -- not "drag and drop is supported" but how it's wired up:

- What library handles the drag initiation?
- What happens on drop? (which store action fires, what data transforms)
- How is hit detection implemented?
- What are the performance considerations?

#### Rendering Architecture

If the app has non-trivial rendering (canvas, WebGL, complex DOM), document the layer/component structure and key rendering decisions.

### 3. Backend Technical Stack (if applicable)

#### Core Libraries Table

Same format as frontend -- library, version, purpose, rationale for non-obvious choices.

#### API Design

Full endpoint table with method, path, and description. Then for each endpoint (or at minimum for the primary ones), document request and response schemas:

```
GET /api/images
Response:
[
  {
    "id": "a1b2c3d4",
    "filename": "warrior_pose_001.png",
    "mtime": 1710500000,
    "width": 1024,
    "height": 1024
  }
]
Supports: ?since={mtime} for incremental polling
```

```
POST /api/projects
Request body:
{
  "name": "My Comic Issue 1",
  "style": "manga"
}
Response:
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### Error Handling

Document how errors propagate through the system:
- What the backend logs (format, levels, destination)
- What error responses look like (status codes, error body schema)
- How the frontend displays errors to the user
- Error response schema example:

```json
{
  "error": "not_found",
  "message": "Project with ID abc123 does not exist",
  "status": 404
}
```

#### Data Storage

Document the storage approach (database schema, file storage, etc.) with concrete examples of stored records. If using a database, show the table structure and migration strategy (Alembic, Prisma Migrate, raw SQL, etc.). If using JSON files, show the file schema.

#### Background Processing

If the backend does work outside of request handling (file watching, scheduled jobs, queue processing), document the mechanism and lifecycle.

#### Configuration

Environment variables table:

| Variable | Default | Description |
| --- | --- | --- |
| `APP_PORT` | `3000` | Server port |
| `DATABASE_URL` | `sqlite:///data.db` | Database connection |

### 4. Data Format Specifications

Concrete schemas for all key data structures with realistic example records:

```json
{
  "id": "b_1710500000000_xk2m9f",
  "title": "The Name of the Wind",
  "author": "Patrick Rothfuss",
  "tags": ["fantasy"],
  "status": "done",
  "rating": 5,
  "dateAdded": "2026-01-10",
  "dateFinished": "2026-02-02"
}
```

Annotate fields with types, constraints, and design decisions (e.g., "coordinates are normalized to 0-1 range relative to page dimensions -- actual pixel coordinates are computed at render time").

### 5. Deployment and Packaging

Include what's appropriate for the project:
- For Docker-based projects: Dockerfile strategy (multi-stage builds, slim/alpine base images, non-root USER), docker-compose with full service definitions, volume mounts, container expectations (process model, healthchecks, graceful shutdown). Never copy .env files or secrets into image layers.
- For CLI tools: installation method, dependency management, distribution
- For static sites: hosting options, build steps if any
- For any project: environment configuration, secrets management, health check endpoint if applicable

### 6. Project Structure

Full directory tree with annotations explaining every file:

```
src/
├── main.tsx                     # App entry point
├── App.tsx                      # Root component, providers, layout
├── api/                         # TanStack Query hooks and fetch functions
│   ├── images.ts                # Image list query, thumbnail URLs
│   └── projects.ts              # Project CRUD mutations and queries
├── stores/                      # Zustand stores
│   ├── projectStore.ts          # Project state, pages, frames, images
│   └── uiStore.ts               # UI state (selection, sidebar tab, modal)
```

Every file should be annotated. The tree should be comprehensive enough that someone could create all the files from it.

### 7. Testing Strategy

Every project needs testing. The TRD should define the testing approach concretely, not leave it as a vague "we'll add tests."

**Unit Testing:**

| Test Area | Scope | Libraries |
| --- | --- | --- |
| Polygon math | point-in-polygon, clamping, cover scale | Vitest |
| Store logic | State mutations, undo/redo behavior | Vitest |
| API hooks | TanStack Query hooks with MSW mocking | Vitest, MSW |

Specify what critical logic needs unit test coverage. Document coverage expectations or philosophy (e.g., "cover all data transformations and business logic" or "80% line coverage on core modules").

**Integration Testing:**

| Test Area | Scope | Libraries |
| --- | --- | --- |
| API endpoints | All REST endpoints with test database | pytest, httpx |
| Project service | Save/load/validate round-trips | pytest |

**E2E Testing:**

| Test Area | Scope | Libraries |
| --- | --- | --- |
| Image placement | Drag from sidebar to frame, verify render | Playwright (Chromium) |
| Project save/load | Save, reload, verify state | Playwright (Chromium) |

E2E tests should validate core user flows end-to-end. Specify what flows need E2E coverage and what browser/platform to target.

**Test Configuration:**
- Test runner configuration (reporters, verbose mode)
- Coverage tool and provider (v8, istanbul, coverage.py)
- Fixture strategy (test databases, mock servers, seed data)
- Whether tests are a gate for commits or PRs (pre-commit hooks, CI checks)

### 8. Security

Document security considerations appropriate to the project:

- **Input validation:** Where and how user input is validated and sanitized (both client and server side)
- **Authentication/authorization:** Implementation details for the auth model chosen during discovery
- **CORS configuration:** Allowed origins, methods, headers
- **Security headers:** CSP, X-Frame-Options, etc. (or middleware like helmet)
- **Secrets management:** Where secrets live (.env files), how they're loaded, what's in .gitignore
- **Dependency scanning:** Tool for vulnerability checks (npm audit, pip-audit, Snyk)
- **Docker security** (if applicable): Non-root USER, no secrets in layers, minimal base images
- **OWASP considerations:** Which of the OWASP top 10 are relevant to this stack and how they're addressed

For projects with low data sensitivity (personal tools, no PII), this section can be brief. For projects handling sensitive data, it should be thorough.

### 9. Code Quality Tooling

Every project should ship with linting and formatting configured. This is not optional.

| Tool | Config File | Purpose |
| --- | --- | --- |
| ESLint | `.eslintrc.json` | JavaScript/TypeScript linting |
| Prettier | `.prettierrc` | Code formatting |
| TypeScript | `tsconfig.json` (strict: true) | Type checking |

Or for Python:

| Tool | Config File | Purpose |
| --- | --- | --- |
| Ruff | `ruff.toml` or `pyproject.toml [tool.ruff]` | Linting + formatting |
| mypy | `mypy.ini` or `pyproject.toml [tool.mypy]` | Type checking |

Document:
- Linter rules or preset (e.g., "ESLint recommended + React hooks plugin")
- Formatter configuration (line width, quote style, etc.)
- Type checking strictness level
- Pre-commit hooks if applicable (husky, pre-commit framework)
- CI enforcement (lint and type check must pass before merge)

### 10. Key Technical Risks and Mitigations

Risk table:

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Large images on canvas may affect performance | Slow pan/resize below 60fps | Use cache() on frame groups, monitor memory, consider downscaling |

Focus on risks that are specific to this project's technical choices, not generic software risks.

### 11. Dependency Summary

Complete dependency lists for both frontend and backend, organized by production vs dev dependencies. Include enough detail that someone could create the package.json or requirements.txt from this section alone.

Consider whether automated dependency updates (Dependabot, Renovate) should be configured for the project.

## Writing Guidelines

- Be specific about library versions (use ranges like `>=0.115` or major versions like `5.x`)
- Include ASCII architecture diagrams where they clarify the system
- Show concrete examples of data structures with realistic data, not placeholders
- Explain "why this library" for every non-obvious choice -- the user confirmed the choice, the TRD should document the reasoning
- Performance considerations belong inline with the component they affect
- Every environment variable needs a default value and description
- Document algorithms and non-trivial logic at the implementation level, not just "the system does X"
