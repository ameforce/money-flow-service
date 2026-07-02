from __future__ import annotations

from email.message import EmailMessage
from email.utils import formatdate
from email.utils import make_msgid
from html import escape
import logging
import smtplib
import ssl
from urllib.parse import quote

from app.core.config import settings


logger = logging.getLogger(__name__)


MFS_EMAIL_BRAND_TOKENS: dict[str, str] = {
    "mfs-primary-blue": "#0B4AB4",
    "mfs-primary-blue-bright": "#1E7BFF",
    "mfs-primary-blue-hover": "#08398B",
    "mfs-secondary-cyan": "#1D9CE5",
    "mfs-secondary-teal": "#14B8A6",
    "mfs-neutral-bg": "#F6F8FB",
    "mfs-neutral-surface": "#FFFFFF",
    "mfs-neutral-border": "#DBE3EF",
    "mfs-text-strong": "#172033",
    "mfs-text-muted": "#5F7596",
    "mfs-success": "#16A34A",
    "mfs-error": "#F43F5E",
    "mfs-warning": "#F59E0B",
    "mfs-info": "#2563EB",
    "mfs-email-soft-blue-bg": "#EEF4FF",
    "mfs-email-soft-blue-border": "#BFD3F6",
    "mfs-email-success-bg": "#DCFCE7",
    "mfs-email-success-border": "#86EFAC",
    "mfs-email-success-text": "#086141",
    "mfs-email-brand-pill-bg": "#EAF4FF",
    "mfs-email-light-link-bg": "#F8FBFF",
    "mfs-email-dark-surface": "#0F172A",
    "mfs-email-dark-card": "#111C2F",
    "mfs-email-dark-brand": "#12213F",
    "mfs-email-dark-panel": "#17264A",
    "mfs-email-dark-border": "#2B58A3",
    "mfs-email-dark-text": "#E5EDF8",
    "mfs-email-dark-muted": "#B8C7DC",
}


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
    def _build_message(
        self,
        *,
        to_email: str,
        subject: str,
        body_text: str,
        body_html: str | None = None,
    ) -> EmailMessage:
        message = EmailMessage()
        from_email = settings.smtp_from_email.strip() or settings.smtp_user.strip()
        if not from_email:
            from_email = "no-reply@enmsoftware.com"
        from_name = (settings.smtp_from_name or "Money Flow Service").strip()
        message["From"] = f"{from_name} <{from_email}>"
        message["To"] = to_email
        message["Subject"] = subject
        # Explicit RFC 5322 headers improve compatibility with strict receivers.
        message["Message-ID"] = make_msgid()
        message["Date"] = formatdate(localtime=True)
        message.set_content(body_text)
        if body_html:
            message.add_alternative(body_html, subtype="html")
        return message

    def send_email(self, *, to_email: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
        mode = settings.email_delivery_mode
        account_label = str(settings.smtp_account_label or "").strip() or "unknown"
        if mode == "log":
            if settings.is_strict_email_environment:
                logger.error(
                    "[email:strict] refusing log delivery in strict env account=%s to=%s subject=%s",
                    account_label,
                    _mask_email(to_email),
                    subject,
                )
                return False
            logger.info("[email:log] account=%s to=%s subject=%s", account_label, _mask_email(to_email), subject)
            logger.info(
                "[email:log] body_redacted=true chars=%d html_chars=%d",
                len(str(body_text or "")),
                len(str(body_html or "")),
            )
            return True

        host = settings.smtp_host.strip()
        user = settings.smtp_user.strip()
        password = settings.smtp_pass
        if not host:
            logger.warning("[email] smtp host is empty, skip sending to=%s", _mask_email(to_email))
            return False
        transport = None
        try:
            tls_context = ssl.create_default_context() if settings.smtp_ssl or settings.smtp_starttls else None
            if settings.smtp_ssl:
                transport = smtplib.SMTP_SSL(host, settings.smtp_port, timeout=15, context=tls_context)
            else:
                transport = smtplib.SMTP(host, settings.smtp_port, timeout=15)
            if settings.smtp_starttls and not settings.smtp_ssl:
                transport.starttls(context=tls_context)
            if user:
                transport.login(user, password)
            message = self._build_message(
                to_email=to_email,
                subject=subject,
                body_text=body_text,
                body_html=body_html,
            )
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
            if transport is not None:
                try:
                    transport.quit()
                except Exception:  # noqa: BLE001
                    pass

    def send_verification_email(
        self,
        *,
        to_email: str,
        token: str,
        verification_code: str,
        expires_minutes: int,
    ) -> bool:
        base = settings.frontend_base_url.rstrip("/")
        verify_link = f"{base}/#verify_token={quote(token)}"
        subject = "[Money Flow Service] 이메일 인증을 완료해 주세요"
        code_text = f"{verification_code[:3]} {verification_code[3:]}" if len(verification_code) == 6 else verification_code
        body_text = (
            "안녕하세요.\n\n"
            "Money Flow Service 계정 보호를 위해 이메일 인증이 필요합니다.\n"
            "아래 링크를 열면 회원가입이 자동으로 완료됩니다.\n"
            f"{verify_link}\n\n"
            "링크가 열리지 않으면 회원가입 화면에서 직접 입력 인증번호를 입력해 주세요.\n"
            f"직접 입력 인증번호: {code_text}\n\n"
            f"유효시간 {expires_minutes}분\n"
            "요청한 적이 없다면 이 메일을 무시해 주세요.\n"
        )
        escaped_link = escape(verify_link, quote=True)
        escaped_code = escape(code_text, quote=True)
        tokens = MFS_EMAIL_BRAND_TOKENS
        primary_blue = tokens["mfs-primary-blue"]
        primary_bright = tokens["mfs-primary-blue-bright"]
        secondary_cyan = tokens["mfs-secondary-cyan"]
        secondary_teal = tokens["mfs-secondary-teal"]
        neutral_bg = tokens["mfs-neutral-bg"]
        neutral_surface = tokens["mfs-neutral-surface"]
        neutral_border = tokens["mfs-neutral-border"]
        text_strong = tokens["mfs-text-strong"]
        text_muted = tokens["mfs-text-muted"]
        success = tokens["mfs-success"]
        info = tokens["mfs-info"]
        soft_blue_bg = tokens["mfs-email-soft-blue-bg"]
        soft_blue_border = tokens["mfs-email-soft-blue-border"]
        success_bg = tokens["mfs-email-success-bg"]
        success_border = tokens["mfs-email-success-border"]
        success_text = tokens["mfs-email-success-text"]
        brand_pill_bg = tokens["mfs-email-brand-pill-bg"]
        light_link_bg = tokens["mfs-email-light-link-bg"]
        dark_surface = tokens["mfs-email-dark-surface"]
        dark_card = tokens["mfs-email-dark-card"]
        dark_brand = tokens["mfs-email-dark-brand"]
        dark_panel = tokens["mfs-email-dark-panel"]
        dark_border = tokens["mfs-email-dark-border"]
        dark_text = tokens["mfs-email-dark-text"]
        dark_muted = tokens["mfs-email-dark-muted"]
        body_html = f"""\
<!doctype html>
<html lang="ko">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <style>
      :root {{ color-scheme: light dark; supported-color-schemes: light dark; }}
      body, table, td, p, a {{ -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }}
      table, td {{ mso-table-lspace: 0pt; mso-table-rspace: 0pt; }}
      a {{ color: {info}; }}
      @media (prefers-color-scheme: dark) {{
        .mfs-body, .mfs-shell, .mfs-shell-cell {{
          background-color: {dark_surface} !important;
          color: {dark_text} !important;
        }}
        .mfs-card {{
          background-color: {dark_card} !important;
          border-color: {dark_border} !important;
          box-shadow: none !important;
          color: {dark_text} !important;
        }}
        .mfs-hero {{
          background-color: {dark_brand} !important;
          background-image: linear-gradient(135deg,{primary_blue} 0%,{dark_brand} 56%,{secondary_teal} 100%) !important;
          color: #FFFFFF !important;
        }}
        .mfs-content {{
          background-color: {dark_card} !important;
          color: {dark_text} !important;
        }}
        .mfs-title {{ color: #FFFFFF !important; }}
        .mfs-copy, .mfs-muted {{ color: {dark_text} !important; }}
        .mfs-brand {{
          background-color: {brand_pill_bg} !important;
          border-color: {neutral_border} !important;
          color: {primary_blue} !important;
        }}
        .mfs-mark {{
          background-color: {dark_surface} !important;
          border-color: rgba(255,255,255,.22) !important;
        }}
        .mfs-code-panel, .mfs-url-panel {{
          background-color: {dark_panel} !important;
          border-color: {dark_border} !important;
          color: {dark_text} !important;
        }}
        .mfs-code-cell, .mfs-url-cell {{
          background-color: {dark_panel} !important;
          color: {dark_text} !important;
        }}
        .mfs-code-label, .mfs-code-value {{ color: {dark_text} !important; }}
        .mfs-expiry-badge {{
          background-color: {dark_panel} !important;
          border-color: {secondary_teal} !important;
          color: {dark_text} !important;
        }}
        .mfs-url-link {{ color: {dark_text} !important; }}
        .mfs-footer {{
          border-top-color: {dark_border} !important;
          color: {dark_muted} !important;
        }}
      }}
      [data-ogsc] .mfs-body, [data-ogsb] .mfs-body,
      [data-ogsc] .mfs-shell, [data-ogsb] .mfs-shell,
      [data-ogsc] .mfs-shell-cell, [data-ogsb] .mfs-shell-cell {{
        background-color: {dark_surface} !important;
        color: {dark_text} !important;
      }}
      [data-ogsc] .mfs-card, [data-ogsb] .mfs-card {{
        background-color: {dark_card} !important;
        border-color: {dark_border} !important;
        box-shadow: none !important;
        color: {dark_text} !important;
      }}
      [data-ogsc] .mfs-hero, [data-ogsb] .mfs-hero {{
        background-color: {dark_brand} !important;
        background-image: linear-gradient(135deg,{primary_blue} 0%,{dark_brand} 56%,{secondary_teal} 100%) !important;
        color: #FFFFFF !important;
      }}
      [data-ogsc] .mfs-content, [data-ogsb] .mfs-content {{
        background-color: {dark_card} !important;
        color: {dark_text} !important;
      }}
      [data-ogsc] .mfs-title, [data-ogsb] .mfs-title {{ color: #FFFFFF !important; }}
      [data-ogsc] .mfs-copy, [data-ogsb] .mfs-copy,
      [data-ogsc] .mfs-muted, [data-ogsb] .mfs-muted {{ color: {dark_text} !important; }}
      [data-ogsc] .mfs-code-panel, [data-ogsb] .mfs-code-panel,
      [data-ogsc] .mfs-url-panel, [data-ogsb] .mfs-url-panel,
      [data-ogsc] .mfs-code-cell, [data-ogsb] .mfs-code-cell,
      [data-ogsc] .mfs-url-cell, [data-ogsb] .mfs-url-cell {{
        background-color: {dark_panel} !important;
        border-color: {dark_border} !important;
        color: {dark_text} !important;
      }}
      [data-ogsc] .mfs-code-label, [data-ogsb] .mfs-code-label,
      [data-ogsc] .mfs-code-value, [data-ogsb] .mfs-code-value {{ color: {dark_text} !important; }}
      [data-ogsc] .mfs-expiry-badge, [data-ogsb] .mfs-expiry-badge {{
        background-color: {dark_panel} !important;
        border-color: {secondary_teal} !important;
        color: {dark_text} !important;
      }}
      [data-ogsc] .mfs-url-link, [data-ogsb] .mfs-url-link {{ color: {dark_text} !important; }}
      [data-ogsc] .mfs-footer, [data-ogsb] .mfs-footer {{
        border-top-color: {dark_border} !important;
        color: {dark_muted} !important;
      }}
    </style>
  </head>
  <body bgcolor="{neutral_bg}" class="mfs-body" style="margin:0;padding:0;background-color:{neutral_bg};font-family:Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:{text_strong};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="{neutral_bg}" class="mfs-shell" style="background-color:{neutral_bg};padding:32px 12px;">
      <tr>
        <td align="center" bgcolor="{neutral_bg}" class="mfs-shell-cell" style="background-color:{neutral_bg};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="{neutral_surface}" class="mfs-card" style="max-width:560px;background-color:{neutral_surface};color:{text_strong};border-radius:24px;border:1px solid {neutral_border};box-shadow:0 20px 60px rgba(15,23,42,.12);overflow:hidden;">
            <tr>
              <td data-email-region="hero" data-brand-token="mfs-primary-blue mfs-primary-blue-bright mfs-secondary-teal" bgcolor="{primary_blue}" class="mfs-hero" style="padding:30px 30px 25px;background-color:{primary_blue};background-image:linear-gradient(135deg,{primary_blue} 0%,{primary_bright} 54%,{secondary_teal} 100%);color:#FFFFFF;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding:0 16px 24px 0;color:#FFFFFF;">
                      <div data-brand-token="mfs-primary-blue" class="mfs-brand" style="display:inline-block;padding:8px 13px;border-radius:999px;background-color:{brand_pill_bg};border:1px solid {neutral_border};font-size:13px;line-height:1;font-weight:800;letter-spacing:.01em;color:{primary_blue};">Money Flow Service</div>
                    </td>
                    <td align="right" width="82" style="padding:0 0 24px;vertical-align:top;">
                      <table role="presentation" width="66" cellspacing="0" cellpadding="0" bgcolor="{dark_surface}" class="mfs-mark" style="width:66px;height:46px;border-radius:18px;background-color:{dark_surface};border:1px solid rgba(255,255,255,.20);">
                        <tr><td height="12" style="font-size:0;line-height:0;">&nbsp;</td></tr>
                        <tr><td align="center" height="7" style="font-size:0;line-height:0;"><span style="display:inline-block;width:38px;height:7px;border-radius:999px;background-color:{secondary_cyan};line-height:7px;">&nbsp;</span></td></tr>
                        <tr><td height="7" style="font-size:0;line-height:0;">&nbsp;</td></tr>
                        <tr><td align="center" height="7" style="font-size:0;line-height:0;"><span style="display:inline-block;width:26px;height:7px;border-radius:999px;background-color:{success};line-height:7px;">&nbsp;</span></td></tr>
                        <tr><td height="13" style="font-size:0;line-height:0;">&nbsp;</td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <h1 data-email-region="headline" class="mfs-title" style="margin:0 0 12px;font-size:28px;line-height:1.34;letter-spacing:-.02em;color:#FFFFFF;font-weight:900;">이메일 인증을 완료해 주세요</h1>
                <p data-email-region="body-copy" class="mfs-copy" style="margin:0;max-width:420px;font-size:15px;line-height:1.7;color:{brand_pill_bg};font-weight:700;">Money Flow Service 계정 보호를 위해 이메일 인증이 필요합니다.</p>
              </td>
            </tr>
            <tr>
              <td bgcolor="{neutral_surface}" class="mfs-content" style="padding:30px;background-color:{neutral_surface};color:{text_strong};">
                <p data-email-region="body-copy" class="mfs-copy" style="margin:0 0 24px;font-size:15px;line-height:1.8;color:{text_strong};font-weight:600;">아래 버튼을 누르면 회원가입이 자동으로 완료되고 Money Flow Service로 바로 이동합니다.</p>
                <table data-email-region="cta" data-brand-token="mfs-primary-blue" role="presentation" align="center" cellspacing="0" cellpadding="0" style="margin:0 auto 26px;">
                  <tr>
                    <td align="center" bgcolor="{primary_blue}" style="border-radius:999px;background-color:{primary_blue};box-shadow:0 14px 30px rgba(11,74,180,.28);">
                      <a href="{escaped_link}" style="display:inline-block;padding:14px 28px;border-radius:999px;background-color:{primary_blue};color:#FFFFFF;text-decoration:none;font-weight:800;font-size:15px;line-height:1.2;">이메일 인증 완료하기</a>
                    </td>
                  </tr>
                </table>
                <table data-email-region="verification-code" data-brand-token="mfs-primary-blue" role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="{soft_blue_bg}" class="mfs-code-panel" style="margin:0 0 20px;border-radius:18px;background-color:{soft_blue_bg};border:1px solid {soft_blue_border};color:{primary_blue};">
                  <tr>
                    <td bgcolor="{soft_blue_bg}" class="mfs-code-cell" style="padding:18px 20px;text-align:center;background-color:{soft_blue_bg};color:{primary_blue};">
                      <div class="mfs-code-label" style="margin:0 0 8px;font-size:13px;font-weight:800;color:{primary_blue};">직접 입력 인증번호</div>
                      <div class="mfs-code-value" style="font-size:34px;letter-spacing:.28em;font-weight:900;line-height:1.2;color:{primary_blue};">{escaped_code}</div>
                    </td>
                  </tr>
                </table>
                <p data-email-region="expiry" data-brand-token="mfs-success" style="margin:0 0 22px;text-align:center;">
                  <span class="mfs-expiry-badge" style="display:inline-block;padding:8px 14px;border-radius:999px;background-color:{success_bg};border:1px solid {success_border};color:{success_text};font-size:13px;font-weight:800;">유효시간 {int(expires_minutes)}분</span>
                </p>
                <p class="mfs-muted" style="margin:0 0 10px;font-size:13px;line-height:1.7;color:{text_muted};font-weight:600;">버튼이 열리지 않으면 아래 fallback URL을 브라우저 주소창에 붙여넣어 주세요.</p>
                <table data-email-region="fallback-url" data-brand-token="mfs-info" role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="{light_link_bg}" class="mfs-url-panel" style="margin:0;border-radius:15px;background-color:{light_link_bg};border:1px solid {neutral_border};color:{primary_blue};">
                  <tr>
                    <td bgcolor="{light_link_bg}" class="mfs-url-cell" style="padding:14px 16px;background-color:{light_link_bg};color:{primary_blue};font-size:12px;line-height:1.65;word-break:break-all;">
                      <a href="{escaped_link}" class="mfs-url-link" style="color:{info};text-decoration:none;font-weight:700;">{escaped_link}</a>
                    </td>
                  </tr>
                </table>
                <p class="mfs-footer" style="margin:24px 0 0;padding-top:18px;border-top:1px solid {neutral_border};font-size:12px;line-height:1.7;color:{text_muted};">요청한 적이 없다면 이 메일을 무시해 주세요.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""
        return self.send_email(to_email=to_email, subject=subject, body_text=body_text, body_html=body_html)

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
        subject = "[Money Flow Service] 가계부 초대가 도착했습니다"
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
