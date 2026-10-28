from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from routes import api_route
import asyncio
import logging
from contextlib import asynccontextmanager
from repository.api_repo import booking_expiry_worker
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

logger = logging.getLogger(__name__)
CORS_ALLOWED_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "https://candyce-corkier-meaningfully.ngrok-free.dev",
    "https://thinks-disclaimers-turns-coverage.trycloudflare.com",
    # "https://unheralded-knottiest-hadlee.ngrok-free.dev" > เปาเทส cors ของ public dns
]

@asynccontextmanager
async def lifespan(app):
    stop = asyncio.Event()
    worker = asyncio.create_task(booking_expiry_worker(stop))
    try:
        yield
    finally:
        stop.set()
        await worker

app = FastAPI(lifespan=lifespan)
app.include_router(api_route.router)

@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": "ข้อมูลที่ส่งมาไม่ถูกต้อง กรุณาตรวจสอบและลองอีกครั้งครับ"},
    )

@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException):
    default_messages = {
        "Not Found": "ไม่พบหน้าหรือรายการที่ต้องการครับ",
        "Method Not Allowed": "วิธีส่งคำขอนี้ไม่รองรับครับ",
    }
    detail = default_messages.get(exc.detail, exc.detail) if isinstance(exc.detail, str) else exc.detail
    return JSONResponse(status_code=exc.status_code, content={"detail": detail}, headers=exc.headers)

@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    logger.exception("Unhandled request error: %s %s", request.method, request.url.path, exc_info=exc)
    origin = request.headers.get("origin")
    headers = {"Access-Control-Allow-Origin": origin, "Vary": "Origin"} if origin in CORS_ALLOWED_ORIGINS else None
    return JSONResponse(
        status_code=500,
        content={"detail": "ระบบขัดข้องชั่วคราว กรุณาลองอีกครั้งครับ"},
        headers=headers,
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

landing_directory = Path(__file__).resolve().parent.parent / "PakpingFront"
if landing_directory.is_dir():
    app.mount("/stay", StaticFiles(directory=landing_directory, html=True), name="stay")
