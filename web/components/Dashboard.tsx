"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  ChevronDown,
  CircleGauge,
  LogOut,
  MapPinned,
  Menu,
  Navigation,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { browserSupabase } from "../lib/supabase";

const TrackerMap = dynamic(() => import("./TrackerMap"), { ssr: false });

type Device = {
  id: number;
  name: string;
  status?: string;
  lastUpdate?: string;
  uniqueId?: string;
};

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

  useEffect(() => {
    if (!supabase) {
      setSessionReady(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSessionReady(Boolean(data.session)));
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !sessionReady) return;

    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;

      const baseUrl = process.env.NEXT_PUBLIC_FLEET_API_URL;
      if (!baseUrl) return;

      const headers = { Authorization: `Bearer ${token}` };
      const [deviceResponse, positionResponse] = await Promise.all([
        fetch(`${baseUrl}/api/devices`, { headers, cache: "no-store" }),
        fetch(`${baseUrl}/api/positions`, { headers, cache: "no-store" }),
      ]);

      if (!deviceResponse.ok || !positionResponse.ok) return;

      const deviceList = (await deviceResponse.json()) as Device[];
      const positionList = (await positionResponse.json()) as Position[];
      setDevices(deviceList);
      setPositions(positionList);
      setSelectedDeviceId((current) => current || deviceList[0]?.id);
    };

    void load();
    const interval = window.setInterval(load, 10000);
    return () => window.clearInterval(interval);
  }, [sessionReady, supabase]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) {
      setAuthError("Configuracao Supabase em falta.");
      return;
    }
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError("Email ou senha invalida.");
    else setSessionReady(true);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSessionReady(false);
  }

  const filteredDevices = devices.filter((device) =>
    device.name.toLowerCase().includes(search.toLowerCase()),
  );

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
            <span className="brand-mark">Ai</span>
            <span className="brand-name">Connect</span>
          </div>
          <p>Gestao inteligente de veiculos</p>
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
  const speed = selectedPosition?.speed || 0;
  const isMoving = speed > 1;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head">
          <div className="brand-logo">
            <span className="brand-mark">Ai</span>
            <span className="brand-name">Connect</span>
          </div>
          <button className="icon-button close-sidebar" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <nav>
          <button className="nav-item active"><MapPinned size={18} />Mapa</button>
          <button className="nav-item"><Activity size={18} />Viagens</button>
          <button className="nav-item"><CircleGauge size={18} />Alertas</button>
          <button className="nav-item"><Users size={18} />Utilizadores</button>
        </nav>
        <button className="logout-button" onClick={signOut}>
          <LogOut size={17} />Terminar sessao
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
              placeholder="Pesquisar veiculo"
            />
          </div>
          <button className="icon-button notification-button">
            <Bell size={18} />
            <span />
          </button>
          <button className="profile-button">
            <div className="avatar">AM</div>
            <div>
              <strong>Administrador</strong>
              <span>Gestao da frota</span>
            </div>
            <ChevronDown size={15} />
          </button>
        </header>

        <section className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">CENTRO DE OPERACOES</p>
              <h1>Visao da frota</h1>
            </div>
            <div className="live-status">
              <span />
              Atualizacao ao vivo
            </div>
          </div>

          <div className="metrics">
            <article>
              <div className="metric-icon red"><Navigation size={18} /></div>
              <div><span>Veiculos</span><strong>{devices.length}</strong></div>
            </article>
            <article>
              <div className="metric-icon green"><Activity size={18} /></div>
              <div><span>Em movimento</span><strong>{isMoving ? 1 : 0}</strong></div>
            </article>
            <article>
              <div className="metric-icon amber"><CircleGauge size={18} /></div>
              <div><span>Velocidade</span><strong>{speed.toFixed(1)} km/h</strong></div>
            </article>
            <article>
              <div className="metric-icon navy"><ShieldCheck size={18} /></div>
              <div><span>Conectividade</span><strong>Seguro</strong></div>
            </article>
          </div>

          <div className="dashboard-grid">
            <section className="map-panel">
              <div className="panel-heading">
                <div>
                  <p>Localizacao em tempo real</p>
                  <h2>{selectedDevice?.name || "Nenhum veiculo"}</h2>
                </div>
                <span className={isMoving ? "status moving" : "status parked"}>
                  {isMoving ? "Em movimento" : "Parado"}
                </span>
              </div>
              <TrackerMap
                latitude={latitude}
                longitude={longitude}
                name={selectedDevice?.name || "Veiculo"}
              />
            </section>

            <aside className="fleet-panel">
              <div className="panel-heading compact-heading">
                <div>
                  <p>Minha frota</p>
                  <h2>{filteredDevices.length} veiculos</h2>
                </div>
              </div>
              <div className="device-list">
                {filteredDevices.map((device) => (
                  <button
                    className={`device-card ${selectedDevice?.id === device.id ? "selected" : ""}`}
                    key={device.id}
                    onClick={() => setSelectedDeviceId(device.id)}
                  >
                    <div className="device-icon"><Navigation size={17} /></div>
                    <div>
                      <strong>{device.name}</strong>
                      <span>{device.status || "online"}</span>
                    </div>
                    <div className="device-speed">
                      {positions.find((position) => position.deviceId === device.id)?.speed.toFixed(0) || 0}
                      <small>km/h</small>
                    </div>
                  </button>
                ))}
              </div>
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}
