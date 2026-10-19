import base64
import binascii
from setting import PROMPTPAY_ID
import io
import math
import uuid
import qrcode
from postgrest.exceptions import APIError
from PIL import Image, UnidentifiedImageError
from promptpay import qrcode as pp
from storge.db import get_db
from datetime import datetime, timedelta, timezone, date, time
from fastapi import HTTPException
from utils.timestamps import parse_db_timestamp
from services.reply_flexroom import send_checkin_alert
import asyncio
import logging
from threading import RLock

booking_lock = RLock()
logger = logging.getLogger(__name__)
PENDING_BOOKING_DETAIL = {
    "code": "pending_booking_exists",
    "message": "คุณมีรายการที่ยังไม่เสร็จ กรุณาไปที่รายการของฉันเพื่อชำระเงินและแนบสลิปให้เสร็จก่อนจองใหม่",
}

ROOM_FIELDS = (
    "room_number", "room_name", "room_type", "price_per_night",
    "description", "imageUrl",
)

MAX_SLIP_BYTES = 5 * 1024 * 1024
SLIP_FORMATS = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"), "WEBP": ("webp", "image/webp")}

DECLINE_RETRY_MINUTES = 15

def payment_due(full_amount, payment_method):
    full_amount = float(full_amount)
    if not math.isfinite(full_amount) or full_amount <= 0:
        raise HTTPException(status_code=409, detail="Booking total is invalid")
    if payment_method == "partial_deposit":
        return round(full_amount * 0.30)
    if payment_method == "full_payment":
        return full_amount
    raise HTTPException(status_code=409, detail="Payment method is invalid")

db = get_db()

def cancel_booking(user_id: str, booking_id: str | None = None):
    with booking_lock:
        query = (db.table("Payments").delete()
                 .eq("line_user_id", user_id)
                 .in_("status", ["pending", "expired"])
                 .is_("paid_at", "null").is_("slip_path", "null"))
        if booking_id is not None:
            query = query.eq("_id", booking_id)
        deleted = query.execute().data
        if not deleted:
            return {"status": "not_found", "deleted_count": 0, "rooms": [], "qr_deleted_count": 0}

        rooms = sorted({row["room_number"] for row in deleted})
        cleanup_errors = []
        qr_deleted_count = 0
        for row in deleted:
            booking_id = row.get("id") if row.get("id") is not None else row.get("_id")
            if booking_id is None:
                cleanup_errors.append({"room_number": row["room_number"], "operation": "missing_booking_id"})
                continue
            prefix = f"{booking_id}-"
            try:
                db.table("Customers").delete().eq("booking_id", str(booking_id)).execute()

                bucket = db.storage.from_("Qrcode")
                paths = []
                offset = 0
                while True:
                    page = bucket.list(options={"search": prefix, "limit": 100, "offset": offset,"sortBy": {"column": "name", "order": "asc"}})
                    paths.extend(item["name"] for item in page
                                 if item.get("name", "").startswith(prefix) and item["name"].endswith(".png"))
                    if len(page) < 100:
                        break
                    offset += len(page)
                for start in range(0, len(paths), 100):
                    batch = paths[start:start + 100]
                    bucket.remove(batch)
                    qr_deleted_count += len(batch)
            except Exception:
                logger.exception("Unable to delete QR files for booking %s", booking_id)
                cleanup_errors.append({"booking_id": str(booking_id), "operation": "delete_qr", "prefix": prefix})

        result = {"status": "cancelled", "deleted_count": len(deleted),
                  "rooms": rooms, "qr_deleted_count": qr_deleted_count}
        if cleanup_errors:
            raise HTTPException(status_code=502, detail={**result, "status": "cleanup_failed", "errors": cleanup_errors})
        return result

def make_qr_url(booking: dict) -> str:
    try:
        amount = float(booking["payment_due"])
    except (KeyError, TypeError, ValueError) as ex:
        raise HTTPException(status_code=422, detail="Booking amount is invalid") from ex
    if not math.isfinite(amount) or amount <= 0:
        raise HTTPException(status_code=422, detail="Booking amount must be greater than zero")

    payload = pp.generate_payload(PROMPTPAY_ID, amount=amount)
    img = qrcode.make(payload)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    booking_id = booking.get("id") or booking.get("_id")
    path = f"{booking_id}-{uuid.uuid4().hex[:6]}.png"
    db.storage.from_("Qrcode").upload(path, buf.getvalue(), {"content-type": "image/png"})
    return db.storage.from_("Qrcode").get_public_url(path)

