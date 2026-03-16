# @dougschaefer/cisco-collaboration-endpoints

Cisco RoomOS device and macro management extension for [Swamp](https://swamp.club) — programmatic device inventory, health checks, xAPI command execution, configuration management, macro deployment, and fleet operations via the Webex Control Hub cloud API.

Built for MSP environments where you're managing Cisco endpoints across multiple client orgs with vault-based credential isolation.

## What's in the box

### Models

**cisco-device** — Device inventory, health, configuration, and workspace management.

| Method | Description |
|--------|-------------|
| `list` | List all devices in the org with optional filters (product, connection status, tag, type) |
| `get` | Get a single device by ID |
| `getStatus` | Query xAPI status values — uses specific paths safe for MTR and native mode |
| `enableMacros` | Enable the macro runtime (`Macros.Mode=On`, `Macros.AutoStart=On`) |
| `healthCheck` | Connection status, firmware, uptime, standby, network, platform detection |
| `setConfiguration` | Apply device configuration patches (JSON Patch format) |
| `executeCommand` | Execute arbitrary xAPI commands via cloud proxy (args passed as JSON string) |
| `updateTags` | Set device tags for fleet organization |
| `listWorkspaces` | List Webex workspaces with calendar/calling info |
| `getWorkspace` | Get workspace details by ID |

**cisco-macro** — Full macro lifecycle management with deployment audit trails.

| Method | Description |
|--------|-------------|
| `list` | List all macros on a device (names and activation state) |
| `get` | Retrieve a macro's source code from a device |
| `save` | Upload macro source (with optional ES6→ES5 transpile) |
| `activate` | Activate a saved macro |
| `deactivate` | Deactivate without removing |
| `remove` | Delete a macro from a device |
| `restartRuntime` | Restart the macro engine on a device |
| `deploy` | Full lifecycle: enable mode → remove existing → save → activate → restart (step-by-step audit) |
| `deployFleet` | Deploy to multiple devices with error isolation per device |

## Authentication

Uses a **Webex Service App** (OAuth2) for API access. Credentials are resolved from the Swamp vault at runtime:

```yaml
globalArguments:
  accessToken:   ${{ vault.get(<client-vault>, webex-access-token) }}
  clientId:      ${{ vault.get(<client-vault>, webex-client-id) }}
  clientSecret:  ${{ vault.get(<client-vault>, webex-client-secret) }}
  refreshToken:  ${{ vault.get(<client-vault>, webex-refresh-token) }}
```

Each client org authorizes the service app independently and gets its own token pair. The service app itself (client ID/secret) is shared, but access tokens are org-scoped — one client's token can never access another client's devices.

### Required Webex Scopes

- `spark:devices_read` / `spark:devices_write` — device inventory and metadata
- `spark:xapi_statuses` / `spark:xapi_commands` — xAPI status queries and command execution
- `spark-admin:devices_read` / `spark-admin:devices_write` — admin-level device operations
- `spark:workspaces_read` — workspace listing

## MTR Mode Compatibility

Cisco devices running Microsoft Teams Rooms (MTR) have a reduced xAPI surface, but **macros work fine**. The key rules:

- **Commands** — All commands work in all modes. Macro lifecycle (Save, Activate, Remove, Get, Runtime.Restart) is fully functional on MTR devices via cloud xAPI.
- **Configurations** — ~83% are available in MTR mode (tagged with `include_for_extension: "mtr"`). `Macros.Mode` and `Macros.AutoStart` are both available.
- **Statuses** — ~70% respond in MTR mode. Untagged paths will timeout. Always query specific named paths, not wildcards.
- **Events** — All events are available. The macro engine can subscribe to xAPI events normally.

The `healthCheck` and `getStatus` methods use MTR-safe status paths by default.

### Writing Macros for MTR Devices

- Wrap `xapi.Status` reads in a timeout (some paths hang on MTR): `Promise.race([xapi.Status.Foo.get(), timeout(5000)])`
- Use PascalCase xAPI paths: `xapi.Status.SystemUnit.Software.Version.get()`
- Files must be `.js` — RoomOS won't load `.json` as macros
- `xapi.Command.Presentation.Stop()` takes `ConnectorId` (integer) or no args — not `PresentationSource` strings
- Call state: `xapi.Status.SystemUnit.State.System.get()` → check for `"InCall"` (not `Call.NumberOfActiveCalls`)
- Older firmware may have slower xAPI response times in MTR mode — build in retries

## Installation

```bash
swamp extension pull @dougschaefer/cisco-collaboration-endpoints
```

## API Reference

The extension uses these Webex Control Hub API endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/devices` | GET | List devices (paginated via Link header) |
| `/v1/devices/{id}` | GET/PATCH/DELETE | Device CRUD |
| `/v1/xapi/command/{name}` | POST | Execute xAPI commands on a device |
| `/v1/xapi/status` | GET | Query device status values (up to 10 paths) |
| `/v1/deviceConfigurations` | PATCH | Apply config patches (`application/json-patch+json`) |
| `/v1/workspaces` | GET | List workspaces |
| `/v1/workspaces/{id}` | GET | Get workspace details |

Base URL: `https://webexapis.com/v1`

## Changelog

### 2026.03.16.4

**Bug fixes — cloud xAPI and swamp compatibility**

The `Macros.Macro.Get` command was passing `{ Name: "*", Content: "False" }` to list all macros on a device. The wildcard `*` works when calling xAPI directly on-device, but fails through the Webex cloud proxy with "No such macro." The `list` method now passes empty arguments `{}`, which correctly returns all macros.

The `executeCommand` method's `args` parameter previously used `z.record(z.unknown())` for arbitrary key-value command arguments. This triggers a Zod cross-instance schema resolution bug in the swamp compiled binary ([systeminit/swamp#723](https://github.com/systeminit/swamp/issues/723)) where `z.unknown()` created by the extension's Zod instance cannot be processed by swamp's internal `toJSONSchema()`. The parameter has been changed to `commandArgs: z.string().optional()` — pass command arguments as a JSON string (e.g., `'{"Level": 50}'`), which is parsed at runtime.

Boolean method arguments (`transpile`, `removeExisting`) across the `save`, `deploy`, and `deployFleet` methods used `z.boolean().default(true|false)`, which also triggered the Zod cross-instance bug. These have been changed to `z.boolean().optional()` with runtime defaults (`transpile` defaults to `true`, `removeExisting` defaults to `false`).

The `baseUrl` field in the shared `WebexGlobalArgsSchema` used `z.string().default(...)` which is similarly incompatible. Changed to `z.string().optional()` with a runtime fallback to `https://webexapis.com/v1`.

### 2026.03.13.2

Initial release with device and macro management models.

## License

MIT
