from supabase import create_client, Client
from setting import SUPABASE_URL, SUPABASE_KEY

_client: Client | None = None

def get_db() -> Client:
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client