from fastapi import HTTPException
from storge.db import get_db

def get_worker(user_id: str) -> dict:
    rows = (
        get_db().table("Worker")
        .select("line_user_id,worker_name")
        .eq("line_user_id", user_id)
        .limit(1)
        .execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=403, detail="ไม่พบพนักงานสำหรับ userId นี้")
    return rows[0]

def log_worker_action(worker: dict, description: str) -> None:
    get_db().table("Worker_log").insert({
        "description": description,
        "userId": worker["line_user_id"],
        "worker_name": worker["worker_name"],
    }).execute()