def create_booking(user_name:str, user_phone:str, user_id:str, room_number:str, check_in:date, check_out:date, action:str):
    with booking_lock:
        if action not in ("full_payment", "partial_deposit"):
            raise HTTPException(400, "Invalid payment action")
        existing = (db.table("Payments").select("_id")
                    .eq("line_user_id", user_id).eq("status", "pending")
                    .gt("expired_at", datetime.now(timezone.utc).isoformat())
                    .limit(1).execute().data)
        if existing:
            raise HTTPException(status_code=409, detail=PENDING_BOOKING_DETAIL)
        validate_stay(db, room_number, check_in, check_out)
        booking = _create_booking(user_id, room_number, check_in, check_out, action)
        try:
            db.table("Customers").insert({
                "customer_name": user_name.strip(),
                "phone_number": user_phone.strip(),
                "line_user_id": user_id,
                "room_number": room_number,
                "booking_id": str(booking.get("id") or booking["_id"]),
                "status": "pending",
            }).execute()
        except Exception as ex:
            logger.exception("Unable to save guest details for room %s", room_number)
            raise HTTPException(502, detail={
                "booking": booking,
                "message": "สร้างรายการจองแล้ว แต่บันทึกข้อมูลผู้เข้าพักไม่สำเร็จ กรุณาติดต่อที่พัก ไม่ต้องจองซ้ำ",
            }) from ex
        return booking

def _create_booking(user_id:str, room_number:str, check_in:date, check_out:date, action:str):
    try:
        if action == "full_payment":
            room = (db.table("Rooms").select("*").eq("room_number", room_number).maybe_single().execute().data)

            nights = (check_out - check_in).days

            if not room or nights < 1:
                raise HTTPException(status_code=400, detail="เลขห้องไม่ถูกต้อง หรือวันเช็คเอาต์ต้องอยู่หลังวันเช็คอิน")
            
            now = datetime.now(timezone.utc)

            rows = (db.table("Payments").select("status,expired_at,paid_at,slip_path").eq("room_number", room_number).in_("status", ["paid", "pending"]).lt("check_in", str(check_out)).gt("check_out", str(check_in)).execute().data)

            for r in rows:
                if r["status"] == "paid" or r.get("paid_at") is not None or bool(r.get("slip_path")) or parse_db_timestamp(r["expired_at"]) > now:
                    raise HTTPException(status_code=409, detail="ห้องไม่ว่างในช่วงวันที่เลือก")
                
            full_amount = nights * float(room["price_per_night"])
            booking = db.table("Payments").insert({
            "room_number": room_number,
            "line_user_id": user_id,
            "payment_method": "full_payment",
            "check_in": str(check_in),
            "check_out": str(check_out),
            "full_amount": full_amount,
            "amount": 0,
            "status": "pending",
            "expired_at": (now + timedelta(minutes=5)).isoformat(),}).execute().data[0]

            booking["payment_due"] = payment_due(full_amount, "full_payment")
            return booking
        
        elif action == "partial_deposit":
            room = (db.table("Rooms").select("*").eq("room_number", room_number).maybe_single().execute().data)

            nights = (check_out - check_in).days

            if not room or nights < 1:
                raise HTTPException(status_code=400, detail="เลขห้องไม่ถูกต้อง หรือวันเช็คเอาต์ต้องอยู่หลังวันเช็คอิน")
            
            now = datetime.now(timezone.utc)

            rows = (db.table("Payments").select("status,expired_at,paid_at,slip_path").eq("room_number", room_number).in_("status", ["paid", "pending"]).lt("check_in", str(check_out)).gt("check_out", str(check_in)).execute().data)

            for r in rows:
                if r["status"] == "paid" or r.get("paid_at") is not None or bool(r.get("slip_path")) or parse_db_timestamp(r["expired_at"]) > now:
                    raise HTTPException(status_code=409, detail="ห้องไม่ว่างในช่วงวันที่เลือก")
                
            full_amount = nights * float(room["price_per_night"])
            booking = db.table("Payments").insert({
            "room_number": room_number,
            "line_user_id": user_id,
            "payment_method": "partial_deposit",
            "check_in": str(check_in),
            "check_out": str(check_out),
            "full_amount": full_amount,
            "amount": 0,
            "status": "pending",
            "expired_at": (now + timedelta(minutes=5)).isoformat(),}).execute().data[0]

            booking["payment_due"] = payment_due(full_amount, "partial_deposit")
            return booking
        
    except HTTPException:
        raise
    except Exception as ex:
        if isinstance(ex, APIError):
            error_text = " ".join(str(getattr(ex, field, "") or "") for field in ("message", "details", "hint"))
            if "one_pending_per_user" in error_text.lower():
                raise HTTPException(status_code=409, detail=PENDING_BOOKING_DETAIL) from ex
        raise HTTPException(status_code=500, detail=str(ex)) from ex

