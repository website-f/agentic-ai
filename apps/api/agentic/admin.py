"""Operator commands, run inside the api container (docs/RUNBOOK.md):

    docker compose exec api python -m agentic.admin reset-password owner@example.com
    docker compose exec api python -m agentic.admin sessions-revoke owner@example.com
    docker compose exec api python -m agentic.admin reset-2fa owner@example.com
    docker compose exec api python -m agentic.admin make-developer dev@example.com --name "Dev"
    docker compose exec api python -m agentic.admin developer-off dev@example.com
    docker compose exec api python -m agentic.admin stuck-tasks [--fail]
    docker compose exec -e AGENTIC_OLD_MASTER_KEY=... api python -m agentic.admin rotate-master-key
    docker compose exec api python -m agentic.admin rotate-master-key --from-dev

rotate-master-key moves every stored secret (provider keys, channel tokens, Google and MCP
credentials, vault logins, the web-push key) from the old master key to the one the app runs
with now (AGENTIC_MASTER_KEY). Only the per-secret data keys are re-wrapped; no secret is
ever decrypted. --from-dev takes the key a dev install derived from its secret key
(AGENTIC_OLD_SECRET_KEY, default the dev one): use it when moving dev data to production.

make-developer (P73) marks the system's developer: an owner of the workspace who also has the
Feedbacks page. A new email gets an account with a one-time password (printed once, changed at
the first sign-in); an existing person is made owner of the workspace. Only this command sets
it, so no one can make themselves a developer from the app.

Every change is written to the audit log as actor `system:admin-cli`.
"""

import argparse
import asyncio
import os
import sys

from sqlalchemy import delete, select

from .core import crypto
from .core.config import DEV_SECRET
from .core.db import SessionLocal, engine
from .core.security import hash_password, temp_password
from .models import (
    AIProvider,
    AuthSession,
    Channel,
    Credential,
    CredentialState,
    GoogleAccount,
    InstanceSecret,
    Integration,
    McpServer,
    Membership,
    MicrosoftAccount,
    Task,
    User,
    Workspace,
)
from .services import audit
from .teams.branches import set_branches

ACTOR = "system:admin-cli"


async def _user(email: str) -> User:
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == email.strip().lower()))
    if u is None:
        sys.exit(f"No user with the email {email}.")
    return u


async def reset_password(email: str) -> None:
    u = await _user(email)
    password = temp_password()
    async with SessionLocal() as db:
        user = await db.get(User, u.id)
        assert user is not None
        user.password_hash = hash_password(password)
        user.must_change_password = True
        user.is_active = True
        await db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
        for m in (await db.scalars(select(Membership).where(Membership.user_id == user.id))).all():
            await audit.record(db, m.workspace_id, ACTOR, "member.password_reset", target=user.id)
        await db.commit()
    print(f"Temporary password for {u.email}: {password}")
    print("They must choose a new one at the next sign-in. All their sessions were ended.")


async def reset_2fa(email: str) -> None:
    """P57: the last owner lost their phone and their recovery codes."""
    from .services import two_factor

    u = await _user(email)
    async with SessionLocal() as db:
        user = await db.get(User, u.id)
        assert user is not None
        two_factor.turn_off(user)
        await db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
        for m in (await db.scalars(select(Membership).where(Membership.user_id == user.id))).all():
            await audit.record(db, m.workspace_id, ACTOR, "auth.2fa_reset", target=user.id)
        await db.commit()
    print(f"Two-step sign-in is off for {u.email}. All their sessions were ended.")


async def make_developer(email: str, name: str | None, workspace: str | None) -> None:
    """P73: the developer is an owner who also reads and answers feedback."""
    email = email.strip().lower()
    if "@" not in email:
        sys.exit("Give the developer's email address.")
    async with SessionLocal() as db:
        spaces = (await db.scalars(select(Workspace).order_by(Workspace.created_at))).all()
        if workspace:
            spaces = [w for w in spaces if workspace in (w.slug, w.id)]
        if not spaces:
            sys.exit(f"No workspace {workspace}." if workspace else "No workspace yet.")
        if len(spaces) > 1:
            names = ", ".join(w.slug for w in spaces)
            sys.exit(f"More than one workspace ({names}): pick one with --workspace <slug>.")
        ws = spaces[0]
        user = await db.scalar(select(User).where(User.email == email))
        password: str | None = None
        if user is None:
            password = temp_password()
            user = User(
                email=email,
                name=(name or email.split("@")[0]).strip()[:120],
                password_hash=hash_password(password),
                must_change_password=True,
            )
            db.add(user)
            await db.flush()
        elif name:
            user.name = name.strip()[:120]
        user.is_developer = True
        user.is_active = True
        m = await db.get(Membership, (ws.id, user.id))
        before_role = m.role if m else None
        if m is None:
            db.add(Membership(workspace_id=ws.id, user_id=user.id, role="owner"))
        else:
            m.role = "owner"
            set_branches(m, None, [])  # P98: owners sit in no branch
            m.department_id = None
        await db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
        await audit.record(
            db,
            ws.id,
            ACTOR,
            "member.developer_on",
            target=user.id,
            before={"role": before_role},
            after={"email": email, "role": "owner", "developer": True},
        )
        await db.commit()
    print(f"{email} is the developer of {ws.name} (owner, plus the Feedbacks page).")
    if password:
        print(f"One-time password: {password}")
        print("They choose their own password at the first sign-in.")
    else:
        print("Their password did not change. Their sessions were ended: sign in again.")


