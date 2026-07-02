# Transaction/Holding Integration Audit — Task 4 commit `ece9d29931f8`

## Scope and method

- Current leader/worktree HEAD audited: `3c37de6` (`Preserve auth selector knowledge before redesign`)
- Worker-3 final task-4 commit audited: `ece9d29931f8` (`Make dense work surfaces easier to scan under edit pressure`)
- Task-4 parent/base: `7b5ed06`
- Files compared:
  - `frontend/src/App.jsx`
  - `frontend/src/App.css`
  - `frontend/src/components/worksurface/TransactionSurfaceTable.jsx`
  - `frontend/src/components/worksurface/HoldingSurfaceTable.jsx`

Commands used for evidence:

```bash
git diff --stat HEAD ece9d29931f8 -- frontend/src/App.jsx frontend/src/App.css frontend/src/components/worksurface/TransactionSurfaceTable.jsx frontend/src/components/worksurface/HoldingSurfaceTable.jsx
git diff --stat ece9d29931f8^ ece9d29931f8 -- frontend/src/App.jsx frontend/src/App.css frontend/src/components/worksurface/TransactionSurfaceTable.jsx frontend/src/components/worksurface/HoldingSurfaceTable.jsx
# Exact-line audit of task-4 added nonblank lines from ece9d29931f8^..ece9d29931f8 against current HEAD.
```

## High-level result

**PASS with integration warning.** The task-4 product changes from `ece9d29931f8^..ece9d29931f8` are already present in current leader HEAD by content:

- `frontend/src/App.jsx`: 59/59 task-4 added nonblank lines present in HEAD.
- `frontend/src/App.css`: 151/151 task-4 added nonblank lines present in HEAD.
- `frontend/src/components/worksurface/TransactionSurfaceTable.jsx`: 4/4 task-4 added nonblank lines present in HEAD.
- `frontend/src/components/worksurface/HoldingSurfaceTable.jsx`: 16/16 task-4 added nonblank lines present in HEAD.

However, `ece9d29931f8` itself is not an ancestor of leader HEAD, and whole-file blobs are not identical for `App.jsx` / `App.css`. Do **not** cherry-pick or overwrite these files wholesale from `ece9d29931f8`, because current leader HEAD also contains other workers' shell/dashboard/auth/docs work that the isolated worker-3 commit does not contain.

## File findings

### `frontend/src/components/worksurface/TransactionSurfaceTable.jsx`

**PASS — exact blob match between leader HEAD and `ece9d29931f8`.**

Preserved task-4 symbols/selectors:

- `transactions-surface-table` table class, including `mobile-sticky-active` / `mobile-sticky-inactive` suffixes.
- `aria-label="거래 작업 표"` on the transaction work-surface table (`TransactionSurfaceTable.jsx:78`).
- Existing ledger classes remain available for CSS/mobile rules: `ledger-table-head`, `ledger-head-date`, `ledger-head-main`, `ledger-head-amount`, `ledger-head-cues`, `ledger-head-actions`.

**Missing:** none.

### `frontend/src/components/worksurface/HoldingSurfaceTable.jsx`

**PASS — exact blob match between leader HEAD and `ece9d29931f8`.**

Preserved task-4 symbols/selectors:

- `holdings-surface-table` table class.
- `aria-label="자산 작업 표"` on the holding work-surface table (`HoldingSurfaceTable.jsx:27`).
- Section grouping classes: `holding-section-header`, `holding-section-title`, `holding-section-actions` (`HoldingSurfaceTable.jsx:60-64`).
- Accessible group-order controls: `${categoryName} 그룹 위로 이동` and `${categoryName} 그룹 아래로 이동` aria labels.

**Missing:** none.

### `frontend/src/App.jsx`

**PASS — task-4 JSX additions are present in leader HEAD, but the file is not blob-identical to `ece9d29931f8`.**

Preserved task-4 data/symbol additions:

- `isTransactionFilterActive` (`App.jsx:1613`) for transaction filter status chips.
- `transactionSortSummary` (`App.jsx:1619`) for the transaction sort status chip.
- `activeHoldingTabLabel`, `holdingSortSummary`, and `holdingColorModeLabel` (`App.jsx:1749-1758`) for holding list status chips.
- Korean holding sort aria label (`App.jsx:2347`): `${getHoldingSortLabel(field)} 정렬 ...`.

Preserved transaction surface markup:

- `work-surface-header` / `work-surface-title` around 거래 입력 (`App.jsx:6055-6058`).
- `surface-eyebrow` copy: `빠른 입력` and `작업 원장` (`App.jsx:6057`, `App.jsx:6088`).
- `surface-control-strip` with `aria-label="거래 입력 상태"` (`App.jsx:6074`) and chips for `편집 가능`/`읽기 전용`, `거래자·카테고리 우선 입력`, `모바일 시트 지원`.
- `surface-control-strip` with `aria-label="거래 목록 상태"` (`App.jsx:6095`) and chips for `transactionSortSummary`, filter state, and selected count.

