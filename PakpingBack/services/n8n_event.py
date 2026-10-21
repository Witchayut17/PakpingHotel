from fastapi import HTTPException

async def process_n8n_event(payload: dict) -> dict:
    from controllers.api_control import check_input
    try:
        message = payload.get("message") or {}
        if not isinstance(message, dict):
            raise HTTPException(status_code=422, detail="message ต้องเป็นข้อมูล JSON object ครับ")
        message_type = message.get("type") or payload.get("messageType") or payload.get("type")
        if message_type == "image":
            return {"status": "ignored", "reason": "Slip uploads are handled by LIFF"}
        return await check_input(payload)
    except HTTPException:
        raise
    except Exception as ex:
        raise HTTPException(status_code=500, detail="ไม่สามารถประมวลผลข้อความได้ครับ") from ex
