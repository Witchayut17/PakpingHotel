import httpx
import logging
import requests
from fastapi import HTTPException
from storge.db import get_db
from setting import line_channel_access_token, line_channel_access_token_housekeeper
import asyncio
from urllib.parse import urlencode
from datetime import datetime

db = get_db()
logger = logging.getLogger(__name__)

def create_room_card(Rooms, selected_date=None):
    room_number = Rooms["room_number"]

    card = {
        "type": "bubble",
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "md",
            "contents": [
                {
                    "type": "text",
                    "text": f"{Rooms['room_type']}",
                    "size": "sm",
                    "color": "#777777",
                },
                {
                    "type": "text",
                    "text": f"ห้อง {Rooms['room_name']} {Rooms['room_number']}",
                    "weight": "bold",
                    "size": "xl",
                },
                {
                    "type": "text",
                    "text": f"{Rooms['price_per_night']:,.0f} บาท / คืน",
                    "size": "lg",
                    "wrap": True,
                },
                {
                    "type": "text",
                    "text": f"{Rooms['description']}",
                    "color": "#228B22",
                    "size": "sm",
                },
            ],
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "button",
                    "style": "primary",
                    "color": "#426B50",
                    "action": {
                        "type": "uri",
                        "label": "ดูเพิ่มเติม",
                        "uri": f"https://liff.line.me/2012069184-52LHZkYs?{urlencode({'room': room_number})}",
                    },
                }
            ],
        },
    }
    if Rooms.get("imageUrl"):
        card["hero"] = {
            "type": "image",
            "url": Rooms["imageUrl"],
            "size": "full",
            "aspectRatio": "20:13",
            "aspectMode": "cover",
        }
    return card

def create_room_maintenance_card(Rooms):
    room_number = Rooms["room_number"]

    card = {
        "type": "bubble",
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "md",
            "contents": [
                {
                    "type": "text",
                    "text": f"{Rooms['room_type']}",
                    "size": "sm",
                    "color": "#777777",
                },
                {
                    "type": "text",
                    "text": f"ห้อง {Rooms['room_name']} {Rooms['room_number']}",
                    "weight": "bold",
                    "size": "xl",
                },
                {
                    "type": "text",
                    "text": f"{Rooms['price_per_night']:,.0f} บาท / คืน",
                    "size": "lg",
                    "wrap": True,
                },
                {
                    "type": "text",
                    "text": f"{Rooms['description']}",
                    "color": "#228B22",
                    "size": "sm",
                },
            ],
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "button",
                    "style": "primary",
                    "color": "#A3A522",
                    "action": {
                        "type": "postback",
                        "label": "เลือกห้อง",
                        "data": f"action=cleaned&room={room_number}",
                    },
                }
            ],
        },
    }
    if Rooms.get("imageUrl"):
        card["hero"] = {
            "type": "image",
            "url": Rooms["imageUrl"],
            "size": "full",
            "aspectRatio": "20:13",
            "aspectMode": "cover",
        }
    return card

async def reply_available_rooms(payload):
    selected_date = payload.date
    if selected_date:
        try:
            selected_date = datetime.strptime(str(selected_date), "%Y-%m-%d").date()
        except ValueError:
            selected_date = None

    result = db.table("Rooms").select("*").in_("status", ["Available", "Booked"]).execute()
    Rooms = result.data

    if selected_date:
        iso = selected_date.isoformat()
        booked = (db.table("Customers").select("room_number").lte("check_in", iso).gt("check_out", iso).execute())
        booked_rows = booked.data or []
        booked_numbers = {row["room_number"] for row in booked_rows}
        Rooms = [r for r in Rooms if r["room_number"] not in booked_numbers]
    
    Rooms.sort(key=lambda room: (room["room_number"][0].upper(), int(room["room_number"][1:])))

    if not Rooms:
        messages = [{
            "type": "text",
            "text": "ขออภัยครับ ขณะนี้ไม่มีห้องว่างในวันที่เลือ" if selected_date
                else "ขออภัยครับ ขณะนี้ไม่มีห้องว่างเปิดให้จอง",
        }]
    else:
        if len(Rooms) > 60:
            raise ValueError("มีห้องมากกว่า 60 ห้อง แสดงไม่พอ")
        messages = [{
            "type": "flex",
            "altText": f"ห้องว่าง {len(Rooms)} ห้อง" + (f"วันที่ {selected_date.strftime('%d/%m/%Y')}" if selected_date else ""),
            "contents": {
                "type": "carousel",
                "contents": [
                    create_room_card(room, selected_date) for room in Rooms[start:start + 12]
                ],
            },
        } for start in range(0, len(Rooms), 12)]

    response = await asyncio.to_thread(
        requests.post,
        "https://api.line.me/v2/bot/message/reply",
        headers={
            "Authorization": f"Bearer {line_channel_access_token}",
        },
        json={
            "replyToken": payload.replyToken,
            "messages": messages,
        },
        timeout=10,
    )
    response.raise_for_status()
    return {"success": True}