def booked_ranges(db, room_number: str):
    today = datetime.now(timezone(timedelta(hours=7))).date().isoformat()
    now = datetime.now(timezone.utc)
    ranges = set()
    for table, fields in (
        ("Customers", "check_in,check_out"),
        ("Payments", "check_in,check_out,status,expired_at,paid_at,slip_path"),
    ):
        offset = 0
        while True:
            query = (db.table(table).select(fields).eq("room_number", room_number)
                     .gt("check_out", today).order("check_in").order("check_out"))
            if table == "Payments":
                query = query.in_("status", ["paid", "pending"])
            else:
                query = query.not_.in_("status", ["cancel", "missing"])
            rows = query.range(offset, offset + 499).execute().data or []
            for row in rows:
                if table == "Payments" and not (
                    row["status"] == "paid" or row.get("paid_at") or row.get("slip_path")
                    or parse_db_timestamp(row["expired_at"]) > now
                ):
                    continue
                if not row.get("check_in") or not row.get("check_out"):
                    continue
                start = date.fromisoformat(str(row["check_in"])[:10]).isoformat()
                end = date.fromisoformat(str(row["check_out"])[:10]).isoformat()
                if start < end:
                    ranges.add((start, end))
            if len(rows) < 500:
                break
            offset += len(rows)
    return [{"check_in": start, "check_out": end} for start, end in sorted(ranges)]

def validate_stay(db, room_number, check_in, check_out):
    today = datetime.now(timezone(timedelta(hours=7))).date()
    if check_in < today or check_out <= check_in:
        raise HTTPException(400, "กรุณาเลือกวันเข้าพักตั้งแต่วันนี้ และวันออกหลังวันเข้าพัก")
    for stay in booked_ranges(db, room_number):
        if check_in.isoformat() < stay["check_out"] and check_out.isoformat() > stay["check_in"]:
            raise HTTPException(409, "ห้องไม่ว่างในช่วงวันที่เลือก กรุณาเลือกวันใหม่")

def sync_booking_statuses():
    with booking_lock:
        db = get_db()
        now = datetime.now(timezone(timedelta(hours=7)))
        (db.table("Payments").update({"status": "expired"}).eq("status", "pending").is_("slip_path", "null").lte("expired_at", now.isoformat()).execute())
        declined = []
        offset = 0
        while True:
            page = (db.table("Customers").select("booking_id").eq("status", "decline")
                    .range(offset, offset + 499).execute().data or [])
            declined.extend(page)
            if len(page) < 500:
                break
            offset += len(page)

        for customer in declined:
            booking_id = str(customer["booking_id"])
            try:
                payments = (db.table("Payments").select("_id,status,expired_at")
                            .eq("_id", booking_id).limit(1).execute().data or [])
                if not payments:
                    logger.warning("Declined booking %s has no payment row", booking_id)
                    continue
                payment = payments[0]
                if payment["status"] == "cancel":
                    (db.table("Customers").update({"status": "cancel"})
                     .eq("booking_id", booking_id).eq("status", "decline").execute())
                    continue
                if payment["status"] != "paid":
                    continue
                deadline = parse_db_timestamp(payment["expired_at"])
                if deadline > now:
                    continue
                cancelled = (db.table("Payments").update({"status": "cancel"})
                             .eq("_id", booking_id).eq("status", "paid")
                             .lte("expired_at", now.isoformat()).execute().data or [])
                if cancelled:
                    (db.table("Customers").update({"status": "cancel"})
                     .eq("booking_id", booking_id).eq("status", "decline").execute())
            except Exception:
                logger.exception("Unable to cancel expired declined booking %s", booking_id)

        overdue_ready = []
        offset = 0
        while True:
            page = (db.table("Customers").select("booking_id,room_number")
                    .eq("status", "ready").is_("arrive_at", "null")
                    .lt("check_in", now.date().isoformat())
                    .range(offset, offset + 499).execute().data or [])
            overdue_ready.extend(page)
            if len(page) < 500:
                break
            offset += len(page)

        for customer in overdue_ready:
            booking_id = str(customer["booking_id"])
            try:
                rooms = (db.table("Rooms").select("status")
                         .eq("room_number", customer["room_number"]).limit(1).execute().data or [])
                if rooms and rooms[0]["status"] == "Busy":
                    continue
                payments = (db.table("Payments").select("status")
                            .eq("_id", booking_id).limit(1).execute().data or [])
                if not payments:
                    logger.warning("Overdue ready booking %s has no payment row", booking_id)
                    continue
                payment_status = payments[0]["status"]
                if payment_status == "paid":
                    cancelled = (db.table("Payments").update({"status": "cancel"})
                                 .eq("_id", booking_id).eq("status", "paid").execute().data or [])
                    if not cancelled:
                        continue
                elif payment_status != "cancel":
                    logger.warning("Overdue ready booking %s has payment status %s", booking_id, payment_status)
                    continue
                (db.table("Customers").update({"status": "missing"})
                 .eq("booking_id", booking_id).eq("status", "ready").execute())
            except Exception:
                logger.exception("Unable to mark overdue booking %s as missing", booking_id)

