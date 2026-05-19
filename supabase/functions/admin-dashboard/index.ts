import { createClient } from "npm:@supabase/supabase-js@2";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";

type ScheduleRow = {
  id: string;
  device_id: string;
  name: string;
  target_time: string;
  buffer_minutes: number;
  plan: Array<Record<string, unknown>>;
  created_at: string | null;
  updated_at: string | null;
};

type DeviceRow = {
  id: number;
  device_id: string;
  created_at: string | null;
  updated_at: string | null;
  schedules: ScheduleRow[];
};

function minutes(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function planCategoryMinutes(plan: Array<Record<string, unknown>> = []) {
  return plan.reduce<Record<string, number>>((totals, block) => {
    const categoryId = String(block.categoryId || "unknown");
    totals[categoryId] = (totals[categoryId] ?? 0) + minutes(block.minutes);
    return totals;
  }, {});
}

function scheduleToAdminOut(schedule: ScheduleRow) {
  const plan = Array.isArray(schedule.plan) ? schedule.plan : [];
  return {
    id: schedule.id,
    name: schedule.name,
    target_time: schedule.target_time,
    buffer_minutes: schedule.buffer_minutes,
    total_minutes: plan.reduce((sum, block) => sum + minutes(block.minutes), 0),
    block_count: plan.length,
    category_minutes: planCategoryMinutes(plan),
    created_at: schedule.created_at,
    updated_at: schedule.updated_at,
  };
}

function verifyPassword(req: Request, body: Record<string, unknown>) {
  const expected = Deno.env.get("ADMIN_PASSWORD");
  if (!expected) return false;
  const provided = req.headers.get("x-admin-password") || String(body.password ?? "");
  return provided === expected;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const body = await req.json().catch(() => ({}));
    if (!verifyPassword(req, body)) {
      return jsonResponse({ error: "Invalid admin password" }, { status: 401 });
    }
    if (body.loginOnly) return jsonResponse({ ok: true });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase service credentials are not configured" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase
      .from("devices")
      .select("id, device_id, created_at, updated_at, schedules(*)")
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;

    const devices = (data ?? []).map((device: DeviceRow) => {
      const schedules = [...(device.schedules ?? [])]
        .map(scheduleToAdminOut)
        .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));

      return {
        id: device.id,
        device_id: device.device_id,
        schedule_count: schedules.length,
        total_minutes: schedules.reduce((sum, schedule) => sum + schedule.total_minutes, 0),
        block_count: schedules.reduce((sum, schedule) => sum + schedule.block_count, 0),
        created_at: device.created_at,
        updated_at: device.updated_at,
        schedules,
      };
    });

    return jsonResponse({
      total_devices: devices.length,
      total_schedules: devices.reduce((sum, device) => sum + device.schedule_count, 0),
      total_blocks: devices.reduce((sum, device) => sum + device.block_count, 0),
      total_minutes: devices.reduce((sum, device) => sum + device.total_minutes, 0),
      updated_at: new Date().toISOString(),
      devices,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
