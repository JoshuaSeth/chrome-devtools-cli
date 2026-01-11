/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import process from 'node:process';
import readline from 'node:readline';

import type {Channel} from './browser.js';
import {ensureBrowserConnected, ensureBrowserLaunched} from './browser.js';
import {cliOptions} from './cli.js';
import {loadIssueDescriptions} from './issue-descriptions.js';
import {logger, saveLogsToFile} from './logger.js';
import {McpContext} from './McpContext.js';
import {McpResponse} from './McpResponse.js';
import {Mutex} from './Mutex.js';
import {hideBin, yargs, zod} from './third_party/index.js';
import {ToolCategory} from './tools/categories.js';
import {tools} from './tools/tools.js';
import {VERSION} from './version.js';

type CliOutputFormat = 'json' | 'text';

interface ZodCheck {
  kind: string;
}

interface ZodDef {
  typeName: string;
  checks?: ZodCheck[];
  values?: string[];
  type?: ZodSchema;
  innerType?: ZodSchema;
  schema?: ZodSchema;
  defaultValue?: () => unknown;
}

interface ZodSchema {
  _def: ZodDef;
  description?: string;
}

function toolIsEnabled(args: Record<string, unknown>, tool: (typeof tools)[0]) {
  if (
    tool.annotations.category === ToolCategory.EMULATION &&
    args.categoryEmulation === false
  ) {
    return false;
  }
  if (
    tool.annotations.category === ToolCategory.PERFORMANCE &&
    args.categoryPerformance === false
  ) {
    return false;
  }
  if (
    tool.annotations.category === ToolCategory.NETWORK &&
    args.categoryNetwork === false
  ) {
    return false;
  }
  if (
    tool.annotations.conditions?.includes('computerVision') &&
    !args.experimentalVision
  ) {
    return false;
  }
  return true;
}

function parseJsonObject(arg: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(arg) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Failed to parse ${label} as JSON object: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function parseJsonArray(arg: string, label: string): unknown[] {
  try {
    const parsed = JSON.parse(arg) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON array`);
    }
    return parsed;
  } catch (err) {
    throw new Error(
      `Failed to parse ${label} as JSON array: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function unwrapZodSchema(
  schema: ZodSchema,
): {
  schema: ZodSchema;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
} {
  let description = schema.description;
  let defaultValue: unknown;
  let required = true;

  let def = schema._def;
  while (
    def.typeName === 'ZodOptional' ||
    def.typeName === 'ZodDefault' ||
    def.typeName === 'ZodEffects'
  ) {
    if (def.typeName === 'ZodOptional') {
      required = false;
    }
    if (def.typeName === 'ZodDefault') {
      required = false;
      if (def.defaultValue) {
        defaultValue = def.defaultValue();
      }
    }

    const next = def.innerType || def.schema;
    if (!next) {
      break;
    }
    schema = next;
    def = schema._def;
    if (!description && schema.description) {
      description = schema.description;
    }
  }

  return {schema, required, description, defaultValue};
}

function schemaToYargsOption(schema: ZodSchema, key: string) {
  const {schema: unwrapped, required, description, defaultValue} =
    unwrapZodSchema(schema);
  const def = unwrapped._def;

  const base = {
    describe: description,
    demandOption: required,
    default: defaultValue,
  };

  switch (def.typeName) {
    case 'ZodString':
      return {
        ...base,
        type: 'string' as const,
      };
    case 'ZodNumber':
      return {
        ...base,
        type: 'number' as const,
      };
    case 'ZodBoolean':
      return {
        ...base,
        type: 'boolean' as const,
      };
    case 'ZodEnum':
      return {
        ...base,
        type: 'string' as const,
        choices: def.values,
      };
    case 'ZodArray': {
      const inner = def.type;
      if (!inner) {
        return {
          ...base,
          type: 'string' as const,
          coerce: (value: unknown) => {
            if (value === undefined) return undefined;
            return parseJsonArray(String(value), `--${key}`);
          },
        };
      }

      const innerDef = unwrapZodSchema(inner).schema._def;
      if (
        innerDef.typeName === 'ZodEnum' ||
        innerDef.typeName === 'ZodString' ||
        innerDef.typeName === 'ZodNumber'
      ) {
        return {
          ...base,
          type: 'array' as const,
          choices:
            innerDef.typeName === 'ZodEnum' ? (innerDef.values ?? []) : undefined,
          coerce: (value: unknown) => {
            if (value === undefined) return undefined;
            const arr = Array.isArray(value) ? value : [value];
            if (innerDef.typeName === 'ZodNumber') {
              return arr.map(v => Number(v));
            }
            return arr.map(v => String(v));
          },
        };
      }

      return {
        ...base,
        type: 'string' as const,
        coerce: (value: unknown) => {
          if (value === undefined) return undefined;
          return parseJsonArray(String(value), `--${key}`);
        },
      };
    }
    case 'ZodObject':
      return {
        ...base,
        type: 'string' as const,
        coerce: (value: unknown) => {
          if (value === undefined) return undefined;
          return parseJsonObject(String(value), `--${key}`);
        },
      };
    default:
      return {
        ...base,
        type: 'string' as const,
      };
  }
}

function schemaIsPositionalFriendly(schema: ZodSchema): boolean {
  const {schema: unwrapped} = unwrapZodSchema(schema);
  const def = unwrapped._def;
  return (
    def.typeName === 'ZodString' ||
    def.typeName === 'ZodNumber' ||
    def.typeName === 'ZodEnum'
  );
}

function tokenizeCliLine(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  const push = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = '';
    }
  };

  for (const char of line) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      push();
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error('Unterminated quote in CLI line');
  }
  if (escaping) {
    current += '\\';
  }
  push();
  return tokens;
}

