from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
SPECS = ROOT / "e2e" / "specs"
HELPERS = ROOT / "e2e" / "support" / "helpers.js"
API_BOOTSTRAP = ROOT / "e2e" / "support" / "auth-bootstrap.js"

API_BOOTSTRAP_CALLS_BY_SPEC = {
    "client-version.spec.js": 1,
    "collaboration.spec.js": 6,
    "dashboard.spec.js": 10,
    "deeplink.spec.js": 1,
    "holdings.spec.js": 15,
    "import.spec.js": 8,
    "layout-stability.spec.js": 5,
    "mobile-browser-matrix.spec.js": 13,
    "mobile-touch-targets.spec.js": 1,
    "prices.spec.js": 3,
    "settings.spec.js": 5,
    "shell-state.spec.js": 1,
    "transactions-category-picker.spec.js": 1,
    "transactions-ledger-layout.spec.js": 3,
    "transactions-tab-state.spec.js": 2,
    "transactions.spec.js": 71,
    "uiux-accessibility-gates.spec.js": 8,
    "uiux-rca.spec.js": 6,
    "validation-ui.spec.js": 2,
    "ws.spec.js": 1,
}
UI_AUTH_CALLS_BY_SPEC = {
    "auth.spec.js": 1,
    "mobile-browser-matrix.spec.js": 4,
    "post-deploy-smoke.spec.js": 1,
}


def _call_count(source: str, helper_name: str) -> int:
    return len(re.findall(rf"\b{helper_name}\s*\(", source))


def test_non_auth_specs_use_explicit_api_capable_bootstrap() -> None:
    # Given: the complete Playwright spec inventory.
    spec_sources = {
        path.name: path.read_text(encoding="utf-8") for path in SPECS.glob("*.spec.js")
    }

    # When: authentication prerequisite helper calls are counted per spec.
    actual = {
        name: _call_count(source, "bootstrapVerifiedSession")
        for name, source in spec_sources.items()
        if _call_count(source, "bootstrapVerifiedSession")
    }

    # Then: every approved non-auth call site uses the explicit bootstrap helper.
    assert actual == API_BOOTSTRAP_CALLS_BY_SPEC


def test_auth_under_test_specs_keep_ui_registration_coverage() -> None:
    # Given: the complete Playwright spec inventory.
    spec_sources = {
        path.name: path.read_text(encoding="utf-8") for path in SPECS.glob("*.spec.js")
    }

    # When: UI registration helper calls are counted per spec.
    actual = {
        name: _call_count(source, "registerAndVerify")
        for name, source in spec_sources.items()
        if _call_count(source, "registerAndVerify")
    }

    # Then: only auth, auth-layout, and post-deploy coverage retain the UI path.
    assert actual == UI_AUTH_CALLS_BY_SPEC
    mobile_source = spec_sources["mobile-browser-matrix.spec.js"]
    assert "cross-browser mobile matrix traverses core screens" in mobile_source
    assert "W1 MUI-005 keeps short-landscape form text" in mobile_source
    assert "W1 MUI-005 keeps 1024px touch form text" in mobile_source


def test_api_bootstrap_is_local_only_and_fails_closed() -> None:
    # Given: the shared E2E authentication helper implementation.
    source = HELPERS.read_text(encoding="utf-8")
    api_source = API_BOOTSTRAP.read_text(encoding="utf-8")

    # When: its API bootstrap contract is inspected.
    bootstrap_source = source.split(
        "export async function bootstrapVerifiedSession", maxsplit=1
    )[1].split("export async function selectFirstNonEmptyOption", maxsplit=1)[0]

    # Then: local-only selection has one UI fallback and the API adapter fails closed.
    assert 'process.env.E2E_AUTH_SETUP_MODE || "ui"' in source
    assert '["ui", "api"].includes(authSetupMode)' in source
    assert "unsupported E2E_AUTH_SETUP_MODE" in bootstrap_source
    assert "!process.env.CI" in source
    assert "!isSharedE2EBaseUrl()" in source
    assert _call_count(bootstrap_source, "registerAndVerify") == 1
    assert 'recordAuthSetupMetric("api"' in bootstrap_source
    assert "throw error" in bootstrap_source
    assert "page.context().request" in api_source
    assert '"x-debug-token-opt-in": "true"' in api_source
    assert "/api/v1/auth/register" in api_source
    assert "/api/v1/auth/verify-email" in api_source
    assert "registerAndVerify" not in api_source
    assert "catch" not in api_source
