import logging
from starlette.concurrency import run_in_threadpool
from fastapi import Body, Depends, Header, HTTPException, Query, Response
from repository import api_repo
from models.api_model import ReplyAvailablePayload, BookingRequest, SlipRequest, CancelBookingRequest, RefundRequest, CompleteRefundRequest, UpdateUserStatusRequest, ReservationRoomActionRequest, UserReply, WorkerData, ReplyMaintenancePayload, RoomStatus, DashboardLogin, DashboardUserCreate, DashboardUserUpdate, DashboardPasswordChange
from storge.db import get_db
from services.reply_flexroom import reply_available_rooms, send_approval_message, reply_maintenance_rooms
from repository.api_repo import create_booking, make_qr_url, worker_data_input, set_room_status
from services.n8n_event import process_n8n_event
from utils.dashboard_auth import ROLES, create_session, current_worker, revoke_session, verify_owner_master_password, verify_password
from utils import dashboard_users
from utils.worker_log import list_worker_logs

db = get_db()
logger = logging.getLogger(__name__)

def _login_worker(payload: DashboardLogin) -> dict:
    rows = (db.table("Worker").select("id,worker_name,role,phone,password")
            .eq("worker_name", payload.worker_name).in_("role", sorted(ROLES))
            .limit(2).execute().data or [])
    if len(rows) != 1:
        raise HTTPException(status_code=401, detail="ชื่อพนักงานหรือรหัสผ่านไม่ถูกต้อง")
    worker = rows[0]
    if not (verify_password(payload.password, worker.get("password"))
            or verify_owner_master_password(payload.password, worker["role"])):
        raise HTTPException(status_code=401, detail="ชื่อพนักงานหรือรหัสผ่านไม่ถูกต้อง")
    return {"token": create_session(worker), "id": worker["id"], "name": worker["worker_name"], "role": worker["role"], "phone": worker.get("phone") or ""}

async def dashboard_login(payload: DashboardLogin) -> dict:
    return await run_in_threadpool(_login_worker, payload)

async def dashboard_me(worker: dict = Depends(current_worker)) -> dict:
    return {"id": worker["id"], "name": worker["worker_name"], "role": worker["role"], "phone": worker.get("phone") or ""}

async def dashboard_logout(authorization: str = Header(...), worker: dict = Depends(current_worker)) -> dict:
    revoke_session(authorization[7:])
    return {"status": "Success"}

async def dashboard_users_list(worker: dict = Depends(current_worker)) -> dict:
    return await run_in_threadpool(dashboard_users.list_users, worker)

