# Money Flow Service brand tokens

이 문서는 Money Flow Service의 **email-first 브랜드 색상 기준**이다. 현재 작업은 회원가입 인증 메일의 가독성과 브랜드 일관성을 맞추기 위한 기준을 먼저 고정하며, 전체 프론트엔드 디자인 시스템을 완성하거나 전역 CSS를 재설계하지 않는다.

## Core palette

| Category | Token | CSS alias | Value | Usage |
| --- | --- | --- | --- | --- |
| Primary | `mfs-primary-blue` | `--mfs-primary-blue` | `#0B4AB4` | 핵심 액션, CTA, 로고/버튼 계열의 기준색 |
| Primary | `mfs-primary-blue-bright` | `--mfs-primary-blue-bright` | `#1E7BFF` | 큰 면적의 그래디언트 하이라이트, 시각적 강조 |
| Primary | `mfs-primary-blue-hover` | `--mfs-primary-blue-hover` | `#08398B` | 버튼 hover/fallback, 진한 primary 상태 |
| Secondary | `mfs-secondary-cyan` | `--mfs-secondary-cyan` | `#1D9CE5` | 보조 그래디언트, 정보성 포인트 |
| Secondary | `mfs-secondary-teal` | `--mfs-secondary-teal` | `#14B8A6` | 연결/성공/실시간 상태를 연상시키는 보조 포인트 |
| Neutral | `mfs-neutral-bg` | `--mfs-neutral-bg` | `#F6F8FB` | 외곽 배경, 앱/메일의 부드러운 바탕 |
| Neutral | `mfs-neutral-surface` | `--mfs-neutral-surface` | `#FFFFFF` | 카드/본문 surface |
| Neutral | `mfs-neutral-border` | `--mfs-neutral-border` | `#DBE3EF` | 카드/입력/정보 박스 경계 |
| Text | `mfs-text-strong` | `--mfs-text-strong` | `#172033` | 제목, 본문 핵심 텍스트 |
| Text | `mfs-text-muted` | `--mfs-text-muted` | `#5F7596` | 보조 설명, footer, muted copy |
| Semantic | `mfs-success` | `--mfs-success` | `#16A34A` | 성공/완료/정상 상태 |
| Semantic | `mfs-error` | `--mfs-error` | `#F43F5E` | 오류/위험/삭제/지출 경고 |
| Semantic | `mfs-warning` | `--mfs-warning` | `#F59E0B` | 만료 임박, 주의 안내 |
| Semantic | `mfs-info` | `--mfs-info` | `#2563EB` | 안내 링크, 보조 정보 강조 |

## Email-specific derived tokens

이메일 HTML은 앱 CSS 변수를 직접 사용할 수 없으므로, 아래 파생 토큰을 인라인 스타일과 `bgcolor` fallback으로 중복 기입한다. 새 트랜잭션 메일을 추가할 때도 원색을 임의로 추가하지 말고 이 표를 먼저 확장한다.

| Token | CSS alias | Value | Usage |
| --- | --- | --- | --- |
| `mfs-email-soft-blue-bg` | `--mfs-email-soft-blue-bg` | `#EEF4FF` | 인증번호/보조 정보 박스 배경 |
| `mfs-email-soft-blue-border` | `--mfs-email-soft-blue-border` | `#BFD3F6` | 인증번호 박스 경계 |
| `mfs-email-success-bg` | `--mfs-email-success-bg` | `#DCFCE7` | 유효시간 pill 배경 |
| `mfs-email-success-border` | `--mfs-email-success-border` | `#86EFAC` | 유효시간 pill 경계 |
| `mfs-email-success-text` | `--mfs-email-success-text` | `#086141` | 유효시간 pill 텍스트 |
| `mfs-email-brand-pill-bg` | `--mfs-email-brand-pill-bg` | `#EAF4FF` | 히어로 영역 브랜드 pill 배경 |
| `mfs-email-light-link-bg` | `--mfs-email-light-link-bg` | `#F8FBFF` | fallback URL 박스 배경 |

