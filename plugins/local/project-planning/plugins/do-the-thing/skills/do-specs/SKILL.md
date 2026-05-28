---
name: do-specs
description: This skill should be used when the user wants to "start a new project", "define a project", "write a PRD", "write a TRD", "plan a new app", "plan a new tool", "define requirements", "kick off a project", "spec out an idea", "do specs", or describes a new software idea they want to build. Use this skill whenever the user is at the beginning of a new software project and needs to go from idea to requirements documents, even if they don't explicitly mention PRDs or TRDs. This skill covers planning only - for scaffolding code, see do-scaffold.
---

# Define Thing - Project Requirements Planning

This skill guides the creation of a Product Requirements Document (PRD) and Technical Requirements Document (TRD) for a new software project. It produces two markdown files in the project's `docs/` directory that serve as the source of truth for what gets built and how.

The goal is to get from a rough idea to a pair of documents detailed enough that implementation can begin without ambiguity. The process is iterative -- ask questions throughout rather than making assumptions.

## Questioning Approach

Always use the AskUserQuestion tool for gathering requirements, clarifying ambiguity, and getting decisions from the user. Do not rely on plain chat for questions when this tool is available. The AskUserQuestion tool provides structured options that make it faster for the user to respond and reduces miscommunication.

Use AskUserQuestion at every decision point:
- Discovery rounds (vision, behavior, technical direction)
- Clarifying ambiguity in requirements
- Confirming key decisions before writing
- Getting feedback on drafted documents
- Resolving technical tradeoffs during TRD

The tool supports up to 4 questions per call with 2-4 options each, plus multiSelect for non-exclusive choices. Use it liberally -- multiple rounds of structured questions are better than dumping a wall of text questions into chat.

## Process Overview

### Phase 1: Discovery

Before writing anything, conduct a thorough discovery interview using AskUserQuestion. Ask questions progressively across multiple rounds -- start broad, get more specific as the picture forms. Do not batch all questions into a single call. Each round should build on the previous answers.

**Round 1 - Vision and scope (AskUserQuestion):**
- What is this thing? What does it do in one sentence?
- Who is it for? What problem does it solve for them?
- Is this a personal/hobby project or a team/business project?
- Are there existing tools or products that do something similar? What's different here?

**Round 2 - Behavior and interaction (AskUserQuestion):**
- Walk through the primary use case from the user's perspective, step by step
- What are the secondary use cases?
- What should happen when things go wrong? (error states, edge cases)
- Are there any hard constraints? (must work offline, must support mobile, must integrate with X)

**Round 3 - Technical direction (AskUserQuestion):**
- Any preferences on tech stack, or should that be determined during TRD?
- What data does this thing work with? Where does it come from?
- Does it need to talk to external services or APIs?
- What does deployment look like?

Continue asking follow-up rounds with AskUserQuestion until the picture is clear enough to write the PRD. Three rounds is a minimum, not a cap. If answers reveal complexity or ambiguity, ask more. Do not skip discovery. Do not write the PRD based on the first message alone. The user has context in their head that needs to be drawn out through structured questions. The only things worth assuming are well-established industry patterns -- internal decisions and preferences always warrant a question.

### Phase 2: Write the PRD

Read `references/prd-template.md` for the full template structure and writing guidelines.

Create the file at `docs/prd-v01.md` in the project directory. Key points:

- Follow the template structure exactly - keep all numbered headings
- Write plainly and clearly. Avoid flowery language
- Use "should" not "must" for requirements
- Use "interact" or "interaction" not "click" or "tap" for user actions
- Write Gherkin scenarios for both frontend and backend requirements (minimum three each)
- The "long version" in section 2.1 summarizes at a high level and touches on the "why" - detailed specs go in section 4
- Mark anything that needs human follow-up with `[@humanUser description]`
- Success metrics identify what to measure, not prescriptive targets
- Scope section uses "Iteration 1 (MVP)" and "Iteration X (future state)" pattern

After writing the PRD, use AskUserQuestion to confirm key decisions and get feedback before moving to the TRD. Present the major scope and requirement choices as structured options so the user can quickly confirm or redirect. Revise if needed.

### Phase 3: TRD Discovery and Writing

