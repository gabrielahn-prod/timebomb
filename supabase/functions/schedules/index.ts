import { createClient } from "npm:@supabase/supabase-js@2";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";

type SchedulePayload = {
  name?: string;
  target_time?: string;
  buffer_minutes?: number;
  plan?: Array<Record<string, unknown>>;
};

const starterPlan = [
  { id: "wash-세안-starter", categoryId: "wash", label: "세안", minutes: 3 },
  { id: "wash-양치-starter", categoryId: "wash", label: "양치", minutes: 3 },
  { id: "ready-옷 고르기-starter", categoryId: "ready", label: "옷 고르기", minutes: 7 },
  { id: "inside-엘리베이터-starter", categoryId: "inside", label: "엘리베이터", minutes: 4 },
  { id: "bus-버스 평균 대기시간-starter", categoryId: "bus", label: "버스 평균 대기시간", minutes: 8 },
];

function getClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service credentials are not configured");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

function normalizeSchedule(input: SchedulePayload = {}) {
  return {
    name: String(input.name || "새 일정").slice(0, 120),
    target_time: /^\d{2}:\d{2}$/.test(String(input.target_time || "")) ? input.target_time : "09:00",
    buffer_minutes: Math.max(0, Math.min(240, Number(input.buffer_minutes) || 0)),
    plan: Array.isArray(input.plan) ? input.plan : [],
  };
}

async function ensureDevice(supabase: ReturnType<typeof createClient>, deviceId: string) {
  const { error } = await supabase
    .from("devices")
    .upsert({ device_id: deviceId }, { onConflict: "device_id" });
  if (error) throw error;
}

async function listSchedules(supabase: ReturnType<typeof createClient>, deviceId: string, starterProfile?: SchedulePayload) {
  await ensureDevice(supabase, deviceId);
  const { data, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  if (data?.length) return data;

  const starter = {
    id: "commute",
    device_id: deviceId,
    ...normalizeSchedule({
      name: "출근",
      target_time: "09:00",
      buffer_minutes: 10,
      plan: starterProfile?.plan?.length ? starterProfile.plan : starterPlan,
    }),
  };
  const { data: created, error: createError } = await supabase
    .from("schedules")
    .insert(starter)
    .select()
    .single();
  if (createError) throw createError;
  return [created];
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const payload = await req.json().catch(() => ({}));
    const action = String(payload.action || "list");
    const deviceId = String(payload.device_id || "").trim();
    const scheduleId = String(payload.schedule_id || "").trim();
    if (!deviceId) return jsonResponse({ error: "device_id is required" }, { status: 400 });

    const supabase = getClient();

    if (action === "list") {
      const schedules = await listSchedules(supabase, deviceId, payload.starter_profile);
      return jsonResponse({ schedules });
    }

    if (action === "create") {
      await ensureDevice(supabase, deviceId);
      const nextId = scheduleId || `schedule-${crypto.randomUUID().slice(0, 8)}`;
      const { data, error } = await supabase
        .from("schedules")
        .insert({ id: nextId, device_id: deviceId, ...normalizeSchedule(payload.schedule) })
        .select()
        .single();
      if (error) throw error;
      return jsonResponse({ schedule: data }, { status: 201 });
    }

    if (action === "update") {
      if (!scheduleId) return jsonResponse({ error: "schedule_id is required" }, { status: 400 });
      const { data, error } = await supabase
        .from("schedules")
        .update(normalizeSchedule(payload.schedule))
        .eq("device_id", deviceId)
        .eq("id", scheduleId)
        .select()
        .single();
      if (error) throw error;
      return jsonResponse({ schedule: data });
    }

    if (action === "delete") {
      if (!scheduleId) return jsonResponse({ error: "schedule_id is required" }, { status: 400 });
      const { error } = await supabase
        .from("schedules")
        .delete()
        .eq("device_id", deviceId)
        .eq("id", scheduleId);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
