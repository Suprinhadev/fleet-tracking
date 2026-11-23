export class TraccarClient {
  constructor(
    private readonly baseUrl: string,
    private readonly email: string,
    private readonly password: string,
  ) {}

  private headers(): Record<string, string> {
    const token = Buffer.from(`${this.email}:${this.password}`).toString("base64");
    return {
      Accept: "application/json",
      Authorization: `Basic ${token}`,
    };
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, { headers: this.headers() });
    if (!response.ok) {
      throw new Error(`Traccar ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }

  async createSession(): Promise<string> {
    const body = new URLSearchParams({
      email: this.email,
      password: this.password,
    });

    const response = await fetch(`${this.baseUrl}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "manual",
    });

    if (!response.ok) {
      throw new Error(`Traccar session ${response.status}: ${await response.text()}`);
    }

    const setCookie = response.headers.get("set-cookie");
    if (!setCookie) throw new Error("Traccar did not return a session cookie");
    return setCookie.split(";")[0];
  }
}
