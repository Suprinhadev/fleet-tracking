import "dotenv/config";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

export const config = {
  port: Number(process.env.PORT || 3000),
  corsOrigins: (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  traccarUrl: required("TRACCAR_API_URL").replace(/\/$/, ""),
  traccarEmail: required("TRACCAR_EMAIL"),
  traccarPassword: required("TRACCAR_PASSWORD"),
  supabaseUrl: required("SUPABASE_URL").replace(/\/$/, ""),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
};
