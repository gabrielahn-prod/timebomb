import { handleOptions, jsonResponse } from "../_shared/cors.ts";

const ODSAY_ROUTE_URL = "https://api.odsay.com/v1/api/searchPubTransPathT";
const KAKAO_DRIVING_ROUTE_URL = "https://apis-navi.kakaomobility.com/v1/directions";

type RoutePayload = {
  start_lng: number;
  start_lat: number;
  end_lng: number;
  end_lat: number;
  search_path_type?: number;
  route_mode?: "transit" | "car";
  include_alternatives?: boolean;
};

function minutes(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function secondsToMinutes(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed / 60)) : 0;
}

function blockId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function laneLabel(segment: Record<string, unknown>) {
  const lanes = Array.isArray(segment.lane) ? segment.lane : [];
  const lane = lanes[0] as Record<string, unknown> | undefined;
  return String(lane?.name ?? lane?.busNo ?? lane?.subwayCode ?? lane?.busID ?? "");
}

function segmentLabel(segment: Record<string, unknown>, fallback: string) {
  const start = segment.startName ? String(segment.startName) : "";
  const end = segment.endName ? String(segment.endName) : "";
  const route = laneLabel(segment);
  const pieces = [route, start && end ? `${start} -> ${end}` : ""].filter(Boolean);
  return pieces.join(" · ") || fallback;
}

function waitMinutes(segment: Record<string, unknown>) {
  for (const key of ["waitTime", "waitingTime", "arrivalTime", "startWaitTime"]) {
    if (key in segment) return minutes(segment[key]);
  }
  return 0;
}

function transitKind(segment: Record<string, unknown>) {
  if (segment.trafficType === 1) return ["subway", "지하철 대기시간", "지하철 탑승 시간"];
  if (segment.trafficType === 2) return ["bus", "버스 대기시간", "버스 탑승 시간"];
  return ["inside", "", ""];
}

function walkFallbackLabel(index: number, nextSegment?: Record<string, unknown>) {
  if (nextSegment?.trafficType === 2) return "정류장까지 이동";
  if (nextSegment?.trafficType === 1) return "역까지 이동";
  if (index === 0) return "도보";
  return "환승 이동";
}

function segmentToBlocks(
  segment: Record<string, unknown>,
  index: number,
  nextSegment?: Record<string, unknown>,
) {
  const sectionMinutes = minutes(segment.sectionTime);
  if (sectionMinutes <= 0) return [];

  if (segment.trafficType === 1 || segment.trafficType === 2) {
    const [categoryId, waitLabel, rideLabel] = transitKind(segment);
    const blocks = [];
    const segmentWaitMinutes = waitMinutes(segment);
    if (segmentWaitMinutes > 0) {
      blocks.push({
        id: blockId("transit-wait"),
        categoryId,
        label: segmentLabel(segment, waitLabel).replace(" · ", " 대기 · "),
        minutes: segmentWaitMinutes,
        source: "odsay",
        sourceType: "wait",
      });
    }
    blocks.push({
      id: blockId("transit-ride"),
      categoryId,
      label: segmentLabel(segment, rideLabel),
      minutes: sectionMinutes,
      source: "odsay",
      sourceType: "ride",
    });
    return blocks;
  }

  const fallback = walkFallbackLabel(index, nextSegment);
  return [{
    id: blockId("transit-walk"),
    categoryId: "inside",
    label: segmentLabel(segment, fallback),
    minutes: sectionMinutes,
    source: "odsay",
    sourceType: "walk",
  }];
}

function pathToRoute(path: Record<string, unknown>, routeIndex: number) {
  const info = (path.info ?? {}) as Record<string, unknown>;
  const subpaths = Array.isArray(path.subPath) ? path.subPath as Record<string, unknown>[] : [];
  const blocks = subpaths.flatMap((segment, index) => segmentToBlocks(segment, index, subpaths[index + 1]));
  const totalMinutes = minutes(info.totalTime) || blocks.reduce((sum, block) => sum + minutes(block.minutes), 0);

  return {
    title: `추천 경로 ${routeIndex + 1}`,
    total_minutes: totalMinutes,
    payment: info.payment ?? null,
    distance_meters: info.totalDistance ?? info.trafficDistance ?? null,
    total_walk_meters: info.totalWalk ?? null,
    mode: "transit",
    blocks,
  };
}

