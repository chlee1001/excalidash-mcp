import type { ExcalidrawElement } from "./scene.js";

export type ExcaliDashConfig = {
  url: string;
  token: string;
  drawingId?: string;
};

export type DrawingSummary = {
  id: string;
  name: string;
  collectionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type Drawing = DrawingSummary & {
  elements: ExcalidrawElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

export type DrawingList = {
  drawings: DrawingSummary[];
  totalCount: number;
  limit: number;
  offset: number;
};

export type Fetch = typeof globalThis.fetch;

export class ExcaliDashError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ExcaliDashError";
  }
}

export class VersionConflictError extends ExcaliDashError {
  constructor(
    message: string,
    readonly currentVersion?: number,
  ) {
    super(message, 409);
    this.name = "VersionConflictError";
  }
}

const apiBase = (url: string): string => {
  const base = url.trim().replace(/\/+$/, "");
  if (!base) throw new Error("EXCALIDASH_URL is required");
  return base.endsWith("/api") ? base : `${base}/api`;
};

export const configFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): ExcaliDashConfig => {
  const url = env.EXCALIDASH_URL?.trim();
  const token = env.EXCALIDASH_API_KEY?.trim() || env.EXCALIDASH_TOKEN?.trim();
  const drawingId = env.EXCALIDASH_DRAWING_ID?.trim() || undefined;

  if (!url) throw new Error("EXCALIDASH_URL is required");
  if (!token) {
    throw new Error(
      "EXCALIDASH_API_KEY is required (EXCALIDASH_TOKEN is accepted for compatibility)",
    );
  }

  return { url, token, drawingId };
};

export class ExcaliDashClient {
  private readonly baseUrl: string;

  constructor(
    private readonly config: ExcaliDashConfig,
    private readonly fetchImpl: Fetch = globalThis.fetch,
  ) {
    this.baseUrl = apiBase(config.url);
  }

  listDrawings(
    options: {
      search?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<DrawingList> {
    const query = new URLSearchParams({
      limit: String(options.limit ?? 50),
      offset: String(options.offset ?? 0),
    });
    if (options.search) query.set("search", options.search);
    return this.request(`drawings?${query}`);
  }

  createDrawing(name: string): Promise<Drawing> {
    return this.request("drawings", {
      method: "POST",
      body: JSON.stringify({
        name,
        elements: [],
        appState: {},
        files: {},
      }),
    });
  }
  getDrawing(drawingId: string): Promise<Drawing> {
    return this.request(`drawings/${encodeURIComponent(drawingId)}`);
  }

  updateScene(
    drawingId: string,
    scene: { version: number; elements: ExcalidrawElement[] },
  ): Promise<Drawing> {
    return this.request(`drawings/${encodeURIComponent(drawingId)}`, {
      method: "PUT",
      body: JSON.stringify(scene),
    });
  }

  private async request<T = unknown>(
    path: string,
    options: {
      method?: "GET" | "POST" | "PUT";
      body?: string;
    } = {},
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body,
    });

    if (!response.ok) {
      const raw = await response.text();
      const detail = raw
        .split(this.config.token)
        .join("[redacted]")
        .slice(0, 2000);
      const message = `ExcaliDash request failed (${response.status})${detail ? `: ${detail}` : ""}`;
      if (response.status === 409) {
        let currentVersion: number | undefined;
        try {
          const data = JSON.parse(raw) as { currentVersion?: unknown };
          if (typeof data.currentVersion === "number")
            currentVersion = data.currentVersion;
        } catch {
          /* Non-JSON conflict responses still indicate a conflict. */
        }
        throw new VersionConflictError(message, currentVersion);
      }
      throw new ExcaliDashError(message, response.status);
    }

    return (await response.json()) as T;
  }
}