async def send_checkin_alerts():
    now = datetime.now(timezone(timedelta(hours=7)))
    if not time(11, 30) <= now.time() < time(11, 31):
        return

    def pending_alerts():
        return (
            db.table("Customers")
            .select("line_user_id,booking_id")
            .eq("check_in", now.date().isoformat())
            .eq("alert_sent", False)
            .eq("status", "ready")
            .is_("arrive_at", "null")
            .execute().data or []
        )

    rows = await asyncio.to_thread(pending_alerts)
    for r in rows:
        if not time(11, 30) <= datetime.now(timezone(timedelta(hours=7))).time() < time(11, 31):
            break
        try:
            await send_checkin_alert(r["line_user_id"], r["booking_id"])
            await asyncio.to_thread(
                lambda: db.table("Customers").update({"alert_sent": True})
                .eq("booking_id", r["booking_id"]).eq("alert_sent", False).execute()
            )
        except Exception:
            logger.exception("Unable to send check-in alert for booking %s", r["booking_id"])

def list_rooms():
    try:
        records = (
            db.table("Rooms").select(",".join(ROOM_FIELDS))
            .in_("status", ["Available", "Booked"]).execute().data
        )
    except Exception as ex:
        logger.exception("Unable to load public room catalogue")
        raise HTTPException(status_code=503, detail="Rooms are temporarily unavailable.") from ex

    rooms = [{field: row.get(field) for field in ROOM_FIELDS} for row in records]
    rooms.sort(key=lambda room: str(room["room_number"]))
    return {"rooms": rooms}

def list_room_statuses() -> dict:
    try:
        client = get_db()
        rooms = []
        offset = 0
        while True:
            page = (client.table("Rooms")
                    .select("room_number,room_name,status")
                    .order("room_number")
                    .range(offset, offset + 499).execute().data or [])
            rooms.extend(page)
            if len(page) < 500:
                break
            offset += len(page)

        busy_numbers = [str(room["room_number"]) for room in rooms if room["status"] == "Busy"]
        occupants = {}
        for start in range(0, len(busy_numbers), 100):
            offset = 0
            while True:
                page = (client.table("Customers")
                        .select("room_number,customer_name,phone_number,check_in,check_out,arrive_at,out_at,status")
                        .in_("room_number", busy_numbers[start:start + 100])
                        .in_("status", ["inhouse", "ready"])
                        .is_("out_at", "null")
                        .range(offset, offset + 499).execute().data or [])
                for customer in page:
                    if not customer.get("arrive_at"):
                        continue
                    room_number = str(customer["room_number"])
                    if room_number not in occupants or customer["arrive_at"] > occupants[room_number]["arrive_at"]:
                        occupants[room_number] = customer
                if len(page) < 500:
                    break
                offset += len(page)
    except Exception as ex:
        logger.exception("Unable to load room statuses")
        raise HTTPException(status_code=503, detail="Room statuses are temporarily unavailable") from ex
    for room in rooms:
        customer = occupants.get(str(room["room_number"])) if room["status"] == "Busy" else None
        room["occupant"] = ({
            "customer_name": customer.get("customer_name"),
            "phone": customer.get("phone_number"),
            "check_in": customer.get("check_in"),
            "check_out": customer.get("check_out"),
            "arrive_at": customer.get("arrive_at"),
        } if customer else None)
    return {"rooms": rooms}

