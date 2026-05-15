import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .database import Base, engine, get_db
from .models import Device, Schedule
from .schemas import ScheduleCreate, ScheduleOut, ScheduleUpdate

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
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
KAKAO_DRIVING_ROUTE_URL = "https://apis-navi.kakaomobility.com/v1/directions"
KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"


class TransitEstimateRequest(BaseModel):
    start_lng: float = Field(..., description="출발지 경도")
    start_lat: float = Field(..., description="출발지 위도")
    end_lng: float = Field(..., description="도착지 경도")
    end_lat: float = Field(..., description="도착지 위도")
    search_path_type: int = Field(default=0, ge=0, le=2)
    route_mode: Literal["transit", "car"] = "transit"
    include_alternatives: bool = True


class TransitRouteOut(BaseModel):
    title: str
    total_minutes: int
    payment: int | None = None
    distance_meters: int | None = None
    total_walk_meters: int | None = None
    mode: str = "transit"
    blocks: list[dict]


class TransitEstimateOut(BaseModel):
    routes: list[TransitRouteOut]


class PlaceOut(BaseModel):
    id: str
    name: str
    address: str
    road_address: str
    category: str
    lng: float
    lat: float


class PlaceSearchOut(BaseModel):
    places: list[PlaceOut]


class AdminScheduleOut(BaseModel):
    id: str
    name: str
    target_time: str
    buffer_minutes: int
    total_minutes: int
    block_count: int
    category_minutes: dict[str, int]
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AdminDeviceOut(BaseModel):
    id: int
    device_id: str
    schedule_count: int
    total_minutes: int
    block_count: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
    schedules: list[AdminScheduleOut]


class AdminDashboardOut(BaseModel):
    total_devices: int
    total_schedules: int
    total_blocks: int
    total_minutes: int
    updated_at: datetime
    devices: list[AdminDeviceOut]


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


def wait_minutes(segment: dict) -> int:
    for key in ("waitTime", "waitingTime", "arrivalTime", "startWaitTime"):
        if key in segment:
            return minutes(segment.get(key))
    return 0


def transit_kind(segment: dict) -> tuple[str, str, str]:
    traffic_type = segment.get("trafficType")
    if traffic_type == 1:
        return "subway", "지하철 대기시간", "지하철 탑승 시간"
    if traffic_type == 2:
        return "bus", "버스 대기시간", "버스 탑승 시간"
    return "inside", "", ""


def walk_fallback_label(index: int, next_segment: dict | None) -> str:
    next_traffic_type = next_segment.get("trafficType") if next_segment else None
    if next_traffic_type == 2:
        return "정류장까지 이동"
    if next_traffic_type == 1:
        return "역까지 이동"
    if index == 0:
        return "도보"
    return "환승 이동"


def segment_to_blocks(segment: dict, index: int, next_segment: dict | None = None) -> list[dict]:
    section_minutes = minutes(segment.get("sectionTime"))
    if section_minutes <= 0:
        return []

    traffic_type = segment.get("trafficType")
    if traffic_type in (1, 2):
        category_id, wait_label, ride_label = transit_kind(segment)
        blocks = []
        segment_wait_minutes = wait_minutes(segment)
        if segment_wait_minutes > 0:
            blocks.append(
                {
                    "id": f"transit-wait-{uuid4().hex[:8]}",
                    "categoryId": category_id,
                    "label": segment_label(segment, wait_label).replace(" · ", " 대기 · ", 1),
                    "minutes": segment_wait_minutes,
                    "source": "odsay",
                    "sourceType": "wait",
                }
            )
        blocks.append(
            {
                "id": f"transit-ride-{uuid4().hex[:8]}",
                "categoryId": category_id,
                "label": segment_label(segment, ride_label),
                "minutes": section_minutes,
                "source": "odsay",
                "sourceType": "ride",
            }
        )
        return blocks

    fallback = walk_fallback_label(index, next_segment)

    return [
        {
            "id": f"transit-walk-{uuid4().hex[:8]}",
            "categoryId": "inside",
            "label": segment_label(segment, fallback),
            "minutes": section_minutes,
            "source": "odsay",
            "sourceType": "walk",
        }
    ]


