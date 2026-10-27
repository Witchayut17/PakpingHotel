from pydantic import BaseModel, constr
from datetime import date
from typing import Literal

class ReplyAvailablePayload(BaseModel):
    replyToken: str
    date: str | None = None

class ReplyMaintenancePayload(BaseModel):
    replyToken: str
    userId: str | None = None

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

class RefundRequest(BaseModel):
    user_id: constr(strip_whitespace=True, min_length=1)
    booking_id: constr(strip_whitespace=True, min_length=1)
    refund_bank: constr(strip_whitespace=True, min_length=1, max_length=30)
    refund_account: constr(strip_whitespace=True, pattern=r"^[0-9]{10,15}$")


class CompleteRefundRequest(BaseModel):
    booking_id: constr(strip_whitespace=True, min_length=1)
    confirmed: Literal[True]


class UpdateUserStatusRequest(BaseModel):
    booking_id: constr(strip_whitespace=True, min_length=1)
    status: Literal["ready", "decline"]
    description: constr(strip_whitespace=True, max_length=500) | None = None


class ReservationRoomActionRequest(BaseModel):
    booking_id: constr(strip_whitespace=True, min_length=1)
    action: Literal["checkin", "checkout"]
    balance_paid_confirmed: bool = False

class UserReply(BaseModel):
    userId: str
    booking_id: constr(strip_whitespace=True, min_length=1)
    status: str
    description : str | None = None

class WorkerData(BaseModel):
    userId: str
    worker_name: str
    phone: str

class RoomStatus(BaseModel):
    room_number: str
    status: str
    userId: constr(strip_whitespace=True, min_length=1)


class DashboardLogin(BaseModel):
    worker_name: constr(strip_whitespace=True, min_length=1)
    password: str


class DashboardUserCreate(BaseModel):
    name: constr(strip_whitespace=True, min_length=1, max_length=200)
    phone: constr(strip_whitespace=True, pattern=r"^[0-9]{10}$")
    role: Literal["it_support", "ceo", "reception", "owner"]


class DashboardUserUpdate(DashboardUserCreate):
    pass


class DashboardPasswordChange(BaseModel):
    current_password: str
    new_password: constr(min_length=8, max_length=256)
