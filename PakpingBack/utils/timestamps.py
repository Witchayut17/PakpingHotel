from datetime import datetime

def parse_db_timestamp(value: str) -> datetime:
    normalized = value.replace(" ", "T", 1)
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(normalized, fmt)
        except ValueError:
            pass
    raise ValueError("รูปแบบวันเวลาในฐานข้อมูลไม่ถูกต้องครับ")
