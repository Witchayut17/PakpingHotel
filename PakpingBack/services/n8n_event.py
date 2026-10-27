from fastapi import HTTPException

async def process_n8n_event(payload: dict) -> dict:
    from controllers.api_control import check_input
    try:
        message = payload.get("message") or {}
        if not isinstance(message, dict):
            raise HTTPException(status_code=422, detail="ข้อมูลข้อความต้องเป็นออบเจ็กต์แบบเจสันครับ")
        message_type = message.get("type") or payload.get("messageType") or payload.get("type")
        if message_type == "image":
            return {"status": "ignored", "reason": "ระบบ LIFF เป็นผู้จัดการรูปสลิปแล้ว"}
        return await check_input(payload)
    except HTTPException:
        raise
    except Exception as ex:
        raise HTTPException(status_code=500, detail="ไม่สามารถประมวลผลข้อความได้ครับ") from ex