def list_user_payments(user_id: str) -> dict:
    try:
        rows = []
        offset = 0
        while True:
            page = (db.table("Payments")
                    .select("_id,room_number,check_in,check_out,amount,full_amount,payment_method,status,expired_at,paid_at,slip_path")
                    .eq("line_user_id", user_id)
                    .in_("status", ["pending", "paid", "expired", "cancel"])
                    .order("expired_at", desc=True)
                    .range(offset, offset + 499).execute().data or [])
            rows.extend(page)
            if len(page) < 500:
                break
            offset += len(page)
    except Exception as ex:
        logger.exception("Unable to load payments for user")
        raise HTTPException(status_code=503, detail="Payments are temporarily unavailable") from ex

    if not rows:
        return {"payments": []}

    review_statuses = {}
    if any(row["status"] in ("paid", "cancel") or row.get("paid_at") or row.get("slip_path") for row in rows):
        try:
            offset = 0
            while True:
                page = (db.table("Customers")
                        .select("booking_id,status,description,arrive_at,out_at")
                        .eq("line_user_id", user_id)
                        .in_("status", ["ready", "inhouse", "decline", "success", "cancel", "missing"])
                        .range(offset, offset + 499).execute().data or [])
                review_statuses.update({str(item["booking_id"]): item for item in page})
                if len(page) < 500:
                    break
                offset += len(page)
        except Exception as ex:
            logger.exception("Unable to load booking review statuses for user")
            raise HTTPException(status_code=503, detail="Payments are temporarily unavailable") from ex

    now = datetime.now(timezone.utc)
    payments = []
    for row in rows:
        booking_id = row["_id"]
        review = review_statuses.get(str(booking_id), {})
        if review.get("status") == "missing":
            payment_status = "missing"
        elif review.get("status") == "ready" and review.get("arrive_at") and not review.get("out_at"):
            payment_status = "inhouse"
        elif row["status"] == "cancel":
            payment_status = "cancel"
        elif row["status"] == "paid" or row.get("paid_at") or row.get("slip_path"):
            payment_status = review.get("status", "paid")
        elif row["status"] == "expired" or parse_db_timestamp(row["expired_at"]) <= now:
            payment_status = "expired"
        else:
            payment_status = "pending"

        qr_url = None
        if payment_status in ("pending", "decline"):
            prefix = f"{booking_id}-"
            try:
                bucket = db.storage.from_("Qrcode")
                files = bucket.list(options={"search": prefix, "limit": 100})
                path = next((item["name"] for item in files
                             if item.get("name", "").startswith(prefix)
                             and item["name"].endswith(".png")), None)
                if path:
                    qr_url = bucket.get_public_url(path)
            except Exception:
                logger.exception("Unable to load QR for booking %s", booking_id)

        payments.append({
            "id": booking_id,
            "room_number": row["room_number"],
            "check_in": row["check_in"],
            "check_out": row["check_out"],
            "amount": row["amount"],
            "full_amount": row.get("full_amount"),
            "payment_due": payment_due(row["full_amount"], row["payment_method"]),
            "payment_method": row["payment_method"],
            "expired_at": row["expired_at"],
            "payment_status": payment_status,
            "description": review.get("description") if payment_status in ("decline", "cancel") else None,
            "qr_url": qr_url,
        })
    return {"payments": payments}

def list_user_paid():
    try:
        records = (db.table("Customers").select("booking_id,customer_name,room_number,check_in,check_out,status,description,line_user_id").in_("status", ["paid", "ready", "inhouse", "decline", "cancel", "missing"]).execute().data or [])
    except Exception as ex:
        logger.exception("Unable to load paid bookings for review")
        raise HTTPException(status_code=503, detail="Paid bookings are temporarily unavailable") from ex
    return {"records": records}

def list_reservations() -> dict:
    try:
        client = get_db()
        payments = []
        offset = 0
        while True:
            page = (client.table("Payments")
                    .select("_id,room_number,check_in,check_out,amount,full_amount,payment_method,status,expired_at,paid_at,initial_paid_at,slip_path")
                    .order("check_in", desc=True)
                    .range(offset, offset + 499).execute().data or [])
            payments.extend(page)
            if len(page) < 500:
                break
            offset += len(page)

        if not payments:
            return {"records": []}

        customers = {}
        booking_ids = [str(payment["_id"]) for payment in payments]
        for start in range(0, len(booking_ids), 100):
            rows = (client.table("Customers")
                    .select("booking_id,customer_name,line_user_id,status,description,arrive_at,out_at")
                    .in_("booking_id", booking_ids[start:start + 100]).execute().data or [])
            customers.update({str(row["booking_id"]): row for row in rows})

        rooms = {}
        offset = 0
        while True:
            page = (client.table("Rooms").select("room_number,status")
                    .range(offset, offset + 499).execute().data or [])
            rooms.update({str(room["room_number"]): room["status"] for room in page})
            if len(page) < 500:
                break
            offset += len(page)
    except Exception as ex:
        logger.exception("Unable to load reservations")
        raise HTTPException(status_code=503, detail="Reservations are temporarily unavailable") from ex

    now = datetime.now(timezone.utc)
    records = []
    for payment in payments:
        booking_id = str(payment["_id"])
        customer = customers.get(booking_id, {})
        payment_status = payment["status"]
        customer_status = customer.get("status")
        if customer_status == "missing":
            status = "missing"
        elif customer_status == "ready" and customer.get("arrive_at") and not customer.get("out_at"):
            status = "inhouse"
        elif payment_status == "cancel":
            status = "cancel"
        elif payment_status == "paid":
            status = customer_status or "paid"
        elif payment_status == "expired" or (
            payment_status == "pending" and parse_db_timestamp(payment["expired_at"]) <= now
        ):
            status = "expired"
        else:
            status = payment_status
        records.append({
            "booking_id": booking_id,
            "customer_name": customer.get("customer_name") or "—",
            "line_user_id": customer.get("line_user_id"),
            "room_number": payment["room_number"],
            "room_status": rooms.get(str(payment["room_number"])),
            "check_in": payment["check_in"],
            "check_out": payment["check_out"],
            "amount": payment["amount"],
            "full_amount": payment.get("full_amount"),
            "payment_method": payment.get("payment_method"),
            "status": status,
            "description": customer.get("description"),
            "arrive_at": customer.get("arrive_at"),
            "out_at": customer.get("out_at"),
            "initial_paid_at": payment.get("initial_paid_at"),
            "has_slip": bool(payment.get("slip_path")),
        })
    return {"records": records}