Before writing a single line of the TRD, conduct technical discovery using AskUserQuestion. The PRD defines what to build -- the TRD defines how, and those decisions belong to the user. Do not select frameworks, databases, libraries, or deployment models without asking first. Present options with brief tradeoff descriptions so the user can make informed choices.

**TRD Round 1 - Architecture and stack (AskUserQuestion):**
- Frontend framework (React, Svelte, Vue, server-rendered with HTMX, none, etc.)
- Backend framework (FastAPI, Flask, Express, none, etc.)
- Database and persistence (SQLite, PostgreSQL, localStorage, files, none, etc.)
- ORM or direct queries

**TRD Round 2 - UI and interaction (AskUserQuestion):**
- CSS approach (Tailwind, component library like shadcn/ui, CSS framework like Pico, custom CSS)
- State management approach (Zustand, Redux, Svelte stores, server-side only, etc.)
- Key interaction libraries if applicable (charting, drag-and-drop, virtual scrolling, etc.)

**TRD Round 3 - Deployment and operations (AskUserQuestion):**
- Deployment model (Docker, static hosting, pip-installable CLI, etc.)
- Browser/platform support
- Port and networking preferences
- Logging approach (structured JSON, plain text, log levels)

**TRD Round 4 - Security (AskUserQuestion):**
- Data sensitivity level (public, internal, contains PII, healthcare data, etc.)
- Authentication and authorization model (none, basic auth, OAuth, API keys, etc.)
- Input validation requirements
- Secrets management approach (.env files, vault, etc.)
- Any compliance requirements (HIPAA, SOC2, GDPR, etc.)

**TRD Round 5 - Testing and code quality (AskUserQuestion):**
- Unit testing approach and coverage expectations
- E2E testing requirements (Playwright, Cypress, etc.)
- Test frameworks for each layer (pytest, Vitest, etc.)
- Linter and formatter (ESLint + Prettier, Ruff, etc.) -- these are not optional, every project needs them
- Type checking strictness (TypeScript strict mode, mypy, etc.)
- Pre-commit hooks or CI gates for quality checks
- Monitoring or observability needs

Continue asking until every major technical decision has been validated. Then read `references/trd-guide.md` for the structure and depth expectations.

Create the file at `docs/trd-v01.md`. Every library choice in the TRD should include a brief rationale explaining why it was chosen over alternatives. Every API endpoint should document request and response schemas with concrete JSON examples. Data schemas should show actual example records, not just field descriptions. The TRD should be detailed enough that someone could build the application from it without needing to ask clarifying questions.

### Phase 4: Review and Iterate

After both documents exist, use AskUserQuestion to check whether the user wants revisions. Common revision patterns:
- Scope changes (move items between MVP and future iterations)
- Missing use cases discovered during TRD writing
- Technical constraints that affect product requirements
- Gherkin scenarios that need refinement

Version documents as `prd-v02.md`, `trd-v02.md` etc. for significant revisions. Keep previous versions for reference.

## Defaults and Preferences

These are strong defaults that reflect how the user typically works. Apply them unless the project has a clear reason to do something different. When in doubt, ask during discovery.

### Sandboxed dependencies
Prefer containerization (Docker) or other sandboxing over installing application-level packages (npm, pip, etc.) directly on the host machine. The motivation is security and isolation - firewalling project dependencies from the host. However, not every project needs Docker. A simple CLI script, a browser extension, or a static site generator might be better served by a lighter approach. Choose the right tool for the job and discuss the tradeoff during discovery.

### Git from the start
The project should be a git repository from the beginning. The TRD should account for a `.gitignore` appropriate to the stack, and the directory structure should be repo-ready.

### Deployment approach
During discovery, determine the right deployment model for the project. Docker with docker-compose is a good default for web applications and multi-service tools, but consider whether the project actually benefits from containerization or whether a simpler approach fits better.

## File Organization

```
project-root/
├── docs/
│   ├── prd-v01.md
│   ├── trd-v01.md
│   └── (subsequent versions as needed)
├── .gitignore
└── (application code and deployment config as appropriate)
```

## Reference Files

- **`references/prd-template.md`** - Full PRD template with all sections and writing guidelines. Read this before writing any PRD.
- **`references/trd-guide.md`** - TRD structure guide with section descriptions and writing guidelines. Read this before writing any TRD.
