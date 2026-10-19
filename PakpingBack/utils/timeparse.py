import re
from datetime import datetime, timezone, timedelta
from typing import Optional
TH = timezone(timedelta(hours=7))

def parse_ts(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    s = s.strip().replace("Z", "+00:00")
    s = re.sub(
        r"\.(\d+)",
        lambda m: "." + (m.group(1) + "000000")[:6],
        s,
        count=1,
    )
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

def fmt_paid(s: Optional[str]) -> str:
    dt = parse_ts(s)
    return dt.astimezone(TH).strftime("%Y-%m-%d-%H:%M") if dt else "-"