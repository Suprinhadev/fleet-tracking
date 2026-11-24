"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bell,
  Bike,
  Bus,
  BusFront,
  CarFront,
  ChevronDown,
  CircleGauge,
  Info,
  LogOut,
  MapPinned,
  Menu,
  Navigation,
  Search,
  ShieldCheck,
  Truck,
  Undo2,
  Users,
  X,
} from "lucide-react";
import { browserSupabase } from "../lib/supabase";
import { getEngineStopBlockReason } from "../lib/engine-stop";
import { polygonAreaWkt } from "../lib/geofences";
import {
  normalizeTripReports,
  summarizeTripReports,
  type TripReport,
} from "../lib/trips";
import { knotsToKilometersPerHour } from "../lib/units";

const TrackerMap = dynamic(() => import("./TrackerMap"), { ssr: false });

type Device = {
  id: number;
  name: string;
  status?: string;
  lastUpdate?: string;
  uniqueId?: string;
  category?: string;
  plate?: string | null;
  brand?: string | null;
  model?: string | null;
  year?: number | null;
  vehicleType?: string | null;
  imei?: string | null;
  ownerName?: string | null;
  color?: string | null;
  photoUrl?: string | null;
};

type VehicleType = "car" | "truck" | "bus" | "motorcycle" | "van";

const vehicleTypeOptions: Array<{ value: VehicleType; label: string }> = [
  { value: "car", label: "Automóvel" },
  { value: "truck", label: "Camião" },
  { value: "bus", label: "Autocarro" },
  { value: "motorcycle", label: "Motocicleta" },
  { value: "van", label: "Carrinha" },
];

function getVehicleType(device?: Pick<Device, "vehicleType" | "category"> | null): VehicleType {
  const type = device?.vehicleType || device?.category;
  return vehicleTypeOptions.find((option) => option.value === type)?.value || "car";
}

function getRoleLabel(role: string): string {
  switch (role) {
    case "developer":
      return "Programador";
    case "owner":
      return "Administrador";
    case "manager":
      return "Gestor";
    case "dispatcher":
      return "Operador";
    default:
      return "Visualizador";
  }
}

function VehicleTypeIcon({ type, size = 18 }: { type: VehicleType; size?: number }) {
  switch (type) {
    case "truck":
      return <Truck size={size} aria-hidden="true" />;
    case "bus":
      return <BusFront size={size} aria-hidden="true" />;
    case "motorcycle":
      return <Bike size={size} aria-hidden="true" />;
    case "van":
      return <Bus size={size} aria-hidden="true" />;
    default:
      return <CarFront size={size} aria-hidden="true" />;
  }
}

function VehicleTypeSelect({ defaultValue = "car" }: { defaultValue?: string }) {
  const initialType = vehicleTypeOptions.find((option) => option.value === defaultValue)?.value || "car";
  const [type, setType] = useState<VehicleType>(initialType);

  return (
    <label>
      Tipo
      <span className="vehicle-type-control">
        <span className="vehicle-type-preview">
          <VehicleTypeIcon type={type} />
        </span>
        <select
          name="vehicleType"
          value={type}
          onChange={(event) => {
            const option = vehicleTypeOptions.find((item) => item.value === event.target.value);
            if (option) setType(option.value);
          }}
        >
          {vehicleTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </span>
    </label>
  );
}

function InfoTip({ label, children }: { label: string; children: string }) {
  return (
    <details className="info-tip">
      <summary aria-label={label} title={label}>
        <Info size={15} aria-hidden="true" />
      </summary>
      <span className="info-tip-content">{children}</span>
    </details>
  );
}

type Position = {
  id: number;
  deviceId: number;
  fixTime: string;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  attributes?: Record<string, unknown>;
};

type TripStop = {
  startTime: string;
  endTime: string;
  duration?: number;
  positionId?: number;
};

type FleetAlert = {
  event_id: number;
  device_id: number;
  type: string;
  event_time: string;
  status: "open" | "acknowledged" | "resolved";
  notes?: string | null;
};

type FleetUser = {
  id: string;
  email?: string;
  displayName: string | null;
  role: string;
  disabled: boolean;
  createdAt: string;
  deviceIds: number[];
};

type Geofence = {
  id: number;
  name: string;
  description?: string;
  area: string;
};

type AuditEntry = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

type NotificationEntry = {
  id: number;
  event_id: number | null;
  device_id: number;
  type: string;
  title: string;
  message: string;
  status: "unread" | "read";
  event_time: string;
  created_at: string;
};

function formatRelativeTime(dateText?: string) {
  if (!dateText) return "Sem dados recentes";

  const timestamp = new Date(dateText).getTime();
  if (!Number.isFinite(timestamp)) return "Sem dados recentes";

  const elapsedMinutes = Math.floor((Date.now() - timestamp) / 60000);
  if (elapsedMinutes < 0) return "Agora";
  if (elapsedMinutes < 1) return "Agora";
  if (elapsedMinutes < 60) return `Há ${elapsedMinutes} min`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `Há ${elapsedHours} h`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `Há ${elapsedDays} d`;
}

async function apiFailureMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json() as {
      error?: unknown;
      message?: unknown;
      fieldErrors?: unknown;
    };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
    if (payload.fieldErrors && typeof payload.fieldErrors === "object") {
      for (const [field, messages] of Object.entries(payload.fieldErrors)) {
        if (Array.isArray(messages)) {
          const firstMessage = messages.find((message) => typeof message === "string");
          if (typeof firstMessage === "string") {
            return `${field}: ${firstMessage} (HTTP ${response.status}).`;
          }
        }
      }
    }
  } catch {
    // Keep the user-facing fallback for empty or non-JSON API responses.
  }
  return `${fallback} (HTTP ${response.status}).`;
}

