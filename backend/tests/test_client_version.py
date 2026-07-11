from __future__ import annotations

import os
import atexit
from pathlib import Path
import shutil
import tempfile

from fastapi import FastAPI
from fastapi.testclient import TestClient

_TEST_DB_DIR = Path(tempfile.mkdtemp(prefix="money-flow-client-version-"))
atexit.register(lambda: shutil.rmtree(_TEST_DB_DIR, ignore_errors=True))
os.environ.setdefault("DATABASE_URL", f"sqlite:///{(_TEST_DB_DIR / 'test_client_version.db').as_posix()}")
os.environ.setdefault("SECRET_KEY", "test-secret-key-should-be-long-enough-1234567890")
os.environ.setdefault("ENV", "test")
os.environ.setdefault("AUTH_COOKIE_SECURE", "false")

import app.main as app_main  # noqa: E402
from app.main import app  # noqa: E402


def test_client_version_endpoint_is_no_store(monkeypatch) -> None:
    monkeypatch.setenv("APP_VERSION", "v1.2.3")

    with TestClient(app) as client:
        response = client.get("/api/v1/system/client-version")

    assert response.status_code == 200
    assert response.json() == {"version": "1.2.3"}
    assert response.headers["cache-control"] == "no-store, no-cache, must-revalidate, max-age=0"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["expires"] == "0"


def test_spa_html_and_fallback_are_no_cache(monkeypatch, tmp_path: Path) -> None:
    dist_dir = tmp_path / "dist"
    dist_dir.mkdir(parents=True)
    (dist_dir / "index.html").write_text("<html><body>spa index</body></html>\n", encoding="utf-8")
    monkeypatch.setattr(app_main, "frontend_dist", dist_dir)

    with TestClient(app) as client:
        root = client.get("/")
        fallback = client.get("/deep/link")

    assert root.status_code == 200
    assert fallback.status_code == 200
    assert root.headers["cache-control"] == "no-cache, must-revalidate"
    assert fallback.headers["cache-control"] == "no-cache, must-revalidate"


def test_hashed_assets_are_long_cache_immutable(tmp_path: Path) -> None:
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir(parents=True)
    (assets_dir / "index-AbCd1234.js").write_text("console.log('asset')\n", encoding="utf-8")

    static_app = FastAPI()
    static_app.mount("/assets", app_main.CacheControlledStaticFiles(directory=assets_dir), name="assets")

    with TestClient(static_app) as client:
        response = client.get("/assets/index-AbCd1234.js")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert response.headers["content-type"].startswith(("application/javascript", "text/javascript"))
