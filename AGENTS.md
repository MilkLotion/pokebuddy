# Repository Guidelines

## Source of Truth and History

Public documentation lives in `docs/` and describes current behavior and rules. Work records live in `worklog/`, which is git-ignored and never published (decided 2026-09-27).

Public (`docs/`, committed):
- `docs/guide.md`: how to install and use the app (installer users).
- `docs/design.md`: product structure and design principles.
- `docs/specs/<feature>.md`: current feature contracts (`game.md`, `scenarios.md`, `balance.md`, `modules.md`, `companion.md`, `ui-components.md`).
- `docs/terms.md`: canonical name and meaning for each user-facing term.
- `docs/contributing/`: development and release, workflow, writing rules, Figma notes.
- `docs/images/`: README and guide screenshots. `docs/images/README.md` lists the pending captures.

Local only (`worklog/`, git-ignored):
- `worklog/progress.md`: current stage, next action, and validation status.
- `worklog/records/<task>/<task>.md`: design, work, review, feedback, and revision in one record. Name every worklog file uniquely in the repository, so the Obsidian graph shows distinct names. Use `<task>-plan.md`, `<task>-review.md`, and similar names for split records. Do not use `README.md` or `record.md` in `worklog/`.
- `worklog/records/<task>/evidence/`: observations, JSON, and screenshots for that task.
- `worklog/history/YYYY-MM.md`: concise dated record of completed work cycles.

Keep only README, design, terms, and guide files at the docs root. Allowed folders are `specs/`, `contributing/`, and `images/`. Public docs must not link into `worklog/`; `scripts/check-docs.cjs` fails on such links. Code comments may name a worklog path as a private pointer. Reuse an existing task record for follow-up work. Do not create separate plan/review/feedback files for each small edit. Keep existing split records in their task folder. Follow [the workflow](docs/contributing/workflow.md).

Link source files, data, commands, and review evidence. Resolve conflicts with `design.md` for decisions and `worklog/progress.md` for status. Code proves current behavior, not user approval. Preserve reasons, corrections, constraints, and context beside the relevant task. Link them from the affected specification. Record the source and whether a claim is confirmed or proposed. Never infer missing intent.

## Required Work Cycle

Unless the user gives a different instruction for a task, every task starts with a solid plan, including small fixes. Write the goal, scope, SSOT files, risks, and acceptance checks before you change code. When you report, state what you did in each step below.

Use this order for every feature or bug fix:

Role instructions: [design](docs/contributing/roles/design.md), [work](docs/contributing/roles/work.md), [review](docs/contributing/roles/review.md), [feedback](docs/contributing/roles/feedback.md), and [revision](docs/contributing/roles/revision.md).

1. **Design:** record goal, scope, SSOT files, risks, and acceptance checks.
2. **Work:** make a focused change. Update the existing task record and affected specification.
3. **Review:** run relevant checks. Record commands and results.
4. **Feedback:** list failures, ambiguity, and review comments.
5. **Revision:** fix findings, rerun affected checks, and update changed facts only. Add one concise entry to the current monthly history when the work cycle ends.

Do not commit or push with open findings. For design-only work, stop after Design and mark implementation as not started.

## ASD-STE100 Writing

Read [`docs/README.md`](docs/README.md) for the document map and evidence priority. Apply [`docs/contributing/writing.md`](docs/contributing/writing.md) to every changed technical passage. Use one fact or instruction per sentence, exact identifiers, one term per concept, and conditions before actions. Separate user decisions, observations, proposals, and historical results. Korean text applies these principles; it does not claim formal ASD-STE100 compliance.

Before completion, manually review changed prose with the writing checklist. Record the scope and result in the task record. Run `node scripts/check-docs.cjs` and `git diff --check` for document changes. The script checks structure and references, not semantic correctness or STE compliance. Do not run builds or lint automatically for document-only work.

## Project Structure

- `src/`: TypeScript runtime. Main process is in `src/main/`; other features are grouped by module.
- `src/renderer/`: all windows (stage, settings `manage/`, device windows, menus, picker).
- `data/`: editable rules and species data.
- `assets/`: fonts, item icons, and logo. `scripts/`, `bin/`, `helpers/`: packaging tools. `bin/pokebuddy` is a thin entry; commands live in `src/cli/main.ts`.
- `docs/`: records.

Read [`docs/contributing/code-map.md`](docs/contributing/code-map.md) before changing code. It lists where each kind of code goes, the import rules that `check-deps` enforces, and the common code for shared behavior (dialogs, two-pane dialogs, scrim and window-button dimming, device frame, quantity input, coach marks, count text, banners). Same feature, same behavior: reuse that common code instead of writing a per-window copy. If a window needs different behavior, add an option to the common code, and first confirm the rule in `docs/specs/`.

## Build and Test Commands

Use Node.js `>=22.12` and npm.

```powershell
npm install                 # install dependencies and run postinstall
npm run build               # compile main and renderer to dist/
npm run check               # type-check without output
npm run selftest            # build and run all self-tests
npm start                   # build and launch Electron
npm run data:build          # rebuild generated data
```

Run a focused check, such as `node dist/tools/selftest/selftest-shop.js`, after building.

For a real-run check of the app, follow [작업 전용 시험 HOME 실기](docs/contributing/development.md#작업-전용-시험-home-실기). Use a test HOME for the task in this repository (`.claude/test-home/<task>`). Do not create it in the user home (`~/.claude`). Create the save before the first start. Use `POKEBUDDY_ONLINE=off` when the check does not need the server. Do not capture the full screen. Delete the test HOME when the check is complete.

## Style and Naming

Use TypeScript. Follow nearby files for two-space indentation, semicolons, and single quotes. Use `camelCase` for values and functions, `PascalCase` for types and classes, and kebab-case for CLI commands and data files. Rebuild after source changes; never edit `dist/` by hand. Keep strings in i18n files.

## Commits, PRs, and Safety

Use short imperative subjects, such as `feat: S4 해금·상점·진화` or `docs: add S5 settings design preview`. Keep commits focused. PRs describe behavior, checks, plan or issue links, and UI screenshots when relevant. Use temporary data or HOME paths. Treat saves, hooks, and mailbox data as user-owned. Preserve Electron IPC checks, context isolation, and sandbox settings.
