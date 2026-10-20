from pydantic import BaseModel, constr
from datetime import date
from typing import Literal

class ReplyAvailablePayload(BaseModel):
    replyToken: str
    date: str | None = None

class ReplyMaintenancePayload(BaseModel):
    replyToken: str

class BookingRequest(BaseModel):
    user_name: constr(strip_whitespace=True, min_length=1, max_length=200)
    user_phone: constr(strip_whitespace=True, pattern=r"^[0-9]{10}$")
    user_id: constr(strip_whitespace=True, min_length=1)
    room_number: str
    check_in: date
    check_out: date
    action: str

class SlipRequest(BaseModel):
    userId: constr(strip_whitespace=True, min_length=1)
    bookingId: constr(strip_whitespace=True, min_length=1)
    image: constr(min_length=1)

class CancelBookingRequest(BaseModel):
    user_id: constr(strip_whitespace=True, min_length=1)
    booking_id: constr(strip_whitespace=True, min_length=1) | None = None

class UpdateUserStatusRequest(BaseModel):
    booking_id: constr(strip_whitespace=True, min_length=1)
    status: Literal["ready", "decline"]
    description: constr(strip_whitespace=True, max_length=500) | None = None


class ReservationRoomActionRequest(BaseModel):
    booking_id: constr(strip_whitespace=True, min_length=1)
    action: Literal["checkin", "checkout"]
    balance_paid_confirmed: bool = False

class CustomerData(BaseModel):
    user_id: str
    customer_name: str
    phone_number: constr(pattern=r"^[0-9]{10}$")
    room_number: str

class UserReply(BaseModel):
    userId: str
    booking_id: constr(strip_whitespace=True, min_length=1)
    status: str
    description : str | None = None

class WorkerData(BaseModel):
    userId: str
    worker_name: str

class RoomStatus(BaseModel):
    room_number: str
    status: str