def reservation_room_action(booking_id: str, action: str, balance_paid_confirmed: bool = False) -> dict:
    if action not in ("checkin", "checkout"):
        raise HTTPException(status_code=422, detail="Invalid room action")
    with booking_lock:
        client = get_db()
        try:
            customers = (client.table("Customers")
                         .select("booking_id,room_number,check_in,check_out,status,arrive_at,out_at")
                         .eq("booking_id", booking_id).limit(1).execute().data or [])
            if not customers:
                raise HTTPException(status_code=404, detail="Reservation not found")
            customer = customers[0]
            if customer["status"] not in ("ready", "inhouse", "success"):
                raise HTTPException(status_code=409, detail="Reservation is not approved")

            payments = (client.table("Payments").select("status,payment_method,amount,full_amount")
                        .eq("_id", booking_id).limit(1).execute().data or [])
            if not payments or payments[0]["status"] != "paid":
                raise HTTPException(status_code=409, detail="Payment is not active")

            room_number = customer["room_number"]
            rooms = (client.table("Rooms").select("status")
                     .eq("room_number", room_number).limit(1).execute().data or [])
            if not rooms:
                raise HTTPException(status_code=404, detail="Room not found")
            room_status = rooms[0]["status"]
            today = datetime.now(timezone(timedelta(hours=7))).date()
            check_in = date.fromisoformat(str(customer["check_in"])[:10])
            check_out = date.fromisoformat(str(customer["check_out"])[:10])

            if action == "checkin":
                if customer["status"] != "ready" or customer.get("arrive_at") or not check_in <= today < check_out:
                    raise HTTPException(status_code=409, detail="Reservation cannot be checked in today")
                payment = payments[0]
                full_amount = payment.get("full_amount")
                if full_amount is None or float(full_amount) <= 0:
                    raise HTTPException(status_code=409, detail="Booking total is missing")
                method = payment.get("payment_method")
                if method not in ("full_payment", "partial_deposit"):
                    raise HTTPException(status_code=409, detail="Payment method is invalid")
                if float(payment["amount"]) < float(payment_due(full_amount, method)):
                    raise HTTPException(status_code=409, detail="Initial payment has not been confirmed")
                if method == "partial_deposit" and not balance_paid_confirmed:
                    raise HTTPException(status_code=409, detail="Confirm remaining balance payment before check-in")
                if room_status not in ("Available", "Booked", "Maintenance"):
                    raise HTTPException(status_code=409, detail="Room is already busy")
                updated = (client.table("Rooms").update({"status": "Busy"})
                           .eq("room_number", room_number).eq("status", room_status).execute().data or [])
                if not updated:
                    raise HTTPException(status_code=409, detail="Room status changed; refresh and try again")
                arrive_at = datetime.now(timezone.utc).isoformat()
                payment_changed = False
                try:
                    if method == "partial_deposit" and float(payment["amount"]) < float(full_amount):
                        updated_payment = (client.table("Payments").update({"amount": full_amount})
                                           .eq("_id", booking_id).eq("status", "paid")
                                           .eq("amount", payment["amount"])
                                           .eq("full_amount", full_amount).execute().data or [])
                        if not updated_payment:
                            raise HTTPException(status_code=409, detail="Payment changed; refresh and try again")
                        payment_changed = True
                    checked_in = (client.table("Customers").update({"status": "inhouse", "arrive_at": arrive_at})
                                  .eq("booking_id", booking_id).eq("status", "ready")
                                  .is_("arrive_at", "null").execute().data or [])
                    if not checked_in:
                        raise HTTPException(status_code=409, detail="Reservation status changed; refresh and try again")
                except Exception:
                    if payment_changed:
                        try:
                            (client.table("Payments").update({"amount": payment["amount"]})
                             .eq("_id", booking_id).eq("status", "paid")
                             .eq("amount", full_amount).execute())
                        except Exception:
                            logger.exception("Unable to restore payment amount for booking %s", booking_id)
                    try:
                        (client.table("Rooms").update({"status": room_status})
                         .eq("room_number", room_number).eq("status", "Busy").execute())
                    except Exception:
                        logger.exception("Unable to restore room %s after failed check-in", room_number)
                    raise
                return {"booking_id": booking_id, "room_number": room_number, "room_status": "Busy",
                        "status": "inhouse", "arrive_at": arrive_at,
                        "amount": full_amount if method == "partial_deposit" else payment["amount"]}

            if customer["status"] == "success":
                if room_status == "Maintenance":
                    return {"booking_id": booking_id, "room_number": room_number,
                            "room_status": "Maintenance", "out_at": customer.get("out_at")}
                raise HTTPException(status_code=409, detail="Reservation is already checked out")
            if room_status != "Busy" or today < check_in or not customer.get("arrive_at") or customer.get("out_at"):
                raise HTTPException(status_code=409, detail="Room is not checked in")
            updated = (client.table("Rooms").update({"status": "Maintenance"})
                       .eq("room_number", room_number).eq("status", "Busy").execute().data or [])
            if not updated:
                raise HTTPException(status_code=409, detail="Room status changed; refresh and try again")
            try:
                out_at = datetime.now(timezone.utc).isoformat()
                completed = (client.table("Customers").update({"status": "success", "out_at": out_at})
                             .eq("booking_id", booking_id).eq("status", customer["status"])
                             .is_("out_at", "null").execute().data or [])
                if not completed:
                    raise HTTPException(status_code=409, detail="Reservation status changed; refresh and try again")
            except Exception:
                try:
                    (client.table("Rooms").update({"status": "Busy"})
                     .eq("room_number", room_number).eq("status", "Maintenance").execute())
                except Exception:
                    logger.exception("Unable to restore room %s after failed checkout", room_number)
                raise
            return {"booking_id": booking_id, "room_number": room_number, "room_status": "Maintenance", "out_at": out_at}
        except HTTPException:
            raise
        except Exception as ex:
            logger.exception("Unable to perform %s for booking %s", action, booking_id)
            raise HTTPException(status_code=503, detail="Unable to update room status") from ex

