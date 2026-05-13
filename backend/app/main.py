import os
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from .models import Device, Schedule
from .schemas import ScheduleCreate, ScheduleOut, ScheduleUpdate

load_dotenv()
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Timebomb API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

STARTER_PLAN = [
    {"id": "wash-세안-starter", "categoryId": "wash", "label": "세안", "minutes": 3},
    {"id": "wash-양치-starter", "categoryId": "wash", "label": "양치", "minutes": 3},
    {"id": "ready-옷 고르기-starter", "categoryId": "ready", "label": "옷 고르기", "minutes": 7},
    {"id": "inside-엘리베이터-starter", "categoryId": "inside", "label": "엘리베이터", "minutes": 4},
    {"id": "bus-버스 평균 대기시간-starter", "categoryId": "bus", "label": "버스 평균 대기시간", "minutes": 8},
]

ODSAY_ROUTE_URL = "https://api.odsay.com/v1/api/searchPubTransPathT"


class TransitEstimateRequest(BaseModel):
    start_lng: float = Field(..., description="출발지 경도")
    start_lat: float = Field(..., description="출발지 위도")
    end_lng: float = Field(..., description="도착지 경도")
    end_lat: float = Field(..., description="도착지 위도")
    search_path_type: int = Field(default=0, ge=0, le=2)


class TransitRouteOut(BaseModel):
    title: str
    total_minutes: int
    payment: int | None = None
    total_walk_meters: int | None = None
    blocks: list[dict]


class TransitEstimateOut(BaseModel):
    routes: list[TransitRouteOut]


@app.get("/health")
def health():
    return {"status": "ok"}


def minutes(value) -> int:
    try:
        return max(0, round(float(value)))
    except (TypeError, ValueError):
        return 0


def lane_label(segment: dict) -> str:
    lanes = segment.get("lane") or []
    if not lanes:
        return ""
    lane = lanes[0]
    return (
        lane.get("name")
        or lane.get("busNo")
        or lane.get("subwayCode")
        or lane.get("busID")
        or ""
    )


def segment_label(segment: dict, fallback: str) -> str:
    start = segment.get("startName")
    end = segment.get("endName")
    route = lane_label(segment)
    pieces = [piece for piece in [route, start and end and f"{start} -> {end}"] if piece]
    return " · ".join(map(str, pieces)) or fallback


def segment_to_block(segment: dict, index: int) -> dict | None:
    section_minutes = minutes(segment.get("sectionTime"))
    if section_minutes <= 0:
        return None

    traffic_type = segment.get("trafficType")
    if traffic_type == 1:
        category_id = "subway"
        fallback = "지하철 탑승 시간"
    elif traffic_type == 2:
        category_id = "bus"
        fallback = "버스 탑승 시간"
    else:
        category_id = "inside"
        fallback = "도보 이동" if index == 0 else "환승 이동"

    return {
        "id": f"transit-{uuid4().hex[:8]}",
        "categoryId": category_id,
        "label": segment_label(segment, fallback),
        "minutes": section_minutes,
        "source": "odsay",
    }


def path_to_route(path: dict, route_index: int) -> TransitRouteOut:
    info = path.get("info", {})
    subpaths = path.get("subPath") or []
    blocks = [
        block
        for index, segment in enumerate(subpaths)
        if (block := segment_to_block(segment, index))
    ]
    total_minutes = minutes(info.get("totalTime")) or sum(block["minutes"] for block in blocks)
    title = info.get("mapObj") or f"추천 경로 {route_index + 1}"

    return TransitRouteOut(
        title=title,
        total_minutes=total_minutes,
        payment=info.get("payment"),
        total_walk_meters=info.get("totalWalk"),
        blocks=blocks,
    )


@app.post("/api/transit/estimate", response_model=TransitEstimateOut)
async def estimate_transit(payload: TransitEstimateRequest):
    api_key = os.getenv("ODSAY_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ODSAY_API_KEY is not configured")

    params = {
        "apiKey": api_key,
        "SX": payload.start_lng,
        "SY": payload.start_lat,
        "EX": payload.end_lng,
        "EY": payload.end_lat,
        "SearchPathType": payload.search_path_type,
        "OPT": 0,
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(ODSAY_ROUTE_URL, params=params)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"ODsay request failed: {exc}") from exc

    data = response.json()
    if data.get("error"):
        raise HTTPException(status_code=502, detail=data["error"])

    paths = data.get("result", {}).get("path") or []
    routes = [path_to_route(path, index) for index, path in enumerate(paths[:3])]
    return TransitEstimateOut(routes=routes)


def get_or_create_device(db: Session, device_id: str) -> Device:
    device = db.scalar(select(Device).where(Device.device_id == device_id))
    if device:
        return device

    device = Device(device_id=device_id)
    db.add(device)
    db.add(
        Schedule(
            id="commute",
            device_id=device_id,
            name="출근",
            target_time="09:00",
            buffer_minutes=10,
            plan=STARTER_PLAN,
        ),
    )
    db.commit()
    db.refresh(device)
    return device


def get_schedule_or_404(db: Session, device_id: str, schedule_id: str) -> Schedule:
    schedule = db.scalar(
        select(Schedule).where(
            Schedule.device_id == device_id,
            Schedule.id == schedule_id,
        ),
    )
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return schedule


@app.get("/api/devices/{device_id}/schedules", response_model=list[ScheduleOut])
def list_schedules(device_id: str, db: Session = Depends(get_db)):
    get_or_create_device(db, device_id)
    return db.scalars(
        select(Schedule)
        .where(Schedule.device_id == device_id)
        .order_by(Schedule.created_at, Schedule.name)
    ).all()


@app.post(
    "/api/devices/{device_id}/schedules",
    response_model=ScheduleOut,
    status_code=status.HTTP_201_CREATED,
)
def create_schedule(device_id: str, payload: ScheduleCreate, db: Session = Depends(get_db)):
    get_or_create_device(db, device_id)
    schedule_id = payload.id or f"schedule-{uuid4().hex[:8]}"
    existing = db.scalar(
        select(Schedule).where(
            Schedule.device_id == device_id,
            Schedule.id == schedule_id,
        ),
    )
    if existing:
        raise HTTPException(status_code=409, detail="Schedule already exists")

    schedule = Schedule(
        id=schedule_id,
        device_id=device_id,
        name=payload.name,
        target_time=payload.target_time,
        buffer_minutes=payload.buffer_minutes,
        plan=payload.plan,
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return schedule


@app.put("/api/devices/{device_id}/schedules/{schedule_id}", response_model=ScheduleOut)
def update_schedule(
    device_id: str,
    schedule_id: str,
    payload: ScheduleUpdate,
    db: Session = Depends(get_db),
):
    schedule = get_schedule_or_404(db, device_id, schedule_id)
    schedule.name = payload.name
    schedule.target_time = payload.target_time
    schedule.buffer_minutes = payload.buffer_minutes
    schedule.plan = payload.plan
    db.commit()
    db.refresh(schedule)
    return schedule


@app.delete("/api/devices/{device_id}/schedules/{schedule_id}", status_code=204)
def delete_schedule(device_id: str, schedule_id: str, db: Session = Depends(get_db)):
    schedule = get_schedule_or_404(db, device_id, schedule_id)
    db.delete(schedule)
    db.commit()
    return Response(status_code=204)
