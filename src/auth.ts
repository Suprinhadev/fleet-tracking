import type { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { filterAllowedDevices as filterDevices } from "./permissions.js";

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

export type AppUser = {
  id: string;
  role: AppRole;
  displayName: string | null;
  disabled: boolean;
  deviceIds: number[];
};

export type AppRole =
  | "developer"
  | "owner"
  | "manager"
  | "dispatcher"
  | "viewer";

async function getAppUser(userId: string): Promise<AppUser | null> {
  const [{ data: profile, error: profileError }, { data: assignments, error: assignmentError }] =
    await Promise.all([
      supabase
        .from("app_profiles")
        .select("role, display_name, disabled")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("user_devices")
        .select("traccar_device_id")
        .eq("user_id", userId),
    ]);

  if (profileError || assignmentError) return null;

  return {
    id: userId,
    role: profile?.role || "viewer",
    displayName: profile?.display_name || null,
    disabled: profile?.disabled || false,
    deviceIds: (assignments || []).map((row) => Number(row.traccar_device_id)),
  };
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  const token = authorization.slice("Bearer ".length);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: "Invalid bearer token" });
  }

  const appUser = await getAppUser(data.user.id);
  if (!appUser || appUser.disabled) {
    return res.status(403).json({ error: "User is disabled or not provisioned" });
  }

  res.locals.authUser = data.user;
  res.locals.appUser = appUser;
  next();
}

export function requireRole(...roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const appUser = res.locals.appUser as AppUser | undefined;
    if (!appUser || !roles.includes(appUser.role)) {
      return res.status(403).json({ error: "Insufficient role" });
    }
    next();
  };
}

export function filterAllowedDevices<T extends { id: number }>(
  appUser: AppUser,
  devices: T[],
): T[] {
  return filterDevices(appUser, devices);
}
