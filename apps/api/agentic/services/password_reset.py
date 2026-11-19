"""P116 (feedback 19 Nov: "reset password via OTP email"): forgot your password, get a 6-digit
code by email, enter it with a new password on the sign-in page.

The code is kept only as an argon2id hash in Valkey (`pwreset:{user id}`, 15 minutes), never
on the account: it cannot sign anyone in by itself, only set a new password together with
the person's email, and a stranger asking for one changes nothing. Five wrong tries and the
code is gone (ask again). Sending uses the office's system mailbox and the same limits as the
emailed sign-in passwords (services/signin_mail.py: per email one per 5 minutes and 5 a day,
per IP 20 an hour) and the same switch (Settings > Sign-in emails, "Forgot password").
Setting the new password signs the person out everywhere. Every step is audited, never with
the code.
"""

import html
import json
import logging
import secrets
from datetime import timedelta

from sqlalchemy import delete, select

from ..core.db import SessionLocal
from ..core.security import hash_password, verify_password
from ..core.valkey import valkey
from ..microsoft import sendmail
from ..models import AuthSession, User
from . import audit, signin_mail

log = logging.getLogger(__name__)

CODE_TTL = timedelta(minutes=15)
TRIES = 5
SUBJECT = "Your Agentic Office password reset code / Kod set semula kata laluan Agentic Office"


def _key(user_id: str) -> str:
    return f"pwreset:{user_id}"


def new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def reset_email(*, name: str, email: str, code: str, link: str) -> str:
    """Malay and English, the code in a box, no images."""
    n, e, u = html.escape(name), html.escape(email), html.escape(link, quote=True)
    a = f'<a href="{u}" style="color:#1d4ed8">{html.escape(link)}</a>'
    p = '<p style="margin:0 0 10px">'
    mins = int(CODE_TTL.total_seconds() // 60)
    return signin_mail._page(  # noqa: SLF001 - the same plain page as the sign-in emails
        f"{p}Hello {n},</p>{p}Here is your code to set a new Agentic Office password:</p>"
        f"{signin_mail._box(html.escape(code))}"  # noqa: SLF001
        f"{p}On the sign-in page ({a}) enter your email <b>{e}</b>, this code and your new "
        f"password. The code is valid for {mins} minutes.</p>"
        f"{p}If you did not ask for it, ignore this email: your password stays the same.</p>"
        '<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">'
        f"{p}Salam {n},</p>{p}Ini kod anda untuk menetapkan kata laluan Agentic Office yang "
        "baharu (kotak di atas).</p>"
        f"{p}Di halaman log masuk ({a}) masukkan e-mel anda <b>{e}</b>, kod ini dan kata "
        f"laluan baharu anda. Kod ini sah selama {mins} minit.</p>"
        f"{p}Jika anda tidak memintanya, abaikan e-mel ini: kata laluan anda kekal sama.</p>"
    )


async def requested(email: str, ip: str) -> None:
    """ "Forgot password": the same 202 for everyone; here, in the background, an active
    member gets a code when their workspace sends sign-in emails and allows it."""
    try:
        if not await signin_mail._ip_ok(ip):  # noqa: SLF001
            return
        async with SessionLocal() as db:
            user = await db.scalar(select(User).where(User.email == email))
            if user is None or not user.is_active:
                return
            found = await signin_mail.sender_for(db, user)
            if found is None or not found[1].forgot_password:
                return
            if not await signin_mail._email_ok(email):  # noqa: SLF001
                return
            ws_id, sm = found
            code = new_code()
            await valkey().set(
                _key(user.id),
                json.dumps({"h": hash_password(code), "tries": 0}),
                ex=int(CODE_TTL.total_seconds()),
            )
            try:
                await sendmail.send(
                    db,
                    ws_id,
                    sender=sm.address,
                    from_name=sm.from_name,
                    to=user.email,
                    to_name=user.name,
                    subject=SUBJECT,
                    html=reset_email(
                        name=user.name,
                        email=user.email,
                        code=code,
                        link=await signin_mail.signin_link(db, ws_id),
                    ),
                )
            except sendmail.SendError as e:
                await valkey().delete(_key(user.id))
                await audit.record(
                    db,
                    ws_id,
                    "system",
                    "auth.reset_code_failed",
                    target=user.id,
                    after={"to": user.email, "why": e.kind},
                )
                await db.commit()
                return
            await audit.record(
                db, ws_id, "system", "auth.reset_code_sent", target=user.id, after={"to": email}
            )
            await db.commit()
    except Exception:  # noqa: BLE001 - a background task must never take the API down
        log.exception("password reset email failed")


async def confirm(email: str, code: str, new_password: str) -> bool:
    """Set the new password when `code` is this person's live code. False otherwise (one
    argon2 check either way). Signs them out everywhere. Commits."""
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email))
        raw = await valkey().get(_key(user.id)) if user is not None else None
        st = json.loads(raw) if raw else None
        ok = verify_password(st["h"] if st else None, code.strip())
        if user is None or st is None or not user.is_active:
            return False
        if not ok:
            st["tries"] = int(st.get("tries", 0)) + 1
            if st["tries"] >= TRIES:
                await valkey().delete(_key(user.id))
            else:
                ttl = await valkey().ttl(_key(user.id))
                await valkey().set(_key(user.id), json.dumps(st), ex=max(int(ttl), 1))
            return False
        await valkey().delete(_key(user.id))
        user.password_hash = hash_password(new_password)
        user.must_change_password = False
        signin_mail.clear_code(user)
        await signin_mail.forget_used(user.id)
        await db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
        found = await signin_mail.sender_for(db, user)
        if found is not None:
            await audit.record(
                db,
                found[0],
                f"user:{user.id}",
                "auth.password_reset",
                target=user.id,
                note="with a code emailed to them; signed out everywhere",
            )
        await db.commit()
        return True