async def reply_maintenance_rooms(payload:str):
    result = db.table("Rooms").select("*").in_("status", ["Maintenance"]).execute()
    userId = payload.get("userId")
    Rooms = result.data
    Rooms.sort(key=lambda room: (room["room_number"][0].upper(), int(room["room_number"][1:])))
    if not Rooms:
        messages = [{
            "type": "text",
            "text": "ไม่มีห้องรอทำความสะอาด"
        }]
    else:
        if len(Rooms) > 60:
            raise ValueError("มีห้องมากกว่า 60 ห้อง แสดงไม่พอ")
        messages = [{
            "type": "flex",
            "altText": f"ห้องรอทำความสะอาด {len(Rooms)} ห้อง",
            "contents": {
                "type": "carousel",
                "contents": [
                    create_room_maintenance_card(room) for room in Rooms[start:start + 12]
                ],
            },
        } for start in range(0, len(Rooms), 12)]
    response = await asyncio.to_thread(
        requests.post,
        "https://api.line.me/v2/bot/message/push",
        headers={
            "Authorization": f"Bearer {line_channel_access_token_housekeeper}",
        },
        json={
            "to": userId,
            "messages": messages,
        },
        timeout=10,
    )
    response.raise_for_status()
    return {"success": True}

async def send_approval_message(userId: str, booking_id: str, status:str, description:str):
    print("userId = ", userId, "booking_id = ",booking_id, "status = ",status, "description = ", description)
    records = (db.table("Customers").select("room_number","check_in").eq("booking_id", booking_id).eq("line_user_id", userId).limit(1).execute().data or [])
    if not records:
        raise HTTPException(status_code=404, detail="ไม่เจอ booking")
    room_number = records[0]["room_number"]
    check_in = records[0]["check_in"]
    try:
        if status == "ready":
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    "https://api.line.me/v2/bot/message/push",
                    headers={"Authorization": f"Bearer {line_channel_access_token}"},
                    json={
                        "to": userId,
                        "messages": [{"type": "text", "text": f"แจ้งเตือน - การจองของคุณห้อง {room_number} ได้รับการยืนยันแล้ว สามารถเข้าเช็คอินในวันที่ {check_in} เวลา 12:00-14:00 ได้เลยครับ"}],
                    },
                )
                response.raise_for_status()
        elif status == "decline":
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    "https://api.line.me/v2/bot/message/push",
                    headers={"Authorization": f"Bearer {line_channel_access_token}"},
                    json={
                        "to": userId,
                        "messages": [{"type": "text", "text": f"แจ้งเตือน - การจองของคุณห้อง {room_number} ถูกปฏิเสธเพราะ '{description}' กรุณาส่งสลิปใหม่ในเว็บไซต์"}],
                    },
                )
                response.raise_for_status()
    except httpx.HTTPStatusError as error:
        raise HTTPException(status_code=502, detail="แจ้งเตือนไม่สำเร็จ") from error
    except httpx.RequestError as error:
        raise HTTPException(status_code=502, detail="แจ้งเตือนไม่สำเร็จ") from error
    return {"status": "sent", "booking_id": booking_id}

async def send_checkin_alert(userId:str, booking_id: str):
    records = (db.table("Customers").select("room_number","check_in").eq("booking_id", booking_id).eq("line_user_id", userId).limit(1).execute().data or [])
    rooms = records[0]["room_number"]
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            "https://api.line.me/v2/bot/message/push",
                headers={"Authorization": f"Bearer {line_channel_access_token}"},
                json={
                    "to": userId,
                    "messages": [{"type": "text", "text": f"แจ้งเตือน - วันนี้คุณมีรายการห้องเช็ตอินห้อง {rooms} กรุณาเข้าเช็คอินภายในเวลา 12:00 - 14:00 ครับ"}],
                },
            )
        response.raise_for_status()
    return {"status": "replied"}

async def send_worker_input(userId:str):
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            "https://api.line.me/v2/bot/message/push",
            headers={"Authorization": f"Bearer {line_channel_access_token_housekeeper}"},
            json={
                "to": userId,
                "messages": [{"type": "text", "text": "แจ้งเตือน - ไม่มีข้อมูลคุณในระบบกรุณากรอก\nชื่อ - นามสกุล\n(ตัวอย่าง นางย้อม ใจดี)"}],
            },
        )
        response.raise_for_status()
    return {"status": "replied"}

# async def reply(token: str, text: str):
#     async with httpx.AsyncClient() as c:
#         response = await c.post("https://api.line.me/v2/bot/message/reply",headers={"Authorization": f"Bearer {line_channel_access_token}"},json={"replyToken": token,"messages": [{"type": "text", "text": text}]})
#         response.raise_for_status()
#     return {"status": "replied"}
