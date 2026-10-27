from fastapi import HTTPException

from storge.db import get_db
from utils.dashboard_auth import ROLES, hash_password, verify_password


def public_worker(row: dict) -> dict:
    return {key: row.get(key) for key in ("id", "worker_name", "role", "phone")}


def editable_worker(worker_id: str, actor: dict) -> dict:
    rows = (get_db().table("Worker")
            .select("id,worker_name,role,phone")
            .eq("id", worker_id).limit(1).execute().data or [])
    if not rows or rows[0]["role"] not in ROLES:
        raise HTTPException(status_code=404, detail="ไม่พบบัญชีพนักงาน")
    target = rows[0]
    if target["role"] == "owner" and actor["role"] != "owner":
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์จัดการบัญชีเจ้าของกิจการ")
    return target


def unique_name(name: str, exclude_id: str | None = None) -> None:
    rows = (get_db().table("Worker").select("id")
            .eq("worker_name", name).in_("role", sorted(ROLES))
            .limit(2).execute().data or [])
    if any(str(row["id"]) != str(exclude_id) for row in rows):
        raise HTTPException(status_code=409, detail="ชื่อพนักงานนี้มีอยู่แล้ว")


def list_users(actor: dict) -> dict:
    roles = sorted(ROLES if actor["role"] == "owner" else ROLES - {"owner"})
    rows = (get_db().table("Worker")
            .select("id,worker_name,role,phone")
            .in_("role", roles).order("worker_name").execute().data or [])
    return {"users": [public_worker(row) for row in rows]}


def create_user(payload, actor: dict) -> dict:
    if payload.role == "owner" and actor["role"] != "owner":
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์สร้างบัญชีเจ้าของกิจการ")
    unique_name(payload.name)
    rows = (get_db().table("Worker").insert({
        "worker_name": payload.name,
        "phone": payload.phone,
        "role": payload.role,
        "password": hash_password(payload.phone),
    }).execute().data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="สร้างบัญชีไม่สำเร็จ")
    return public_worker(rows[0])


def update_user(worker_id: str, payload, actor: dict) -> dict:
    target = editable_worker(worker_id, actor)
    if payload.role == "owner" and actor["role"] != "owner":
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์กำหนดบทบาทเจ้าของกิจการ")
    if str(target["id"]) == str(actor["id"]) and payload.role != target["role"]:
        raise HTTPException(status_code=400, detail="ไม่สามารถเปลี่ยนบทบาทของตนเอง")
    unique_name(payload.name, worker_id)
    rows = (get_db().table("Worker")
            .update({"worker_name": payload.name, "phone": payload.phone, "role": payload.role})
            .eq("id", worker_id).execute().data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="ไม่พบบัญชีพนักงาน")
    return public_worker(rows[0])


def reset_user_password(worker_id: str, actor: dict) -> dict:
    target = editable_worker(worker_id, actor)
    if not target.get("phone") or len(target["phone"]) != 10 or not target["phone"].isdigit():
        raise HTTPException(status_code=400, detail="กรุณากำหนดเบอร์โทร 10 หลักก่อนรีเซ็ตรหัสผ่าน")
    (get_db().table("Worker").update({"password": hash_password(target["phone"])})
     .eq("id", worker_id).execute())
    return {"status": "Success"}


def delete_user(worker_id: str, actor: dict) -> dict:
    target = editable_worker(worker_id, actor)
    if str(target["id"]) == str(actor["id"]):
        raise HTTPException(status_code=400, detail="ไม่สามารถลบบัญชีของตนเอง")
    (get_db().table("Worker").delete().eq("id", worker_id).execute())
    return {"status": "Success"}


def change_password(payload, actor: dict) -> dict:
    if not verify_password(payload.current_password, actor.get("password")):
        raise HTTPException(status_code=400, detail="รหัสผ่านปัจจุบันไม่ถูกต้อง")
    (get_db().table("Worker").update({"password": hash_password(payload.new_password)})
     .eq("id", actor["id"]).execute())
    return {"status": "Success"}
