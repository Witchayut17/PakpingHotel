import logging

from fastapi import HTTPException
from storge.db import get_db

logger = logging.getLogger(__name__)

WORKER_ACTIONS = {
    "profile_updated",
    "password_reset",
    "slip_approved",
    "slip_declined",
    "checkin",
    "checkout",
    "refund_completed",
    "account_created",
    "account_updated",
    "account_deleted",
    "account_password_reset",
}

def list_worker_logs(page: int = 1, page_size: int = 20, search: str = "", role: str = "") -> dict:
    if page < 1 or not 1 <= page_size <= 100:
        raise HTTPException(status_code=422, detail="เลขหน้าหรือจำนวนรายการต่อหน้าไม่ถูกต้อง")
    if role and role not in {"owner", "ceo", "reception", "it_support", "housekeeper"}:
        raise HTTPException(status_code=422, detail="บทบาทพนักงานไม่ถูกต้อง")
    client = get_db()
    try:
        sample = client.table("Worker_log").select("*").limit(1).execute().data or []
        if not sample:
            return {"records": [], "total": 0, "page": page, "page_size": page_size}
        columns = sample[0]
        time_column = next((key for key in ("created_at", "timestamp", "createdAt", "created_time", "created_on", "time") if key in columns), None)
        query = client.table("Worker_log").select("*", count="exact")
        if search.strip():
            term = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            query = query.ilike("worker_name", f"%{term}%")
        if role:
            query = query.eq("role", role)
        if time_column:
            query = query.order(time_column, desc=True)
        if "id" in columns:
            query = query.order("id", desc=True)
        offset = (page - 1) * page_size
        result = query.range(offset, offset + page_size - 1).execute()
        records = [{"id": row.get("id"), "created_at": row.get(time_column) if time_column else None, "worker_name": row.get("worker_name"), "role": row.get("role"), "description": row.get("description"), "userId": row.get("userId")} for row in result.data or []]
        return {"records": records, "total": result.count or 0, "page": page, "page_size": page_size}
    except Exception as error:
        logger.exception("Unable to read Worker_log")
        raise HTTPException(status_code=503, detail="ไม่สามารถโหลดประวัติพนักงานได้ กรุณาลองอีกครั้ง") from error

def get_worker(user_id: str) -> dict:
    rows = (get_db().table("Worker").select("id,line_user_id,worker_name,role").eq("line_user_id", user_id).limit(1).execute().data or [])
    if not rows:
        raise HTTPException(status_code=403, detail="ไม่พบพนักงานสำหรับรหัสผู้ใช้นี้")
    return rows[0]

def log_worker_action(worker: dict, description: str) -> None:
    actor_id = worker.get("line_user_id") or worker.get("id")
    if actor_id is None or not str(actor_id).strip():
        raise ValueError("กรุณาระบุรหัสพนักงาน")
    if not worker.get("worker_name") or not worker.get("role"):
        raise ValueError("กรุณาระบุชื่อและบทบาทพนักงาน")
    get_db().table("Worker_log").insert({"description": description, "userId": str(actor_id), "worker_name": worker["worker_name"], "role": worker["role"],}).execute()

def log_worker_event(worker: dict, action: str, *, booking_id: str | None = None, target_worker_id: str | None = None, room_number: str | None = None, arrive_at: str | None = None, out_at: str | None = None, reason: str | None = None,) -> bool:
    if action not in WORKER_ACTIONS:
        raise ValueError("ไม่รองรับการดำเนินการของพนักงานที่ระบุ")
    reservation_actions = {"slip_approved", "slip_declined", "checkin", "checkout", "refund_completed"}
    if action in reservation_actions and (booking_id is None or not str(booking_id).strip()):
        raise ValueError("กรุณาระบุรหัสการจองสำหรับการดำเนินการกับรายการจอง")
    if action.startswith("account_") and (target_worker_id is None or not str(target_worker_id).strip()):
        raise ValueError("กรุณาระบุรหัสพนักงานที่ต้องการจัดการบัญชี")
    if action == "checkin" and not arrive_at:
        raise ValueError("กรุณาระบุวันเวลาเข้าพักสำหรับการเช็คอิน")
    if action == "checkout" and not out_at:
        raise ValueError("กรุณาระบุวันเวลาออกจากที่พักสำหรับการเช็คเอาต์")

    details = {}
    if action in {"profile_updated", "password_reset"}:
        details["worker_id"] = worker.get("id") or worker.get("line_user_id")
    for key, value in (("booking_id", booking_id), ("target_worker_id", target_worker_id), ("room_number", room_number), ("arrive_at", arrive_at), ("out_at", out_at)):
        if value is not None:
            details[key] = str(value)
    if reason is not None:
        details["reason_provided"] = "true" if reason.strip() else "false"
    fields = []
    for key, value in details.items():
        text = str(value).replace("\r", "\\r").replace("\n", "\\n")
        fields.append(f"{key}={text}")
    description = f"{action}: {', '.join(fields)}"
    try:
        log_worker_action(worker, description)
    except Exception:
        logger.exception("Worker_log insert failed: actor=%s role=%s event=%s", worker.get("id") or worker.get("line_user_id"), worker.get("role"), description)
        return False
    return True
