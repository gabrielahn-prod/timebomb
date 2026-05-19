import { handleOptions, jsonResponse } from "../_shared/cors.ts";

const KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const apiKey = Deno.env.get("KAKAO_REST_API_KEY");
    if (!apiKey) return jsonResponse({ error: "KAKAO_REST_API_KEY is not configured" }, { status: 500 });

    const payload = await req.json().catch(() => ({}));
    const query = String(payload.query ?? "").trim();
    if (!query) return jsonResponse({ error: "query is required" }, { status: 400 });

    const params = new URLSearchParams({ query, size: "8" });
    if (payload.lng !== undefined && payload.lat !== undefined) {
      params.set("x", String(payload.lng));
      params.set("y", String(payload.lat));
      params.set("sort", "distance");
    }

    const response = await fetch(`${KAKAO_KEYWORD_URL}?${params}`, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
    });
    if (!response.ok) {
      return jsonResponse({ error: `Kakao place search failed: ${await response.text()}` }, { status: 502 });
    }

    const data = await response.json();
    const places = (data.documents ?? [])
      .filter((item: Record<string, unknown>) => item.x && item.y)
      .map((item: Record<string, string>, index: number) => ({
        id: item.id || `kakao-${index}`,
        name: item.place_name || query,
        address: item.address_name || "",
        road_address: item.road_address_name || "",
        category: item.category_group_name || item.category_name || "",
        lng: Number(item.x),
        lat: Number(item.y),
      }));

    return jsonResponse({ places });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
