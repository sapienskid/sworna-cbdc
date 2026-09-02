"""Sworna CBDC banking backend (FastAPI)."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import SessionLocal, engine
from .models import Base
from .routers import admin, auth, payments, registry
from .seed import seed
from .token_client import token_client


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as session:
        seed(session)
    yield
    await token_client.aclose()


app = FastAPI(
    title="Sworna CBDC - Banking API",
    version="0.1.0",
    description="Banking registry + payment proxy over the Sworna token network.",
    lifespan=lifespan,
)

_cors_origins = [
    o.strip() for o in os.getenv("SWORNA_CORS_ORIGINS", "*").split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,  # comma-separated origins via SWORNA_CORS_ORIGINS
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(registry.router)
app.include_router(payments.router)
app.include_router(admin.router)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


# Serve production web UI if built
from .paths import REPO_ROOT
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

DIST_DIR = REPO_ROOT / "web" / "dist"
if (DIST_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")

if DIST_DIR.exists():
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            return {"detail": "Not Found"}
        target = DIST_DIR / full_path
        if target.is_file():
            return FileResponse(target)
        return FileResponse(DIST_DIR / "index.html")