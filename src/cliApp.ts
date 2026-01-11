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

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('npx chrome-devtools-mcp@latest')
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
      'Start a stateful session over stdin/stdout (JSON lines)',
      y => {
        return y.option('format', {
          choices: ['json'] as const,
          default: 'json',
          describe:
            'Output format. In session mode, each tool result is written as a single JSON line.',
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

        const writeJsonLine = (obj: unknown) => {
          process.stdout.write(`${JSON.stringify(obj)}\n`);
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
              if (!trimmed) {
                continue;
              }

              let message: unknown;
              try {
                message = JSON.parse(trimmed);
              } catch (err) {
                writeJsonLine({
                  isError: true,
                  error:
                    err instanceof Error ? err.message : 'Invalid JSON message',
                });
                continue;
              }

              if (
                !message ||
                typeof message !== 'object' ||
                Array.isArray(message)
              ) {
                writeJsonLine({
                  isError: true,
                  error: 'Expected an object message',
                });
                continue;
              }

              const msg = message as Record<string, unknown>;
              const maybeTool = msg['tool'];
              if (maybeTool === 'exit' || maybeTool === 'quit') {
                break;
              }
              if (typeof maybeTool !== 'string' || !maybeTool.trim()) {
                writeJsonLine({
                  isError: true,
                  error: 'Missing required field: "tool" (string)',
                });
                continue;
              }

              const toolName = maybeTool.trim();
              const tool = tools.find(t => t.name === toolName);
              if (!tool) {
                writeJsonLine({
                  tool: toolName,
                  isError: true,
                  error: `Unknown tool: ${toolName}`,
                });
                continue;
              }
              if (!toolIsEnabled(args, tool)) {
                writeJsonLine({
                  tool: toolName,
                  isError: true,
                  error: `Tool ${toolName} is disabled by category or experimental flags.`,
                });
                continue;
              }

              const guard = await toolMutex.acquire();
              try {
                const maybeParams = msg['params'];
                const rawParams =
                  maybeParams &&
                  typeof maybeParams === 'object' &&
                  !Array.isArray(maybeParams)
                    ? (maybeParams as Record<string, unknown>)
                    : {};
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
                writeJsonLine({
                  tool: tool.name,
                  content,
                });
              } catch (err) {
                const errorText =
                  err instanceof Error ? err.message : String(err);
                writeJsonLine({
                  tool: toolName,
                  isError: true,
                  error: errorText,
                });
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
      ['call <tool>', '$0 <tool>'],
      'Invoke a tool once and print its output',
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
        const tool = tools.find(t => t.name === toolName);
        if (!tool) {
          throw new Error(`Unknown tool: ${toolName}`);
        }
        if (!toolIsEnabled(args, tool)) {
          throw new Error(
            `Tool ${toolName} is disabled by category or experimental flags.`,
          );
        }

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
        const guard = await toolMutex.acquire();
        try {
          await loadIssueDescriptions();
          await context.detectOpenDevToolsWindows();

          let rawParams: Record<string, unknown> = {};
          if (args.params) {
            rawParams = parseJsonObject(String(args.params), '--params');
          } else if (args.paramsFile) {
            const content = await fs.readFile(String(args.paramsFile), 'utf8');
            rawParams = parseJsonObject(content, args.paramsFile);
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

          if (args.format === 'json') {
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
          } else {
            for (const item of content) {
              if (item.type === 'text') {
                process.stdout.write(`${item.text}\n`);
              } else {
                process.stdout.write(
                  `[image ${item.mimeType} ${item.data.length}b base64]\n`,
                );
              }
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
      },
    )
    .recommendCommands()
    .wrap(Math.min(120, process.stdout.columns || 120))
    .help()
    .version(VERSION)
    .parseAsync();

  return argv;
}

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
