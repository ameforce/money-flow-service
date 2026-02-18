from __future__ import annotations

from email.message import EmailMessage
from email.utils import formatdate
from email.utils import make_msgid
import logging
import smtplib
import ssl
from urllib.parse import quote

from app.core.config import settings


logger = logging.getLogger(__name__)


def _mask_email(value: str) -> str:
    text = str(value or "").strip()
    if "@" not in text:
        return "***"
    local, domain = text.split("@", 1)
    if len(local) <= 2:
        local_masked = "*" * len(local)
    else:
        local_masked = f"{local[:2]}{'*' * (len(local) - 2)}"
    return f"{local_masked}@{domain}"


class EmailService:
    def _build_message(self, *, to_email: str, subject: str, body_text: str) -> EmailMessage:
        message = EmailMessage()
        from_email = settings.smtp_from_email.strip() or settings.smtp_user.strip()
        if not from_email:
            from_email = "no-reply@enmsoftware.com"
        from_name = (settings.smtp_from_name or "money-flow").strip()
        message["From"] = f"{from_name} <{from_email}>"
        message["To"] = to_email
        message["Subject"] = subject
        # Explicit RFC 5322 headers improve compatibility with strict receivers.
        message["Message-ID"] = make_msgid()
        message["Date"] = formatdate(localtime=True)
        message.set_content(body_text)
        return message

    def send_email(self, *, to_email: str, subject: str, body_text: str) -> bool:
        mode = settings.email_delivery_mode
        account_label = str(settings.smtp_account_label or "").strip() or "unknown"
        if mode == "log":
            logger.info("[email:log] account=%s to=%s subject=%s", account_label, _mask_email(to_email), subject)
            logger.info("[email:log] body_redacted=true chars=%d", len(str(body_text or "")))
            return True

        host = settings.smtp_host.strip()
        user = settings.smtp_user.strip()
        password = settings.smtp_pass
        if not host:
            logger.warning("[email] smtp host is empty, skip sending to=%s", _mask_email(to_email))
            return False
        tls_context = ssl.create_default_context()
        if settings.smtp_ssl:
            transport = smtplib.SMTP_SSL(host, settings.smtp_port, timeout=15, context=tls_context)
        else:
            transport = smtplib.SMTP(host, settings.smtp_port, timeout=15)
        try:
            if settings.smtp_starttls and not settings.smtp_ssl:
                transport.starttls(context=tls_context)
            if user:
                transport.login(user, password)
            message = self._build_message(to_email=to_email, subject=subject, body_text=body_text)
            transport.send_message(message)
            logger.info(
                "[email:smtp] account=%s sent to=%s subject=%s",
                account_label,
                _mask_email(to_email),
                subject,
            )
            return True
        except Exception:  # noqa: BLE001
            logger.exception("[email:smtp] account=%s failed to send to=%s", account_label, _mask_email(to_email))
            return False
        finally:
            try:
                transport.quit()
            except Exception:  # noqa: BLE001
                pass

    def send_verification_email(self, *, to_email: str, token: str, expires_minutes: int) -> bool:
        base = settings.frontend_base_url.rstrip("/")
        verify_link = f"{base}/#verify_token={quote(token)}"
        subject = "[money-flow] 이메일 인증을 완료해 주세요"
        body = (
            "안녕하세요.\n\n"
            "money-flow 계정 인증을 위해 아래 링크를 열어 주세요.\n"
            f"{verify_link}\n\n"
            f"인증 링크 유효 시간: {expires_minutes}분\n"
            "본인이 요청하지 않았다면 이 메일을 무시해 주세요.\n"
        )
        return self.send_email(to_email=to_email, subject=subject, body_text=body)

    def send_household_invitation_email(
        self,
        *,
        to_email: str,
        inviter_name: str,
        household_name: str,
        token: str,
        expires_minutes: int,
    ) -> bool:
        base = settings.frontend_base_url.rstrip("/")
        invite_link = f"{base}/#invite_token={quote(token)}"
        subject = "[money-flow] 가계부 초대가 도착했습니다"
        body = (
            "안녕하세요.\n\n"
            f"{inviter_name}님이 '{household_name}' 가계부로 초대했습니다.\n"
            "아래 링크를 열어 초대를 수락해 주세요.\n"
            f"{invite_link}\n\n"
            f"초대 링크 유효 시간: {expires_minutes}분\n"
            "본인이 요청하지 않았다면 이 메일을 무시해 주세요.\n"
        )
        return self.send_email(to_email=to_email, subject=subject, body_text=body)


email_service = EmailService()

