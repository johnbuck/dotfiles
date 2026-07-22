# Technical depth: how deep the Technical approach should go

The bar for the "Technical approach" section of a spec when the work is **non-trivial**. The test
of "deep enough": whoever builds it could implement it from the spec without having to ask. Scale
to the work: a one-line fix needs none of this; a new service or a multi-file feature needs most
of it. Do not manufacture depth a small change does not warrant, and when you do not actually know
a detail, say so in the Assumptions block rather than inventing it.

Every technical choice should already have been decided during planning (from the operator's stated
preference or from the house preferences). The spec documents the reasoning; it does not decide
unilaterally.

## Depth standards (include the ones that apply)

- **Architecture / request-flow trace.** Do not write "the frontend talks to the backend"; trace
  the actual path. ASCII where it clarifies. Example:
  ```
  1. Browser loads the web page from FastAPI static serving
  2. The page asks GET /api/images every 5s
  3. Full-size images load on demand when placed in a frame
  4. Save and load go through POST/GET/PUT/DELETE /api/projects
  ```

- **Library table.** Library | Version (ranges like `5.x` / `>=0.115` are fine) | Purpose. A
  one-line "why this over the alternative" for any non-obvious choice.

- **Data / state shapes.** Show the real shape, not field names. For a store, a tree; for a record,
  a realistic JSON example with field constraints noted:
  ```json
  { "id": "b_1710500000000_xk2m9f", "title": "The Name of the Wind",
    "status": "done", "rating": 5, "dateAdded": "2026-01-10" }
  ```
  Note anything non-obvious ("coordinates are 0 to 1 relative to the page; pixels are computed at
  render time").

- **API design.** Endpoint table (method, path, description). For the main endpoints, the request
  AND response shape with a concrete JSON example.

- **Error handling.** How errors travel: what is logged (format, level, destination), the error
  response shape, and how the user sees it:
  ```json
  { "error": "not_found", "message": "Project abc123 does not exist", "status": 404 }
  ```

- **Data storage.** Schema plus a concrete stored record. For a database: the table structure and
  the migration approach (additive and reversible; see data stewardship). For files: the file
  shape.

- **Background processing.** If work happens outside handling a request (timers, watchers, queues),
  the mechanism and lifecycle.

- **Configuration.** Env-var table: Variable | Default | Description. Every variable has a default
  and a description; secrets come from a local `.env` that is never committed.

- **Project structure.** For new code, an annotated directory tree: every file with a one-line
  purpose, complete enough to create the files from.

- **Key technical risks.** Risk | Impact | Mitigation. Only risks specific to THIS work's technical
  choices, not generic software risks.

## Deployment (when it ships somewhere)
- Docker: the image approach (multi-stage, slim base, a non-root USER), the compose service, its
  volumes, a healthcheck, and graceful shutdown. Never copy `.env` or secrets into image layers.
- CLI: install method, dependency management, how it is distributed.
- Static: hosting and build steps.
- Always: env config, secrets handling, and a health check endpoint if it applies.

## Writing
- Be specific about versions. Show realistic data, not placeholders. Explain "why this library" for
  non-obvious choices. Put performance notes inline with the component they affect, not in a
  separate section. Document non-trivial logic at the implementation level, not "the system does X".