Preserved holding surface markup:

- `work-surface-header` / `work-surface-title` around 자산 입력 (`App.jsx:6469-6472`).
- `surface-eyebrow` copy: `자산 입력 흐름` and `자산 원장` (`App.jsx:6471`, `App.jsx:6658`).
- `surface-control-strip` with `aria-label="자산 입력 상태"` (`App.jsx:6479`) and chips for edit mode, type/owner/account organization, and 평가금액 sorting cue.
- `surface-control-strip` with `aria-label="자산 목록 상태"` (`App.jsx:6665`) and chips for active tab, holding sort, color mode, and selected count.

**Missing:** none for the task-4 patch content.

**Integration warning:** `git diff --stat HEAD ece9d29931f8 -- frontend/src/App.jsx` still reports `394` changed lines because leader HEAD has additional shell/dashboard/auth/doc-integration work not present in the isolated worker-3 commit. Preserve the leader HEAD structure and keep the task-4 symbols above; do not replace `App.jsx` with the ece9 blob.

### `frontend/src/App.css`

**PASS — task-4 CSS selectors are present in leader HEAD, but the file is not blob-identical to `ece9d29931f8`.**

Preserved task-4 selectors/classes:

- Surface cards: `.surface-entry-card`, `.surface-list-card`, `.surface-support-card` (`App.css:862-874`).
- Work-surface header system: `.work-surface-header`, `.work-surface-title`, `.surface-eyebrow`, `.surface-control-strip` (`App.css:892-914`).
- Status chips: `.surface-chip`, `.surface-chip-strong`, `.surface-chip-muted` (`App.css:921-941`).
- Dense table framing: `.transactions-surface-table`, `.holdings-surface-table`, sticky `thead`, compact `th`/`td`, and hover rows (`App.css:1947-1972`).
- Holding group controls: `.holding-section-header`, `.holding-section-title`, `.holding-section-actions`, `.holding-section-actions button` (`App.css:2486-2502`).
- Mobile surface rules for `.work-surface-header`, `.surface-control-strip`, `.surface-chip`, `.transaction-list-card > .surface-list-heading .surface-eyebrow`, and `.holding-list-card > .surface-list-heading .surface-eyebrow` (`App.css:3066-3100`).

**Missing:** none for the task-4 patch content.

**Integration warning:** `git diff --stat HEAD ece9d29931f8 -- frontend/src/App.css` reports large whole-file differences (`822` lines) because leader HEAD includes other workers' token/shell/dashboard/auth CSS. Use selector-level preservation above as the integration source of truth; do not overwrite `App.css` from ece9.

## Recommended integration order

1. **Keep current leader HEAD for `App.jsx` and `App.css`.** The task-4 additions are already present, while leader HEAD contains additional accepted work from other lanes.
2. **Treat `TransactionSurfaceTable.jsx` and `HoldingSurfaceTable.jsx` as content-integrated.** Their HEAD blobs match `ece9d29931f8` exactly for the audited files.
3. **If Git history needs an explicit record for task 4, use an empty/manual integration marker rather than re-cherry-picking product changes.** Reapplying `ece9d29931f8` would be conflict-prone and risks reverting unrelated leader changes.
4. **During any future conflict resolution, preserve these exact anchors:**
   - `isTransactionFilterActive`, `transactionSortSummary`
   - `activeHoldingTabLabel`, `holdingSortSummary`, `holdingColorModeLabel`
   - `aria-label="거래 입력 상태"`, `aria-label="거래 목록 상태"`, `aria-label="자산 입력 상태"`, `aria-label="자산 목록 상태"`
   - `aria-label="거래 작업 표"`, `aria-label="자산 작업 표"`
   - `.surface-control-strip`, `.surface-chip*`, `.transactions-surface-table`, `.holdings-surface-table`, `.holding-section-*`
5. **After final integration, rerun the task-4 focused gates:**
   - `npm run frontend:build`
   - `npm run lint --prefix frontend`
   - `npm run e2e:raw -- e2e/specs/transactions.spec.js e2e/specs/holdings.spec.js`

## Audit conclusion

Task-4 surface changes are **present by content** in leader HEAD for all audited files. The failed automatic cherry-pick appears to be a lineage/conflict issue, not missing product code. The safest integration path is to preserve the current leader HEAD and avoid replacing `App.jsx` / `App.css` with the isolated `ece9d29931f8` versions.