export default function Dashboard() {
  const supabase = useMemo(() => browserSupabase(), []);
  const [sessionReady, setSessionReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [vehicleStateFilter, setVehicleStateFilter] = useState<"all" | "moving" | "parked" | "offline">("all");
  const [fleetCollapsed, setFleetCollapsed] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [dataWarning, setDataWarning] = useState("");
  const [actionFeedback, setActionFeedback] = useState<{
    kind: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [activeSection, setActiveSection] = useState<"map" | "vehicles" | "trips" | "alerts" | "users" | "geofences" | "audit">("map");
  const [accessRole, setAccessRole] = useState<string>("Carregando");
  const [accessRoleCode, setAccessRoleCode] = useState<string>("");
  const [accessLoaded, setAccessLoaded] = useState(false);
  const [accessDeviceIds, setAccessDeviceIds] = useState<number[]>([]);
  const [tripPeriod, setTripPeriod] = useState<"today" | "week" | "custom">("today");
  const [trips, setTrips] = useState<TripReport[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<TripReport | null>(null);
  const [tripRoute, setTripRoute] = useState<Array<[number, number]>>([]);
  const [tripStops, setTripStops] = useState<TripStop[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [alerts, setAlerts] = useState<FleetAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [fleetUsers, setFleetUsers] = useState<FleetUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userCreateOpen, setUserCreateOpen] = useState(false);
  const [userCreateSaving, setUserCreateSaving] = useState(false);
  const [userCreateError, setUserCreateError] = useState("");
  const [userCreateDeviceIds, setUserCreateDeviceIds] = useState<number[]>([]);
  const [vehicleFormOpen, setVehicleFormOpen] = useState(false);
  const [vehicleFormSaving, setVehicleFormSaving] = useState(false);
  const [vehicleFormError, setVehicleFormError] = useState("");
  const [vehicleEditError, setVehicleEditError] = useState("");
  const [userEditError, setUserEditError] = useState("");
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [geofencesLoading, setGeofencesLoading] = useState(false);
  const [geofenceLoadError, setGeofenceLoadError] = useState("");
  const [geofenceDraftMode, setGeofenceDraftMode] = useState<"circle" | "polygon">("circle");
  const [geofenceMapCenter, setGeofenceMapCenter] = useState<[number, number] | null>(null);
  const [geofenceDraftCenter, setGeofenceDraftCenter] = useState<[number, number] | null>(null);
  const [geofenceDraftPoints, setGeofenceDraftPoints] = useState<Array<[number, number]>>([]);
  const [geofenceDraftRadius, setGeofenceDraftRadius] = useState(500);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const notificationWrapRef = useRef<HTMLDivElement>(null);
  const [notificationChannels, setNotificationChannels] = useState({
    inApp: true,
    browser: true,
    email: false,
    whatsapp: false,
  });
  const [editingUser, setEditingUser] = useState<FleetUser | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Device | null>(null);
  const tripSummary = useMemo(() => summarizeTripReports(trips), [trips]);

  function showFeedback(kind: "success" | "error" | "info", message: string) {
    setActionFeedback({ kind, message });
  }

  function clearSessionData() {
    setDevices([]);
    setPositions([]);
    setSelectedDeviceId(undefined);
    setAccessRole("Não disponível");
    setAccessRoleCode("");
    setAccessLoaded(false);
    setAccessDeviceIds([]);
    setAlerts([]);
    setTrips([]);
    setSelectedTrip(null);
    setTripRoute([]);
    setTripStops([]);
    setFleetUsers([]);
    setGeofences([]);
    setAuditEntries([]);
    setNotifications([]);
    setLiveConnected(false);
    setDataWarning("");
    setActionFeedback(null);
  }

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (notificationWrapRef.current &&
          !notificationWrapRef.current.contains(event.target)) {
        setNotificationOpen(false);
      }
      document.querySelectorAll<HTMLDetailsElement>(".info-tip[open]").forEach((tip) => {
        if (!tip.contains(event.target as Node)) tip.open = false;
      });
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNotificationOpen(false);
      document.querySelectorAll<HTMLDetailsElement>(".info-tip[open]").forEach((tip) => {
        tip.open = false;
      });
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (!supabase) {
      setSessionReady(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSessionReady(Boolean(data.session)));
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !sessionReady) return;

    const loadAccess = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
        if (!token || !baseUrl) return;

        const response = await fetch(`${baseUrl}/api/access/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) {
          setAccessRole("Não provisionado");
          setAccessLoaded(true);
          return;
        }

        const access = (await response.json()) as {
          role: string;
          displayName: string | null;
          deviceIds?: number[];
        };
        setAccessRole(access.displayName || access.role);
        setAccessRoleCode(access.role);
        setAccessDeviceIds(access.deviceIds || []);
        setAccessLoaded(true);
      } catch {
        setAccessRole("Não disponível");
        setAccessLoaded(true);
      }
    };

    void loadAccess();
  }, [sessionReady, supabase]);

  useEffect(() => {
    if (!supabase || !sessionReady) return;

    const load = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) return;

        const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
        if (!baseUrl) {
          setDataWarning("API não configurada.");
          return;
        }

        const headers = { Authorization: `Bearer ${token}` };
        const [deviceResponse, positionResponse] = await Promise.all([
          fetch(`${baseUrl}/api/devices`, { headers, cache: "no-store" }),
          fetch(`${baseUrl}/api/positions`, { headers, cache: "no-store" }),
        ]);

        if (!deviceResponse.ok || !positionResponse.ok) {
          setDataWarning("Dados indisponíveis no momento.");
          return;
        }

        const deviceList = (await deviceResponse.json()) as Device[];
        const positionList = (await positionResponse.json()) as Position[];
        setDevices(deviceList);
        setPositions(positionList);
        setDataWarning("");
        setSelectedDeviceId((current) => current || deviceList[0]?.id);
      } catch {
        setDataWarning("Falha temporária ao atualizar dados.");
      }
    };

    void load();
    const interval = window.setInterval(load, 10000);
    return () => window.clearInterval(interval);
  }, [sessionReady, supabase]);

  useEffect(() => {
    if (!supabase || !sessionReady) return;

    const controller = new AbortController();

    const connectLive = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
        if (!token || !baseUrl) return;

        const response = await fetch(`${baseUrl}/api/live`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          setLiveConnected(false);
          return;
        }

        setLiveConnected(true);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";

          for (const event of events) {
            const line = event
              .split("\n")
              .find((item) => item.startsWith("data: "));
            if (!line) continue;

            let message: {
              devices?: Device[];
              positions?: Position[];
              events?: unknown[];
              accessChanged?: boolean;
              accessRevoked?: boolean;
            };
            try {
              message = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            if (message.accessChanged) {
              window.location.reload();
              return;
            }
            if (message.accessRevoked) {
              clearSessionData();
              setAuthError("O acesso desta conta foi revogado. Contacte o administrador.");
              const { error } = await supabase.auth.signOut();
              if (error) console.error("Sign out after access revocation failed:", error.message);
              setSessionReady(false);
              return;
            }

            if (message.devices?.length) {
              setDevices((current) => {
                const map = new Map(current.map((device) => [device.id, device]));
                for (const device of message.devices || []) map.set(device.id, device);
                return Array.from(map.values());
              });
            }

            if (message.positions?.length) {
              setPositions((current) => {
                const map = new Map(current.map((position) => [position.id, position]));
                for (const position of message.positions || []) map.set(position.id, position);
                return Array.from(map.values())
                  .sort(
                    (a, b) =>
                      new Date(b.fixTime).getTime() - new Date(a.fixTime).getTime(),
                  )
                  .slice(0, 100);
              });
            }

            if (message.events?.length && "Notification" in window) {
              for (const liveEvent of message.events as Array<{ type: string }>) {
                if (Notification.permission === "granted") {
                  new Notification("Novo evento da frota", {
                    body: `Evento recebido: ${liveEvent.type}`,
                  });
                }
              }
            }
          }
        }
      } catch {
        if (!controller.signal.aborted) setLiveConnected(false);
      }
    };

    void connectLive();
    return () => controller.abort();
  }, [sessionReady, supabase]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) {
      setAuthError("Configuração Supabase em falta.");
      return;
    }
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError("Email ou senha inválida.");
    else setSessionReady(true);
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      showFeedback("error", "Não foi possível terminar a sessão.");
      return;
    }
    clearSessionData();
    setAuthError("");
    setSessionReady(false);
  }

  async function enableBrowserNotifications() {
    if (!("Notification" in window)) {
      showFeedback("error", "Este navegador não suporta notificações.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      showFeedback(
        permission === "granted" ? "success" : "info",
        permission === "granted"
          ? "Notificações do navegador ativadas."
          : "Permissão de notificações não concedida. Pode alterá-la nas definições do navegador.",
      );
    } catch {
      showFeedback("error", "Não foi possível pedir permissão para notificações.");
    }
  }

  async function markNotificationRead(notificationId: number) {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
    if (!token || !baseUrl) {
      showFeedback("error", "Não foi possível autenticar a atualização da notificação.");
      return;
    }
    try {
      const response = await fetch(`${baseUrl}/api/notifications/${notificationId}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        showFeedback("error", await apiFailureMessage(response, "Não foi possível marcar a notificação como lida"));
        return;
      }
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId
            ? { ...notification, status: "read" }
            : notification,
        ),
      );
    } catch {
      showFeedback("error", "Falha de comunicação ao atualizar a notificação.");
    }
  }

  function getTripRange() {
    const now = new Date();
    if (tripPeriod === "week") {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      return { from: start.toISOString(), to: now.toISOString() };
    }
    if (tripPeriod === "custom") {
      if (!customFrom || !customTo) {
        showFeedback("error", "Selecione as datas inicial e final para aplicar o período.");
        return null;
      }
      if (customFrom > customTo) {
        showFeedback("error", "A data inicial não pode ser posterior à data final.");
        return null;
      }
      return {
        from: new Date(`${customFrom}T00:00:00+02:00`).toISOString(),
        to: new Date(`${customTo}T23:59:59+02:00`).toISOString(),
      };
    }
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: now.toISOString() };
  }

  async function loadTrips() {
    if (!supabase || !selectedDevice?.id) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
    if (!token || !baseUrl) {
      showFeedback("error", "A sessão ou a configuração da API está indisponível.");
      return;
    }

    const range = getTripRange();
    if (!range) return;
    setTripsLoading(true);
    setSelectedTrip(null);
    setTripRoute([]);

    try {
      const params = new URLSearchParams({
        deviceId: String(selectedDevice.id),
        from: range.from,
        to: range.to,
      });
      const response = await fetch(
        `${baseUrl}/api/reports/trips?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      if (!response.ok) {
        setTrips([]);
        showFeedback("error", await apiFailureMessage(response, "Não foi possível carregar as viagens"));
        return;
      }
      const report: unknown = await response.json();
      if (!Array.isArray(report)) {
        setTrips([]);
        showFeedback("error", "O relatório devolveu um formato de viagens inesperado.");
        return;
      }
      setTrips(normalizeTripReports(report));
    } catch {
      setTrips([]);
      showFeedback("error", "Falha de comunicação ao carregar as viagens.");
    } finally {
      setTripsLoading(false);
    }
  }

  async function updateAlertStatus(
    eventId: number,
    status: "acknowledged" | "resolved",
  ) {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
    if (!token || !baseUrl) {
      showFeedback("error", "A sessão ou a configuração da API está indisponível.");
      return;
    }

    try {
      const response = await fetch(`${baseUrl}/api/alerts/${eventId}/ack`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        showFeedback("error", await apiFailureMessage(response, "Não foi possível atualizar o alerta"));
        return;
      }
      setAlerts((current) =>
        current.map((alert) =>
          alert.event_id === eventId ? { ...alert, status } : alert,
        ),
      );
      showFeedback("success", status === "acknowledged" ? "Alerta reconhecido." : "Alerta resolvido.");
    } catch {
      showFeedback("error", "Falha de comunicação ao atualizar o alerta.");
    }
  }

  async function saveVehicle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setVehicleFormSaving(true);
    setVehicleFormError("");

    const form = new FormData(event.currentTarget);
    const year = String(form.get("year") || "").trim();
    const payload = {
      name: String(form.get("name") || "").trim(),
      plate: String(form.get("plate") || "").trim() || undefined,
      brand: String(form.get("brand") || "").trim() || undefined,
      model: String(form.get("model") || "").trim() || undefined,
      year: year ? Number(year) : undefined,
      vehicleType: String(form.get("vehicleType") || "").trim() || undefined,
      imei: String(form.get("imei") || "").trim(),
      ownerName: String(form.get("ownerName") || "").trim() || undefined,
      color: String(form.get("color") || "").trim() || undefined,
      photoUrl: String(form.get("photoUrl") || "").trim() || undefined,
    };

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
      if (!token || !baseUrl) throw new Error("API não configurada.");

      const response = await fetch(`${baseUrl}/api/devices`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível cadastrar o veículo.");

      setVehicleFormOpen(false);
      setSelectedDeviceId(Number(result.id));
      const { data: refreshData } = await supabase.auth.getSession();
      const refreshToken = refreshData.session?.access_token;
      if (refreshToken && baseUrl) {
        const deviceResponse = await fetch(`${baseUrl}/api/devices`, {
          headers: { Authorization: `Bearer ${refreshToken}` },
          cache: "no-store",
        });
        if (deviceResponse.ok) setDevices((await deviceResponse.json()) as Device[]);
      }
      showFeedback("success", "Veículo cadastrado.");
    } catch (error) {
      setVehicleFormError(error instanceof Error ? error.message : "Falha ao cadastrar.");
    } finally {
      setVehicleFormSaving(false);
    }
  }

  async function saveGeofence(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const rawDeviceIds = String(form.get("deviceIds") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const deviceIds = rawDeviceIds.map(Number);
    if (deviceIds.some((value) => !Number.isInteger(value) || value <= 0)) {
      showFeedback("error", "Indique IDs de veículos válidos, separados por vírgulas.");
      return;
    }
    const payload = {
      name: String(form.get("name") || "").trim(),
      description: String(form.get("description") || "").trim() || undefined,
      area: String(form.get("area") || "").trim(),
      deviceIds: Array.from(new Set(deviceIds)),
    };
    if (!payload.area) {
      showFeedback("error", "Defina a área da geocerca no mapa antes de guardar.");
      return;
    }
    if (!payload.deviceIds.length) {
      showFeedback("error", "Atribua a geocerca a pelo menos um veículo para que possa gerar eventos.");
      return;
    }

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
      if (!token || !baseUrl) {
        showFeedback("error", "A sessão ou a configuração da API está indisponível.");
        return;
      }
      const response = await fetch(`${baseUrl}/api/geofences`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        showFeedback("error", await apiFailureMessage(response, "Não foi possível criar a geocerca"));
        return;
      }
      const created = (await response.json()) as Geofence;
      setGeofences((current) => [...current, created]);
      formElement.reset();
      setGeofenceDraftCenter(null);
      setGeofenceDraftPoints([]);
      setGeofenceDraftMode("circle");
      showFeedback("success", "Geocerca criada e atribuída ao(s) veículo(s).");
    } catch {
      showFeedback("error", "Falha de comunicação ao criar a geocerca.");
    }
  }

  async function deleteGeofence(geofenceId: number) {
    if (!supabase || !window.confirm("Eliminar esta geocerca? Esta ação será registada na auditoria.")) return;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
      if (!token || !baseUrl) {
        showFeedback("error", "A sessão ou a configuração da API está indisponível.");
        return;
      }
      const response = await fetch(`${baseUrl}/api/geofences/${geofenceId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        showFeedback("error", await apiFailureMessage(response, "Não foi possível eliminar a geocerca"));
        return;
      }
      setGeofences((current) => current.filter((geofence) => geofence.id !== geofenceId));
      showFeedback("success", "Geocerca eliminada.");
    } catch {
      showFeedback("error", "Falha de comunicação ao eliminar a geocerca.");
    }
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setUserCreateSaving(true);
    setUserCreateError("");

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (password !== String(form.get("passwordConfirmation") || "")) {
      setUserCreateError("As senhas não coincidem.");
      setUserCreateSaving(false);
      return;
    }

    const deviceIds = Array.from(new Set(
      form.getAll("deviceIds").map((value) => Number(String(value))),
    ));
    const payload = {
      email: String(form.get("email") || "").trim().toLowerCase(),
      password,
      displayName: String(form.get("displayName") || "").trim(),
      role: String(form.get("role") || "viewer"),
      deviceIds,
    };

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
      if (!token || !baseUrl) {
        setUserCreateError("A sessão ou a configuração da API está indisponível.");
        return;
      }

      const response = await fetch(`${baseUrl}/api/access/users`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setUserCreateError(await apiFailureMessage(response, "Não foi possível criar o utilizador"));
        return;
      }

      const created = await response.json() as {
        id: string;
        email: string;
        displayName: string;
        role: string;
        deviceIds: number[];
      };
      setFleetUsers((current) => [
        ...current,
        {
          ...created,
          disabled: false,
          createdAt: new Date().toISOString(),
        },
      ]);
      setUserCreateOpen(false);
      setUserCreateDeviceIds([]);
      showFeedback(
        "success",
        "Utilizador criado. A conta já está ativa; partilhe a senha inicial por um canal seguro.",
      );
    } catch {
      setUserCreateError("Falha de comunicação ao criar o utilizador.");
    } finally {
      setUserCreateSaving(false);
    }
  }

  async function updateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !editingUser) return;

    const form = new FormData(event.currentTarget);
    const deviceIds = Array.from(new Set(
      form.getAll("deviceIds").map((value) => Number(String(value))),
    ));
    if (deviceIds.some((value) => !Number.isInteger(value) || value <= 0)) {
      setUserEditError("A seleção de veículos é inválida. Atualize a página e tente novamente.");
      return;
    }
    const payload = {
      displayName: String(form.get("displayName") || "").trim(),
      role: String(form.get("role") || "") as FleetUser["role"],
      disabled: form.get("disabled") === "true",
      deviceIds: Array.from(new Set(deviceIds)),
    };
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
      if (!token || !baseUrl) {
        setUserEditError("A sessão ou a configuração da API está indisponível.");
        return;
      }

      const response = await fetch(`${baseUrl}/api/access/users/${editingUser.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setUserEditError(await apiFailureMessage(response, "Não foi possível atualizar o utilizador"));
        return;
      }

      setFleetUsers((current) =>
        current.map((user) =>
          user.id === editingUser.id
            ? {
                ...user,
                displayName: payload.displayName,
                role: payload.role,
                disabled: payload.disabled,
                deviceIds: payload.deviceIds,
              }
            : user,
        ),
      );
      setEditingUser(null);
      setUserEditError("");
      showFeedback("success", "Utilizador atualizado.");
    } catch {
      setUserEditError("Falha de comunicação ao atualizar o utilizador.");
    }
  }

  async function updateVehicle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !editingVehicle) return;

    const form = new FormData(event.currentTarget);
    const year = String(form.get("year") || "").trim();
    const payload = {
      name: String(form.get("name") || "").trim(),
      plate: String(form.get("plate") || "").trim() || undefined,
      brand: String(form.get("brand") || "").trim() || undefined,
      model: String(form.get("model") || "").trim() || undefined,
      year: year ? Number(year) : undefined,
      vehicleType: String(form.get("vehicleType") || "").trim() || undefined,
      imei: String(form.get("imei") || "").trim() || undefined,
      ownerName: String(form.get("ownerName") || "").trim() || undefined,
      color: String(form.get("color") || "").trim() || undefined,
      photoUrl: String(form.get("photoUrl") || "").trim() || undefined,
    };

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
      if (!token || !baseUrl) {
        setVehicleEditError("A sessão ou a configuração da API está indisponível.");
        return;
      }
      const response = await fetch(`${baseUrl}/api/devices/${editingVehicle.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setVehicleEditError(await apiFailureMessage(response, "Não foi possível atualizar o veículo"));
        return;
      }

      setDevices((current) =>
        current.map((device) =>
          device.id === editingVehicle.id
            ? {
                ...device,
                name: payload.name,
                plate: payload.plate || null,
                brand: payload.brand || null,
                model: payload.model || null,
                year: payload.year || null,
                vehicleType: payload.vehicleType || null,
                imei: payload.imei || device.imei || null,
                ownerName: payload.ownerName || null,
                color: payload.color || null,
                photoUrl: payload.photoUrl || null,
              }
            : device,
        ),
      );
      setEditingVehicle(null);
      setVehicleEditError("");
      showFeedback("success", "Veículo atualizado.");
    } catch {
      setVehicleEditError("Falha de comunicação ao atualizar o veículo.");
    }
  }

  async function deleteVehicle(vehicleId: number) {
    if (!supabase || !window.confirm("Eliminar este veículo permanentemente? Esta ação será registada na auditoria.")) return;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
      if (!token || !baseUrl) {
        showFeedback("error", "A sessão ou a configuração da API está indisponível.");
        return;
      }
      const response = await fetch(`${baseUrl}/api/devices/${vehicleId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        showFeedback("error", await apiFailureMessage(response, "Não foi possível eliminar o veículo"));
        return;
      }

      setDevices((current) => current.filter((device) => device.id !== vehicleId));
      if (selectedDeviceId === vehicleId) setSelectedDeviceId(undefined);
      showFeedback("success", "Veículo eliminado.");
    } catch {
      showFeedback("error", "Falha de comunicação ao eliminar o veículo.");
    }
  }

  async function sendRemoteCommand(
    type: "engineStop" | "engineResume",
    deviceId = selectedDevice?.id,
  ) {
    if (!supabase || !deviceId) return;
    if (type === "engineStop") {
      const position = positions
        .filter((item) => item.deviceId === deviceId)
        .sort((a, b) => new Date(b.fixTime).getTime() - new Date(a.fixTime).getTime())[0];
      const blockReason = getEngineStopBlockReason(position);
      if (blockReason) {
        showFeedback("error", `Bloqueio cancelado: ${blockReason}`);
        return;
      }
    }

    const confirmation = window.prompt(
      type === "engineStop"
        ? "O bloqueio remoto só deve ser usado com o veículo parado num local seguro. Digite CONFIRMAR para enviar."
        : "Este comando tenta retomar o motor bloqueado. Digite CONFIRMAR para enviar.",
    );
    if (confirmation !== "CONFIRMAR") return;

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
      if (!token || !baseUrl) {
        showFeedback("error", "A sessão ou a configuração da API está indisponível.");
        return;
      }

      const response = await fetch(`${baseUrl}/api/devices/${deviceId}/commands`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type, confirmation: "CONFIRMAR" }),
      });
      if (!response.ok) {
        showFeedback("error", await apiFailureMessage(response, "O Traccar não aceitou o comando"));
        return;
      }
      showFeedback(
        "info",
        type === "engineStop"
          ? "Pedido de bloqueio aceite pelo Traccar. Isto não confirma que o relé executou a ação; verifique o estado do veículo antes de qualquer procedimento."
          : "Pedido de retoma aceite pelo Traccar. Confirme o estado do veículo antes de o utilizar.",
      );
    } catch {
      showFeedback("error", "Falha de comunicação ao enviar o comando remoto.");
    }
  }

  async function openTrip(trip: TripReport) {
    if (!trip.valid) {
      showFeedback("error", trip.issue || "Esta viagem contém dados inválidos e não pode ser aberta.");
      return;
    }
    setSelectedTrip(trip);
    setTripRoute([]);
    setTripStops([]);
    if (!supabase) return;

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
      if (!token || !baseUrl) {
        showFeedback("error", "A sessão ou a configuração da API está indisponível.");
        return;
      }

      const params = new URLSearchParams({
        deviceId: String(trip.deviceId),
        from: new Date(trip.startTime).toISOString(),
        to: new Date(trip.endTime).toISOString(),
      });
      const [routeResponse, stopsResponse] = await Promise.all([
        fetch(`${baseUrl}/api/reports/route?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`${baseUrl}/api/reports/stops?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);

      if (!routeResponse.ok) {
        showFeedback("error", await apiFailureMessage(routeResponse, "Não foi possível carregar o trajeto"));
        return;
      }
      if (!stopsResponse.ok) {
        showFeedback("error", await apiFailureMessage(stopsResponse, "Não foi possível carregar as paragens"));
        return;
      }

      const positions = (await routeResponse.json()) as Position[];
      setTripRoute(
        positions
          .filter((position) => Number.isFinite(position.latitude) && Number.isFinite(position.longitude))
          .map((position) => [position.latitude, position.longitude]),
      );
      setTripStops((await stopsResponse.json()) as TripStop[]);
    } catch {
      setTripRoute([]);
      setTripStops([]);
      showFeedback("error", "Falha de comunicação ao carregar o trajeto da viagem.");
    }
  }

  useEffect(() => {
    if (activeSection === "trips" && sessionReady && tripPeriod !== "custom") {
      void loadTrips();
    }
  }, [activeSection, tripPeriod, selectedDeviceId, sessionReady]);

  useEffect(() => {
    if (!supabase || !sessionReady || activeSection !== "alerts") return;

    const loadAlerts = async () => {
      setAlertsLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
        if (!token || !baseUrl) {
          showFeedback("error", "A sessão ou a configuração da API está indisponível.");
          return;
        }
        const response = await fetch(`${baseUrl}/api/alerts`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) {
          setAlerts([]);
          showFeedback("error", await apiFailureMessage(response, "Não foi possível carregar os alertas"));
          return;
        }
        setAlerts((await response.json()) as FleetAlert[]);
      } catch {
        setAlerts([]);
        showFeedback("error", "Falha de comunicação ao carregar os alertas.");
      } finally {
        setAlertsLoading(false);
      }
    };

    void loadAlerts();
  }, [activeSection, sessionReady, supabase]);

  useEffect(() => {
    if (!supabase || !sessionReady || activeSection !== "users") return;

    const loadUsers = async () => {
      setUsersLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
        if (!token || !baseUrl) {
          showFeedback("error", "A sessão ou a configuração da API está indisponível.");
          return;
        }
        const response = await fetch(`${baseUrl}/api/access/users`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) {
          setFleetUsers([]);
          showFeedback("error", await apiFailureMessage(response, "Não foi possível carregar os utilizadores"));
          return;
        }
        setFleetUsers((await response.json()) as FleetUser[]);
      } catch {
        setFleetUsers([]);
        showFeedback("error", "Falha de comunicação ao carregar os utilizadores.");
      } finally {
        setUsersLoading(false);
      }
    };

    void loadUsers();
  }, [activeSection, sessionReady, supabase]);

  useEffect(() => {
    if (!supabase || !sessionReady) return;

    const loadNotifications = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
        if (!token || !baseUrl) return;
        const response = await fetch(`${baseUrl}/api/notifications`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (response.ok) {
          setNotifications((await response.json()) as NotificationEntry[]);
        }
        const channelsResponse = await fetch(`${baseUrl}/api/notifications/channels`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (channelsResponse.ok) {
          setNotificationChannels(await channelsResponse.json());
        }
      } catch {
        setNotifications([]);
      }
    };

    void loadNotifications();
    const interval = window.setInterval(loadNotifications, 15000);
    return () => window.clearInterval(interval);
  }, [sessionReady, supabase]);

  useEffect(() => {
    if (!supabase || !sessionReady || activeSection !== "geofences") return;

    const loadGeofences = async () => {
      setGeofencesLoading(true);
      setGeofenceLoadError("");
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
        if (!token || !baseUrl) {
          const message = "A sessão ou a configuração da API está indisponível.";
          setGeofenceLoadError(message);
          showFeedback("error", message);
          return;
        }
        const response = await fetch(`${baseUrl}/api/geofences`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (response.ok) setGeofences((await response.json()) as Geofence[]);
        else {
          const message = await apiFailureMessage(response, "Não foi possível carregar as geocercas");
          setGeofenceLoadError(message);
          showFeedback("error", message);
        }
      } catch {
        const message = "Falha de comunicação ao carregar as geocercas.";
        setGeofenceLoadError(message);
        showFeedback("error", message);
      } finally {
        setGeofencesLoading(false);
      }
    };
    void loadGeofences();
  }, [activeSection, sessionReady, supabase]);

  useEffect(() => {
    if (!supabase || !sessionReady || activeSection !== "audit") return;

    const loadAudit = async () => {
      setAuditLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
        if (!token || !baseUrl) {
          showFeedback("error", "A sessão ou a configuração da API está indisponível.");
          return;
        }
        const response = await fetch(`${baseUrl}/api/audit`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (response.ok) setAuditEntries((await response.json()) as AuditEntry[]);
        else {
          setAuditEntries([]);
          showFeedback("error", await apiFailureMessage(response, "Não foi possível carregar a auditoria"));
        }
      } catch {
        setAuditEntries([]);
        showFeedback("error", "Falha de comunicação ao carregar a auditoria.");
      } finally {
        setAuditLoading(false);
      }
    };
    void loadAudit();
  }, [activeSection, sessionReady, supabase]);

  const filteredDevices = devices.filter((device) => {
    const matchesSearch =
      `${device.name} ${device.uniqueId || ""} ${device.category || ""} ${device.plate || ""} ${device.brand || ""} ${device.model || ""} ${device.ownerName || ""}`
        .toLowerCase()
        .includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (vehicleStateFilter === "all") return true;

    const position = positions
      .filter((item) => item.deviceId === device.id)
      .sort((a, b) => new Date(b.fixTime).getTime() - new Date(a.fixTime).getTime())[0];
    const age = position
      ? (Date.now() - new Date(position.fixTime).getTime()) / 60000
      : null;
    if (vehicleStateFilter === "offline") {
      return !position || age === null || age < 0 || age > 10;
    }
    if (vehicleStateFilter === "moving") {
      return Boolean(position && age !== null && age >= 0 && age <= 10 && position.speed > 1);
    }
    return Boolean(position && age !== null && age >= 0 && age <= 10 && position.speed <= 1);
  });

  const selectedDevice =
    devices.find((device) => device.id === selectedDeviceId) || devices[0];

  const selectedPosition =
    positions
      .filter((position) => position.deviceId === selectedDevice?.id)
      .sort((a, b) => new Date(b.fixTime).getTime() - new Date(a.fixTime).getTime())[0];

  if (!sessionReady) {
    return (
      <main className="login-shell">
        <section className="login-brand">
          <div className="brand-logo compact">
            <img
              src="/ai-connect-logo.png"
              alt="Ai Connect"
              className="brand-logo-image"
            />
          </div>
          <p>Gestão inteligente de veículos</p>
        </section>
        <section className="login-card">
          <div>
            <p className="eyebrow">PLATAFORMA FLEET</p>
            <h1>Bem-vindo de volta</h1>
            <p className="muted">Entre para acompanhar a sua frota em tempo real.</p>
          </div>
          <form onSubmit={signIn}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nome@empresa.co.mz"
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Digite a sua senha"
                required
              />
            </label>
            {authError && <p className="form-error">{authError}</p>}
            <button className="primary-button" type="submit">
              Entrar
            </button>
          </form>
        </section>
      </main>
    );
  }

  const latitude = selectedPosition?.latitude || -25.867148888888888;
  const longitude = selectedPosition?.longitude || 32.5478;
  const speedKnots = selectedPosition?.speed ?? 0;
  const positionAgeMinutes = selectedPosition
    ? (Date.now() - new Date(selectedPosition.fixTime).getTime()) / 60000
    : null;
  const hasRecentPosition =
    positionAgeMinutes !== null && positionAgeMinutes >= 0 && positionAgeMinutes <= 10;
  const currentSpeedKmh = selectedPosition &&
      hasRecentPosition &&
      Number.isFinite(selectedPosition.speed) &&
      selectedPosition.speed >= 0
    ? knotsToKilometersPerHour(selectedPosition.speed)
    : null;
  const engineStopBlockReason = getEngineStopBlockReason(selectedPosition);
  const isMoving = hasRecentPosition && speedKnots > 1;
  const rssi = selectedPosition?.attributes?.rssi;
  const ignition = selectedPosition?.attributes?.ignition;
  const batteryLevel = selectedPosition?.attributes?.batteryLevel;
  const satellites = selectedPosition?.attributes?.sat;
  const traccarMotion = selectedPosition?.attributes?.motion;
  const totalDistance = selectedPosition?.attributes?.totalDistance;
  const totalDistanceKm =
    typeof totalDistance === "number" ? totalDistance / 1000 : null;
  const movementLabel = !selectedPosition
    ? "Sem dados"
    : !hasRecentPosition
      ? formatRelativeTime(selectedPosition.fixTime)
      : isMoving
        ? "Em movimento"
        : "Parado";
  const geofenceDraftArea = geofenceDraftMode === "circle"
    ? geofenceDraftCenter
      ? `CIRCLE (${geofenceDraftCenter[0].toFixed(6)},${geofenceDraftCenter[1].toFixed(6)},${geofenceDraftRadius})`
      : ""
    : polygonAreaWkt(geofenceDraftPoints);
  const geofenceDraftSummary = geofenceDraftMode === "circle"
    ? geofenceDraftCenter
      ? `Círculo · raio ${geofenceDraftRadius} m`
      : "Clique no mapa para definir o centro"
    : `${geofenceDraftPoints.length} ponto(s) · ${
        geofenceDraftPoints.length < 3
          ? `adicione mais ${3 - geofenceDraftPoints.length}`
          : "polígono fechado"
      }`;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head">
          <div className="brand-logo">
            <img
              src="/ai-connect-logo.png"
              alt="Ai Connect"
              className="brand-logo-image"
            />
          </div>
          <button className="icon-button close-sidebar" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <nav>
          <button
            className={`nav-item ${activeSection === "map" ? "active" : ""}`}
            onClick={() => setActiveSection("map")}
          >
            <MapPinned size={18} />Mapa
          </button>
          <button
            className={`nav-item ${activeSection === "vehicles" ? "active" : ""}`}
            onClick={() => setActiveSection("vehicles")}
          >
            <Navigation size={18} />Veículos
          </button>
          <button
            className={`nav-item ${activeSection === "trips" ? "active" : ""}`}
            onClick={() => setActiveSection("trips")}
          >
            <Activity size={18} />Viagens
          </button>
          <button
            className={`nav-item ${activeSection === "alerts" ? "active" : ""}`}
            onClick={() => setActiveSection("alerts")}
          >
            <CircleGauge size={18} />Alertas
          </button>
          <button
            className={`nav-item ${activeSection === "users" ? "active" : ""}`}
            onClick={() => setActiveSection("users")}
          >
            <Users size={18} />Utilizadores
          </button>
          <button
            className={`nav-item ${activeSection === "geofences" ? "active" : ""}`}
            onClick={() => {
              setGeofenceMapCenter([latitude, longitude]);
              setActiveSection("geofences");
            }}
          >
            <MapPinned size={18} />Geocercas
          </button>
          {(accessRoleCode === "developer" || accessRoleCode === "owner") && (
            <button
              className={`nav-item ${activeSection === "audit" ? "active" : ""}`}
              onClick={() => setActiveSection("audit")}
            >
              <ShieldCheck size={18} />Auditoria
            </button>
          )}
        </nav>
        <button className="logout-button" onClick={signOut}>
          <LogOut size={17} />Terminar sessão
        </button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="search-box">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Pesquisar por nome, matrícula, modelo ou IMEI"
            />
          </div>
          <div className="notification-wrap" ref={notificationWrapRef}>
            <button
              className="icon-button notification-button"
              onClick={() => setNotificationOpen((value) => !value)}
              aria-label="Abrir notificações"
            >
              <Bell size={18} />
              {notifications.filter((notification) => notification.status === "unread").length > 0 && (
                <span />
              )}
            </button>
            {notificationOpen && (
              <div className="notification-panel">
                <div className="notification-heading">
                  <strong>Notificações</strong>
                  <button type="button" onClick={() => void enableBrowserNotifications()}>
                    Ativar no navegador
                  </button>
                </div>
                <div className="notification-channels">
                  <span>Email: {notificationChannels.email ? "Ativo" : "Não configurado"}</span>
                  <span>WhatsApp: {notificationChannels.whatsapp ? "Ativo" : "Não configurado"}</span>
                  <InfoTip label="Sobre os canais de notificação">
                    Email e WhatsApp dependem de webhooks configurados no backend. “Ativo” indica configuração disponível, não confirmação de entrega. Notificações do navegador exigem permissão neste dispositivo.
                  </InfoTip>
                </div>
                {notifications.length === 0 ? (
                  <p className="notification-empty">Sem notificações.</p>
                ) : notifications.slice(0, 8).map((notification) => (
                  <button
                    type="button"
                    className={`notification-item ${notification.status}`}
                    key={notification.id}
                    onClick={() => void markNotificationRead(notification.id)}
                  >
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                    <small>{formatRelativeTime(notification.created_at)}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="profile-button">
            <div className="avatar">AM</div>
            <div>
              <strong>Administrador</strong>
              <span>Gestão da frota</span>
            </div>
            <ChevronDown size={15} />
          </button>
        </header>

        <section className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">CENTRO DE OPERAÇÕES</p>
              <h1>
                {activeSection === "map"
                  ? "Visão da frota"
                  : activeSection === "vehicles"
                    ? "Veículos"
                    : activeSection === "trips"
                      ? "Viagens"
                      : activeSection === "alerts"
                        ? "Alertas"
                        : activeSection === "users"
                          ? "Utilizadores"
                          : activeSection === "geofences"
                            ? "Geocercas"
                            : "Auditoria"}
              </h1>
            </div>
            <div className="live-status">
              <span className={liveConnected ? "" : "offline"} />
              {dataWarning || (liveConnected ? "Atualização ao vivo" : "Atualização por consulta")}
            </div>
          </div>

          {actionFeedback && (
            <div
              className={`action-feedback ${actionFeedback.kind}`}
              role={actionFeedback.kind === "error" ? "alert" : "status"}
              aria-live={actionFeedback.kind === "error" ? "assertive" : "polite"}
            >
              <span>{actionFeedback.message}</span>
              <button
                type="button"
                aria-label="Fechar mensagem"
                onClick={() => setActionFeedback(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {activeSection === "map" ? (
            <div className="metrics">
              <article>
                <div className="metric-icon red"><Navigation size={18} /></div>
                <div><span>Veículos</span><strong>{devices.length}</strong></div>
              </article>
              <article>
                <div className="metric-icon green"><Activity size={18} /></div>
                <div>
                  <span>Em movimento</span>
                  <strong>
                    {devices.filter((device) => {
                      const position = positions
                        .filter((item) => item.deviceId === device.id)
                        .sort((a, b) => new Date(b.fixTime).getTime() - new Date(a.fixTime).getTime())[0];
                      const age = position
                        ? (Date.now() - new Date(position.fixTime).getTime()) / 60000
                        : null;
                      return Boolean(position && age !== null && age >= 0 && age <= 10 && position.speed > 1);
                    }).length}
                  </strong>
                </div>
              </article>
              <article>
                <div className="metric-icon amber"><CircleGauge size={18} /></div>
                <div><span>Parados</span><strong>{devices.filter((device) => {
                  const position = positions
                    .filter((item) => item.deviceId === device.id)
                    .sort((a, b) => new Date(b.fixTime).getTime() - new Date(a.fixTime).getTime())[0];
                  const age = position
                    ? (Date.now() - new Date(position.fixTime).getTime()) / 60000
                    : null;
                  return Boolean(position && age !== null && age >= 0 && age <= 10 && position.speed <= 1);
                }).length}</strong></div>
              </article>
              <article>
                <div className="metric-icon navy"><ShieldCheck size={18} /></div>
                <div>
                  <span>Sem dados recentes</span>
                  <strong>{devices.filter((device) => {
                    const position = positions
                      .filter((item) => item.deviceId === device.id)
                      .sort((a, b) => new Date(b.fixTime).getTime() - new Date(a.fixTime).getTime())[0];
                    const age = position
                      ? (Date.now() - new Date(position.fixTime).getTime()) / 60000
                      : null;
                    return !position || age === null || age < 0 || age > 10;
                  }).length}</strong>
                </div>
              </article>
            </div>
          ) : activeSection === "vehicles" ? (
            <div className="metrics">
              <article>
                <div className="metric-icon red"><Navigation size={18} /></div>
                <div><span>Veículos</span><strong>{devices.length}</strong></div>
              </article>
              <article>
                <div className="metric-icon green"><ShieldCheck size={18} /></div>
                <div><span>Com matrícula</span><strong>{devices.filter((device) => Boolean(device.plate)).length}</strong></div>
              </article>
              <article>
                <div className="metric-icon amber"><Activity size={18} /></div>
                <div><span>Com proprietário</span><strong>{devices.filter((device) => Boolean(device.ownerName)).length}</strong></div>
              </article>
              <article>
                <div className="metric-icon navy"><Users size={18} /></div>
                <div><span>Sem dados fiscais</span><strong>{devices.filter((device) => !device.plate).length}</strong></div>
              </article>
            </div>
          ) : activeSection === "trips" ? (
            <div className="metrics">
              <article>
                <div className="metric-icon red"><Activity size={18} /></div>
                <div><span>Viagens</span><strong>{tripsLoading ? "Carregando" : trips.length}</strong></div>
              </article>
              <article>
                <div className="metric-icon green"><Navigation size={18} /></div>
                <div><span>Distância</span><strong>{tripSummary.distanceKm.toFixed(2)} km</strong></div>
              </article>
              <article>
                <div className="metric-icon amber"><CircleGauge size={18} /></div>
                <div>
                  <span className="metric-label">
                    Velocidade média
                    <InfoTip label="Sobre a velocidade média">
                      A média do período é calculada pela distância total dividida pela duração total das viagens válidas. As velocidades dos relatórios Traccar são convertidas de nós para km/h.
                    </InfoTip>
                  </span>
                  <strong>{tripSummary.averageSpeedKmh === null ? "—" : `${tripSummary.averageSpeedKmh.toFixed(1)} km/h`}</strong>
                </div>
              </article>
              <article>
                <div className="metric-icon navy"><ShieldCheck size={18} /></div>
                <div>
                  <span className="metric-label">
                    Velocidade máxima
                    <InfoTip label="Sobre a velocidade máxima">
                      Valor máximo informado pelo Traccar nas viagens válidas, convertido de nós para km/h.
                    </InfoTip>
                  </span>
                  <strong>{tripSummary.validCount ? `${tripSummary.maxSpeedKmh.toFixed(1)} km/h` : "—"}</strong>
                </div>
              </article>
            </div>
          ) : activeSection === "alerts" ? (
            <div className="metrics">
              <article>
                <div className="metric-icon red"><CircleGauge size={18} /></div>
                <div><span>Alertas abertos</span><strong>{alertsLoading ? "Carregando" : alerts.filter((alert) => alert.status === "open").length}</strong></div>
              </article>
              <article>
                <div className="metric-icon amber"><CircleGauge size={18} /></div>
                <div><span>Graves</span><strong>{alertsLoading ? "Carregando" : alerts.filter((alert) => alert.status === "open" && /overspeed|harsh|geofence|alarm/i.test(alert.type)).length}</strong></div>
              </article>
              <article>
                <div className="metric-icon green"><ShieldCheck size={18} /></div>
                <div><span>Reconhecidos</span><strong>{alertsLoading ? "Carregando" : alerts.filter((alert) => alert.status === "acknowledged").length}</strong></div>
              </article>
              <article>
                <div className="metric-icon navy"><ShieldCheck size={18} /></div>
                <div><span>Resolvidos</span><strong>{alertsLoading ? "Carregando" : alerts.filter((alert) => alert.status === "resolved").length}</strong></div>
              </article>
            </div>
          ) : activeSection === "users" ? (
            <div className="metrics">
              <article>
                <div className="metric-icon red"><Users size={18} /></div>
                <div><span>Utilizadores ativos</span><strong>{usersLoading ? "Carregando" : fleetUsers.filter((user) => !user.disabled).length || (accessLoaded ? 1 : 0)}</strong></div>
              </article>
              <article>
                <div className="metric-icon green"><ShieldCheck size={18} /></div>
                <div><span>Perfis disponíveis</span><strong>5</strong></div>
              </article>
              <article>
                <div className="metric-icon amber"><Navigation size={18} /></div>
                <div><span>Veículos atribuídos</span><strong>{fleetUsers.length ? new Set(fleetUsers.flatMap((user) => user.deviceIds)).size : (accessLoaded ? accessDeviceIds.length : "Carregando")}</strong></div>
              </article>
              <article>
                <div className="metric-icon navy"><Users size={18} /></div>
                <div><span>Papel atual</span><strong>{accessLoaded ? accessRole : "Carregando"}</strong></div>
              </article>
            </div>
          ) : activeSection === "geofences" ? (
            <div className="metrics">
              <article>
                <div className="metric-icon red"><MapPinned size={18} /></div>
                <div><span>Geocercas</span><strong>{geofencesLoading ? "Carregando" : geofences.length}</strong></div>
              </article>
              <article>
                <div className="metric-icon green"><ShieldCheck size={18} /></div>
                <div><span>Veículos permitidos</span><strong>{devices.length}</strong></div>
              </article>
              <article>
                <div className="metric-icon amber"><CircleGauge size={18} /></div>
                <div><span>Com alertas</span><strong>{alerts.filter((alert) => /geofence/i.test(alert.type)).length}</strong></div>
              </article>
              <article>
                <div className="metric-icon navy"><Activity size={18} /></div>
                <div><span>Estado</span><strong>Operacional</strong></div>
              </article>
            </div>
          ) : (
            <div className="metrics">
              <article>
                <div className="metric-icon red"><ShieldCheck size={18} /></div>
                <div><span>Eventos registados</span><strong>{auditLoading ? "Carregando" : auditEntries.length}</strong></div>
              </article>
              <article>
                <div className="metric-icon green"><Activity size={18} /></div>
                <div><span>Última ação</span><strong>{auditEntries[0] ? formatRelativeTime(auditEntries[0].created_at) : "Sem ações"}</strong></div>
              </article>
              <article>
                <div className="metric-icon amber"><Users size={18} /></div>
                <div><span>Responsável</span><strong>{accessLoaded ? accessRole : "Carregando"}</strong></div>
              </article>
              <article>
                <div className="metric-icon navy"><ShieldCheck size={18} /></div>
                <div><span>Retenção</span><strong>Histórico ativo</strong></div>
              </article>
            </div>
          )}

          {activeSection === "vehicles" ? (
            <div className="vehicles-layout">
              <div className="vehicles-toolbar">
                <div>
                  <strong>Frota registada</strong>
                  <span>{filteredDevices.length} veículo{filteredDevices.length === 1 ? "" : "s"} exibido{filteredDevices.length === 1 ? "" : "s"}</span>
                </div>
                {(accessRoleCode === "developer" || accessRoleCode === "owner") && (
                    <button type="button" className="add-vehicle-button" onClick={() => {
                      setVehicleFormError("");
                      setVehicleFormOpen(true);
                    }}>
                    Novo veículo
                  </button>
                )}
              </div>
              {filteredDevices.length === 0 ? (
                <div className="section-placeholder">
                  <Navigation size={28} />
                  <h2>Sem veículos</h2>
                  <p>Nenhum veículo corresponde ao filtro atual.</p>
                </div>
              ) : (
                <div className="vehicle-table">
                  {filteredDevices.map((device) => (
                    <article className="vehicle-row" key={device.id}>
                      <div className="vehicle-row-icon">
                        <VehicleTypeIcon type={getVehicleType(device)} />
                      </div>
                      <div className="vehicle-row-main">
                        <strong>{device.name}</strong>
                        <span>{device.plate || "Matrícula não definida"}</span>
                      </div>
                      <div className="vehicle-row-field">
                        <span>Marca / modelo</span>
                        <strong>{[device.brand, device.model].filter(Boolean).join(" ") || "Não definido"}</strong>
                      </div>
                      <div className="vehicle-row-field">
                        <span>IMEI</span>
                        <strong>{device.imei || device.uniqueId || "Não disponível"}</strong>
                      </div>
                      <div className="vehicle-row-field">
                        <span>Proprietário</span>
                        <strong>{device.ownerName || "Não definido"}</strong>
                      </div>
                      {(accessRoleCode === "developer" || accessRoleCode === "owner") && (
                        <div className="vehicle-row-actions">
                          <button type="button" className="danger" onClick={() => {
                            void sendRemoteCommand("engineStop", device.id);
                          }}>
                            Bloquear
                          </button>
                          <button type="button" onClick={() => {
                            void sendRemoteCommand("engineResume", device.id);
                          }}>
                            Retomar
                          </button>
                          <button type="button" onClick={() => {
                            setVehicleEditError("");
                            setEditingVehicle(device);
                          }}>Editar</button>
                          <button type="button" className="danger" onClick={() => void deleteVehicle(device.id)}>Eliminar</button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : activeSection === "trips" ? (
            <div className="trips-layout">
              <aside className="trips-filters">
                <div className="period-tabs">
                  <button
                    className={tripPeriod === "today" ? "active" : ""}
                    onClick={() => setTripPeriod("today")}
                  >
                    Hoje
                  </button>
                  <button
                    className={tripPeriod === "week" ? "active" : ""}
                    onClick={() => setTripPeriod("week")}
                  >
                    7 dias
                  </button>
                  <button
                    className={tripPeriod === "custom" ? "active" : ""}
                    onClick={() => setTripPeriod("custom")}
                  >
                    Personalizado
                  </button>
                </div>

                {tripPeriod === "custom" && (
                  <div className="custom-period">
                    <label>
                      De
                      <input
                        type="date"
                        value={customFrom}
                        onChange={(event) => setCustomFrom(event.target.value)}
                      />
                    </label>
                    <label>
                      Até
                      <input
                        type="date"
                        value={customTo}
                        onChange={(event) => setCustomTo(event.target.value)}
                      />
                    </label>
                    <button type="button" className="apply-period" onClick={() => void loadTrips()}>
                      Aplicar período
                    </button>
                  </div>
                )}

                <div className="trip-list">
                  {tripsLoading && <p className="trip-empty">Carregando viagens…</p>}
                  {!tripsLoading && trips.length === 0 && (
                    <p className="trip-empty">Sem viagens neste período</p>
                  )}
                  {!tripsLoading && tripSummary.invalidCount > 0 && (
                    <p className="trip-data-warning" role="status">
                      {tripSummary.invalidCount} viagem(ns) com dados inconsistentes foram excluídas dos totais.
                    </p>
                  )}
                  {!tripsLoading &&
                    trips.map((trip, index) => {
                      const time = new Date(trip.startTime);
                      const timeLabel = Number.isFinite(time.getTime())
                        ? new Intl.DateTimeFormat("pt-MZ", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(time)
                        : "Hora indisponível";
                      if (!trip.valid) {
                        return (
                          <article
                            key={`${trip.deviceId}-${trip.startTime}-${index}`}
                            className="trip-item trip-item-invalid"
                            aria-label="Viagem com dados inconsistentes"
                          >
                            <strong>{timeLabel}</strong>
                            <span>Dados inválidos</span>
                            <small>{trip.issue}</small>
                          </article>
                        );
                      }
                      return (
                        <button
                          type="button"
                          key={`${trip.deviceId}-${trip.startTime}-${index}`}
                          className={`trip-item ${selectedTrip === trip ? "selected" : ""}`}
                          onClick={() => void openTrip(trip)}
                        >
                          <strong>{timeLabel}</strong>
                          <span>{((trip.distanceMeters ?? 0) / 1000).toFixed(2)} km</span>
                          <small>
                            Média {trip.averageSpeedKmh?.toFixed(1) ?? "—"} km/h · Máx.{" "}
                            {trip.maxSpeedKmh?.toFixed(1) ?? "—"} km/h
                          </small>
                        </button>
                      );
                    })}
                </div>
              </aside>

              <section className="trip-map-panel">
                {selectedTrip ? (
                  <div className="selected-trip-details">
                    <div>
                      <span>Início</span>
                      <strong>{new Date(selectedTrip.startTime).toLocaleString("pt-MZ")}</strong>
                    </div>
                    <div>
                      <span>Fim</span>
                      <strong>{new Date(selectedTrip.endTime).toLocaleString("pt-MZ")}</strong>
                    </div>
                    <div>
                      <span>Distância</span>
                      <strong>{((selectedTrip.distanceMeters ?? 0) / 1000).toFixed(2)} km</strong>
                    </div>
                    <div>
                      <span>Velocidade média</span>
                      <strong>{selectedTrip.averageSpeedKmh?.toFixed(1) ?? "—"} km/h</strong>
                    </div>
                    <div>
                      <span>Velocidade máxima</span>
                      <strong>{selectedTrip.maxSpeedKmh?.toFixed(1) ?? "—"} km/h</strong>
                    </div>
                    <div>
                      <span>Paragens</span>
                      <strong>{tripStops.length}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="trip-map-placeholder">
                    Selecione uma viagem para ver o trajeto no mapa
                  </div>
                )}
                {selectedTrip && tripStops.length > 0 && (
                  <div className="trip-stops-list">
                    {tripStops.map((stop, index) => {
                      const durationMinutes =
                        stop.duration !== undefined
                          ? Math.max(0, Math.round(stop.duration / 60000))
                          : Math.max(
                              0,
                              Math.round(
                                (new Date(stop.endTime).getTime() -
                                  new Date(stop.startTime).getTime()) /
                                  60000,
                              ),
                            );
                      return (
                        <article key={`${stop.startTime}-${index}`}>
                          <strong>Paragem {index + 1}</strong>
                          <span>
                            {new Date(stop.startTime).toLocaleTimeString("pt-MZ", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {" — "}
                            {durationMinutes} min
                          </span>
                        </article>
                      );
                    })}
                  </div>
                )}
                <TrackerMap
                  latitude={selectedPosition?.latitude || latitude}
                  longitude={selectedPosition?.longitude || longitude}
                  name={selectedTrip ? selectedDevice?.name || "Veículo" : "Viagem"}
                  route={tripRoute}
                  course={selectedPosition?.course}
                  state={isMoving ? "moving" : "static"}
                />
              </section>
            </div>
          ) : activeSection === "alerts" ? (
            <div className="alert-layout">
              {alertsLoading ? (
                <div className="section-placeholder"><p>Carregando alertas…</p></div>
              ) : alerts.length === 0 ? (
                <div className="section-placeholder">
                  <CircleGauge size={28} />
                  <h2>Sem alertas</h2>
                  <p>Não existem eventos registados para os veículos permitidos.</p>
                </div>
              ) : (
                <div className="alert-list">
                  {alerts.map((alert) => {
                    const device = devices.find((item) => item.id === alert.device_id);
                    return (
                      <article className="alert-card" key={alert.event_id}>
                        <div className="alert-main">
                          <strong>{alert.type}</strong>
                          <span>{device?.name || `Veículo ${alert.device_id}`}</span>
                          <small>{new Date(alert.event_time).toLocaleString("pt-MZ")}</small>
                        </div>
                        <span className={`alert-status ${alert.status}`}>
                          {alert.status === "open"
                            ? "Aberto"
                            : alert.status === "acknowledged"
                              ? "Reconhecido"
                              : "Resolvido"}
                        </span>
                        {(accessRoleCode === "developer" ||
                          accessRoleCode === "owner" ||
                          accessRoleCode === "manager") && (
                          <div className="alert-actions">
                            {alert.status === "open" && (
                              <button onClick={() => void updateAlertStatus(alert.event_id, "acknowledged")}>
                                Reconhecer
                              </button>
                            )}
                            {alert.status !== "resolved" && (
                              <button onClick={() => void updateAlertStatus(alert.event_id, "resolved")}>
                                Resolver
                              </button>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          ) : activeSection === "users" ? (
            <div className="users-layout">
              {(accessRoleCode === "developer" || accessRoleCode === "owner") && (
                <div className="users-toolbar">
                  <div>
                    <strong>Gestão de acessos</strong>
                    <span>Crie contas e limite os veículos visíveis por utilizador.</span>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      setUserCreateError("");
                      setUserCreateDeviceIds([]);
                      setUserCreateOpen(true);
                    }}
                  >
                    Novo utilizador
                  </button>
                </div>
              )}
              {usersLoading ? (
                <div className="section-placeholder"><p>Carregando utilizadores…</p></div>
              ) : fleetUsers.length === 0 ? (
                <div className="section-placeholder">
                  <Users size={28} />
                  <h2>{accessRoleCode === "developer" || accessRoleCode === "owner" ? "Sem utilizadores" : "Utilizadores"}</h2>
                  <p>
                    {accessRoleCode === "developer" || accessRoleCode === "owner"
                      ? "Ainda não existem contas para apresentar."
                      : `Perfil atual: ${accessLoaded ? accessRole : "Carregando"}. A listagem completa está disponível para developer e owner.`}
                  </p>
                </div>
              ) : (
                <div className="user-list">
                  {fleetUsers.map((user) => (
                    <article className="user-card" key={user.id}>
                      <div className="user-avatar">
                        {(user.displayName || user.email || "U").charAt(0).toUpperCase()}
                      </div>
                      <div className="user-main">
                        <strong>{user.displayName || user.email || "Utilizador"}</strong>
                        <span>{user.email || "Email indisponível"}</span>
                      </div>
                      <span className="user-role">{getRoleLabel(user.role)}</span>
                      <span className="user-device-count">
                        {user.role === "developer" || user.role === "owner"
                          ? "Frota completa"
                          : `${user.deviceIds.length} veículo${user.deviceIds.length === 1 ? "" : "s"}`}
                      </span>
                      <span className={user.disabled ? "user-state disabled" : "user-state"}>
                        {user.disabled ? "Desativado" : "Ativo"}
                      </span>
                      {(accessRoleCode === "developer" || accessRoleCode === "owner") && (
                        <button
                          type="button"
                          className="edit-user-button"
                          onClick={() => {
                            setUserEditError("");
                            setEditingUser(user);
                          }}
                        >
                          Editar
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : activeSection === "geofences" ? (
            <div className="geofence-layout">
              {(accessRoleCode === "developer" || accessRoleCode === "owner") && (
                <form className="geofence-form" onSubmit={saveGeofence}>
                  <label>
                    Nome
                    <input name="name" required minLength={2} placeholder="Ex.: Depósito central" />
                  </label>
                  <div className="geofence-mode-switch" role="group" aria-label="Tipo de área">
                    <button
                      type="button"
                      className={geofenceDraftMode === "circle" ? "active" : ""}
                      onClick={() => {
                        setGeofenceDraftMode("circle");
                        setGeofenceDraftCenter(null);
                        setGeofenceDraftPoints([]);
                      }}
                    >
                      Círculo
                    </button>
                    <button
                      type="button"
                      className={geofenceDraftMode === "polygon" ? "active" : ""}
                      onClick={() => {
                        setGeofenceDraftMode("polygon");
                        setGeofenceDraftCenter(null);
                        setGeofenceDraftPoints([]);
                      }}
                    >
                      Polígono
                    </button>
                  </div>
                  <label className="geofence-area-field">
                    <span>
                      Área
                      <InfoTip label="Como definir a área">
                        No modo círculo, clique no mapa para marcar o centro e defina o raio. No modo polígono, clique em pelo menos três pontos para desenhar o perímetro; use Desfazer para remover o último ponto.
                      </InfoTip>
                    </span>
                    <input
                      value={geofenceDraftSummary}
                      readOnly
                    />
                    <input type="hidden" name="area" value={geofenceDraftArea} />
                  </label>
                  <label>
                    <span>
                      Veículos (IDs Traccar)
                      <InfoTip label="Atribuição de veículos">
                        A geocerca só gera eventos para os veículos atribuídos. O ID do veículo selecionado é preenchido automaticamente; pode indicar vários IDs separados por vírgulas.
                      </InfoTip>
                    </span>
                    <input
                      name="deviceIds"
                      required
                      defaultValue={selectedDevice?.id || ""}
                      placeholder="Ex.: 1,2"
                    />
                  </label>
                  {geofenceDraftMode === "circle" ? (
                    <label>
                      Raio (metros)
                      <input
                        type="number"
                        min={50}
                        max={50000}
                        value={geofenceDraftRadius}
                        onChange={(event) => setGeofenceDraftRadius(
                          Math.min(50000, Math.max(50, Number(event.target.value) || 50)),
                        )}
                      />
                    </label>
                  ) : (
                    <div className="geofence-draw-actions">
                      <span>
                        {geofenceDraftPoints.length < 3
                          ? `Adicione ${3 - geofenceDraftPoints.length} ponto(s) para fechar a área`
                          : `${geofenceDraftPoints.length} pontos adicionados`}
                      </span>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!geofenceDraftPoints.length}
                        onClick={() => setGeofenceDraftPoints((current) => current.slice(0, -1))}
                      >
                        <Undo2 size={15} /> Desfazer
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!geofenceDraftPoints.length}
                        onClick={() => setGeofenceDraftPoints([])}
                      >
                        <X size={15} /> Limpar
                      </button>
                    </div>
                  )}
                  <label className="geofence-description">
                    Descrição
                    <input name="description" placeholder="Descrição opcional" />
                  </label>
                  <button type="submit" className="primary-button" disabled={!geofenceDraftArea}>
                    Criar geocerca
                  </button>
                </form>
              )}
              <div className="geofence-map-wrap">
                <TrackerMap
                  latitude={geofenceDraftMode === "circle" && geofenceDraftCenter
                    ? geofenceDraftCenter[0]
                    : geofenceMapCenter?.[0] ?? latitude}
                  longitude={geofenceDraftMode === "circle" && geofenceDraftCenter
                    ? geofenceDraftCenter[1]
                    : geofenceMapCenter?.[1] ?? longitude}
                  name="Mapa de geocercas"
                  state="static"
                  showVehicleMarker={false}
                  route={geofenceDraftMode === "polygon" ? geofenceDraftPoints : []}
                  draftPoints={geofenceDraftMode === "polygon" ? geofenceDraftPoints : []}
                  geofenceAreas={[
                    ...geofences.map((geofence) => geofence.area),
                    ...(geofenceDraftArea ? [geofenceDraftArea] : []),
                  ]}
                  onMapClick={accessRoleCode === "developer" || accessRoleCode === "owner"
                    ? (clickedLatitude, clickedLongitude) => {
                        if (geofenceDraftMode === "circle") {
                          setGeofenceDraftCenter([clickedLatitude, clickedLongitude]);
                          setGeofenceMapCenter([clickedLatitude, clickedLongitude]);
                        } else {
                          setGeofenceDraftPoints((current) => [
                            ...current,
                            [clickedLatitude, clickedLongitude],
                          ]);
                        }
                      }
                    : undefined}
                />
              </div>
              <div className="geofence-list">
                {geofencesLoading ? (
                  <p className="trip-empty">Carregando geocercas…</p>
                ) : geofenceLoadError ? (
                  <div className="section-placeholder">
                    <MapPinned size={28} />
                    <h2>Falha ao carregar</h2>
                    <p>{geofenceLoadError}</p>
                  </div>
                ) : geofences.length === 0 ? (
                  <div className="section-placeholder">
                    <MapPinned size={28} />
                    <h2>Sem geocercas</h2>
                    <p>Nenhuma área foi criada no Traccar.</p>
                  </div>
                ) : geofences.map((geofence) => (
                  <article className="geofence-card" key={geofence.id}>
                    <div>
                      <strong>{geofence.name}</strong>
                      <span>{geofence.description || "Sem descrição"}</span>
                      <small>{geofence.area}</small>
                    </div>
                    {(accessRoleCode === "developer" || accessRoleCode === "owner") && (
                      <button type="button" onClick={() => void deleteGeofence(geofence.id)}>
                        Eliminar
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </div>
          ) : activeSection === "audit" ? (
            <div className="audit-layout">
              {auditLoading ? (
                <div className="section-placeholder"><p>Carregando auditoria…</p></div>
              ) : auditEntries.length === 0 ? (
                <div className="section-placeholder">
                  <ShieldCheck size={28} />
                  <h2>Sem ações registadas</h2>
                  <p>A auditoria aparecerá após ações administrativas.</p>
                </div>
              ) : (
                <div className="audit-list">
                  {auditEntries.map((entry) => (
                    <article className="audit-card" key={entry.id}>
                      <div className="audit-icon"><ShieldCheck size={17} /></div>
                      <div className="audit-main">
                        <strong>{entry.action}</strong>
                        <span>{entry.entity_type}{entry.entity_id ? ` · ${entry.entity_id}` : ""}</span>
                      </div>
                      <time>{new Date(entry.created_at).toLocaleString("pt-MZ")}</time>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : (
          <div className="dashboard-grid">
            <section className="map-panel">
              <div className="panel-heading">
                <div>
                  <p>Localização em tempo real</p>
                  <h2>{selectedDevice?.name || "Nenhum veículo"}</h2>
                </div>
                <span
                  className={
                    !selectedPosition
                      ? "status unknown"
                      : !hasRecentPosition
                        ? "status unknown"
                        : isMoving
                          ? "status moving"
                          : "status parked"
                  }
                >
                  {movementLabel}
                </span>
              </div>
              <TrackerMap
                latitude={latitude}
                longitude={longitude}
                name={selectedDevice?.name || "Veículo"}
                route={tripRoute}
                course={selectedPosition?.course}
                state={
                  !selectedPosition || !hasRecentPosition
                    ? "offline"
                    : isMoving
                      ? "moving"
                      : "static"
                }
              />
            </section>

            <aside className="fleet-panel">
              <div className="panel-heading compact-heading">
                <div>
                  <p>Minha frota</p>
                  <h2>
                    {filteredDevices.length} veículo{filteredDevices.length === 1 ? "" : "s"}
                  </h2>
                </div>
                <div className="fleet-actions">
                  <button
                    type="button"
                    className="fleet-collapse"
                    aria-label={fleetCollapsed ? "Expandir frota" : "Recolher frota"}
                    onClick={() => setFleetCollapsed((value) => !value)}
                  >
                    <ChevronDown
                      size={16}
                      className={fleetCollapsed ? "collapsed" : ""}
                    />
                  </button>
                </div>
              </div>
              {!fleetCollapsed && (
              <>
              <div className="fleet-filters">
                <select
                  value={vehicleStateFilter}
                  onChange={(event) =>
                    setVehicleStateFilter(
                      event.target.value as "all" | "moving" | "parked" | "offline",
                    )
                  }
                  aria-label="Filtrar veículos por estado"
                >
                  <option value="all">Todos os estados</option>
                  <option value="moving">Em movimento</option>
                  <option value="parked">Parados</option>
                  <option value="offline">Sem dados recentes</option>
                </select>
              </div>
              <div className="device-list">
                {filteredDevices.length === 0 && (
                  <p className="trip-empty">Nenhum veículo corresponde ao filtro.</p>
                )}
                {filteredDevices.map((device) => (
                  (() => {
                    const position = positions
                      .filter((item) => item.deviceId === device.id)
                      .sort((a, b) => new Date(b.fixTime).getTime() - new Date(a.fixTime).getTime())[0];
                    const age = position
                      ? (Date.now() - new Date(position.fixTime).getTime()) / 60000
                      : null;
                    const deviceRecent = Boolean(position && age !== null && age >= 0 && age <= 10);
                    const deviceMoving = Boolean(deviceRecent && position && position.speed > 1);
                    const deviceSpeedKmh = deviceRecent && position &&
                        Number.isFinite(position.speed) && position.speed >= 0
                      ? knotsToKilometersPerHour(position.speed)
                      : null;
                    const stateClass = deviceRecent
                      ? deviceMoving ? "state-moving" : "state-static"
                      : "state-offline";
                    const stateLabel = deviceRecent
                      ? deviceMoving ? "Em movimento" : "Parado"
                      : position
                        ? formatRelativeTime(position.fixTime)
                        : "Sem dados recentes";

                    return (
                      <button
                        className={`device-card ${selectedDevice?.id === device.id ? "selected" : ""} ${stateClass}`}
                        key={device.id}
                        onClick={() => setSelectedDeviceId(device.id)}
                      >
                        <div className="device-icon">
                          <VehicleTypeIcon type={getVehicleType(device)} size={17} />
                        </div>
                        <div>
                          <strong>{device.name}</strong>
                          <span>{stateLabel}</span>
                        </div>
                        <div className="device-speed">
                          <span
                            className="device-speed-value"
                            title={
                              deviceSpeedKmh === null
                                ? "Velocidade indisponível: sem posição GPS ou com mais de 10 minutos."
                                : "Velocidade GPS atual"
                            }
                          >
                            {deviceSpeedKmh === null
                              ? "— km/h"
                              : `${deviceSpeedKmh.toFixed(1)} km/h`}
                          </span>
                          <small>
                            {position
                              ? `GPS · ${formatRelativeTime(position.fixTime)}`
                              : "Sem posição GPS"}
                          </small>
                        </div>
                      </button>
                    );
                  })()
                ))}
              </div>
              </>
              )}
              {!fleetCollapsed && selectedDevice && (
                <div className="device-details">
                  <div>
                    <span>
                      Velocidade GPS
                      <InfoTip label="Sobre a velocidade em tempo real">
                        Velocidade informada pelo rastreador ao Traccar, convertida de nós para km/h. Só é apresentada como atual quando a posição tem até 10 minutos; não é uma leitura OBD do painel do veículo.
                      </InfoTip>
                    </span>
                    <strong>
                      {currentSpeedKmh === null
                        ? "Não disponível"
                        : `${currentSpeedKmh.toFixed(1)} km/h`}
                    </strong>
                    <small>
                      {selectedPosition
                        ? `Última posição: ${formatRelativeTime(selectedPosition.fixTime)}`
                        : "Sem posição GPS"}
                    </small>
                  </div>
                  <div>
                    <span>Sinal</span>
                    <strong>{typeof rssi === "number" ? String(rssi) : "Não disponível"}</strong>
                  </div>
                  <div>
                    <span>Ignição</span>
                    <strong>
                      {typeof ignition === "boolean"
                        ? ignition ? "Ligada" : "Desligada"
                        : "Não disponível"}
                    </strong>
                  </div>
                  <div>
                    <span>Bateria</span>
                    <strong>
                      {typeof batteryLevel === "number"
                        ? `${batteryLevel}%`
                        : "Não disponível"}
                    </strong>
                  </div>
                  <div>
                    <span>Satélites</span>
                    <strong>{typeof satellites === "number" ? String(satellites) : "Não disponível"}</strong>
                  </div>
                  <div>
                    <span>Movimento Traccar</span>
                    <strong>
                      {typeof traccarMotion === "boolean"
                        ? traccarMotion ? "Em movimento" : "Parado"
                        : "Não disponível"}
                    </strong>
                  </div>
                  <div>
                    <span>Distância total</span>
                    <strong>
                      {totalDistanceKm !== null
                        ? `${totalDistanceKm.toFixed(2)} km`
                        : "Não disponível"}
                    </strong>
                  </div>
                  <div>
                    <span>Matrícula</span>
                    <strong>{selectedDevice?.plate || "Não definida"}</strong>
                  </div>
                  <div>
                    <span>Marca / modelo</span>
                    <strong>
                      {[selectedDevice?.brand, selectedDevice?.model].filter(Boolean).join(" ") || "Não definido"}
                    </strong>
                  </div>
                </div>
              )}
              {!fleetCollapsed && selectedDevice && (accessRoleCode === "developer" || accessRoleCode === "owner") && (
                <div className="vehicle-admin-actions sidebar-vehicle-actions">
                  <div className={`engine-stop-status ${engineStopBlockReason ? "blocked" : "ready"}`}>
                    <span>
                      {engineStopBlockReason
                        ? `Bloqueio indisponível: ${engineStopBlockReason}`
                        : "Critérios GPS atendidos — confirme a segurança no local."}
                    </span>
                    <InfoTip label="Por que o bloqueio pode estar indisponível">
                      O bloqueio remoto só fica disponível com posição GPS dos últimos 10 minutos, velocidade até 0,5 nós (cerca de 0,9 km/h) e sem movimento indicado. Uma posição antiga não confirma que o veículo continua parado; bloquear o motor durante a marcha pode causar perigo. Mesmo com o pedido aceite pelo Traccar, a execução do relé não é garantida.
                    </InfoTip>
                  </div>
                  <button
                    type="button"
                    className="danger"
                    disabled={Boolean(engineStopBlockReason)}
                    title={engineStopBlockReason || "A última posição GPS indica que o veículo está parado."}
                    onClick={() => void sendRemoteCommand("engineStop", selectedDevice.id)}
                  >
                    Bloquear motor
                  </button>
                  <button type="button" onClick={() => void sendRemoteCommand("engineResume", selectedDevice.id)}>
                    Retomar motor
                  </button>
                  <button type="button" onClick={() => {
                    setVehicleEditError("");
                    setEditingVehicle(selectedDevice);
                  }}>
                    Editar veículo
                  </button>
                  <button type="button" className="danger" onClick={() => void deleteVehicle(selectedDevice.id)}>
                    Eliminar
                  </button>
                </div>
              )}
            </aside>
          </div>
          )}
        </section>
      </main>
      {vehicleFormOpen && (
        <div className="vehicle-modal-backdrop" role="presentation">
          <section className="vehicle-modal" role="dialog" aria-modal="true" aria-label="Cadastrar veículo">
            <div className="vehicle-modal-heading">
              <div>
                <p className="eyebrow">CADASTRO DA FROTA</p>
                <h2>Novo veículo</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setVehicleFormOpen(false)}
                aria-label="Fechar formulário"
              >
                <X size={18} />
              </button>
            </div>
            <form className="vehicle-form" onSubmit={saveVehicle}>
              <label>Nome*<input name="name" required minLength={2} placeholder="Ex.: Veículo executivo" /></label>
              <label>Matrícula<input name="plate" placeholder="Ex.: BAA-123-MC" /></label>
              <label>Marca<input name="brand" placeholder="Ex.: Toyota" /></label>
              <label>Modelo<input name="model" placeholder="Ex.: Hilux" /></label>
              <label>Ano<input name="year" type="number" min={1900} max={2100} placeholder="2026" /></label>
              <VehicleTypeSelect />
              <label>IMEI*<input name="imei" required minLength={8} placeholder="Número único do rastreador" /></label>
              <label>Cliente / proprietário<input name="ownerName" placeholder="Nome do cliente ou proprietário" /></label>
              <label>Cor<input name="color" placeholder="Ex.: Branco" /></label>
              <label className="vehicle-photo-field">Foto (URL opcional)<input name="photoUrl" type="url" placeholder="https://..." /></label>
              {vehicleFormError && <p className="form-error">{vehicleFormError}</p>}
              <div className="vehicle-form-actions">
                <button type="button" className="secondary-button" onClick={() => setVehicleFormOpen(false)}>Cancelar</button>
                <button type="submit" className="primary-button" disabled={vehicleFormSaving}>
                  {vehicleFormSaving ? "Cadastrando…" : "Cadastrar veículo"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {editingVehicle && (
        <div className="vehicle-modal-backdrop" role="presentation">
          <section className="vehicle-modal" role="dialog" aria-modal="true" aria-label="Editar veículo">
            <div className="vehicle-modal-heading">
              <div>
                <p className="eyebrow">GESTÃO DA FROTA</p>
                <h2>Editar veículo</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setEditingVehicle(null)}
                aria-label="Fechar edição"
              >
                <X size={18} />
              </button>
            </div>
            <form className="vehicle-form" onSubmit={updateVehicle}>
              <label>Nome*<input name="name" required defaultValue={editingVehicle.name} /></label>
              <label>Matrícula<input name="plate" defaultValue={editingVehicle.plate || ""} /></label>
              <label>Marca<input name="brand" defaultValue={editingVehicle.brand || ""} /></label>
              <label>Modelo<input name="model" defaultValue={editingVehicle.model || ""} /></label>
              <label>Ano<input name="year" type="number" min={1900} max={2100} defaultValue={editingVehicle.year || ""} /></label>
              <VehicleTypeSelect
                key={editingVehicle.id}
                defaultValue={getVehicleType(editingVehicle)}
              />
              <label>IMEI*<input name="imei" required minLength={8} defaultValue={editingVehicle.imei || editingVehicle.uniqueId || ""} /></label>
              <label>Cliente / proprietário<input name="ownerName" defaultValue={editingVehicle.ownerName || ""} /></label>
              <label>Cor<input name="color" defaultValue={editingVehicle.color || ""} /></label>
              <label className="vehicle-photo-field">Foto (URL opcional)<input name="photoUrl" type="url" defaultValue={editingVehicle.photoUrl || ""} /></label>
              {vehicleEditError && <p className="form-error">{vehicleEditError}</p>}
              <div className="vehicle-form-actions">
                <button type="button" className="secondary-button" onClick={() => setEditingVehicle(null)}>
                  Cancelar
                </button>
                <button type="submit" className="primary-button">
                  Guardar alterações
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {editingUser && (
        <div className="vehicle-modal-backdrop" role="presentation">
          <section className="vehicle-modal user-edit-modal" role="dialog" aria-modal="true" aria-label="Editar utilizador">
            <div className="vehicle-modal-heading">
              <div>
                <p className="eyebrow">GESTÃO DE ACESSOS</p>
                <h2>Editar utilizador</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setEditingUser(null)}
                aria-label="Fechar edição"
              >
                <X size={18} />
              </button>
            </div>
            <form className="vehicle-form" onSubmit={updateUser}>
              <label>
                Nome
                <input name="displayName" required defaultValue={editingUser.displayName || ""} />
              </label>
              <label>
                Papel
                <select name="role" defaultValue={editingUser.role}>
                  <option value="owner">Owner</option>
                  <option value="manager">Gestor</option>
                  <option value="dispatcher">Operador</option>
                  <option value="viewer">Visualizador</option>
                </select>
              </label>
              <label>
                Estado
                <select name="disabled" defaultValue={editingUser.disabled ? "true" : "false"}>
                  <option value="false">Ativo</option>
                  <option value="true">Desativado</option>
                </select>
              </label>
              <fieldset className="user-device-picker">
                <legend>
                  Veículos atribuídos
                  <InfoTip label="Sobre veículos atribuídos">
                    Sem veículos selecionados, o utilizador não terá acesso a veículos. O papel owner tem acesso à frota completa, independentemente desta seleção.
                  </InfoTip>
                </legend>
                {devices.length === 0 ? (
                  <p className="user-device-empty">Não há veículos disponíveis para atribuir.</p>
                ) : (
                  <div className="user-device-options">
                    {devices.map((device) => (
                      <label className="user-device-option" key={device.id}>
                        <input
                          type="checkbox"
                          name="deviceIds"
                          value={device.id}
                          defaultChecked={editingUser.deviceIds.includes(device.id)}
                        />
                        <span>
                          <strong>{device.name}</strong>
                          {device.plate && <small>{device.plate}</small>}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              {userEditError && <p className="form-error">{userEditError}</p>}
              <div className="vehicle-form-actions">
                <button type="button" className="secondary-button" onClick={() => setEditingUser(null)}>
                  Cancelar
                </button>
                <button type="submit" className="primary-button">
                  Guardar alterações
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {userCreateOpen && (
        <div className="vehicle-modal-backdrop" role="presentation">
          <section className="vehicle-modal user-create-modal" role="dialog" aria-modal="true" aria-label="Criar utilizador">
            <div className="vehicle-modal-heading">
              <div>
                <p className="eyebrow">GESTÃO DE ACESSOS</p>
                <h2>Novo utilizador</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setUserCreateOpen(false);
                  setUserCreateError("");
                  setUserCreateDeviceIds([]);
                }}
                aria-label="Fechar criação de utilizador"
              >
                <X size={18} />
              </button>
            </div>
            <form className="vehicle-form" onSubmit={createUser}>
              <label>
                Nome
                <input name="displayName" required minLength={2} maxLength={100} autoComplete="name" />
              </label>
              <label>
                Email
                <input name="email" type="email" required autoComplete="email" />
              </label>
              <label>
                Papel
                <span className="user-role-control">
                  <select name="role" defaultValue="viewer">
                    <option value="owner">Administrador (owner)</option>
                    <option value="manager">Gestor</option>
                    <option value="dispatcher">Operador</option>
                    <option value="viewer">Visualizador</option>
                  </select>
                  <InfoTip label="Sobre os papéis">
                    Owner pode gerir toda a frota. Gestor, operador e visualizador só veem os veículos atribuídos; as permissões são verificadas também no servidor.
                  </InfoTip>
                </span>
              </label>
              <label>
                Senha inicial
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Confirmar senha
                <input
                  name="passwordConfirmation"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <fieldset className="user-device-picker">
                <legend>
                  Veículos atribuídos
                  <InfoTip label="Sobre veículos atribuídos">
                    Sem veículos selecionados, o utilizador não terá acesso a veículos. O papel owner tem acesso à frota completa, independentemente desta seleção.
                  </InfoTip>
                </legend>
                {devices.length === 0 ? (
                  <p className="user-device-empty">Não há veículos disponíveis para atribuir.</p>
                ) : (
                  <div className="user-device-options">
                    {devices.map((device) => (
                      <label className="user-device-option" key={device.id}>
                        <input
                          type="checkbox"
                          name="deviceIds"
                          value={device.id}
                          checked={userCreateDeviceIds.includes(device.id)}
                          onChange={(event) => {
                            setUserCreateDeviceIds((current) =>
                              event.target.checked
                                ? [...current, device.id]
                                : current.filter((id) => id !== device.id),
                            );
                          }}
                        />
                        <span>
                          <strong>{device.name}</strong>
                          {device.plate && <small>{device.plate}</small>}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <p className="user-password-notice">
                A conta será ativada imediatamente e não será enviado convite por email. Entregue a senha inicial por um canal seguro.
              </p>
              {userCreateError && <p className="form-error">{userCreateError}</p>}
              <div className="vehicle-form-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setUserCreateOpen(false);
                    setUserCreateError("");
                    setUserCreateDeviceIds([]);
                  }}
                  disabled={userCreateSaving}
                >
                  Cancelar
                </button>
                <button type="submit" className="primary-button" disabled={userCreateSaving}>
                  {userCreateSaving ? "Criando…" : "Criar utilizador"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
