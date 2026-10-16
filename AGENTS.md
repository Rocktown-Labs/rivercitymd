<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `pnpm dlx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

---
applyTo: "**/*.{ts,tsx,js,jsx}"
---

# GitHub‑Driven Development Workflow

This file defines how autonomous agents should plan, implement, test, and ship code using **GitHub Issues, GitHub Projects, and Pull Requests as the source of truth**.

The goal is to enforce a reliable **Plan → Branch → Implement → Test → PR → Merge → Ship** workflow while integrating tightly with the GitHub CLI (`gh`).

Reference:
https://cli.github.com/manual/gh

---

# Core Principles

1. **GitHub is the source of truth**
   - Issues define work
   - Projects track progress
   - PRs ship code

2. **Never push directly to `main` or `master`**

3. **Every change must trace to a GitHub Issue**

4. **All work flows through a Pull Request**

5. **Project status must reflect real development state**

---

# Development Lifecycle

Agents must follow this lifecycle.

1. Discover or create Issue
2. Ensure repository Project exists
3. Add Issue to Project (Backlog)
4. Enter Plan Mode
5. Create branch
6. Implement
7. Run quality gates
8. Preview if applicable
9. Open Pull Request
10. Update Project status
11. Address CI/review
12. Merge
13. Mark Project item Done

---

# Plan Mode (Required Before Coding)

Before generating code, the agent must:

1. Read the GitHub Issue
2. Extract acceptance criteria
3. Identify affected files
4. Identify required tests
5. Define implementation strategy
6. Confirm branch strategy

Plan output should include:

- Issue link
- Implementation steps
- File changes
- Test strategy
- Branch name
- PR plan

Agents must **not begin coding until Plan Mode completes**.

---

# GitHub CLI Operational Commands

Agents should use `gh` for GitHub interactions.

## Verify authentication

```bash
gh auth status
```

## Confirm repository context

```bash
gh repo view
```

---

# Issue Workflow

## List Issues

```bash
gh issue list --state open
```

## Search Issues

```bash
gh issue list --search "<keywords>"
```

## View Issue

```bash
gh issue view <issueNumber> --comments
```

## Create Issue

```bash
gh issue create --title "feat: ..." --body "..."
```

Issue titles must follow:

- `feat:`
- `fix:`
- `chore:`

Example:

```
feat: add authentication middleware
```

---

# GitHub Project Workflow

Every repository should have a **GitHub Project (kanban)** attached.

Agents must ensure a project exists before beginning work.

## Determine repo owner

```bash
gh repo view --json owner,name -q '.owner.login'
```

## List Projects

```bash
gh project list --owner <orgOrUser>
```

## View Project

```bash
gh project view <projectNumber> --owner <orgOrUser>
```

## Create Project if none exists

```bash
gh project create \
  --owner <orgOrUser> \
  --title "<repo-name> Project"
```

---

# Project Status Mapping

| Development State | Project Status |
| ----------------- | -------------- |
| Issue created     | Backlog        |
| Branch created    | In Progress    |
| PR opened         | In Review      |
| PR merged         | Done           |

---

# Add Issue to Project

```bash
gh project item-add <projectNumber> \
  --owner <orgOrUser> \
  --url <issueUrl>
```

---

# View Project Items

```bash
gh project item-list <projectNumber> \
  --owner <orgOrUser>
```

---

# Update Project Status

Retrieve field IDs:

```bash
gh project view <projectNumber> \
  --owner <orgOrUser> \
  --format json
```

Update status:

```bash
gh project item-edit <projectNumber> \
  --owner <orgOrUser> \
  --id <itemId> \
  --field-id <statusFieldId> \
  --single-select-option-id <optionId>
```

If status update cannot be performed due to missing IDs, log the reason and continue development.

---

# Branch Strategy

Branches must always derive from `main`.

Update main first:

```bash
git checkout main
git pull origin main
```

Create branch:

```bash
git checkout -b <type>/<slug>-<issueNumber>
```

Branch naming rules:

```
feat/<slug>-<issueNumber>
fix/<slug>-<issueNumber>
chore/<slug>-<issueNumber>
```

Example:

```
feat/auth-middleware-42
```

Rules:

- lowercase
- kebab-case
- descriptive slug

---

# Pull Request Rules

PR title must match the Issue title exactly.

Required PR body:

```
## Summary

## Implementation Notes

## Testing Notes

Closes #<issueNumber>
```

Create PR:

```bash
gh pr create \
  --title "<issueTitle>" \
  --body "<PR body>" \
  --base main \
  --head <branchName>
