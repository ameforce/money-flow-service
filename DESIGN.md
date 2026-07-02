# Money Flow Service Design System

This document is the canonical app design baseline for Money Flow Service. `docs/brand-tokens.md` remains the email-first brand-token source and future handoff note; it is not the full frontend design system.

## 1. Atmosphere & Identity

Money Flow Service is a Data-dense operational finance workspace. It should feel calm, accountable, and fast to scan: household cash flow, assets, imports, and collaboration states must be visible without a marketing-style hero or decorative layout. The signature is a quiet command surface with compact financial cards, clear Korean labels, restrained blue accents, and stable mobile behavior.

## 2. Color

### Palette

| Role | Token | Light | Usage |
| --- | --- | --- | --- |
| Surface/page | `--mf-bg` | `#F4F7FB` | App background |
| Surface/card | `--mf-surface` | `#FFFFFF` | Cards, panels, forms |
| Surface/muted | `--mf-surface-muted` | `#F8FBFF` | Secondary panels and grouped rows |
| Text/primary | `--mf-text` | `#10233F` | Headings and body copy |
| Text/muted | `--mf-text-muted` | `#5C6F8A` | Helpers, metadata, captions |
| Border/default | `--mf-border` | `#DCE6F2` | Card borders, dividers, inputs |
| Accent/primary | `--mf-color-blue-600` | `#0F7CFF` | Primary actions, active nav, focus ring |
| Accent/secondary | `--mf-color-blue-100` | `#EAF4FF` | Soft active backgrounds |
| Status/success | `--mf-color-green-600` | `#16A34A` | Income, positive values, success |
| Status/error | `--mf-color-rose-600` | `#E11D48` | Expense, destructive action, error |
| Status/warning | `--mf-color-amber-600` | `#D97706` | Transfers, cautions, pending work |
| Status/info | `--mf-color-indigo-600` | `#4F46E5` | Investments and neutral emphasis |

### Rules

- Accent color is interactive or semantic, not decorative.
- Financial status colors must be paired with text labels or icons; color alone is not sufficient.
- New raw colors belong in `frontend/src/index.css` first, then in this table.
- No new dependencies are required for token, audit, or visual-governance work.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Usage |
| --- | --- | --- | --- | --- |
| Page title | `clamp(1.55rem, 4vw, 2.45rem)` | 800 | 1.08 | Main shell identity |
| Section title | `1.2rem` to `1.55rem` | 800 | 1.18 | Dashboard/card section headings |
| Card title | `1rem` to `1.16rem` | 800 | 1.2 | Repeated panels |
| Body | `0.92rem` to `1rem` | 500 | 1.5 | General Korean copy |
| Body/small | `0.78rem` to `0.88rem` | 600 | 1.35 | Metadata and summaries |
| Caption | `0.68rem` to `0.76rem` | 700 | 1.25 | Chips, table labels, helper labels |
| Numeric | Existing body scale | 700-900 | 1.15 | KRW amounts, percentages, KPI values |

### Font Stack

- Primary: system UI with Korean fallbacks, including Apple SD Gothic Neo, Malgun Gothic, and Noto Sans KR.
- Numeric data should use tabular numeric settings where alignment matters.

### Rules

- Body text should not drop below readable Korean caption size on mobile.
- Hero-scale text belongs only in the shell identity and main dashboard metric.
- Keep letter spacing at `0` unless an existing uppercase eyebrow token already uses spacing.

## 4. Spacing & Layout

### Base Unit

All spacing is derived from a 4px base. Existing rem values should map to this rhythm when edited.

| Token | Value | Usage |
| --- | --- | --- |
| Tight | `0.25rem` | Icon-to-label and chip internals |
| Compact | `0.5rem` | Small row gaps, mobile cards |
| Standard | `0.75rem` | Control padding, dense cards |
| Comfortable | `1rem` | Card padding and form groups |
| Section | `1.25rem` to `1.5rem` | Dashboard groups and page regions |

### Grid

- Desktop shell: fixed side navigation plus fluid content.
- Mobile shell: top identity, bottom-safe navigation, no horizontal overflow.
- Dashboard: preserve all financial context by reflowing content, not hiding state-bearing sections.
- Tables and ledgers: exact values remain comparable; mobile can simplify columns but must preserve label/value relationships.

### Rules

- No mobile fix may depend on one captured coordinate.
- Sticky surfaces must not obscure focus, form errors, or active controls.
- 360px, 390px, tablet, and Korean font fallback conditions are required for UI-sensitive changes.

## 5. Components

### App Navigation

- Structure: `nav` with one button per product surface.
- States: default, hover, active, focus-visible, disabled when applicable.
- Accessibility: every button has a visible Korean label or stable accessible label; the active page uses `aria-current="page"`.
- Icons: structural icons are inline SVG and `aria-hidden`; glyph text is not used for chrome.

### Dashboard Cards

- Structure: heading, primary metric or summary, supporting rows.
- Variants: hero metric, KPI, market strip, status card, member card, recent activity.
- Accessibility: status cards remain available on mobile; chart summaries need text/table alternatives when chart work is touched.

### Dialogs And Sheets

- Structure: labeled dialog region, close control, focusable first action or first field.
- States: open, closing, dirty-confirm, disabled while loading.
- Accessibility: Escape closes when safe; dirty drafts ask for confirmation; focus returns to the trigger.

### Forms

- Structure: label, input/select, helper or error text.
- Accessibility: field errors use `aria-invalid` and `aria-describedby`; blocking submit errors use an alert or summary.
- Mobile: labels stay above fields and messages wrap without horizontal overflow.

### Tables And Ledgers

- Structure: native table semantics are preferred for exact values.
- Accessibility: sortable headers expose one clear sorted state.
- Mobile: hidden columns must not remove the only label for a value or action.

## 6. Motion & Interaction

| Type | Duration | Usage |
| --- | --- | --- |
| Micro | `100ms` to `150ms` | Button press, chip state |
| Standard | `180ms` to `240ms` | Sheet/dialog entrance, tab feedback |
| Emphasis | `260ms` to `360ms` | Major panel transitions |

### Rules

- Respect `prefers-reduced-motion`.
- Every interactive control needs hover, active, disabled, and focus-visible treatment.
- Touch targets should meet 44px where product controls are frequently tapped.
- Do not remove useful focus state with global pointer blur behavior.

## 7. Depth & Surface

### Strategy

Use a mixed but restrained strategy: tonal shift for hierarchy, thin borders for precision, and soft shadows only for elevated surfaces such as dialogs, sticky controls, and primary cards.

| Level | Treatment | Usage |
| --- | --- | --- |
| Base | Page background token | App body |
| Raised | White card with token border | Dashboard and forms |
| Elevated | White surface plus soft shadow | Dialogs, sheets, sticky controls |
| Active | Blue accent fill or soft blue surface | Current nav, primary action |

### Rules

- Do not nest decorative cards inside cards.
- Keep operational surfaces dense but scannable.
- Visual depth must clarify ownership and state, not add decoration.
