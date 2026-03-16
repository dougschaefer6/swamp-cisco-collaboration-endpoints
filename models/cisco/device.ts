import { z } from "npm:zod@4";
import {
  patchDeviceConfig,
  sanitizeId,
  webexApi,
  WebexGlobalArgsSchema,
  webexPaginate,
  xapiCommand,
  xapiStatus,
} from "./_client.ts";

/**
 * @dougschaefer/cisco-device — Cisco RoomOS device management via Webex Control Hub
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WEBEX CONTROL HUB API REFERENCE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Base URL: https://webexapis.com/v1
 * Auth: Bearer token from a Webex Service App (OAuth2 client_credentials + per-org refresh tokens)
 *
 * Key API surfaces used by this model and the companion @dougschaefer/cisco-collaboration-endpoints-macro model:
 *
 * DEVICES API
 *   GET    /devices              — List all devices in the org (paginated, Link header)
 *   GET    /devices/{id}         — Get a single device by ID
 *   PATCH  /devices/{id}         — Update device metadata (displayName, tags)
 *   DELETE /devices/{id}         — Deactivate/remove a device from Control Hub
 *
 * xAPI COMMAND EXECUTION (cloud proxy — works on connected devices in any mode)
 *   POST   /xapi/command/{commandName}   — Execute an xAPI command on a device
 *     Body: { deviceId, arguments: {}, body?: string }
 *     Macro-relevant commands:
 *       Macros.Macro.Save       — Upload macro source (body = JS code, args: Name, Overwrite, Transpile)
 *       Macros.Macro.Activate   — Enable a saved macro
 *       Macros.Macro.Deactivate — Disable without removing
 *       Macros.Macro.Remove     — Delete a macro from the device
 *       Macros.Macro.Get        — List/retrieve macros (args: Name="*", Content="True"|"False")
 *       Macros.Runtime.Restart  — Restart the macro runtime engine
 *
 * xAPI STATUS QUERIES
 *   GET    /xapi/status?deviceId={id}&name={path}  — Query device status values
 *     Accepts up to 10 name params per request.
 *     Safe paths for all modes: SystemUnit.Software.Version, SystemUnit.Uptime,
 *       Standby.State, Network.1.IPv4.Address, Peripherals.ConnectedDevice
 *
 * DEVICE CONFIGURATIONS API (JSON Patch)
 *   PATCH  /deviceConfigurations?deviceId={id}
 *     Content-Type: application/json-patch+json
 *     Body: [{ op: "replace", path: "Config.Path/sources/configured/value", value: "..." }]
 *     Macro-relevant configs:
 *       Macros.Mode              — "On" to enable the macro engine
 *       Macros.AutoStart         — "On" to auto-run macros on boot
 *
 * WORKSPACES API
 *   GET    /workspaces           — List workspaces (rooms/spaces with assigned devices)
 *   GET    /workspaces/{id}      — Get workspace details
 *
 * LOCATIONS API
 *   GET    /locations            — List physical locations
 *
 * ═══════════════════════════════════════════════════════════════════════
 * MTR MODE — xAPI AVAILABILITY RULES
 * ═══════════════════════════════════════════════════════════════════════
 *
 * When a Cisco device runs Microsoft Teams Rooms (MTR), the RoomOS xAPI schema
 * uses the `include_for_extension: "mtr"` flag to control which Configurations
 * and Statuses are exposed. This flag does NOT apply to Commands or Events.
 *
 * COMMANDS (0% tagged): Commands are base RoomOS platform operations available
 *   in ALL modes — Webex native, MTR, Zoom, etc. All macro lifecycle commands
 *   (Save, Activate, Remove, Get, Runtime.Restart) work on MTR devices through
 *   the cloud xAPI. Macros run in the RoomOS layer underneath the Teams app.
 *
 * CONFIGURATIONS (~83% tagged for MTR): Settings tagged with include_for_extension
 *   are available in MTR mode. Untagged configs (like Conference.DefaultCall.Protocol)
 *   are managed by the Teams application and not exposed through xAPI.
 *   Macro-relevant configs (Macros.Mode, Macros.AutoStart) ARE available in MTR mode.
 *
 * STATUSES (~70% tagged for MTR): Tagged statuses respond normally. Untagged ones
 *   will timeout or return empty. CRITICAL: wildcard status queries that hit
 *   untagged paths cause timeouts on MTR devices. Always use specific named
 *   status paths (e.g., "SystemUnit.Software.Version") instead of broad wildcards.
 *
 * EVENTS (0% tagged): Like commands, events are base platform. The macro engine
 *   can subscribe to xAPI events normally in MTR mode.
 *
 * PRACTICAL NOTES FOR MTR MACRO DEVELOPMENT:
 *   - The macro engine runs in the RoomOS layer, below the Teams application
 *   - Macros can use xapi.Config, xapi.Status, xapi.Command, xapi.Event normally
 *   - Some xapi.Status reads will timeout if the path isn't MTR-tagged — wrap
 *     status reads in a timeout helper (e.g., Promise.race with a 5s deadline)
 *   - Use PascalCase xAPI paths: xapi.Status.SystemUnit.Software.Version.get()
 *   - Macro files must be .js (not .json) — RoomOS won't load JSON as macros
 *   - The macro engine transpiles ES6+ to ES5 internally (Transpile: "True")
 *   - xapi.Command.Presentation.Stop() takes no args or ConnectorId (integer),
 *     NOT PresentationSource strings
 *   - Call state detection: use xapi.Status.SystemUnit.State.System.get() and
 *     check for "InCall", not xapi.Status.Call.NumberOfActiveCalls (nonexistent)
 *   - Older firmware (e.g., 26.3.1.5) may have slower xAPI response times in
 *     MTR mode compared to native mode — build in timeouts and retries
 *
 * Source: Cisco roomos.cisco.com schema + doc/MTR/APIAndCustomizations.md
 */

const DeviceSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  product: z.string(),
}).passthrough();

const WorkspaceSchema = z.object({
  id: z.string(),
  displayName: z.string(),
}).passthrough();

export const model = {
  type: "@dougschaefer/cisco-collaboration-endpoints-device",
  version: "2026.03.16.4",
  globalArguments: WebexGlobalArgsSchema,
  resources: {
    device: {
      description:
        "Cisco RoomOS device registered to Webex Control Hub — codecs, boards, desk devices, and room navigators",
      schema: DeviceSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    workspace: {
      description:
        "Webex workspace (room/space) with assigned devices, calendar integration, and calling configuration",
      schema: WorkspaceSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all devices in the Webex org. Optionally filter by product type, connection status, or tag.",
      arguments: z.object({
        product: z.string().optional().describe(
          "Filter by product name (e.g., 'Cisco Codec Pro', 'Cisco Room Kit Pro')",
        ),
        connectionStatus: z.string().optional().describe(
          "Filter by connection status: connected, disconnected, connected_with_issues",
        ),
        tag: z.string().optional().describe("Filter by device tag"),
        type: z.string().optional().describe(
          "Filter by device type: roomdesk, phone, accessory, camera",
        ),
      }),
      execute: async (args: Record<string, string | undefined>, context: {
        globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
        logger: { info: (msg: string, vars?: Record<string, unknown>) => void };
        writeResource: (
          type: string,
          name: string,
          data: unknown,
        ) => Promise<unknown>;
      }) => {
        const params: Record<string, string> = {};
        if (args.product) params.product = args.product;
        if (args.connectionStatus) {
          params.connectionStatus = args.connectionStatus;
        }
        if (args.tag) params.tag = args.tag;
        if (args.type) params.type = args.type;

        const devices = await webexPaginate(
          "/devices",
          context.globalArgs,
          params,
        );

        context.logger.info("Found {count} devices", { count: devices.length });

        const handles = [];
        for (const device of devices) {
          const name = sanitizeId(
            (device.displayName as string) + "-" +
              (device.serial as string || device.id as string).slice(-8),
          );
          const handle = await context.writeResource("device", name, device);
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get detailed information about a specific device by ID.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
      }),
      execute: async (args: { deviceId: string }, context: {
        globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
        logger: { info: (msg: string, vars?: Record<string, unknown>) => void };
        writeResource: (
          type: string,
          name: string,
          data: unknown,
        ) => Promise<unknown>;
      }) => {
        const device = (await webexApi(
          `/devices/${encodeURIComponent(args.deviceId)}`,
          context.globalArgs,
        )) as Record<string, unknown>;

        const name = sanitizeId(
          (device.displayName as string) + "-" +
            (device.serial as string || args.deviceId).slice(-8),
        );
        const handle = await context.writeResource("device", name, device);

        context.logger.info("Retrieved device {name}", {
          name: device.displayName,
        });

        return { dataHandles: [handle] };
      },
    },

    getStatus: {
      description:
        "Query xAPI status values from a device. Use specific paths (e.g., 'SystemUnit.Software.Version') rather than broad wildcards for MTR devices.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
        statusPaths: z.array(z.string()).min(1).max(10).describe(
          "Status paths to query (max 10). Examples: SystemUnit.Software.Version, SystemUnit.Uptime, Standby.State",
        ),
      }),
      execute: async (
        args: { deviceId: string; statusPaths: string[] },
        context: {
          globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
          logger: {
            info: (msg: string, vars?: Record<string, unknown>) => void;
          };
        },
      ) => {
        const result = await xapiStatus(
          args.deviceId,
          context.globalArgs,
          ...args.statusPaths,
        );

        context.logger.info(
          "Queried {count} status paths on device {id}",
          { count: args.statusPaths.length, id: args.deviceId },
        );

        return {
          data: {
            attributes: {
              deviceId: args.deviceId,
              statusPaths: args.statusPaths,
              result: result.result,
            },
            name: `device-status-${sanitizeId(args.deviceId).slice(-12)}`,
          },
        };
      },
    },

    enableMacros: {
      description:
        "Enable the macro runtime on a device by setting Macros.Mode=On and Macros.AutoStart=On.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
      }),
      execute: async (args: { deviceId: string }, context: {
        globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
        logger: { info: (msg: string, vars?: Record<string, unknown>) => void };
      }) => {
        await patchDeviceConfig(args.deviceId, context.globalArgs, [
          {
            op: "replace",
            path: "Macros.Mode/sources/configured/value",
            value: "On",
          },
          {
            op: "replace",
            path: "Macros.AutoStart/sources/configured/value",
            value: "On",
          },
        ]);

        context.logger.info("Enabled macros on device {id}", {
          id: args.deviceId,
        });

        return {
          data: {
            attributes: {
              deviceId: args.deviceId,
              macrosMode: "On",
              macrosAutoStart: "On",
            },
            name: `macros-enabled-${sanitizeId(args.deviceId).slice(-12)}`,
          },
        };
      },
    },

    healthCheck: {
      description:
        "Run a health check on a device — queries connection status, firmware version, uptime, standby state, and network address. Uses specific status paths safe for both native and MTR mode devices.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
      }),
      execute: async (args: { deviceId: string }, context: {
        globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
        logger: { info: (msg: string, vars?: Record<string, unknown>) => void };
      }) => {
        // Get device metadata from Devices API
        const device = (await webexApi(
          `/devices/${encodeURIComponent(args.deviceId)}`,
          context.globalArgs,
        )) as Record<string, unknown>;

        // Query MTR-safe status paths
        const statusPaths = [
          "SystemUnit.Software.Version",
          "SystemUnit.Uptime",
          "Standby.State",
          "Network.1.IPv4.Address",
          "SystemUnit.State.System",
        ];

        let statusResult: Record<string, unknown> = {};
        try {
          statusResult = await xapiStatus(
            args.deviceId,
            context.globalArgs,
            ...statusPaths,
          );
        } catch (e) {
          statusResult = { error: (e as Error).message };
        }

        const isMtr = (device.devicePlatform as string || "")
          .toLowerCase()
          .includes("mtr");

        context.logger.info("Health check on {name} ({product})", {
          name: device.displayName,
          product: device.product,
        });

        return {
          data: {
            attributes: {
              deviceId: args.deviceId,
              displayName: device.displayName,
              product: device.product,
              connectionStatus: device.connectionStatus,
              software: device.software,
              upgradeChannel: device.upgradeChannel,
              devicePlatform: device.devicePlatform,
              isMtr,
              serial: device.serial,
              mac: device.mac,
              ip: device.ip,
              tags: device.tags,
              errorCodes: device.errorCodes,
              lastSeen: device.lastSeen,
              xapiStatus: statusResult,
            },
            name: `health-${sanitizeId(args.deviceId).slice(-12)}`,
          },
        };
      },
    },

    setConfiguration: {
      description:
        "Set one or more device configurations via JSON Patch. Use the path format 'Config.Path/sources/configured/value'. On MTR devices, only configs tagged with include_for_extension='mtr' are available.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
        patches: z.array(z.object({
          path: z.string().describe(
            "Configuration path (e.g., 'Macros.Mode/sources/configured/value')",
          ),
          value: z.string().describe("Configuration value to set"),
        })).min(1).describe("Array of configuration patches to apply"),
      }),
      execute: async (
        args: {
          deviceId: string;
          patches: Array<{ path: string; value: string }>;
        },
        context: {
          globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
          logger: {
            info: (msg: string, vars?: Record<string, unknown>) => void;
          };
        },
      ) => {
        const ops = args.patches.map((p) => ({
          op: "replace" as const,
          path: p.path,
          value: p.value,
        }));

        await patchDeviceConfig(args.deviceId, context.globalArgs, ops);

        context.logger.info(
          "Applied {count} config patches to device {id}",
          { count: args.patches.length, id: args.deviceId },
        );

        return {
          data: {
            attributes: {
              deviceId: args.deviceId,
              patchesApplied: args.patches.length,
              patches: args.patches,
            },
            name: `config-${sanitizeId(args.deviceId).slice(-12)}`,
          },
        };
      },
    },

    executeCommand: {
      description:
        "Execute an arbitrary xAPI command on a device via the Webex cloud API. Commands work in all device modes (native, MTR, Zoom). For macro-specific commands, prefer the @dougschaefer/cisco-collaboration-endpoints-macro model methods.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
        command: z.string().describe(
          "xAPI command name (e.g., 'Audio.Volume.Set', 'Standby.Activate', 'SystemUnit.Boot')",
        ),
        commandArgs: z.string().optional().describe(
          "Command arguments as JSON string (e.g., '{\"Level\": 50}')",
        ),
        body: z.string().optional().describe(
          "Command body content (used by commands like Macros.Macro.Save)",
        ),
      }),
      execute: async (
        args: {
          deviceId: string;
          command: string;
          commandArgs?: string;
          body?: string;
        },
        context: {
          globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
          logger: {
            info: (msg: string, vars?: Record<string, unknown>) => void;
          };
        },
      ) => {
        const cmdArgs = args.commandArgs
          ? JSON.parse(args.commandArgs)
          : undefined;
        const result = await xapiCommand(
          args.command,
          args.deviceId,
          context.globalArgs,
          cmdArgs,
          args.body,
        );

        context.logger.info("Executed {cmd} on device {id}", {
          cmd: args.command,
          id: args.deviceId,
        });

        return {
          data: {
            attributes: {
              deviceId: args.deviceId,
              command: args.command,
              result,
            },
            name: `cmd-${sanitizeId(args.command)}-${
              sanitizeId(args.deviceId).slice(-12)
            }`,
          },
        };
      },
    },

    updateTags: {
      description:
        "Update tags on a device. Tags are used for organizing and filtering devices in Control Hub and can be used to target fleet operations.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
        tags: z.array(z.string()).describe(
          "Complete list of tags to set on the device (replaces existing tags)",
        ),
      }),
      execute: async (
        args: { deviceId: string; tags: string[] },
        context: {
          globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
          logger: {
            info: (msg: string, vars?: Record<string, unknown>) => void;
          };
          writeResource: (
            type: string,
            name: string,
            data: unknown,
          ) => Promise<unknown>;
        },
      ) => {
        const device = (await webexApi(
          `/devices/${encodeURIComponent(args.deviceId)}`,
          context.globalArgs,
          {
            method: "PATCH",
            body: { tags: args.tags },
          },
        )) as Record<string, unknown>;

        const name = sanitizeId(
          (device.displayName as string || "device") + "-" +
            (device.serial as string || args.deviceId).slice(-8),
        );
        const handle = await context.writeResource("device", name, device);

        context.logger.info("Updated tags on device {id}: {tags}", {
          id: args.deviceId,
          tags: args.tags.join(", "),
        });

        return { dataHandles: [handle] };
      },
    },

    listWorkspaces: {
      description:
        "List Webex workspaces (rooms/spaces) in the org. Workspaces represent physical locations with assigned devices, calendar integration, and calling configuration.",
      arguments: z.object({
        displayName: z.string().optional().describe(
          "Filter by workspace display name (partial match)",
        ),
        workspaceLocationId: z.string().optional().describe(
          "Filter by workspace location ID",
        ),
        calling: z.string().optional().describe(
          "Filter by calling type: freeCalling, hybridCalling, webexCalling, thirdPartySipCalling",
        ),
      }),
      execute: async (
        args: Record<string, string | undefined>,
        context: {
          globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
          logger: {
            info: (msg: string, vars?: Record<string, unknown>) => void;
          };
          writeResource: (
            type: string,
            name: string,
            data: unknown,
          ) => Promise<unknown>;
        },
      ) => {
        const params: Record<string, string> = {};
        if (args.displayName) params.displayName = args.displayName;
        if (args.workspaceLocationId) {
          params.workspaceLocationId = args.workspaceLocationId;
        }
        if (args.calling) params.calling = args.calling;

        const workspaces = await webexPaginate(
          "/workspaces",
          context.globalArgs,
          params,
        );

        context.logger.info("Found {count} workspaces", {
          count: workspaces.length,
        });

        const handles = [];
        for (const ws of workspaces) {
          const name = sanitizeId(
            (ws.displayName as string || "workspace") + "-" +
              (ws.id as string).slice(-8),
          );
          const handle = await context.writeResource("workspace", name, ws);
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getWorkspace: {
      description: "Get detailed information about a specific workspace by ID.",
      arguments: z.object({
        workspaceId: z.string().describe("Webex workspace ID"),
      }),
      execute: async (args: { workspaceId: string }, context: {
        globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
        logger: { info: (msg: string, vars?: Record<string, unknown>) => void };
        writeResource: (
          type: string,
          name: string,
          data: unknown,
        ) => Promise<unknown>;
      }) => {
        const ws = (await webexApi(
          `/workspaces/${encodeURIComponent(args.workspaceId)}`,
          context.globalArgs,
        )) as Record<string, unknown>;

        const name = sanitizeId(
          (ws.displayName as string || "workspace") + "-" +
            (ws.id as string || args.workspaceId).slice(-8),
        );
        const handle = await context.writeResource("workspace", name, ws);

        context.logger.info("Retrieved workspace {name}", {
          name: ws.displayName,
        });

        return { dataHandles: [handle] };
      },
    },
  },
};
