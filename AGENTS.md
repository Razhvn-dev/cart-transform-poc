# ACES Shopify Builder - Agent Instructions

## Single Source of Truth

- Before every task, read the full `Project Master Context V5.2 Final`.
- V5.2 is the current locked absolute SSOT.
- Do not rely on historical chat records.
- If repository facts conflict with old reports, trust the current code, tests, and SSOT.
- Do not modify V5.2. Future architecture updates belong in a future V5.3 or newer SSOT.

## Communication Rules

- Unless Huang explicitly asks for another language, all replies, implementation reports, risk analyses, summaries, and recommendations must use Simplified Chinese by default.
- Source code, identifiers, API names, CLI commands, Shopify official fields, filenames, and config keys should remain in English.
- Content intended for Josh or other English-speaking recipients should be written in English only when Huang explicitly requests it.
- Responses should be concise and engineering-focused. Avoid repeated background and unrelated long explanations.
- Clearly distinguish verified facts, assumptions, recommendations, and unverified items.

## Current Baseline

- Current phase: Production Architecture Baseline.
- Current runtime authority: hard-coded Cart Transform Shared Core.
- Runtime Snapshot: shadow validation only.
- Next planned target: Phase 3.2 Runtime Snapshot Authority Migration.
- Do not switch runtime authority without Huang's explicit approval.

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

Every task must:

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
- The current development store has been restored to production-profile hard-coded Function behavior. Do not switch it again unless the task explicitly approves it.

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
- An unexpected file must be modified.
- The task may overwrite or lose uncommitted code.
