import logging
from starlette.concurrency import run_in_threadpool
from fastapi import Body, HTTPException, Query
from repository import api_repo
from models.api_model import ReplyAvailablePayload, BookingRequest, SlipRequest, CancelBookingRequest, UpdateUserStatusRequest, ReservationRoomActionRequest, UserReply, WorkerData, ReplyMaintenancePayload, RoomStatus
from storge.db import get_db
from services.reply_flexroom import reply_available_rooms, send_approval_message, reply_maintenance_rooms
from repository.api_repo import create_booking, make_qr_url, worker_data_input, set_room_status
from services.n8n_event import process_n8n_event

db = get_db()
logger = logging.getLogger(__name__)

async def received_n8n(payload: dict = Body(...)) -> dict:
    if "body" in payload:
        payload = payload["body"]
        if not isinstance(payload, dict):
            raise HTTPException(status_code=422, detail="body ต้องเป็นข้อมูล JSON object ครับ")
    if "events" in payload:
        events = payload["events"]
        if not isinstance(events, list) or any(not isinstance(event, dict) for event in events):
            raise HTTPException(status_code=422, detail="events ต้องเป็นรายการ JSON object ครับ")
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
        booking = create_booking(payload.user_name, payload.user_phone, payload.user_id, payload.room_number, payload.check_in, payload.check_out, payload.action)

    except Exception as ex:
        logger.exception("Booking failed:name=%s phone=%s userId=%s room=%s check_in=%s check_out=%s action=%s",payload.user_name, payload.user_phone, payload.user_id, payload.room_number, payload.check_in, payload.check_out, payload.action)
        if isinstance(ex, HTTPException):
            raise
        raise HTTPException(status_code=500, detail="ไม่สามารถสร้างรายการจองได้ครับ") from ex
    qr_url = make_qr_url(booking)
    return {"booking": booking, "qr_url": qr_url}

async def cancel_booking(payload: CancelBookingRequest):
    result = await run_in_threadpool(api_repo.cancel_booking, payload.user_id, payload.booking_id)
    if result["status"] == "cancelled":
        try:
            pass
        except Exception:
            logger.exception("Booking cancelled but LINE notification failed")
            result["notification_status"] = "failed"
    return result

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

async def reservation_room_action(payload: ReservationRoomActionRequest):
    return await run_in_threadpool(api_repo.reservation_room_action, payload.booking_id, payload.action, payload.balance_paid_confirmed)

async def get_booking_slip(booking_id: str = Query(min_length=1)):
    return await run_in_threadpool(api_repo.get_booking_slip, booking_id)

async def update_user_status(payload: UpdateUserStatusRequest):
    return await run_in_threadpool(api_repo.update_user_status, payload.booking_id, payload.status, payload.description)

async def reply_approval(payload: UserReply):
    return await send_approval_message(payload.userId, payload.booking_id, payload.status, payload.description)

async def worker_reply(payload: dict = Body(...)) -> dict:
    try:
        userId = payload.get("userId")
        if not isinstance(userId, str) or not userId.strip():
            raise HTTPException(status_code=422, detail="กรุณาระบุ userId ครับ")

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
    return await run_in_threadpool(api_repo.insert_worker_data, payload.userId, payload.worker_name)

async def reply_maintenance(payload: ReplyMaintenancePayload):
    try:
        await reply_maintenance_rooms(payload)
        return {"status": "Success"}
    except Exception as ex:
        logger.exception("Unable to reply with maintenance rooms")
        raise HTTPException(status_code=500, detail="ไม่สามารถส่งรายการห้องรอทำความสะอาดได้ครับ") from ex

async def set_room_status_by_number(payload: RoomStatus):
    try:
        await run_in_threadpool(set_room_status, payload.room_number, payload.status)
        return {"status": "Success"}
    except Exception as ex:
        logger.exception("Unable to set room status")
        raise HTTPException(status_code=500, detail="ไม่สามารถเปลี่ยนสถานะห้องได้ครับ") from ex
