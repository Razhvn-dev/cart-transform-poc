# Bundle Admin Recovery Release Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the existing local Bundle Admin import-recovery and development publication/rollback-recovery work into a fully verified development release candidate ready for explicit push and Sealos/Devbox release approval.

**Architecture:** Keep the embedded Bundle Admin route thin and read-only for import recovery assessment, with validation and isolation in the domain service. Keep development publication and rollback recovery as evidence-bound, resumable CLI steps using the existing dev-only persistence adapter, CAS guards, and independent read-back verification. This plan does not add production authority or perform any external write.

**Tech Stack:** Remix, React, JavaScript/TypeScript, Vitest, Prisma, Shopify Admin GraphQL 2026-04, Shopify CLI, Rust Cart Transform verification.

## Global Constraints

- Current SSOT is `Project_Master_Context_V5.4_Current_Baseline.md`.
- Preserve Option C: Cart retains one parent line; Checkout and Orders expand into components; inventory deducts components only.
- `lineUpdate` and runtime `productVariantComponents` remain prohibited.
- Production runtime authority remains the hard-coded Shared Core.
- Development target is only `cart-transform-poc-dev` on `huang-mvqquz1p.myshopify.com` through `shopify.app.dev.toml`.
- Do not touch the Custom Distribution App, production resources, store configuration, products, inventory, metafields, or theme.
- Do not deploy, push, seed, or commit during this plan without separate explicit approval.
- Preserve all unrelated existing working-tree changes.
- Every external mutation path must fail closed without exact server-owned evidence and must support independent reconciliation after an unknown transport outcome.

---

### Task 1: Prebuilt Import Recovery Assessment

**Files:**
- Modify only if evidence requires:
  - `app/domains/bundle-admin/bundle-admin.http.server.js`
  - `app/domains/bundle-admin/bundle-admin.service.js`
  - `app/domains/bundle-admin/bundle-admin.shopify-service.server.js`
  - `app/routes/app.bundle-admin.prebuilt-imports.tsx`
  - `app/routes/app.bundle-admin.prebuilt-imports.recovery-assessment.ts`
- Test:
  - `app/domains/bundle-admin/bundle-admin.http.server.test.js`
  - `app/domains/bundle-admin/bundle-admin.service.test.js`
  - `app/domains/bundle-admin/bundle-admin.shopify-service.server.test.js`
  - `app/domains/bundle-admin/bundle-admin.prebuilt-import-recovery-isolation.test.js`

**Interfaces:**
- Consumes: authenticated embedded Admin request context, development-only Shopify service composition, normalized prebuilt import source, and Shopify ledger/metafield reads.
- Produces: a bounded, authenticated, no-store, read-only recovery assessment response; it must not expose execute, publish, rollback, or arbitrary target controls.

- [ ] **Step 1: Inspect the full task diff and verify route/service boundaries**

Run:

```powershell
git diff -- app/domains/bundle-admin app/routes/app.bundle-admin.prebuilt-imports.tsx app/routes/app.bundle-admin.prebuilt-imports.recovery-assessment.ts
```

Expected: recovery assessment remains authenticated, development-only, bounded to at most 25 unique identities, and read-only.

- [ ] **Step 2: Run the focused tests**

Run:

```powershell
npx vitest run app/domains/bundle-admin/bundle-admin.http.server.test.js app/domains/bundle-admin/bundle-admin.service.test.js app/domains/bundle-admin/bundle-admin.shopify-service.server.test.js app/domains/bundle-admin/bundle-admin.prebuilt-import-recovery-isolation.test.js
```

Expected: all selected files pass with zero failures.

- [ ] **Step 3: Fix only evidence-backed failures with TDD**

For each failure, first add or retain a focused failing assertion, run the smallest failing test, implement the minimal correction in the listed files, then rerun the focused set. Do not expand the route into a write workflow.

- [ ] **Step 4: Review the task diff**

Expected: spec compliance and code quality are both approved; Critical and Important findings are fixed and re-reviewed.

---

### Task 2: Development Publication and Rollback Recovery

**Files:**
- Modify only if evidence requires:
  - `scripts/dev-shopify-publication-rehearsal.transport.js`
  - `scripts/dev-shopify-publication-rehearsal.cas-probe.js`
  - `scripts/dev-shopify-publication-rehearsal.candidate-recovery-execution.js`
  - `scripts/dev-shopify-publication-rehearsal.rollback-staging-execution.js`
  - `scripts/dev-shopify-publication-rehearsal.rollback-recovery.js`
  - `scripts/dev-shopify-publication-rehearsal.rollback-recovery-execution.js`
  - `scripts/dev-shopify-publication-rehearsal.execution.js`
  - `scripts/execute-dev-shopify-publication-rehearsal.mjs`
  - `scripts/recover-dev-shopify-publication-rehearsal-candidate.mjs`
  - `scripts/recover-dev-shopify-publication-rehearsal-rollback.mjs`
  - `scripts/verify-dev-shopify-publication-rehearsal-cas.mjs`
  - `extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js`
  - `extensions/master-kit-expand/src/config/prebuilt-bundle-import.shopify-ledger.js`
