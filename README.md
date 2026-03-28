# @dougschaefer/cisco-collaboration-endpoints

Cisco RoomOS device and macro management for [Swamp](https://swamp.club) via the Webex Control Hub cloud xAPI. The device model covers inventory, health checks, xAPI command execution, configuration patches, status queries, and workspace management, while the macro model handles the full lifecycle from save and activate through fleet-wide deployment with per-device error isolation. Works with Room Kit, Board, Desk, and codec endpoints, including devices running in MTR mode where xAPI commands and macros remain fully functional even though the configuration and status surfaces are reduced.

## Models

| Model Type | Description |
|------------|-------------|
| `cisco-collaboration-endpoints-device` | Device inventory, health, xAPI commands, configuration, status, and workspace management |
| `cisco-collaboration-endpoints-macro` | Macro save, activate, deploy, and fleet push with audit trails |

### cisco-collaboration-endpoints-device

| Method | Description |
|--------|-------------|
| `list` | List all devices in the org, with optional filters by product, connection status, tag, or type |
| `get` | Get a single device by ID |
| `health` | Connection status, firmware version, uptime, standby state, network info, and platform detection |
| `runCommand` | Execute an arbitrary xAPI command via the Webex cloud proxy (pass arguments as a JSON string) |
| `getStatus` | Query xAPI status values using specific paths safe for both native and MTR modes |
| `getConfiguration` | Retrieve device configuration values |
| `setConfiguration` | Apply configuration patches in JSON Patch format |
| `listWorkspaces` | List Webex workspaces with calendar and calling information |
| `getWorkspace` | Get workspace details by ID |
| `refreshToken` | Refresh the Webex OAuth access token using the stored refresh token |

### cisco-collaboration-endpoints-macro

| Method | Description |
|--------|-------------|
| `list` | List all macros on a device with names and activation state |
| `get` | Retrieve a macro's source code from a device |
| `save` | Upload macro source to a device (with optional ES6 to ES5 transpile) |
| `activate` | Activate a saved macro |
| `deactivate` | Deactivate a macro without removing it |
| `delete` | Remove a macro from a device |
| `deploy` | Full lifecycle deployment: enable macro mode, optionally remove existing, save, activate, and restart the runtime, with step-by-step audit output |
| `fleetPush` | Deploy a macro to multiple devices with error isolation per device |
| `listFromDevice` | List macros directly from a specific device |

## Installation

```bash
swamp extension pull @dougschaefer/cisco-collaboration-endpoints
```

## Setup

The extension authenticates against the Webex Control Hub API using OAuth tokens. You can use either a Webex Service App (recommended for production) or a personal access token for testing.

1. Create a Webex integration or service app at [developer.webex.com](https://developer.webex.com) with these scopes:

   - `spark:devices_read`, `spark:devices_write` (device inventory and metadata)
   - `spark:xapi_statuses`, `spark:xapi_commands` (xAPI status queries and command execution)
   - `spark-admin:devices_read`, `spark-admin:devices_write` (admin-level device operations)
   - `spark:workspaces_read` (workspace listing)

2. Create a Swamp vault and store your credentials:

```bash
swamp vault create webex --type local_encryption
swamp vault set webex access-token <your-access-token>
swamp vault set webex refresh-token <your-refresh-token>
swamp vault set webex client-id <your-client-id>
swamp vault set webex client-secret <your-client-secret>
```

3. Create a model instance, wiring credentials from vault:

```bash
swamp model create --type @dougschaefer/cisco-collaboration-endpoints-device --name cisco-devices
```

When prompted for global arguments, use vault references:

```
accessToken:  ${{ vault.get(webex, access-token) }}
refreshToken: ${{ vault.get(webex, refresh-token) }}
clientId:     ${{ vault.get(webex, client-id) }}
clientSecret: ${{ vault.get(webex, client-secret) }}
```

4. Run methods against the instance:

```bash
swamp model execute cisco-devices --method list
swamp model execute cisco-devices --method health
```

## API Compatibility

All device and macro operations use the Webex Control Hub REST API at `https://webexapis.com/v1`, specifically the `/v1/devices`, `/v1/xapi/command`, `/v1/xapi/status`, `/v1/deviceConfigurations`, and `/v1/workspaces` endpoints.

MTR-mode devices accept xAPI commands normally through the cloud proxy. The `include_for_extension` flag that limits certain configurations and statuses in MTR mode only applies to config and status queries, not to commands, so macro lifecycle operations (save, activate, remove, restart runtime) work on MTR devices the same as native RoomOS. The `health` and `getStatus` methods use MTR-safe status paths by default.

Token refresh is built into the device model via the `refreshToken` method, which exchanges the stored refresh token for a new access token through the Webex OAuth flow.

## License

MIT — see [LICENSE](LICENSE)