def path_to_route(path: dict, route_index: int) -> TransitRouteOut:
    info = path.get("info", {})
    subpaths = path.get("subPath") or []
    blocks = [
        block
        for index, segment in enumerate(subpaths)
        for block in segment_to_blocks(
            segment,
            index,
            subpaths[index + 1] if index + 1 < len(subpaths) else None,
        )
    ]
    total_minutes = minutes(info.get("totalTime")) or sum(block["minutes"] for block in blocks)
    title = f"추천 경로 {route_index + 1}"

    return TransitRouteOut(
        title=title,
        total_minutes=total_minutes,
        payment=info.get("payment"),
        distance_meters=info.get("totalDistance") or info.get("trafficDistance"),
        total_walk_meters=info.get("totalWalk"),
        mode="transit",
        blocks=blocks,
    )


def seconds_to_minutes(value) -> int:
    try:
        return max(0, round(float(value) / 60))
    except (TypeError, ValueError):
        return 0


def format_distance(distance_meters: int | None) -> str:
    if not distance_meters:
        return ""
    if distance_meters >= 1000:
        return f"{distance_meters / 1000:.1f}km"
    return f"{distance_meters}m"


def kakao_key() -> str:
    api_key = os.getenv("KAKAO_MOBILITY_REST_API_KEY") or os.getenv("KAKAO_REST_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="KAKAO_REST_API_KEY is not configured")
    return api_key


def kakao_route_to_route(route: dict, route_index: int, mode: str) -> TransitRouteOut:
    summary = route.get("summary") or {}
    total_minutes = seconds_to_minutes(summary.get("duration"))
    distance_meters = minutes(summary.get("distance"))
    mode_label = "차량으로 이동"
    title_label = "차량 경로"
    distance_label = format_distance(distance_meters)

    return TransitRouteOut(
        title=" · ".join(
            piece for piece in [f"{title_label} {route_index + 1}", distance_label] if piece
        ),
        total_minutes=total_minutes,
        payment=(summary.get("fare") or {}).get("taxi"),
        distance_meters=distance_meters,
        total_walk_meters=None,
        mode=mode,
        blocks=[
            {
                "id": f"kakao-{mode}-{uuid4().hex[:8]}",
                "categoryId": "car",
                "label": mode_label,
                "minutes": total_minutes,
                "source": "kakao",
                "sourceType": mode,
                "distanceMeters": distance_meters,
            }
        ],
    )


async def estimate_transit_route(payload: TransitEstimateRequest) -> TransitEstimateOut:
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
        headers = {}
        if referer := os.getenv("ODSAY_REFERER"):
            headers["Referer"] = referer
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(ODSAY_ROUTE_URL, params=params, headers=headers)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"ODsay request failed: {exc}") from exc

    data = response.json()
    if data.get("error"):
        raise HTTPException(status_code=502, detail=data["error"])

    paths = data.get("result", {}).get("path") or []
    routes = sorted(
        [path_to_route(path, index) for index, path in enumerate(paths)],
        key=lambda route: route.total_minutes,
    )[:3]
    return TransitEstimateOut(routes=routes)


