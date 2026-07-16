"""E2E-only Python startup normalization for platform-stable static assets."""

from __future__ import annotations

import mimetypes


mimetypes.add_type("application/javascript", ".js", strict=True)
mimetypes.add_type("application/javascript", ".mjs", strict=True)
mimetypes.add_type("application/wasm", ".wasm", strict=True)