## Email dark-mode fallback tokens

Gmail/Naver 같은 메일 클라이언트는 다크모드에서 색상을 강제로 변환할 수 있다. 인증 메일은 아래 색상을 `@media (prefers-color-scheme: dark)`, Outlook 계열 `[data-ogsc]`, 주요 table `bgcolor` fallback과 함께 사용한다.

| Token | CSS alias | Value | Usage |
| --- | --- | --- | --- |
| `mfs-email-dark-surface` | `--mfs-email-dark-surface` | `#0F172A` | 다크모드 외곽 배경 |
| `mfs-email-dark-card` | `--mfs-email-dark-card` | `#111C2F` | 다크모드 카드/본문 surface |
| `mfs-email-dark-brand` | `--mfs-email-dark-brand` | `#12213F` | 다크모드 브랜드 영역 fallback |
| `mfs-email-dark-panel` | `--mfs-email-dark-panel` | `#17264A` | 다크모드 인증번호/fallback URL 박스 |
| `mfs-email-dark-border` | `--mfs-email-dark-border` | `#2B58A3` | 다크모드 보조 박스 경계 |
| `mfs-email-dark-text` | `--mfs-email-dark-text` | `#E5EDF8` | 다크모드 기본 텍스트 |
| `mfs-email-dark-muted` | `--mfs-email-dark-muted` | `#B8C7DC` | 다크모드 보조 텍스트 |

## Usage rules

- 핵심 CTA는 `mfs-primary-blue`를 우선 사용한다. `mfs-primary-blue-bright`는 밝고 강한 색이므로 작은 CTA 단독 배경으로 쓰지 말고, 큰 히어로 그래디언트나 강조 면에 제한한다.
- Money Flow Service의 대표 그래디언트는 `mfs-primary-blue -> mfs-primary-blue-bright -> mfs-secondary-teal` 순서를 기본으로 한다.
- 인증번호처럼 사용자가 정확히 읽어야 하는 값은 장식보다 대비를 우선한다.
- 이메일 본문은 `bgcolor`, 인라인 `background-color`, 인라인 `color`를 함께 사용한다. 앱 CSS 변수나 외부 stylesheet에 의존하지 않는다.
- 링크/보조 안내는 `mfs-info`를 쓸 수 있지만, primary action과 경쟁하지 않게 면적과 굵기를 제한한다.

## Forbidden patterns

- 승인되지 않은 보라색/무지개 그래디언트를 새 브랜드 색처럼 사용하는 것.
- 밝은 히어로 위에 연한 텍스트를 올려 Gmail 다크모드에서 제목이 사라지는 패턴.
- `#2563EB`, `#1E7BFF` 같은 밝은 파랑을 작은 흰색 텍스트 CTA 배경으로 단독 사용해 대비가 부족해지는 패턴.
- 토큰 문서에 매핑하지 않은 원색을 이메일 템플릿에 임의로 추가하는 것.
- 이메일 클라이언트가 무시할 수 있는 CSS-only 버튼, CSS 변수 전용 색상, 외부 폰트/외부 CSS 의존.

## Future redesign handoff

- 현재 문서는 **email-first brand baseline**이다. 전체 프론트엔드 디자인 시스템이 아니며, `frontend/src/App.css` 또는 별도 UI 리디자인 worktree를 이번 작업에서 변경하지 않는다.
- 향후 프론트엔드 리디자인 worktree가 안정화되면 이 문서의 토큰과 리디자인 팔레트를 비교해 하나의 canonical source로 승격해야 한다.
- 프론트엔드 CSS 변수 도입 시 위 CSS alias 이름을 우선 사용하고, 이메일 HTML은 메일 클라이언트 호환성 때문에 계속 인라인 값과 `data-brand-token` marker를 유지한다.
- 새로운 트랜잭션 메일을 추가할 때는 `backend/app/services/email_service.py`의 인증 메일 구조와 이 문서의 토큰 표를 기준으로 확장한다.