async def developer_off(email: str) -> None:
    u = await _user(email)
    async with SessionLocal() as db:
        user = await db.get(User, u.id)
        assert user is not None
        user.is_developer = False
        for m in (await db.scalars(select(Membership).where(Membership.user_id == user.id))).all():
            await audit.record(db, m.workspace_id, ACTOR, "member.developer_off", target=user.id)
        await db.commit()
    print(f"{u.email} is no longer the developer (their role did not change).")


async def revoke_sessions(email: str) -> None:
    u = await _user(email)
    async with SessionLocal() as db:
        n = (await db.execute(delete(AuthSession).where(AuthSession.user_id == u.id))).rowcount  # type: ignore[attr-defined]
        await db.commit()
    print(f"Ended {n} session(s) for {u.email}.")


async def stuck_tasks(fail: bool) -> None:
    """Tasks that look running but whose Temporal workflow is gone (e.g. after a restore)."""
    from temporalio.service import RPCError

    from .agents import runtime
    from .core.temporal import temporal_client

    client = await temporal_client()
    async with SessionLocal() as db:
        rows = (
            await db.scalars(select(Task).where(Task.status.in_(("running", "blocked", "ready"))))
        ).all()
    found = 0
    for t in rows:
        if not t.workflow_id:
            continue
        try:
            d = await client.get_workflow_handle(t.workflow_id).describe()
            open_ = d.status is not None and d.status.name == "RUNNING"
        except RPCError:
            open_ = False
        if open_:
            continue
        found += 1
        print(f"{t.id}  {t.status:8}  {t.title[:60]}  (workflow {t.workflow_id} is not running)")
        if fail:
            await runtime.finish(t.id, "failed", "The run stopped unexpectedly. Start it again.")
    print(f"{found} stuck task(s)" + (" marked failed." if fail and found else "."))


# (model, column, how its associated data is built)
SECRETS = [
    (AIProvider, "api_key_enc", lambda r: r.aad),
    (Channel, "config_enc", lambda r: f"channel:{r.id}"),
    (Integration, "config_enc", lambda r: r.aad),
    (GoogleAccount, "token_enc", lambda r: r.aad),
    (MicrosoftAccount, "token_enc", lambda r: r.aad),
    (McpServer, "auth_header_enc", lambda r: r.aad),
    (Credential, "username_enc", lambda r: r.aad + ":u"),
    (Credential, "password_enc", lambda r: r.aad),
    (CredentialState, "state_enc", lambda r: f"credential_state:{r.credential_id}"),
    (InstanceSecret, "value_enc", lambda r: f"instance_secret:{r.name}"),
    (User, "totp_secret_enc", lambda r: f"user_totp:{r.id}"),  # P57 two-step sign-in
]


async def rotate_master_key(from_dev: bool) -> None:
    if from_dev:
        old = crypto.dev_master_key(os.environ.get("AGENTIC_OLD_SECRET_KEY", DEV_SECRET))
    else:
        raw = os.environ.get("AGENTIC_OLD_MASTER_KEY", "")
        if not raw:
            sys.exit("Set AGENTIC_OLD_MASTER_KEY (base64url), or use --from-dev.")
        old = crypto._b64d(raw)  # noqa: SLF001
    new = crypto._master_key()  # noqa: SLF001 - the key this process runs with
    if old == new:
        sys.exit("The old and the new master key are the same; nothing to do.")
    moved = skipped = 0
    async with SessionLocal() as db:
        for model, column, aad in SECRETS:
            for row in (await db.scalars(select(model))).all():
                token = getattr(row, column)
                if not token:
                    continue
                try:
                    setattr(row, column, crypto.rewrap(token, aad(row), old, new))
                    moved += 1
                except crypto.DecryptError:
                    try:  # already on the new key (a re-run): leave it
                        crypto.decrypt(token, aad(row))
                        skipped += 1
                    except crypto.DecryptError:
                        await db.rollback()
                        sys.exit(
                            f"{model.__tablename__}.{column} of {aad(row)} opens with "
                            "neither key. Nothing was changed."
                        )
        for ws_id in (await db.scalars(select(Workspace.id))).all():
            await audit.record(
                db, ws_id, ACTOR, "secrets.rotate_master_key", after={"moved": moved}
            )
        await db.commit()
    print(f"{moved} secret(s) moved to the new master key, {skipped} already on it.")


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m agentic.admin")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("reset-password").add_argument("email")
    sub.add_parser("sessions-revoke").add_argument("email")
    sub.add_parser("reset-2fa").add_argument("email")
    md = sub.add_parser("make-developer")
    md.add_argument("email")
    md.add_argument("--name", default=None)
    md.add_argument("--workspace", default=None, help="slug, when there is more than one")
    sub.add_parser("developer-off").add_argument("email")
    st = sub.add_parser("stuck-tasks")
    st.add_argument("--fail", action="store_true", help="mark them failed so they can be retried")
    rk = sub.add_parser("rotate-master-key")
    rk.add_argument("--from-dev", action="store_true", help="the old key is a dev install's")
    a = ap.parse_args()

    async def run() -> None:
        try:
            if a.cmd == "reset-password":
                await reset_password(a.email)
            elif a.cmd == "sessions-revoke":
                await revoke_sessions(a.email)
            elif a.cmd == "reset-2fa":
                await reset_2fa(a.email)
            elif a.cmd == "make-developer":
                await make_developer(a.email, a.name, a.workspace)
            elif a.cmd == "developer-off":
                await developer_off(a.email)
            elif a.cmd == "rotate-master-key":
                await rotate_master_key(a.from_dev)
            else:
                await stuck_tasks(a.fail)
        finally:
            await engine.dispose()

    asyncio.run(run())


if __name__ == "__main__":
    main()
