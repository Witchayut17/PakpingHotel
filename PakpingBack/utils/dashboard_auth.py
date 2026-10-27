import hashlib
import hmac
import secrets
import time
from threading import RLock

from fastapi import Header, HTTPException

from storge.db import get_db

ROLES = {"Owner", "CEO", "Receptionist", "IT Support"}
SESSION_SECONDS = 12 * 60 * 60
HASH_ITERATIONS = 260_000
_sessions: dict[str, tuple[str, float, str]] = {}
_sessions_lock = RLock()

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, HASH_ITERATIONS)
    return f"pbkdf2_sha256${HASH_ITERATIONS}${salt.hex()}${digest.hex()}"

def verify_password(password: str, stored: str | None) -> bool:
    try:
        algorithm, iterations, salt, expected = (stored or "").split("$")
        if algorithm != "pbkdf2_sha256" or not 100_000 <= int(iterations) <= 1_000_000:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, TypeError):
        return False

def create_session(worker: dict) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    credential = hashlib.sha256(worker["password"].encode()).hexdigest()
    with _sessions_lock:
        now = time.time()
        for key, (_, expires, _) in list(_sessions.items()):
            if expires <= now:
                del _sessions[key]
        _sessions[token_hash] = (worker["id"], now + SESSION_SECONDS, credential)
    return token


def revoke_session(token: str) -> None:
    with _sessions_lock:
        _sessions.pop(hashlib.sha256(token.encode()).hexdigest(), None)

def _worker_for_token(token: str) -> dict:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with _sessions_lock:
        session = _sessions.get(token_hash)
        if session and session[1] <= time.time():
            del _sessions[token_hash]
            session = None
    if not session:
        raise HTTPException(status_code=401, detail="กรุณาเข้าสู่ระบบใหม่")
    worker_id, _, credential = session
    try:
        rows = (get_db().table("Worker")
                .select("id,worker_name,role,password")
                .eq("id", worker_id).limit(1).execute().data or [])
        if not rows or rows[0]["role"] not in ROLES:
            raise ValueError("worker unavailable")
        current_credential = hashlib.sha256((rows[0].get("password") or "").encode()).hexdigest()
        if not hmac.compare_digest(credential, current_credential):
            raise ValueError("password changed")
        return rows[0]
    except (ValueError, TypeError, KeyError, AttributeError):
        revoke_session(token)
        raise HTTPException(status_code=401, detail="กรุณาเข้าสู่ระบบใหม่") from None

def current_worker(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="กรุณาเข้าสู่ระบบ")
    return _worker_for_token(authorization[7:])

def require_roles(*roles: str):
    from fastapi import Depends

    def check(worker: dict = Depends(current_worker)) -> dict:
        if worker["role"] != "Owner" and worker["role"] not in roles:
            raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์ใช้งานส่วนนี้")
        return worker

    return check