async def estimate_kakao_route(payload: TransitEstimateRequest) -> TransitEstimateOut:
    mode = payload.route_mode
    if mode != "car":
        return TransitEstimateOut(routes=[])

    params = {
        "origin": f"{payload.start_lng},{payload.start_lat}",
        "destination": f"{payload.end_lng},{payload.end_lat}",
        "summary": "true",
        "priority": "RECOMMEND",
        "alternatives": str(payload.include_alternatives).lower(),
    }
    headers = {
        "Authorization": f"KakaoAK {kakao_key()}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(KAKAO_DRIVING_ROUTE_URL, params=params, headers=headers)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Kakao route request failed: {exc.response.text}",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Kakao route request failed: {exc}") from exc

    data = response.json()
    routes = [
        kakao_route_to_route(route, index, mode)
        for index, route in enumerate(data.get("routes") or [])
        if route.get("result_code", 0) == 0
    ]
    return TransitEstimateOut(routes=routes[:3])


@app.post("/api/transit/estimate", response_model=TransitEstimateOut)
async def estimate_transit(payload: TransitEstimateRequest):
    if payload.route_mode == "transit":
        return await estimate_transit_route(payload)
    return await estimate_kakao_route(payload)


@app.get("/api/places/search", response_model=PlaceSearchOut)
async def search_places(
    query: str = Query(..., min_length=1),
    lng: float | None = None,
    lat: float | None = None,
):
    api_key = os.getenv("KAKAO_REST_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="KAKAO_REST_API_KEY is not configured")

    params = {
        "query": query,
        "size": 8,
    }
    if lng is not None and lat is not None:
        params.update({"x": lng, "y": lat, "sort": "distance"})

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                KAKAO_KEYWORD_URL,
                params=params,
                headers={"Authorization": f"KakaoAK {api_key}"},
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Kakao place search failed: {exc}") from exc

    data = response.json()
    places = [
        PlaceOut(
            id=item.get("id") or f"kakao-{index}",
            name=item.get("place_name") or query,
            address=item.get("address_name") or "",
            road_address=item.get("road_address_name") or "",
            category=item.get("category_group_name") or item.get("category_name") or "",
            lng=float(item["x"]),
            lat=float(item["y"]),
        )
        for index, item in enumerate(data.get("documents", []))
        if item.get("x") and item.get("y")
    ]
    return PlaceSearchOut(places=places)


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


def plan_category_minutes(plan: list[dict] | None) -> dict[str, int]:
    totals: dict[str, int] = {}
    for block in plan or []:
        category_id = str(block.get("categoryId") or "unknown")
        totals[category_id] = totals.get(category_id, 0) + minutes(block.get("minutes"))
    return totals


def schedule_to_admin_out(schedule: Schedule) -> AdminScheduleOut:
    plan = schedule.plan or []
    return AdminScheduleOut(
        id=schedule.id,
        name=schedule.name,
        target_time=schedule.target_time,
        buffer_minutes=schedule.buffer_minutes,
        total_minutes=sum(minutes(block.get("minutes")) for block in plan),
        block_count=len(plan),
        category_minutes=plan_category_minutes(plan),
        created_at=schedule.created_at,
        updated_at=schedule.updated_at,
    )


@app.get("/api/admin/dashboard", response_model=AdminDashboardOut)
def admin_dashboard(db: Session = Depends(get_db)):
    devices = db.scalars(
        select(Device)
        .options(selectinload(Device.schedules))
        .order_by(Device.updated_at.desc(), Device.created_at.desc())
    ).all()

    admin_devices = []
    for device in devices:
        schedules = sorted(
            [schedule_to_admin_out(schedule) for schedule in device.schedules],
            key=lambda schedule: (schedule.updated_at or schedule.created_at or datetime.min),
            reverse=True,
        )
        admin_devices.append(
            AdminDeviceOut(
                id=device.id,
                device_id=device.device_id,
                schedule_count=len(schedules),
                total_minutes=sum(schedule.total_minutes for schedule in schedules),
                block_count=sum(schedule.block_count for schedule in schedules),
                created_at=device.created_at,
                updated_at=device.updated_at,
                schedules=schedules,
            )
        )

    return AdminDashboardOut(
        total_devices=len(admin_devices),
        total_schedules=sum(device.schedule_count for device in admin_devices),
        total_blocks=sum(device.block_count for device in admin_devices),
        total_minutes=sum(device.total_minutes for device in admin_devices),
        updated_at=datetime.now(timezone.utc),
        devices=admin_devices,
    )


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
