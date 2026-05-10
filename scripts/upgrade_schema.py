from __future__ import annotations

from app.db.schema_upgrade import upgrade_schema


if __name__ == "__main__":
    upgrade_schema()