- Test: matching `*.test.js` files for every module above.

**Interfaces:**
- Consumes: exact isolated rehearsal resource identities, stored compareDigest values, expected snapshot checksum `23143031`, baseline/candidate/rollback revision identities, and dev-only Admin API transport.
- Produces: local planning plus explicit recovery commands that are resumable, CAS-guarded, independently readable, and fail closed after an ambiguous transport result.

- [ ] **Step 1: Inspect the recovery and transport diff**

Run:

```powershell
git diff -- scripts extensions/master-kit-expand/src/config package.json
```

Expected: no automatic mutation retry, no production keys, no Custom Distribution App target, and no former all-in-one recovery path.

- [ ] **Step 2: Run the focused recovery tests**

Run:

```powershell
npx vitest run scripts/dev-shopify-publication-rehearsal.transport.test.js scripts/dev-shopify-publication-rehearsal.cas-probe.test.js scripts/dev-shopify-publication-rehearsal.candidate-recovery-execution.test.js scripts/dev-shopify-publication-rehearsal.rollback-staging-execution.test.js scripts/dev-shopify-publication-rehearsal.rollback-recovery.test.js scripts/dev-shopify-publication-rehearsal.rollback-recovery-execution.test.js scripts/dev-shopify-publication-rehearsal.execution.test.js extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.test.js extensions/master-kit-expand/src/config/prebuilt-bundle-import.shopify-ledger.test.js
```

Expected: all selected files pass with zero failures.

- [ ] **Step 3: Verify CLI safety without Shopify writes**

Run each new CLI with `--help` or its local planning mode only. Reject `--apply`, `--execute`, or missing exact confirmation inputs in default invocation.

Expected: no Shopify mutation is sent and every target banner resolves only to the development app/store/config.

- [ ] **Step 4: Fix only evidence-backed failures with TDD**

For each failure, establish RED in the matching focused test, make the smallest correction, then rerun the complete focused recovery set.

- [ ] **Step 5: Review the task diff**

Expected: spec compliance and code quality are both approved; Critical and Important findings are fixed and re-reviewed.

---

### Task 3: Development Release Candidate Verification

**Files:**
- Review:
  - all files changed by Tasks 1 and 2
  - `docs/DEV_PUBLICATION_REHEARSAL_INCIDENT_2026-07-17.md`
  - `docs/PROJECT_PROGRESS_2026-07-21_V59_CURRENT.md`
  - `docs/PROJECT_BUSINESS_PROGRESS_2026-07-21.md`
  - `package.json`
- Do not include ignored `.local` evidence or `shopify.app.local.toml` in a future commit.

**Interfaces:**
- Consumes: the reviewed Task 1 and Task 2 working tree.
- Produces: a local development release candidate report and exact external approval boundary for push and Sealos/Devbox release.

- [ ] **Step 1: Run repository tests**

```powershell
npm test
```

Expected: zero failed test files and zero failed tests.

- [ ] **Step 2: Run Function tests**

```powershell
npm run test:function
```

Expected: zero failed test files and zero failed tests.

- [ ] **Step 3: Run static and build gates**

```powershell
npm run lint
npm run build
```

Expected: both commands exit zero.

- [ ] **Step 4: Run the complete local validation and production isolation gates**

```powershell
npm run validate:local
npm run assert:function:production-clean
git diff --check
```

Expected: every command exits zero; the production Function query, generated types, and artifacts remain production-clean.

- [ ] **Step 5: Audit the future commit boundary**

```powershell
git status --short
git diff --stat
git diff --name-only
git ls-files --others --exclude-standard
```

Expected: every intended file belongs to the Bundle Admin/recovery development candidate; no secret, ignored SSOT export, local config, temporary output, or unrelated file is included.

- [ ] **Step 6: Perform broad whole-branch review**

Expected: no open Critical or Important finding. Record remaining Minor observations separately.

- [ ] **Step 7: Stop at the external approval boundary**

Report the exact candidate scope, verification evidence, and remaining embedded manual test checklist. Do not commit, push, or deploy until Huang explicitly approves those actions.
