import { z } from "npm:zod@4.3.6";

/**
 * Shared Webex API client for Cisco device management extension models.
 *
 * Credentials are passed via globalArguments, resolved from vault:
 *   accessToken:   ${{ vault.get(<client-vault>, webex-access-token) }}
 *   clientId:      ${{ vault.get(<client-vault>, webex-client-id) }}
 *   clientSecret:  ${{ vault.get(<client-vault>, webex-client-secret) }}
 *   refreshToken:  ${{ vault.get(<client-vault>, webex-refresh-token) }}
 */

export const WebexGlobalArgsSchema = z.object({
  accessToken: z.string().describe(
    "Webex API access token. Use: ${{ vault.get(<client-vault>, webex-access-token) }}",
  ),
  clientId: z.string().optional().describe(
    "Webex service app client ID for token refresh. Use: ${{ vault.get(<client-vault>, webex-client-id) }}",
  ),
  clientSecret: z.string().optional().describe(
    "Webex service app client secret for token refresh. Use: ${{ vault.get(<client-vault>, webex-client-secret) }}",
  ),
  refreshToken: z.string().optional().describe(
    "Webex refresh token for token refresh. Use: ${{ vault.get(<client-vault>, webex-refresh-token) }}",
  ),
  baseUrl: z
    .string()
    .optional()
    .describe("Webex API base URL (defaults to https://webexapis.com/v1)"),
});

export type WebexGlobalArgs = z.infer<typeof WebexGlobalArgsSchema>;

export async function webexApi(
  path: string,
  globalArgs: WebexGlobalArgs,
  options?: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
  },
): Promise<unknown> {
  const url = new URL(path, globalArgs.baseUrl || "https://webexapis.com/v1");
  if (options?.params) {
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${globalArgs.accessToken}`,
    "Accept": "application/json",
  };

  const fetchOptions: RequestInit = {
    method: options?.method || "GET",
    headers,
  };

  if (options?.body) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(options.body);
  }

  const resp = await fetch(url.toString(), fetchOptions);

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Webex API ${resp.status} ${resp.statusText}: ${body}`);
  }

  const text = await resp.text();
  return text ? JSON.parse(text) : {};
}

/**
 * Execute an xAPI command on a device via the Webex cloud API.
 */
export async function xapiCommand(
  commandName: string,
  deviceId: string,
  globalArgs: WebexGlobalArgs,
  args?: Record<string, unknown>,
  body?: string,
): Promise<unknown> {
  const payload: Record<string, unknown> = {
    deviceId,
    arguments: args || {},
  };
  if (body !== undefined) {
    payload.body = body;
  }

  return await webexApi(`/xapi/command/${commandName}`, globalArgs, {
    method: "POST",
    body: payload,
  });
}

/**
 * Query xAPI status on a device via the Webex cloud API.
 * Accepts up to 10 status names per the API limit.
 */
export async function xapiStatus(
  deviceId: string,
  globalArgs: WebexGlobalArgs,
  ...names: string[]
): Promise<Record<string, unknown>> {
  const url = new URL(
    "/v1/xapi/status",
    globalArgs.baseUrl || "https://webexapis.com/v1",
  );
  url.searchParams.set("deviceId", deviceId);
  for (const name of names.slice(0, 10)) {
    url.searchParams.append("name", name);
  }

  const resp = await fetch(url.toString(), {
    headers: {
      "Authorization": `Bearer ${globalArgs.accessToken}`,
      "Accept": "application/json",
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Webex xAPI Status ${resp.status}: ${body}`);
  }

  return resp.json() as Promise<Record<string, unknown>>;
}

/**
 * Patch device configurations via the Device Configurations API.
 * Accepts an array of JSON Patch operations.
 */
export async function patchDeviceConfig(
  deviceId: string,
  globalArgs: WebexGlobalArgs,
  patches: Array<{ op: string; path: string; value: string }>,
): Promise<unknown> {
  const url = new URL(
    "/v1/deviceConfigurations",
    globalArgs.baseUrl || "https://webexapis.com/v1",
  );
  url.searchParams.set("deviceId", deviceId);

  const resp = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${globalArgs.accessToken}`,
      "Content-Type": "application/json-patch+json",
      "Accept": "application/json",
    },
    body: JSON.stringify(patches),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Webex DeviceConfig PATCH ${resp.status}: ${body}`);
  }

  const text = await resp.text();
  return text ? JSON.parse(text) : {};
}

/**
 * Paginate through all results from a Webex list API endpoint.
 */
export async function webexPaginate(
  path: string,
  globalArgs: WebexGlobalArgs,
  params?: Record<string, string>,
  maxPages = 20,
): Promise<Array<Record<string, unknown>>> {
  const allItems: Array<Record<string, unknown>> = [];
  let currentUrl: string | null = null;

  const url = new URL(path, globalArgs.baseUrl || "https://webexapis.com/v1");
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }
  if (!url.searchParams.has("max")) {
    url.searchParams.set("max", "100");
  }
  currentUrl = url.toString();

  for (let page = 0; page < maxPages && currentUrl; page++) {
    const resp: Response = await fetch(currentUrl, {
      headers: {
        "Authorization": `Bearer ${globalArgs.accessToken}`,
        "Accept": "application/json",
      },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Webex API ${resp.status}: ${body}`);
    }

    const data = await resp.json() as {
      items?: Array<Record<string, unknown>>;
    };
    if (data.items) {
      allItems.push(...data.items);
    }

    // Check Link header for next page
    const linkHeader: string | null = resp.headers.get("Link");
    if (linkHeader) {
      const nextMatch: RegExpMatchArray | null = linkHeader.match(
        /<([^>]+)>;\s*rel="next"/,
      );
      currentUrl = nextMatch ? nextMatch[1] : null;
    } else {
      currentUrl = null;
    }
  }

  return allItems;
}

export function sanitizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}
