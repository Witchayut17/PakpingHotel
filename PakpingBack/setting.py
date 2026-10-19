import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
PROMPTPAY_ID = os.getenv("PROMPTPAY_ID")
line_channel_access_token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN") or os.getenv("line_channel_access_token")