```

---

# Merge Rules

Only merge when:

- CI passes
- Tests pass
- Review feedback resolved

Merge PR:

```bash
gh pr merge --merge --delete-branch
```

After merge:

- Issue closes automatically
- Move Project item → Done

---

# Required Quality Gates

Agents must run before PR:

```bash
pnpm check
pnpm typecheck
pnpm test
```

If lint fixes required:

```bash
pnpm fix
```

Follow **Ultracite standards**.

---

# Repository Architecture Conventions

Follow existing project structure.

```
app/
components/
lib/
db/
workflows/
```

Avoid unrelated refactors.

Changes must stay focused on the Issue.

# Agent Skill Routing

Before implementing any work, agents must inspect `.agents/skills` to check if a specific guideline matches their task. Below is a categorized directory of available workspace skills:

### 🗄️ Backend & Database (Convex)
*   **Convex Routing**: `.agents/skills/convex` — Umbrella skill for all database logic.
*   **Zen of Convex**: `.agents/skills/convex-best-practices` — Architectural guidelines.
*   **Functions & Endpoints**: `.agents/skills/convex-functions` — Queries, mutations, and actions.
*   **Schema & Validations**: `.agents/skills/convex-schema-validator` — Types and DB index rules.
*   **Realtime Queries**: `.agents/skills/convex-realtime` — Paginated and reactive queries.
*   **Database Migrations**: `.agents/skills/convex-migrations` — Schema updates and database backfills.
*   **Background Jobs**: `.agents/skills/convex-cron-jobs` — Cron scheduler and queue parameters.
*   **Security & Audit**: `.agents/skills/convex-security-check` and `/convex-security-audit` — RLS permissions and API limits.
*   **Convex Agents**: `.agents/skills/convex-agents` — Thread managers and tool mappings.
*   **File Storage**: `.agents/skills/convex-file-storage` — Media/image uploads.
*   **Reusables**: `.agents/skills/convex-component-authoring` — Creating self-contained elements.
*   **Webhooks**: `.agents/skills/convex-http-actions` — Third-party webhook handling.

### 🎨 Frontend & Styling (Next.js, React, UI)
*   **Visual Aesthetics**: `.agents/skills/frontend-design` — Designing premium, modern interfaces (avoid generic plain styles).
*   **W3C/Responsive Audits**: `.agents/skills/web-design-guidelines` — Accessibility guidelines.
*   **Component Architecture**: `.agents/skills/vercel-composition-patterns` — Compounds and render props.
*   **Core Performance**: `.agents/skills/vercel-react-best-practices` — Next.js routing and hydration rules.
*   **Mobile Frameworks**: `.agents/skills/vercel-react-native-skills` — React Native guidelines.

### ✉️ Email & Communication (Resend, React Email)
*   **Resend Delivery**: `.agents/skills/resend` and `/resend-design-skills` — Transmitting and styling emails.
*   **HTML Templates**: `.agents/skills/react-email` — Styling responsive layouts with React.
*   **Sequences**: `.agents/skills/emails` and `/email-best-practices` — Lifecycle and transactional emails.
*   **Cold Outreach**: `.agents/skills/cold-email` — B2B SDR prospecting sequences.

### 📈 Product Growth & Monetization (SaaS Metrics)
*   **Pricing Plans**: `.agents/skills/pricing` — Packaging and tier decisions.
*   **Upgrade Screens**: `.agents/skills/paywalls` — Modals and limits conversions.
*   **Offboarding**: `.agents/skills/churn-prevention` — Cancel flows.
*   **Affiliate Loops**: `.agents/skills/referrals` — Partner recommendations.
*   **Activation Funnels**: `.agents/skills/onboarding` — User activation checklists.
*   **Scope Restriction**: `.agents/skills/avoid-feature-creep` — Preventing MVP bloat.

### 📣 Marketing & SEO
*   **ICP & Positioning**: `.agents/skills/product-marketing` — Audience definition and messaging.
*   **Ad Copy**: `.agents/skills/copywriting` and `/copy-editing` — High-converting landing copy.
*   **Traditional SEO**: `.agents/skills/seo-audit` — Crawl diagnostics and site speed.
*   **pSEO Scale**: `.agents/skills/programmatic-seo` — Landing page templates.
*   **AI Engine Optimization**: `.agents/skills/ai-seo` — Citations in ChatGPT/Claude/Gemini.
*   **Lead Capture**: `.agents/skills/lead-magnets` — Opt-in PDFs.
*   **SDR Sourcing**: `.agents/skills/prospecting` — Account qualification.
*   **Content Channels**: `.agents/skills/social` and `/video` — LinkedIn/X feeds and script generation.
*   **Sales collateral**: `.agents/skills/sales-enablement` — One-pagers and decks.
*   **Revenue Pipeline**: `.agents/skills/revops` — Leads scoring.
*   **Tracking**: `.agents/skills/analytics` — Event tracking.

### 🛠️ Monorepos & Discovery
*   **Monorepo Tasks**: `.agents/skills/turborepo` — Cache pipelines.
*   **Finding Skills**: `.agents/skills/find-skills` — Custom extension searches.

Agents must inspect the relevant skill's `SKILL.md` before writing code.

---

# Changelog Update Rule

Whenever any feature, bug fix, or configuration update is developed, the agent must update `CHANGELOG.md` in the root of the project **directly inside the feature/fix branch before creating the PR**:
1. **Group logical changes**: Place changes under semantic release versions (e.g. `v1.0.0` or incremental patch bumps).
2. **Standard Headers**: Segment updates under `Added`, `Fixed`, or `Changed`.
3. **Format**: Maintain concise, dated, bulleted items.
4. **Single-Commit Builds**: Always commit `CHANGELOG.md` within the PR branch so the PR merge contains the version bump in a single commit, avoiding duplicate Vercel deployment builds.

---

# Synchronization Rule

Keep this file synchronized with:

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `.agents/workflow/*`

When updating workflow rules, update all references in the same PR.

---

# Summary

Agents must operate using:

Issue → Plan → Branch → Implement → Test → PR → Merge → Done

GitHub Issues and Projects must always reflect the **true state of development**.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`packages/backend/convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
