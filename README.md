# Tracker System

## Node.js and TypeScript integration

The application backend runs on the VPS and exposes a Node.js API:

- `GET /health`: health check.
- `GET /api/devices`: reads devices from Traccar.
- `GET /api/positions`: reads live/current and historical positions from Traccar.
- `GET /api/reports/route`: reads route history from Traccar.
- `GET /api/events`: reads Traccar events.
- `GET /api/reports/trips`: reads Traccar trip records.
- `GET /api/reports/stops`: reads Traccar stop records.
- `GET /api/reports/summary`: reads Traccar summary records.
- `GET /api/live`: server-sent live updates from Traccar.
- `POST /api/alerts/:eventId/ack`: acknowledges or resolves an application alert.

The backend opens a session-authenticated WebSocket to `/api/socket`. It stores
only alert metadata in Supabase; no coordinates or position history are copied.
The frontend authenticates to Supabase and calls the backend with the Supabase
access token as a bearer token.

Apply `supabase/migrations/001_tracker_positions.sql` in the Supabase SQL editor.
Copy `.env.example` to `.env.local` and fill the real server-only values.
Never expose `TRACCAR_PASSWORD` or `SUPABASE_SERVICE_ROLE_KEY` in frontend code.

## Responsive fleet frontend

The Next.js frontend is under `web/`. It provides:

- Supabase email/password login.
- Live positions with a ten-second refresh.
- A responsive OpenStreetMap view.
- Fleet list and vehicle status cards.
- Desktop and mobile navigation.

Copy `web/.env.example` to `web/.env.local` before running it. Use only the
Supabase public URL and anon key in the frontend; never add the service-role key.

Starter setup for testing an A16 BLE vehicle tracker with Traccar and PostgreSQL.
This project does not contain a server address, real credentials, or an exposed
device port. Nothing is deployed by this repository.

## Architecture

Tracker + SIM -> mobile network -> public server address and confirmed protocol
port -> Traccar -> private PostgreSQL database

The Traccar web interface is bound to `127.0.0.1:8082` on the host. It is not
publicly exposed; on a remote server, access it through an SSH tunnel until a
domain and HTTPS reverse proxy are configured. PostgreSQL has no published host
port.

## Protocol and port to confirm

The A16 BLE product image lists GT06, JT808, and TQ. Traccar documents support
for GT06 and JT808, but the exact protocol/firmware and transport must be
confirmed for the unit in hand. Do not assume that TQ is supported.

| Protocol (candidate) | Traccar port (candidate) | Transport |
| --- | ---: | --- |
| GT06 | 5023 | TCP candidate; confirm with the manual/vendor |
| JT808 | 5027 | TCP candidate; confirm with the manual/vendor |
| TQ | Pending | Confirm exact protocol name and Traccar support |

These are not enabled or published in `compose.yaml`. Once the protocol is
confirmed, publish only its port and transport in Compose and allow that same
port through the server firewall. Do not open both TCP and UDP unless the
device documentation specifically requires both.

When a server exists, the tracker should be configured with:

- Server host: `[PENDING: public IP address or DNS name of our server]`
- Server port: `[PENDING: port for the confirmed Traccar protocol]`
- Transport: `[PENDING: TCP or UDP, as confirmed by the tracker manual]`

The host/IP must belong to a server we control. Do not use the example IP from
the earlier message unless ownership and access are verified.

## Information to collect

### From the A16 BLE vendor/manual

- Exact model, hardware revision, firmware version, and protocol enabled by
  default: `[PENDING]`
- Exact server configuration SMS/command syntax, including separators and
  required password: `[PENDING]`
- Protocol version and transport (TCP/UDP): `[PENDING]`
- Heartbeat and location reporting interval defaults: `[PENDING]`
- Whether device registration uses IMEI, serial number, or another identifier:
  `[PENDING]`
- APN required for the selected SIM/operator; username/password only if
  required: `[PENDING]`
- Exact LTE modem/band variant shipped: `[PENDING: verify on the unit label]`
- Confirm whether BLE relay features are optional and leave fuel-cutoff/
  immobilizer commands disabled during initial testing.

### From the server/provider

- Provider and server OS/version (prefer a supported Linux server): `[PENDING]`
- Public static IPv4 or DNS name: `[PENDING]`
- Administrative access and firewall control: `[PENDING]`
- Domain name for the web interface (optional for initial device testing):
  `[PENDING]`
- Backup destination and retention: `[PENDING]`

### From the SIM/operator

- Operator and confirmation that data service is active: `[PENDING]`
- APN and any required credentials: `[PENDING]`
- SIM PIN disabled and sufficient data balance/plan: `[PENDING]`
- Confirm coverage and the shipped modem's LTE bands for the intended network:
  `[PENDING]`

Do not put real passwords, SIM PINs, full IMEIs, phone numbers, or live vehicle
locations in this report or in source control. Share redacted details only.

## Local preparation

Requirements: Docker Engine/Desktop with the Docker Compose plugin.

1. Copy `.env.example` to `.env` and set a unique, long random password.
2. Keep `.env` private; it is excluded from Git.
3. Validate the Compose file with `docker compose config`.
4. Start with `docker compose up -d`.
5. Check service status with `docker compose ps` and logs with
   `docker compose logs --tail=100 traccar database`.
6. To reach the web interface remotely, create an SSH tunnel to
   `127.0.0.1:8082`; do not publish the interface directly to the Internet.

No tracker can connect from outside until a server with a public address is
available, the confirmed device port is published in Compose, and the same
port/protocol is allowed by the server firewall.

## First live test

After confirming protocol and setting up the server:

1. Add the tracker in Traccar using its device identifier (usually the IMEI;
   verify this for the device).
2. Change the initial Traccar account password before granting anyone access.
3. Configure the tracker with the server host, confirmed port, transport, and
   operator APN using the vendor's exact syntax.
4. Verify that Traccar receives positions and timestamps before testing any
   optional attributes such as ignition or speed.
5. Keep relay, immobilizer, and fuel-cutoff commands disabled during the first
   test. Use a stationary, authorized test vehicle and verify data handling
   before expanding access.
6. Plan authenticated HTTPS access, updates, backups, and monitoring before
   production use.

## References

- [Traccar 6.17 release notes](https://www.traccar.org/blog/traccar-6-17/)
- [Traccar Docker deployment](https://www.traccar.org/docker/)
- [Traccar protocol list](https://www.traccar.org/protocols/)
- [Traccar PostgreSQL configuration](https://www.traccar.org/postgresql/)
- [Traccar secure connection guide](https://www.traccar.org/secure-connection/)
