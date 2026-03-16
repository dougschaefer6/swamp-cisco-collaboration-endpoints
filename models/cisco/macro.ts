import { z } from "npm:zod@4";
import {
  patchDeviceConfig,
  sanitizeId,
  WebexGlobalArgsSchema,
  xapiCommand,
} from "./_client.ts";

const MacroSchema = z.object({
  deviceId: z.string(),
  deviceName: z.string().optional(),
  macroName: z.string(),
  active: z.boolean(),
  content: z.string().optional(),
  deployedAt: z.string(),
}).passthrough();

const DeploymentResultSchema = z.object({
  deviceId: z.string(),
  deviceName: z.string().optional(),
  macroName: z.string(),
  steps: z.array(z.object({
    step: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
  })),
  success: z.boolean(),
  deployedAt: z.string(),
}).passthrough();

export const model = {
  type: "@dougschaefer/cisco-collaboration-endpoints-macro",
  version: "2026.03.16.4",
  globalArguments: WebexGlobalArgsSchema,
  resources: {
    macro: {
      description:
        "Cisco RoomOS macro deployed to a device — source code, activation state, and deployment metadata",
      schema: MacroSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    deployment: {
      description:
        "Macro deployment result — step-by-step record of a push operation to one or more devices",
      schema: DeploymentResultSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all macros on a device. Returns macro names and activation state.",
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
        const result = (await xapiCommand(
          "Macros.Macro.Get",
          args.deviceId,
          context.globalArgs,
          {},
        )) as Record<string, unknown>;

        const inner = result.result as Record<string, unknown> || {};
        const macros = (inner.Macro as Array<Record<string, unknown>>) || [];

        context.logger.info("Found {count} macros on device {id}", {
          count: macros.length,
          id: args.deviceId,
        });

        const handles = [];
        for (const macro of macros) {
          const name = sanitizeId(
            `${args.deviceId.slice(-8)}-${macro.Name as string}`,
          );
          const handle = await context.writeResource("macro", name, {
            deviceId: args.deviceId,
            macroName: macro.Name,
            active: macro.Active === "True",
            deployedAt: new Date().toISOString(),
          });
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a specific macro's source code from a device.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
        macroName: z.string().describe("Macro name on the device"),
      }),
      execute: async (
        args: { deviceId: string; macroName: string },
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
        const result = (await xapiCommand(
          "Macros.Macro.Get",
          args.deviceId,
          context.globalArgs,
          { Name: args.macroName, Content: "True" },
        )) as Record<string, unknown>;

        const inner = result.result as Record<string, unknown> || {};
        const macros = (inner.Macro as Array<Record<string, unknown>>) || [];
        const macro = macros[0] || {};

        const name = sanitizeId(
          `${args.deviceId.slice(-8)}-${args.macroName}`,
        );
        const handle = await context.writeResource("macro", name, {
          deviceId: args.deviceId,
          macroName: args.macroName,
          active: macro.Active === "True",
          content: macro.Content as string || "",
          deployedAt: new Date().toISOString(),
        });

        context.logger.info("Retrieved macro {macro} from device", {
          macro: args.macroName,
        });

        return { dataHandles: [handle] };
      },
    },

    save: {
      description:
        "Save (upload) a macro to a device. Overwrites any existing macro with the same name. Does not activate — call activate separately or use deploy for the full lifecycle.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
        macroName: z.string().describe(
          "Macro name (alphanumeric and underscores)",
        ),
        content: z.string().describe("JavaScript macro source code"),
        transpile: z.boolean().optional().describe(
          "Whether to transpile ES6+ to ES5 for the macro engine (defaults to true)",
        ),
      }),
      execute: async (
        args: {
          deviceId: string;
          macroName: string;
          content: string;
          transpile: boolean;
        },
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
        await xapiCommand(
          "Macros.Macro.Save",
          args.deviceId,
          context.globalArgs,
          {
            Name: args.macroName,
            Overwrite: "True",
            Transpile: (args.transpile !== false) ? "True" : "False",
          },
          args.content,
        );

        const name = sanitizeId(
          `${args.deviceId.slice(-8)}-${args.macroName}`,
        );
        const handle = await context.writeResource("macro", name, {
          deviceId: args.deviceId,
          macroName: args.macroName,
          active: false,
          content: args.content,
          deployedAt: new Date().toISOString(),
        });

        context.logger.info("Saved macro {macro} to device {id}", {
          macro: args.macroName,
          id: args.deviceId,
        });

        return { dataHandles: [handle] };
      },
    },

    activate: {
      description: "Activate a macro on a device by name.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
        macroName: z.string().describe("Macro name to activate"),
      }),
      execute: async (
        args: { deviceId: string; macroName: string },
        context: {
          globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
          logger: {
            info: (msg: string, vars?: Record<string, unknown>) => void;
          };
        },
      ) => {
        await xapiCommand(
          "Macros.Macro.Activate",
          args.deviceId,
          context.globalArgs,
          { Name: args.macroName },
        );

        context.logger.info("Activated macro {macro} on device {id}", {
          macro: args.macroName,
          id: args.deviceId,
        });

        return {
          data: {
            attributes: {
              deviceId: args.deviceId,
              macroName: args.macroName,
              active: true,
            },
            name: `activated-${sanitizeId(args.macroName)}`,
          },
        };
      },
    },

    deactivate: {
      description: "Deactivate a macro on a device by name.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
        macroName: z.string().describe("Macro name to deactivate"),
      }),
      execute: async (
        args: { deviceId: string; macroName: string },
        context: {
          globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
          logger: {
            info: (msg: string, vars?: Record<string, unknown>) => void;
          };
        },
      ) => {
        await xapiCommand(
          "Macros.Macro.Deactivate",
          args.deviceId,
          context.globalArgs,
          { Name: args.macroName },
        );

        context.logger.info("Deactivated macro {macro} on device {id}", {
          macro: args.macroName,
          id: args.deviceId,
        });

        return {
          data: {
            attributes: {
              deviceId: args.deviceId,
              macroName: args.macroName,
              active: false,
            },
            name: `deactivated-${sanitizeId(args.macroName)}`,
          },
        };
      },
    },

    remove: {
      description: "Remove a macro from a device by name.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
        macroName: z.string().describe("Macro name to remove"),
      }),
      execute: async (
        args: { deviceId: string; macroName: string },
        context: {
          globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
          logger: {
            info: (msg: string, vars?: Record<string, unknown>) => void;
          };
        },
      ) => {
        await xapiCommand(
          "Macros.Macro.Remove",
          args.deviceId,
          context.globalArgs,
          { Name: args.macroName },
        );

        context.logger.info("Removed macro {macro} from device {id}", {
          macro: args.macroName,
          id: args.deviceId,
        });

        return { dataHandles: [] };
      },
    },

    restartRuntime: {
      description:
        "Restart the macro runtime on a device. Required after saving or activating macros.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
      }),
      execute: async (args: { deviceId: string }, context: {
        globalArgs: z.infer<typeof WebexGlobalArgsSchema>;
        logger: { info: (msg: string, vars?: Record<string, unknown>) => void };
      }) => {
        await xapiCommand(
          "Macros.Runtime.Restart",
          args.deviceId,
          context.globalArgs,
        );

        context.logger.info("Restarted macro runtime on device {id}", {
          id: args.deviceId,
        });

        return {
          data: {
            attributes: { deviceId: args.deviceId, runtimeRestarted: true },
            name: `runtime-restart-${sanitizeId(args.deviceId).slice(-12)}`,
          },
        };
      },
    },

    deploy: {
      description:
        "Full macro deployment lifecycle: ensure Macros.Mode is on, save the macro, activate it, and restart the runtime. Records each step for audit.",
      arguments: z.object({
        deviceId: z.string().describe("Webex device ID"),
        macroName: z.string().describe(
          "Macro name (alphanumeric and underscores)",
        ),
        content: z.string().describe("JavaScript macro source code"),
        transpile: z.boolean().optional().describe(
          "Whether to transpile ES6+ to ES5 (defaults to true)",
        ),
        removeExisting: z.boolean().optional().describe(
          "Remove existing macro with same name before saving (clean deploy, defaults to false)",
        ),
      }),
      execute: async (
        args: {
          deviceId: string;
          macroName: string;
          content: string;
          transpile: boolean;
          removeExisting: boolean;
        },
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
        const steps: Array<{
          step: string;
          success: boolean;
          error?: string;
        }> = [];

        // Step 1: Enable macro mode
        try {
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
          steps.push({ step: "enableMacroMode", success: true });
        } catch (e) {
          steps.push({
            step: "enableMacroMode",
            success: false,
            error: (e as Error).message,
          });
        }

        // Step 2: Remove existing (if requested)
        if (args.removeExisting) {
          try {
            await xapiCommand(
              "Macros.Macro.Remove",
              args.deviceId,
              context.globalArgs,
              { Name: args.macroName },
            );
            steps.push({ step: "removeExisting", success: true });
          } catch (e) {
            steps.push({
              step: "removeExisting",
              success: false,
              error: (e as Error).message,
            });
          }
        }

        // Step 3: Save macro
        try {
          await xapiCommand(
            "Macros.Macro.Save",
            args.deviceId,
            context.globalArgs,
            {
              Name: args.macroName,
              Overwrite: "True",
              Transpile: (args.transpile !== false) ? "True" : "False",
            },
            args.content,
          );
          steps.push({ step: "save", success: true });
        } catch (e) {
          steps.push({
            step: "save",
            success: false,
            error: (e as Error).message,
          });
        }

        // Step 4: Activate
        try {
          await xapiCommand(
            "Macros.Macro.Activate",
            args.deviceId,
            context.globalArgs,
            { Name: args.macroName },
          );
          steps.push({ step: "activate", success: true });
        } catch (e) {
          steps.push({
            step: "activate",
            success: false,
            error: (e as Error).message,
          });
        }

        // Step 5: Restart runtime
        try {
          await xapiCommand(
            "Macros.Runtime.Restart",
            args.deviceId,
            context.globalArgs,
          );
          steps.push({ step: "restartRuntime", success: true });
        } catch (e) {
          steps.push({
            step: "restartRuntime",
            success: false,
            error: (e as Error).message,
          });
        }

        const allSuccess = steps.every((s) => s.success);
        const deploymentRecord = {
          deviceId: args.deviceId,
          macroName: args.macroName,
          steps,
          success: allSuccess,
          deployedAt: new Date().toISOString(),
        };

        const deployName = sanitizeId(
          `${args.deviceId.slice(-8)}-${args.macroName}-${Date.now()}`,
        );
        const deployHandle = await context.writeResource(
          "deployment",
          deployName,
          deploymentRecord,
        );

        // Also write the macro resource if save succeeded
        const handles = [deployHandle];
        if (steps.find((s) => s.step === "save")?.success) {
          const macroName = sanitizeId(
            `${args.deviceId.slice(-8)}-${args.macroName}`,
          );
          const macroHandle = await context.writeResource("macro", macroName, {
            deviceId: args.deviceId,
            macroName: args.macroName,
            active: steps.find((s) => s.step === "activate")?.success ?? false,
            content: args.content,
            deployedAt: deploymentRecord.deployedAt,
          });
          handles.push(macroHandle);
        }

        context.logger.info(
          "Deployed macro {macro} to device {id}: {result}",
          {
            macro: args.macroName,
            id: args.deviceId,
            result: allSuccess ? "all steps succeeded" : "some steps failed",
          },
        );

        return { dataHandles: handles };
      },
    },

    deployFleet: {
      description:
        "Deploy a macro to multiple devices. Runs the full deploy lifecycle on each device sequentially with error isolation — a failure on one device does not stop deployment to remaining devices.",
      arguments: z.object({
        deviceIds: z.array(z.string()).min(1).describe(
          "Array of Webex device IDs to deploy to",
        ),
        macroName: z.string().describe(
          "Macro name (alphanumeric and underscores)",
        ),
        content: z.string().describe("JavaScript macro source code"),
        transpile: z.boolean().optional().describe(
          "Whether to transpile ES6+ to ES5 (defaults to true)",
        ),
        removeExisting: z.boolean().optional().describe(
          "Remove existing macro before saving on each device (defaults to false)",
        ),
      }),
      execute: async (
        args: {
          deviceIds: string[];
          macroName: string;
          content: string;
          transpile: boolean;
          removeExisting: boolean;
        },
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
        const handles = [];
        let successCount = 0;
        let failCount = 0;

        for (const deviceId of args.deviceIds) {
          const steps: Array<{
            step: string;
            success: boolean;
            error?: string;
          }> = [];

          // Enable macro mode
          try {
            await patchDeviceConfig(deviceId, context.globalArgs, [
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
            steps.push({ step: "enableMacroMode", success: true });
          } catch (e) {
            steps.push({
              step: "enableMacroMode",
              success: false,
              error: (e as Error).message,
            });
          }

          // Remove existing if requested
          if (args.removeExisting) {
            try {
              await xapiCommand(
                "Macros.Macro.Remove",
                deviceId,
                context.globalArgs,
                { Name: args.macroName },
              );
              steps.push({ step: "removeExisting", success: true });
            } catch (e) {
              steps.push({
                step: "removeExisting",
                success: false,
                error: (e as Error).message,
              });
            }
          }

          // Save
          try {
            await xapiCommand(
              "Macros.Macro.Save",
              deviceId,
              context.globalArgs,
              {
                Name: args.macroName,
                Overwrite: "True",
                Transpile: (args.transpile !== false) ? "True" : "False",
              },
              args.content,
            );
            steps.push({ step: "save", success: true });
          } catch (e) {
            steps.push({
              step: "save",
              success: false,
              error: (e as Error).message,
            });
          }

          // Activate
          try {
            await xapiCommand(
              "Macros.Macro.Activate",
              deviceId,
              context.globalArgs,
              { Name: args.macroName },
            );
            steps.push({ step: "activate", success: true });
          } catch (e) {
            steps.push({
              step: "activate",
              success: false,
              error: (e as Error).message,
            });
          }

          // Restart runtime
          try {
            await xapiCommand(
              "Macros.Runtime.Restart",
              deviceId,
              context.globalArgs,
            );
            steps.push({ step: "restartRuntime", success: true });
          } catch (e) {
            steps.push({
              step: "restartRuntime",
              success: false,
              error: (e as Error).message,
            });
          }

          const allSuccess = steps.every((s) => s.success);
          if (allSuccess) successCount++;
          else failCount++;

          const deployName = sanitizeId(
            `${deviceId.slice(-8)}-${args.macroName}-${Date.now()}`,
          );
          const handle = await context.writeResource(
            "deployment",
            deployName,
            {
              deviceId,
              macroName: args.macroName,
              steps,
              success: allSuccess,
              deployedAt: new Date().toISOString(),
            },
          );
          handles.push(handle);
        }

        context.logger.info(
          "Fleet deploy of {macro}: {success} succeeded, {fail} failed across {total} devices",
          {
            macro: args.macroName,
            success: successCount,
            fail: failCount,
            total: args.deviceIds.length,
          },
        );

        return { dataHandles: handles };
      },
    },
  },
};
