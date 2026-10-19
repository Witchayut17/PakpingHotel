from fastapi import FastAPI
from routes import api_route
import asyncio
from contextlib import asynccontextmanager
from repository.api_repo import booking_expiry_worker
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path


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
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "https://candyce-corkier-meaningfully.ngrok-free.dev",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

landing_directory = Path(__file__).resolve().parent.parent / "PakpingFront" / "src"
if landing_directory.is_dir():
    app.mount("/stay", StaticFiles(directory=landing_directory, html=True), name="stay")
