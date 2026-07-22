# ACES Shopify Builder - Agent Instructions

## Single Source of Truth

- Before any repository, Shopify, deployment, architecture, or project-documentation task, read the full `Project_Master_Context_V5.4_Current_Baseline.md`.
- Pure conversation, translation, and stakeholder-reply drafting do not require reading the SSOT unless they make project claims or change project documentation.
- V5.4 is the current locked absolute SSOT. Its local Word export is `Project_Master_Context_V5.4_Current_Baseline.docx` and is intentionally ignored by Git.
- `Project Master Context V5.2 Final` remains an immutable historical baseline; do not modify it.
- Do not rely on historical chat records as project authority. Current stakeholder feedback explicitly supplied by Huang may be recorded as confirmed product input in non-SSOT requirements documentation; it does not override SSOT locks or authorize external actions.
- If repository facts conflict with old reports, trust the current code, tests, and SSOT.
- Future architecture updates belong in a V5.5 or newer SSOT.

## Communication Rules

- Unless Huang explicitly asks for another language, all replies, implementation reports, risk analyses, summaries, and recommendations must use Simplified Chinese by default.
- Source code, identifiers, API names, CLI commands, Shopify official fields, filenames, and config keys should remain in English.
- Content intended for Josh or other English-speaking recipients should be written in English only when Huang explicitly requests it.
- Responses should be concise and engineering-focused. Avoid repeated background and unrelated long explanations.
- Clearly distinguish verified facts, assumptions, recommendations, and unverified items.

## Current Baseline

- Current phase: Bundle Admin local baseline is complete; development-only pre-built SKU Function diagnosis and local hardening are in progress within the Production Architecture Baseline.
- Current runtime authority: hard-coded Cart Transform Shared Core.
- Runtime Snapshot: production remains hard-coded; dev candidate promotion code is implemented and previously validated, but deployed Function state must be confirmed before Function work.
- Next planned target: resolve the development-store pre-built Checkout no-op through read-only active-version/input evidence and a minimal dev-only hosted bisect if separately approved. Guarded publication, rollback, and production work remain separate phases.
- Do not switch production runtime authority without Huang's explicit approval.

## Environment Rules

- Only development app: `cart-transform-poc-dev`.
- Development store: `huang-mvqquz1p.myshopify.com`.
- Development config: `shopify.app.dev.toml`.
- Local preview config: `shopify.app.local.toml`.
- Custom Distribution App: `cart-transform-poc`.
- Without explicit approval, do not touch, deploy, modify, or run scripts against the Custom Distribution App.
- Do not automatically run seed scripts.
- Do not modify store configuration, products, inventory, metafields, or theme unless the task explicitly authorizes it.

## Architecture Locks

- Option C must not change.
- Cart keeps a single Master Kit parent line.
- Checkout and Orders expand into components.
- Inventory deducts components only.
- `lineUpdate` is prohibited.
- Runtime `productVariantComponents` is prohibited.
- Bundle Metadata V1 must not be broken.
- Native Dawn Add to Cart must continue to be bypassed on Builder pages.
- Component products must keep the native Dawn product template.
- Dedicated Builder template isolation must be preserved.

## Development Workflow

### Huang's Local-First Release Policy

- Continue feature work, tests, and documentation locally by default.
- Do not present a Sealos/Devbox release as the automatic next ordinary step after a local batch. When Huang asks for planning, timelines, or release options, state the external approval dependency clearly.
- Accumulate compatible local Bundle Admin work until Huang explicitly asks to commit, push, release, or perform a real embedded-Shopify validation.
- Shopify writes, Function/Theme deployment, Sealos release, commit, and push are external mutations and require Huang's explicit approval, even when local validation passes.
- Read-only browser, Shopify CLI, Admin API, registration, active-version, and Function-log diagnostics are allowed only when Huang explicitly asks to diagnose or verify live state. Announce the exact development app/store target first and do not mutate external state.

Every repository, Shopify, deployment, architecture, or project-documentation task must:

1. Read the SSOT.
2. Check `git status` and relevant diffs.
3. Define the current scope and prohibited actions.
4. Verify current behavior before changing it when behavior is relevant.
5. Make the smallest safe change.
6. Run relevant tests, build, or lint when code changes require them.
7. Report browser or Shopify live behavior that was not verified.
8. Do not deploy, commit, push, or clean the working tree without approval.

## Evidence-First Debugging

- No evidence-free fixes.
- Locate the failing layer before acting.
- For Builder issues, inspect assets and console behavior first.
- For add-to-cart issues, inspect `/cart.js` first.
- For Checkout expansion issues, inspect Function profile, active version, registration, and invocation.
- A Cart Transform record existing does not prove the Function is executing correctly.
- Deleting, recreating registration, or rolling back deployment requires evidence and approval.
- Browser manual validation cannot be replaced by local mock input.

## Function Profile Rules

- Production entry/query must stay free of dev tokens.
- The dev profile may only be used with dev/local config.
- Production-clean assertion must pass before approved deployment.
- After dev build/typegen, restore production query, generated types, and artifacts when required by the project workflow.
- Before deployment, clearly print profile, config, app, and store.
- Do not deploy the dev shadow profile by default.
- The current development-store Function profile/version is not assumed from documentation. Confirm the active app version, Function extension, and Cart Transform binding before any Function diagnosis or deployment.

## File and Working-Tree Safety

- This repository may contain many uncommitted changes.
- Do not run `reset`, `clean`, `checkout`, `stash`, `revert`, or delete files unless Huang explicitly approves.
- Do not mix unrelated dirty files into the current change.
- Reports must separate this task's changes from pre-existing working-tree changes.
- Do not add SSOT docx files, secrets, local config, or temporary files to commits unless explicitly requested.

## Response Format

After implementation tasks, default to this concise structure:

### 完成内容

### 修改文件

### 验证

### 风险或未完成项

### 下一步

Complex architecture tasks may add necessary sections, but avoid mechanically outputting long templates.

## Stop Conditions

Stop and report instead of guessing when:

- Target app, store, or Client ID cannot be confirmed.
- The task needs writes to production or the Custom Distribution App.
- A secret is required but cannot be obtained safely.
- Shopify live evidence cannot be obtained.
- The task requires changing locked architecture.
- An unexpected file must be modified, overwritten, or overlaps the current task's change scope.
- The task may overwrite or lose uncommitted code.