function formatDistance(distanceMeters: number) {
  if (!distanceMeters) return "";
  if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)}km`;
  return `${distanceMeters}m`;
}

function kakaoKey() {
  return Deno.env.get("KAKAO_MOBILITY_REST_API_KEY") || Deno.env.get("KAKAO_REST_API_KEY");
}

function kakaoRouteToRoute(route: Record<string, unknown>, routeIndex: number) {
  const summary = (route.summary ?? {}) as Record<string, unknown>;
  const totalMinutes = secondsToMinutes(summary.duration);
  const distanceMeters = minutes(summary.distance);
  const fare = (summary.fare ?? {}) as Record<string, unknown>;

  return {
    title: ["차량 경로 " + (routeIndex + 1), formatDistance(distanceMeters)].filter(Boolean).join(" · "),
    total_minutes: totalMinutes,
    payment: fare.taxi ?? null,
    distance_meters: distanceMeters,
    total_walk_meters: null,
    mode: "car",
    blocks: [{
      id: blockId("kakao-car"),
      categoryId: "car",
      label: "차량으로 이동",
      minutes: totalMinutes,
      source: "kakao",
      sourceType: "car",
      distanceMeters,
    }],
  };
}

async function estimateTransit(payload: RoutePayload) {
  const apiKey = Deno.env.get("ODSAY_API_KEY");
  if (!apiKey) return jsonResponse({ error: "ODSAY_API_KEY is not configured" }, { status: 500 });

  const params = new URLSearchParams({
    apiKey,
    SX: String(payload.start_lng),
    SY: String(payload.start_lat),
    EX: String(payload.end_lng),
    EY: String(payload.end_lat),
    SearchPathType: String(payload.search_path_type ?? 0),
    OPT: "0",
  });
  const headers: HeadersInit = {};
  const referer = Deno.env.get("ODSAY_REFERER");
  if (referer) headers.Referer = referer;

  const response = await fetch(`${ODSAY_ROUTE_URL}?${params}`, { headers });
  if (!response.ok) return jsonResponse({ error: `ODsay request failed: ${await response.text()}` }, { status: 502 });

  const data = await response.json();
  if (data.error) return jsonResponse({ error: data.error }, { status: 502 });

  const paths = data.result?.path ?? [];
  const routes = paths
    .map((path: Record<string, unknown>, index: number) => pathToRoute(path, index))
    .sort((a: { total_minutes: number }, b: { total_minutes: number }) => a.total_minutes - b.total_minutes)
    .slice(0, 3);
  return jsonResponse({ routes });
}

async function estimateCar(payload: RoutePayload) {
  const apiKey = kakaoKey();
  if (!apiKey) return jsonResponse({ error: "KAKAO_REST_API_KEY is not configured" }, { status: 500 });

  const params = new URLSearchParams({
    origin: `${payload.start_lng},${payload.start_lat}`,
    destination: `${payload.end_lng},${payload.end_lat}`,
    summary: "true",
    priority: "RECOMMEND",
    alternatives: String(payload.include_alternatives ?? true),
  });
  const response = await fetch(`${KAKAO_DRIVING_ROUTE_URL}?${params}`, {
    headers: {
      Authorization: `KakaoAK ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) return jsonResponse({ error: `Kakao route request failed: ${await response.text()}` }, { status: 502 });

  const data = await response.json();
  const routes = (data.routes ?? [])
    .filter((route: Record<string, unknown>) => (route.result_code ?? 0) === 0)
    .map((route: Record<string, unknown>, index: number) => kakaoRouteToRoute(route, index))
    .slice(0, 3);
  return jsonResponse({ routes });
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const payload = await req.json() as RoutePayload;
    const coords = [payload.start_lng, payload.start_lat, payload.end_lng, payload.end_lat].map(Number);
    if (coords.some((value) => !Number.isFinite(value))) {
      return jsonResponse({ error: "valid coordinates are required" }, { status: 400 });
    }
    if (payload.route_mode === "car") return estimateCar(payload);
    return estimateTransit(payload);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
