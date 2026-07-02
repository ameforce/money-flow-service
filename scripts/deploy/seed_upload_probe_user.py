from __future__ import annotations

import argparse
from datetime import UTC, datetime


PROBE_EMAIL_PREFIX = "jenkins-upload-probe-"


def seed_upload_probe_user(email: str, password: str, display_name: str) -> None:
    from sqlalchemy import select

    from app.api.routes.auth import _apply_registration_real_name, _ensure_default_household_membership
    from app.core.config import settings
    from app.core.security import hash_password
    from app.db.models import DisplayNameMode, User
    from app.db.session import SessionLocal
    from app.services.profile import sync_user_display_name

    normalized_email = email.strip().lower()
    normalized_display_name = display_name.strip() or "Upload Probe"
    if settings.env != "dev":
        raise RuntimeError("upload probe user seeding is dev-only")
    if not normalized_email.startswith(PROBE_EMAIL_PREFIX):
        raise RuntimeError("upload probe email must use the Jenkins probe prefix")

    now = datetime.now(UTC)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == normalized_email))
        if user is None:
            user = User(
                email=normalized_email,
                password_hash=hash_password(password),
                real_name=normalized_display_name,
                nickname=None,
                display_name_mode=DisplayNameMode.real_name.value,
                display_name=normalized_display_name,
                email_verified=True,
                email_verified_at=now,
            )
            sync_user_display_name(user)
            db.add(user)
            db.flush()
        else:
            user.password_hash = hash_password(password)
            user.email_verified = True
            user.email_verified_at = now
            user.display_name_mode = DisplayNameMode.real_name.value
            _apply_registration_real_name(user, normalized_display_name)

        _ensure_default_household_membership(db, user)
        db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed a dev-only Jenkins upload probe user.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--display-name", default="Upload Probe")
    args = parser.parse_args()
    seed_upload_probe_user(args.email, args.password, args.display_name)


if __name__ == "__main__":
    main()