function kebabToCamelCase(key: string): string {
  return key.replaceAll(/-([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

function parseBooleanLike(value: string, label: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  throw new Error(`Invalid boolean for ${label}: ${value}`);
}

function coerceCliValue(schema: ZodSchema, key: string, raw: string): unknown {
  const {schema: unwrapped} = unwrapZodSchema(schema);
  const def = unwrapped._def;

  switch (def.typeName) {
    case 'ZodString':
      return raw;
    case 'ZodNumber': {
      const numberValue = Number(raw);
      if (!Number.isFinite(numberValue)) {
        throw new Error(`Invalid number for --${key}: ${raw}`);
      }
      return numberValue;
    }
    case 'ZodBoolean':
      return parseBooleanLike(raw, `--${key}`);
    case 'ZodEnum':
      return raw;
    case 'ZodObject':
      return parseJsonObject(raw, `--${key}`);
    case 'ZodArray': {
      const trimmed = raw.trim();
      if (trimmed.startsWith('[')) {
        return parseJsonArray(trimmed, `--${key}`);
      }

      const inner = def.type;
      if (!inner) {
        throw new Error(`--${key} must be a JSON array`);
      }

      const innerDef = unwrapZodSchema(inner).schema._def;
      if (innerDef.typeName === 'ZodString') {
        return raw;
      }
      if (innerDef.typeName === 'ZodNumber') {
        const numberValue = Number(raw);
        if (!Number.isFinite(numberValue)) {
          throw new Error(`Invalid number for --${key}: ${raw}`);
        }
        return numberValue;
      }
      if (innerDef.typeName === 'ZodEnum') {
        return raw;
      }

      throw new Error(`--${key} must be a JSON array`);
    }
    default:
      return raw;
  }
}

function assignCliValue(
  params: Record<string, unknown>,
  key: string,
  schema: ZodSchema,
  value: unknown,
) {
  const {schema: unwrapped} = unwrapZodSchema(schema);
  if (unwrapped._def.typeName !== 'ZodArray') {
    params[key] = value;
    return;
  }

  if (Array.isArray(value)) {
    params[key] = value;
    return;
  }

  const existing = params[key];
  if (!existing) {
    params[key] = [value];
    return;
  }

  if (!Array.isArray(existing)) {
    params[key] = [existing, value];
    return;
  }

  existing.push(value);
}

function parseToolParamsFromCliTokens(
  tool: (typeof tools)[0],
  tokens: string[],
): Record<string, unknown> {
  const schemaEntries = Object.entries(
    tool.schema as unknown as Record<string, ZodSchema>,
  );
  const schemaByKey = new Map(schemaEntries);

  const positionalKeys = schemaEntries
    .filter(([, schema]) => unwrapZodSchema(schema).required)
    .filter(([, schema]) => schemaIsPositionalFriendly(schema))
    .map(([key]) => key);

  const params: Record<string, unknown> = {};
  let nextPositionalKeyIndex = 0;
  let afterDoubleDash = false;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '--') {
      // Everything after `--` is treated as positional args.
      afterDoubleDash = true;
      continue;
    }

    if (!afterDoubleDash && token.startsWith('--')) {
      const withoutPrefix = token.slice(2);
      if (!withoutPrefix) {
        continue;
      }

      if (withoutPrefix.startsWith('no-')) {
        const rawKey = withoutPrefix.slice(3);
        const key = kebabToCamelCase(rawKey);
        const schema = schemaByKey.get(key);
        if (!schema) {
          throw new Error(`Unknown param: --${rawKey}`);
        }
        assignCliValue(params, key, schema, false);
        continue;
      }

      let rawKey: string;
      let rawValue: string | undefined;
      const equalsIndex = withoutPrefix.indexOf('=');
      if (equalsIndex !== -1) {
        rawKey = withoutPrefix.slice(0, equalsIndex);
        rawValue = withoutPrefix.slice(equalsIndex + 1);
      } else {
        rawKey = withoutPrefix;
      }

      const key = kebabToCamelCase(rawKey);
      const schema = schemaByKey.get(key);
      if (!schema) {
        throw new Error(`Unknown param: --${rawKey}`);
      }

      const {schema: unwrapped} = unwrapZodSchema(schema);
      const typeName = unwrapped._def.typeName;

      if (rawValue === undefined && typeName === 'ZodBoolean') {
        assignCliValue(params, key, schema, true);
        continue;
      }

      if (rawValue === undefined) {
        rawValue = tokens[i + 1];
        if (rawValue === undefined) {
          throw new Error(`Missing value for --${rawKey}`);
        }
        i++;
      }

      const coercedValue = coerceCliValue(schema, key, rawValue);
      assignCliValue(params, key, schema, coercedValue);
      continue;
    }

    if (nextPositionalKeyIndex >= positionalKeys.length) {
      throw new Error(`Unexpected extra arg: ${token}`);
    }

    const key = positionalKeys[nextPositionalKeyIndex++];
    const schema = schemaByKey.get(key);
    if (!schema) {
      throw new Error(`Unexpected positional arg for unknown param: ${key}`);
    }
    params[key] = coerceCliValue(schema, key, token);
  }

  return params;
}

async function runToolOnce(args: Record<string, unknown>, toolName: string) {
  const tool = tools.find(t => t.name === toolName);
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  if (!toolIsEnabled(args, tool)) {
    throw new Error(
      `Tool ${toolName} is disabled by category or experimental flags.`,
    );
  }

  const logFile = args.logFile ? saveLogsToFile(String(args.logFile)) : undefined;

  const chromeArgsRaw = args.chromeArg;
  const extraArgs: string[] = Array.isArray(chromeArgsRaw)
    ? chromeArgsRaw.map(String)
    : chromeArgsRaw
      ? [String(chromeArgsRaw)]
      : [];
  if (args.proxyServer) {
    extraArgs.push(`--proxy-server=${args.proxyServer}`);
  }

  const devtools = (args.experimentalDevtools as boolean | undefined) ?? false;
  const browser =
    args.browserUrl || args.wsEndpoint || args.autoConnect
      ? await ensureBrowserConnected({
          browserURL: args.browserUrl ? String(args.browserUrl) : undefined,
          wsEndpoint: args.wsEndpoint ? String(args.wsEndpoint) : undefined,
          wsHeaders: (args.wsHeaders as Record<string, string> | undefined) ?? undefined,
          // Important: only pass channel, if autoConnect is true.
          channel: args.autoConnect ? (args.channel as Channel) : undefined,
          userDataDir: args.userDataDir ? String(args.userDataDir) : undefined,
          devtools,
        })
      : await ensureBrowserLaunched({
          headless: Boolean(args.headless),
          executablePath: args.executablePath
            ? String(args.executablePath)
            : undefined,
          channel: args.channel as Channel,
          isolated: (args.isolated as boolean | undefined) ?? false,
          userDataDir: args.userDataDir ? String(args.userDataDir) : undefined,
          logFile,
          viewport: (args.viewport as {width: number; height: number} | undefined) ?? undefined,
          args: extraArgs,
          acceptInsecureCerts: args.acceptInsecureCerts as boolean | undefined,
          devtools,
        });

  const shouldCloseBrowser = !args.browserUrl && !args.wsEndpoint && !args.autoConnect;

  const context = await McpContext.from(browser, logger, {
    experimentalDevToolsDebugging: devtools,
    experimentalIncludeAllPages: args.experimentalIncludeAllPages as
      | boolean
      | undefined,
  });

  const toolMutex = new Mutex();
  const guard = await toolMutex.acquire();
  try {
    await loadIssueDescriptions();
    await context.detectOpenDevToolsWindows();

    const rawParams: Record<string, unknown> = {};
    for (const key of Object.keys(tool.schema)) {
      if (args[key] !== undefined) {
        rawParams[key] = args[key];
      }
    }

    const parsedParams = zod.object(tool.schema).parse(rawParams);

    const response = new McpResponse();
    await tool.handler(
      {
        params: parsedParams,
      },
      response,
      context,
    );

    const content = await response.handle(tool.name, context);

    const format = (args.format as CliOutputFormat | undefined) ?? 'text';
    if (format === 'json') {
      console.log(
        JSON.stringify(
          {
            tool: tool.name,
            content,
          },
          null,
          2,
        ),
      );
      return;
    }

    for (const item of content) {
      if (item.type === 'text') {
        process.stdout.write(`${item.text}\n`);
      } else {
        process.stdout.write(
          `[image ${item.mimeType} ${item.data.length}b base64]\n`,
        );
      }
    }
  } finally {
    guard.dispose();
    context.dispose();
    if (shouldCloseBrowser) {
      await browser.close();
    } else {
      await browser.disconnect();
    }
  }
}

async function main() {
  const cli = yargs(hideBin(process.argv))
    .scriptName('chrome_devtools')
    .options(cliOptions)
    .command(
      'list-tools',
      'List available tools',
      y => {
        return y
          .option('format', {
            choices: ['json', 'text'] as const,
            default: 'text' satisfies CliOutputFormat,
            describe: 'Output format.',
          })
          .option('all', {
            type: 'boolean',
            default: false,
            describe:
              'Include tools that are disabled by category flags and experimental feature flags.',
          });
      },
      args => {
        const availableTools = args.all
          ? tools
          : tools.filter(tool => toolIsEnabled(args, tool));

        if (args.format === 'json') {
          console.log(
            JSON.stringify(
              availableTools.map(tool => ({
                name: tool.name,
                description: tool.description,
                annotations: tool.annotations,
              })),
              null,
              2,
            ),
          );
          return;
        }

        for (const tool of availableTools) {
          console.log(`${tool.name}\t${tool.description}`);
        }
      },
    )
    .command(
      'session',
      'Start a stateful session over stdin/stdout (JSON lines or CLI lines)',
      y => {
        return y.option('format', {
          choices: ['json', 'text'] as const,
          default: 'json' satisfies CliOutputFormat,
          describe:
            'Output format. In session mode, each tool result is written either as a single JSON line or printed as text.',
        });
      },
      async args => {
        const logFile = args.logFile ? saveLogsToFile(args.logFile) : undefined;

        const extraArgs: string[] = (args.chromeArg ?? []).map(String);
        if (args.proxyServer) {
          extraArgs.push(`--proxy-server=${args.proxyServer}`);
        }

        const devtools = args.experimentalDevtools ?? false;
        const browser =
          args.browserUrl || args.wsEndpoint || args.autoConnect
            ? await ensureBrowserConnected({
                browserURL: args.browserUrl,
                wsEndpoint: args.wsEndpoint,
                wsHeaders: args.wsHeaders,
                // Important: only pass channel, if autoConnect is true.
                channel: args.autoConnect
                  ? (args.channel as Channel)
                  : undefined,
                userDataDir: args.userDataDir,
                devtools,
              })
            : await ensureBrowserLaunched({
                headless: args.headless,
                executablePath: args.executablePath,
                channel: args.channel as Channel,
                isolated: args.isolated ?? false,
                userDataDir: args.userDataDir,
                logFile,
                viewport: args.viewport,
                args: extraArgs,
                acceptInsecureCerts: args.acceptInsecureCerts,
                devtools,
              });

        const shouldCloseBrowser =
          !args.browserUrl && !args.wsEndpoint && !args.autoConnect;

        const context = await McpContext.from(browser, logger, {
          experimentalDevToolsDebugging: devtools,
          experimentalIncludeAllPages: args.experimentalIncludeAllPages,
        });

        const toolMutex = new Mutex();

        const format = (args.format as CliOutputFormat | undefined) ?? 'json';

        const writeJsonLine = (obj: unknown) => {
          process.stdout.write(`${JSON.stringify(obj)}\n`);
        };

        const writeToolSuccess = (toolName: string, content: unknown) => {
          if (format === 'json') {
            writeJsonLine({
              tool: toolName,
              content,
            });
            return;
          }

          const items = content as Array<
            | {type: 'text'; text: string}
            | {type: 'image'; mimeType: string; data: string}
          >;
          for (const item of items) {
            if (item.type === 'text') {
              process.stdout.write(`${item.text}\n`);
            } else {
              process.stdout.write(
                `[image ${item.mimeType} ${item.data.length}b base64]\n`,
              );
            }
          }
        };

        const writeToolError = (toolName: string, errorText: string) => {
          if (format === 'json') {
            writeJsonLine({
              tool: toolName,
              isError: true,
              error: errorText,
            });
            return;
          }
          process.stderr.write(`${toolName}: ${errorText}\n`);
        };

        try {
          await loadIssueDescriptions();
          await context.detectOpenDevToolsWindows();

          const rl = readline.createInterface({
            input: process.stdin,
            crlfDelay: Infinity,
          });

          try {
            for await (const line of rl) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('#')) {
                continue;
              }

              let toolName: string;
              let rawParams: Record<string, unknown>;

              if (trimmed.startsWith('{')) {
                let message: unknown;
                try {
                  message = JSON.parse(trimmed);
                } catch (err) {
                  writeToolError(
                    'session',
                    err instanceof Error ? err.message : 'Invalid JSON message',
                  );
                  continue;
                }

                if (
                  !message ||
                  typeof message !== 'object' ||
                  Array.isArray(message)
                ) {
                  writeToolError('session', 'Expected an object message');
                  continue;
                }

                const msg = message as Record<string, unknown>;
                const maybeTool = msg['tool'];
                if (maybeTool === 'exit' || maybeTool === 'quit') {
                  break;
                }
                if (typeof maybeTool !== 'string' || !maybeTool.trim()) {
                  writeToolError(
                    'session',
                    'Missing required field: "tool" (string)',
                  );
                  continue;
                }

                toolName = maybeTool.trim();

                const maybeParams = msg['params'];
                rawParams =
                  maybeParams &&
                  typeof maybeParams === 'object' &&
                  !Array.isArray(maybeParams)
                    ? (maybeParams as Record<string, unknown>)
                    : {};
              } else {
                let tokens: string[];
                try {
                  tokens = tokenizeCliLine(trimmed);
                } catch (err) {
                  writeToolError(
                    'session',
                    err instanceof Error ? err.message : String(err),
                  );
                  continue;
                }

                if (tokens.length === 0) {
                  continue;
                }
                const commandTokens =
                  tokens[0] === 'chrome_devtools' ||
                  tokens[0] === 'chrome-devtools-cli' ||
                  tokens[0] === 'chrome-devtools-mcp'
                    ? tokens.slice(1)
                    : tokens;

                if (commandTokens.length === 0) {
                  continue;
                }

                const first = commandTokens[0];
                if (first === 'exit' || first === 'quit') {
                  break;
                }

                toolName = first.replaceAll('-', '_');
                const tool = tools.find(t => t.name === toolName);
                if (!tool) {
                  writeToolError('session', `Unknown tool: ${toolName}`);
                  continue;
                }

                try {
                  rawParams = parseToolParamsFromCliTokens(tool, commandTokens);
                } catch (err) {
                  writeToolError(
                    toolName,
                    err instanceof Error ? err.message : String(err),
                  );
                  continue;
                }
              }

              const tool = tools.find(t => t.name === toolName);
              if (!tool) {
                writeToolError(toolName, `Unknown tool: ${toolName}`);
                continue;
              }
              if (!toolIsEnabled(args, tool)) {
                writeToolError(
                  toolName,
                  `Tool ${toolName} is disabled by category or experimental flags.`,
                );
                continue;
              }

              const guard = await toolMutex.acquire();
              try {
                const parsedParams = zod.object(tool.schema).parse(rawParams);

                const response = new McpResponse();
                await tool.handler(
                  {
                    params: parsedParams,
                  },
                  response,
                  context,
                );
                const content = await response.handle(tool.name, context);
                writeToolSuccess(tool.name, content);
              } catch (err) {
                const errorText =
                  err instanceof Error ? err.message : String(err);
                writeToolError(toolName, errorText);
              } finally {
                guard.dispose();
              }
            }
          } finally {
            rl.close();
          }
        } finally {
          context.dispose();
          if (shouldCloseBrowser) {
            await browser.close();
          } else {
            await browser.disconnect();
          }
        }
      },
    )
    .command(
      'call <tool>',
      'Invoke a tool once (JSON params via --params/--paramsFile)',
      y => {
        return y
          .option('params', {
            type: 'string',
            describe: 'Tool params as a JSON object string.',
          })
          .option('paramsFile', {
            type: 'string',
            describe: 'Path to a JSON file containing the tool params object.',
          })
          .option('format', {
            choices: ['json', 'text'] as const,
            default: 'json' satisfies CliOutputFormat,
            describe: 'Output format.',
          })
          .check(args => {
            if (args.params && args.paramsFile) {
              throw new Error('Use either --params or --paramsFile, not both.');
            }
            return true;
          });
      },
      async args => {
        const toolName = String(args.tool);

        let rawParams: Record<string, unknown> = {};
        if (args.params) {
          rawParams = parseJsonObject(String(args.params), '--params');
        } else if (args.paramsFile) {
          const content = await fs.readFile(String(args.paramsFile), 'utf8');
          rawParams = parseJsonObject(content, String(args.paramsFile));
        }

        for (const [key, value] of Object.entries(rawParams)) {
          (args as Record<string, unknown>)[key] = value;
        }

        await runToolOnce(args as Record<string, unknown>, toolName);
      },
    )

  for (const tool of tools) {
    const dashed = tool.name.replaceAll('_', '-');
    const aliases = dashed === tool.name ? [] : [dashed];

    const schemaEntries = Object.entries(
      tool.schema as unknown as Record<string, ZodSchema>,
    );

    const positionalKeys = schemaEntries
      .filter(([, schema]) => unwrapZodSchema(schema).required)
      .filter(([, schema]) => schemaIsPositionalFriendly(schema))
      .map(([key]) => key);

    const command =
      positionalKeys.length > 0
        ? `${tool.name} ${positionalKeys.map(k => `<${k}>`).join(' ')}`
        : tool.name;

    cli.command({
      command,
      aliases,
      describe: tool.description,
      builder: cmd => {
        const anyCmd = cmd as unknown as any;

        anyCmd.option('format', {
          choices: ['text', 'json'] as const,
          default: 'text' satisfies CliOutputFormat,
          describe: 'Output format.',
        });

        for (const [key, schema] of schemaEntries) {
          const option = schemaToYargsOption(schema, key);
          anyCmd.option(key, option);
          if (positionalKeys.includes(key)) {
            anyCmd.positional(key, option);
          }
        }

        return cmd;
      },
      handler: async cmdArgs => {
        await runToolOnce(cmdArgs as Record<string, unknown>, tool.name);
      },
    });
  }

  const parsed = await cli
    .demandCommand(1, 'Specify a command (tool name, list-tools, session).')
    .strict()
    .recommendCommands()
    .wrap(Math.min(120, process.stdout.columns || 120))
    .help()
    .version(VERSION)
    .parseAsync();

  return parsed;
}

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