def get_booking_slip(booking_id: str) -> dict:
    try:
        records = (db.table("Payments").select("slip_path").eq("_id", booking_id).in_("status", ["paid", "cancel"]).limit(1).execute().data or [])
        if not records or not records[0].get("slip_path"):
            raise HTTPException(status_code=404, detail="Slip not found")
        signed = db.storage.from_("Slips").create_signed_url(records[0]["slip_path"], 60)
        return {"booking_id": booking_id, "slip_url": signed["signedURL"]}
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Unable to load slip for booking %s", booking_id)
        raise HTTPException(status_code=503, detail="Slip is temporarily unavailable") from ex

def update_user_status(booking_id: str, status: str, description: str | None = None) -> dict:
    if status == "decline" and not (description or "").strip():
        raise HTTPException(status_code=422, detail="กรุณาระบุเหตุผลที่ปฏิเสธสลิป")
    reason = description.strip() if status == "decline" else None
    deadline = None
    try:
        with booking_lock:
            awaiting = (db.table("Customers").select("booking_id").eq("booking_id", booking_id)
                        .eq("status", "paid").limit(1).execute().data or [])
            if not awaiting:
                raise HTTPException(status_code=409, detail="Booking is not awaiting review")
            if status == "decline":
                deadline = datetime.now(timezone.utc) + timedelta(minutes=DECLINE_RETRY_MINUTES)
                payment = (db.table("Payments").update({"expired_at": deadline.isoformat()})
                           .eq("_id", booking_id).eq("status", "paid").execute().data or [])
                if not payment:
                    raise HTTPException(status_code=409, detail="Payment is not awaiting review")
            previous_amount = None
            previous_initial_paid_at = None
            approved_amount = None
            if status == "ready":
                payment_rows = (db.table("Payments")
                                .select("amount,full_amount,payment_method,initial_paid_at")
                                .eq("_id", booking_id).eq("status", "paid").limit(1).execute().data or [])
                if not payment_rows:
                    raise HTTPException(status_code=409, detail="Payment is not awaiting review")
                previous_amount = payment_rows[0]["amount"]
                previous_initial_paid_at = payment_rows[0].get("initial_paid_at")
                approved_amount = payment_due(payment_rows[0]["full_amount"], payment_rows[0]["payment_method"])
                updated_payment = (db.table("Payments").update({
                    "amount": approved_amount,
                    "initial_paid_at": datetime.now(timezone.utc).isoformat(),
                })
                                   .eq("_id", booking_id).eq("status", "paid")
                                   .eq("amount", previous_amount).execute().data or [])
                if not updated_payment:
                    raise HTTPException(status_code=409, detail="Payment changed; refresh and try again")
            records = []
            try:
                records = (db.table("Customers").update({"status": status, "description": reason})
                           .eq("booking_id", booking_id).eq("status", "paid").execute().data or [])
            finally:
                if approved_amount is not None and not records:
                    try:
                        (db.table("Payments").update({
                            "amount": previous_amount,
                            "initial_paid_at": previous_initial_paid_at,
                        })
                         .eq("_id", booking_id).eq("status", "paid")
                         .eq("amount", approved_amount).execute())
                    except Exception:
                        logger.exception("Unable to restore payment amount for booking %s", booking_id)
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Unable to update customer status for booking %s", booking_id)
        raise HTTPException(status_code=503, detail="Unable to update customer status") from ex
    if not records:
        raise HTTPException(status_code=409, detail="Booking is not awaiting review")
    return {"booking_id": booking_id, "status": status, "description": reason,
            "expired_at": deadline.isoformat() if deadline else None}