async def dashboard_worker_logs(
    response: Response,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str = Query(default="", max_length=200),
    role: str = Query(default=""),
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    return await run_in_threadpool(list_worker_logs, page, page_size, search, role)

async def dashboard_users_create(payload: DashboardUserCreate, worker: dict = Depends(current_worker)) -> dict:
    return await run_in_threadpool(dashboard_users.create_user, payload, worker)

async def dashboard_users_update(worker_id: str, payload: DashboardUserUpdate, worker: dict = Depends(current_worker)) -> dict:
    return await run_in_threadpool(dashboard_users.update_user, worker_id, payload, worker)

async def dashboard_users_reset_password(worker_id: str, worker: dict = Depends(current_worker)) -> dict:
    return await run_in_threadpool(dashboard_users.reset_user_password, worker_id, worker)

async def dashboard_users_delete(worker_id: str, worker: dict = Depends(current_worker)) -> dict:
    return await run_in_threadpool(dashboard_users.delete_user, worker_id, worker)

async def dashboard_change_password(payload: DashboardPasswordChange, worker: dict = Depends(current_worker)) -> dict:
    return await run_in_threadpool(dashboard_users.change_password, payload, worker)

async def dashboard_overview_data() -> dict:
    result = await run_in_threadpool(api_repo.list_reservations)
    fields = ("customer_name", "room_number", "check_in", "check_out", "amount","full_amount", "payment_method", "status", "arrive_at", "initial_paid_at")
    return {"records": [{**{field: row.get(field) for field in fields},"is_mock": str(row.get("line_user_id") or "").startswith("MOCK-")}for row in result["records"]]}

async def received_n8n(payload: dict = Body(...)) -> dict:
    if "body" in payload:
        payload = payload["body"]
        if not isinstance(payload, dict):
            raise HTTPException(status_code=422, detail="ข้อมูลคำขอต้องเป็นข้อมูลแบบเจสันชนิดออบเจ็กต์ครับ")
    if "events" in payload:
        events = payload["events"]
        if not isinstance(events, list) or any(not isinstance(event, dict) for event in events):
            raise HTTPException(status_code=422, detail="รายการเหตุการณ์ต้องเป็นรายการออบเจ็กต์แบบเจสันครับ")
        results = []
        for event in events:
            results.append(await process_n8n_event({"destination": payload.get("destination"), **event}))
        return results[0] if len(results) == 1 else {"results": results}
    return await process_n8n_event(payload)

async def post_slip(payload: SlipRequest) -> dict:
    return await run_in_threadpool(api_repo.save_slip, payload.userId, payload.bookingId, payload.image)

async def check_input(payload: dict = Body(...)) -> dict:
    message = payload.get("message") or {}
    text = payload.get("text")
    if text is None and isinstance(message, dict):
        text = message.get("text")
    if text == "ดูห้องว่าง":
        result = "0"
    elif text == "อัพเดทสถานะห้อง":
        result = "1"
    else:
        result = "Unknown"
    return {**payload, "result": result}

async def reply_available(payload: ReplyAvailablePayload):
    try:
        await reply_available_rooms(payload)
        return {"status": "Success"}
    except Exception as ex:
        logger.exception("Unable to reply with available rooms")
        raise HTTPException(status_code=500, detail="ไม่สามารถส่งรายการห้องว่างได้ครับ") from ex

async def post_booking(payload: BookingRequest):
    try:
        booking = await run_in_threadpool(create_booking, payload.user_name, payload.user_phone, payload.user_id, payload.room_number, payload.check_in, payload.check_out, payload.action)

    except Exception as ex:
        logger.exception("Booking failed:name=%s phone=%s userId=%s room=%s check_in=%s check_out=%s action=%s",payload.user_name, payload.user_phone, payload.user_id, payload.room_number, payload.check_in, payload.check_out, payload.action)
        if isinstance(ex, HTTPException):
            raise
        raise HTTPException(status_code=500, detail="ไม่สามารถสร้างรายการจองได้ครับ") from ex
    try:
        qr_url = await run_in_threadpool(make_qr_url, booking)
    except Exception as ex:
        logger.exception("Unable to create QR for booking %s", booking.get("_id"))
        try:
            rolled_back = await run_in_threadpool(api_repo.rollback_booking_without_qr, booking)
        except Exception:
            logger.exception("Unable to roll back booking without QR: %s", booking.get("_id"))
            rolled_back = False
        if not rolled_back:
            raise HTTPException(502, detail={
                "booking": booking,
                "message": "สร้างรายการแล้วแต่คิวอาร์โค้ดยังไม่พร้อม กรุณาติดต่อที่พักก่อนจองซ้ำครับ",
            }) from ex
        raise HTTPException(503, detail={
            "code": "qr_generation_failed",
            "message": "สร้างคิวอาร์โค้ดไม่สำเร็จและยกเลิกรายการแล้ว กรุณาลองจองอีกครั้งครับ",
        }) from ex
    return {"booking": booking, "qr_url": qr_url}

async def cancel_booking(payload: CancelBookingRequest):
    return await run_in_threadpool(api_repo.cancel_booking, payload.user_id, payload.booking_id)

async def request_refund(payload: RefundRequest):
    return await run_in_threadpool(api_repo.request_refund, payload.user_id, payload.booking_id,
                                   payload.refund_bank, payload.refund_account)

async def complete_refund(payload: CompleteRefundRequest, worker: dict = Depends(current_worker)):
    return await run_in_threadpool(api_repo.complete_refund, payload.booking_id, actor=worker)

async def cancel_approved_deposit(payload: CancelBookingRequest):
    if not payload.booking_id:
        raise HTTPException(status_code=422, detail="กรุณาระบุรายการที่ต้องการยกเลิกครับ")
    return await run_in_threadpool(api_repo.cancel_approved_deposit, payload.user_id, payload.booking_id)

async def list_rooms():
    return api_repo.list_rooms()

async def list_room_statuses():
    return await run_in_threadpool(api_repo.list_room_statuses)

async def room_availability(room_number: str):
    if not room_number.strip():
        raise HTTPException(422, "กรุณาระบุเลขห้องครับ")
    try:
        ranges = await run_in_threadpool(api_repo.booked_ranges, db, room_number)
        return {"room_number": room_number, "booked_ranges": ranges}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Unable to load room availability")
        raise HTTPException(503, "ไม่สามารถตรวจสอบวันว่างได้ กรุณาลองอีกครั้งครับ")

async def list_user_payments(userId: str = Query(min_length=1)):
    return await run_in_threadpool(api_repo.list_user_payments, userId)

async def list_user_paid():
    return await run_in_threadpool(api_repo.list_user_paid)

async def list_reservations():
    return await run_in_threadpool(api_repo.list_reservations)

async def reservation_room_action(payload: ReservationRoomActionRequest, worker: dict = Depends(current_worker)):
    return await run_in_threadpool(api_repo.reservation_room_action, payload.booking_id, payload.action, payload.balance_paid_confirmed, actor=worker)

async def get_booking_slip(booking_id: str = Query(min_length=1)):
    return await run_in_threadpool(api_repo.get_booking_slip, booking_id)

async def update_user_status(payload: UpdateUserStatusRequest, worker: dict = Depends(current_worker)):
    return await run_in_threadpool(api_repo.update_user_status, payload.booking_id, payload.status, payload.description, actor=worker)

async def reply_approval(payload: UserReply):
    return await send_approval_message(payload.userId, payload.booking_id, payload.status, payload.description)

async def worker_reply(payload: dict = Body(...)) -> dict:
    try:
        userId = payload.get("userId")
        if not isinstance(userId, str) or not userId.strip():
            raise HTTPException(status_code=422, detail="กรุณาระบุรหัสผู้ใช้ครับ")

        def find_worker():
            return (db.table("Worker").select("line_user_id")
                    .eq("line_user_id", userId).limit(1).execute().data or [])

        rows = await run_in_threadpool(find_worker)
        if not rows:
            await worker_data_input(userId)
            payload["haveId"] = "0"
        else:
            await reply_maintenance_rooms(payload)
            payload["haveId"] = "1"
        return payload
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Unable to check worker %s", payload.get("userId"))
        raise HTTPException(status_code=500, detail="ไม่สามารถตรวจสอบข้อมูลพนักงานได้ครับ") from ex

async def worker_insert(payload: WorkerData):
    return await run_in_threadpool(api_repo.insert_worker_data, payload.userId, payload.worker_name, payload.phone)

async def reply_maintenance(payload: ReplyMaintenancePayload):
    try:
        await reply_maintenance_rooms(payload)
        return {"status": "Success"}
    except Exception as ex:
        logger.exception("Unable to reply with maintenance rooms")
        raise HTTPException(status_code=500, detail="ไม่สามารถส่งรายการห้องรอทำความสะอาดได้ครับ") from ex

async def set_room_status_by_number(payload: RoomStatus):
    try:
        await run_in_threadpool(set_room_status, payload.room_number, payload.status, payload.userId)
        return {"status": "Success"}
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Unable to set room status")
        raise HTTPException(status_code=500, detail="ไม่สามารถเปลี่ยนสถานะห้องได้ครับ") from ex