def save_slip(user_id: str, booking_id: str, image_data: str) -> dict:
    try:
        encoded = image_data.split(",", 1)[1] if image_data.startswith("data:image/") else image_data
        if len(encoded) > ((MAX_SLIP_BYTES + 2) // 3) * 4:
            raise HTTPException(422, "Slip image must be 5 MB or less")
        image_bytes = base64.b64decode(encoded, validate=True)
    except (IndexError, binascii.Error, ValueError) as ex:
        raise HTTPException(422, "Invalid slip image") from ex
    if not image_bytes or len(image_bytes) > MAX_SLIP_BYTES:
        raise HTTPException(422, "Slip image must be 5 MB or less")
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image.verify()
            image_format = image.format
    except (UnidentifiedImageError, OSError, ValueError) as ex:
        raise HTTPException(422, "Invalid slip image") from ex
    if image_format not in SLIP_FORMATS:
        raise HTTPException(422, "Slip image must be JPEG, PNG, or WebP")

    with booking_lock:
        queried = False
        for id_column in ("id", "_id"):
            try:
                rows = (db.table("Payments").select("*")
                        .eq(id_column, booking_id).eq("line_user_id", user_id)
                        .limit(1).execute().data)
                queried = True
            except Exception:
                if id_column == "id" or queried:
                    continue
                raise
            if rows:
                break
        else:
            raise HTTPException(404, "Booking not found")

        booking = rows[0]
        customer = (db.table("Customers").select("status").eq("booking_id", str(booking_id))
                    .eq("line_user_id", user_id).limit(1).execute().data or [])
        is_retry = bool(customer and customer[0]["status"] == "decline"
                        and booking.get("status") == "paid" and booking.get("slip_path"))
        now = datetime.now(timezone.utc)
        if is_retry and parse_db_timestamp(booking["expired_at"]) <= now:
            raise HTTPException(409, "หมดเวลาส่งสลิปใหม่แล้ว")
        if not is_retry and (booking.get("slip_path") or booking.get("status") == "paid"):
            raise HTTPException(409, "Slip already submitted")
        if not is_retry and (booking.get("status") != "pending" or parse_db_timestamp(booking["expired_at"]) <= now):
            raise HTTPException(409, "Booking has expired")

        extension, content_type = SLIP_FORMATS[image_format]
        slip_path = booking["slip_path"] if is_retry else f"{booking_id}-{uuid.uuid4().hex}.{extension}"
        slips = db.storage.from_("Slips")
        if is_retry:
            slips.update(slip_path, image_bytes, {"content-type": content_type, "cache-control": "0"})
        else:
            slips.upload(slip_path, image_bytes, {"content-type": content_type})
        try:
            slip_url = slips.create_signed_url(slip_path, 7 * 24 * 60 * 60)["signedURL"]
        except Exception:
            if not is_retry:
                try:
                    slips.remove([slip_path])
                except Exception:
                    logger.exception("Unable to remove unused slip %s", slip_path)
            raise
        uploaded_at = datetime.now(timezone.utc)
        changes = {"slip_path": slip_path, "slip_url": slip_url,
                   "paid_at": uploaded_at.isoformat(), "status": "paid"}
        if is_retry:
            changes["expired_at"] = (uploaded_at + timedelta(minutes=5)).isoformat()
        payment_update = (db.table("Payments").update(changes)
                          .eq(id_column, booking_id).eq("line_user_id", user_id))
        if is_retry:
            payment_update = (payment_update.eq("status", "paid").eq("slip_path", slip_path)
                              .gt("expired_at", uploaded_at.isoformat()))
        else:
            payment_update = (payment_update.eq("status", "pending").is_("slip_path", "null")
                              .gt("expired_at", uploaded_at.isoformat()))
        updated = payment_update.execute().data
        if not updated:
            if not is_retry:
                try:
                    slips.remove([slip_path])
                except Exception:
                    logger.exception("Unable to remove unused slip %s", slip_path)
            raise HTTPException(409, "Booking has changed or expired")

        try:
            (db.table("Customers")
             .update({"check_in": booking["check_in"], "check_out": booking["check_out"], "status": "paid", "description": None})
             .eq("booking_id", str(booking_id)).eq("line_user_id", user_id).execute())
        except Exception:
            logger.exception("Slip saved, but related booking data could not be synchronized for %s", booking_id)
        return {"status": "pending_review", "booking_id": str(booking_id)}

async def booking_expiry_worker(stop):
    while not stop.is_set():
        try:
            await asyncio.to_thread(sync_booking_statuses)
            print("log sync_booking_statuses")
        except Exception:
            logger.exception("Unable to synchronize booking expiry")
        try:
            await send_checkin_alerts()
            print("send_checkin_alerts")
        except Exception:
            logger.exception("Unable to check for check-in alerts")
        try:
            await asyncio.wait_for(stop.wait(), timeout=30)
        except asyncio.TimeoutError:
            pass
