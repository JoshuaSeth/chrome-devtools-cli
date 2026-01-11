/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';

import type {Tool} from '@modelcontextprotocol/sdk/types.js';

import {cliOptions} from '../build/src/cli.js';
import {ToolCategory, labels} from '../build/src/tools/categories.js';
import {tools} from '../build/src/tools/tools.js';

const OUTPUT_PATH = './docs/tool-reference.md';
const README_PATH = './README.md';
const CLI_COMMANDS_README_BEGIN_MARKER =
  '<!-- BEGIN AUTO GENERATED CLI COMMANDS -->';
const CLI_COMMANDS_README_END_MARKER =
  '<!-- END AUTO GENERATED CLI COMMANDS -->';

// Extend the MCP Tool type to include our annotations
interface ToolWithAnnotations extends Tool {
  annotations?: {
    title?: string;
    category?: typeof ToolCategory;
    conditions?: string[];
  };
  schema?: Record<string, ZodSchema>;
}

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

interface TypeInfo {
  type: string;
  enum?: string[];
  items?: TypeInfo;
  description?: string;
  default?: unknown;
}

function escapeHtmlTags(text: string): string {
  return text
    .replace(/&(?![a-zA-Z]+;)/g, '&amp;')
    .replace(/<([a-zA-Z][^>]*)>/g, '&lt;$1&gt;');
}

function addCrossLinks(text: string, tools: ToolWithAnnotations[]): string {
  let result = text;

  // Create a set of all tool names for efficient lookup
  const toolNames = new Set(tools.map(tool => tool.name));

  // Sort tool names by length (descending) to match longer names first
  const sortedToolNames = Array.from(toolNames).sort(
    (a, b) => b.length - a.length,
  );

  for (const toolName of sortedToolNames) {
    // Create regex to match tool name (case insensitive, word boundaries)
    const regex = new RegExp(`\\b${toolName}\\b`, 'gi');

    result = result.replace(regex, match => {
      // Only create link if the match isn't already inside a link
      if (result.indexOf(`[${match}]`) !== -1) {
        return match; // Already linked
      }
      const anchorLink = toolName.toLowerCase();
      return `[\`${match}\`](#${anchorLink})`;
    });
  }

  return result;
}

function generateToolsTOC(
  categories: Record<string, ToolWithAnnotations[]>,
  sortedCategories: string[],
): string {
  let toc = '';

  for (const category of sortedCategories) {
    const categoryTools = categories[category];
    const categoryName = labels[category];
    toc += `- **${categoryName}** (${categoryTools.length} tools)\n`;

    // Sort tools within category for TOC
    categoryTools.sort((a: Tool, b: Tool) => a.name.localeCompare(b.name));
    for (const tool of categoryTools) {
      const anchorLink = tool.name.toLowerCase();
      toc += `  - [\`${tool.name}\`](docs/tool-reference.md#${anchorLink})\n`;
    }
  }

  return toc;
}

function updateReadmeWithToolsTOC(toolsTOC: string): void {
  const readmeContent = fs.readFileSync(README_PATH, 'utf8');

  const beginMarker = '<!-- BEGIN AUTO GENERATED TOOLS -->';
  const endMarker = '<!-- END AUTO GENERATED TOOLS -->';

  const beginIndex = readmeContent.indexOf(beginMarker);
  const endIndex = readmeContent.indexOf(endMarker);

  if (beginIndex === -1 || endIndex === -1) {
    console.warn('Could not find auto-generated tools markers in README.md');
    return;
  }

  const before = readmeContent.substring(0, beginIndex + beginMarker.length);
  const after = readmeContent.substring(endIndex);

  const updatedContent = before + '\n\n' + toolsTOC + '\n' + after;

  fs.writeFileSync(README_PATH, updatedContent);
  console.log('Updated README.md with tools table of contents');
}

function generateConfigOptionsMarkdown(): string {
  let markdown = '';

  for (const [optionName, optionConfig] of Object.entries(cliOptions)) {
    // Skip hidden options
    if (optionConfig.hidden) {
      continue;
    }

    const aliasText = optionConfig.alias ? `, \`-${optionConfig.alias}\`` : '';
    const description = optionConfig.description || optionConfig.describe || '';

    // Convert camelCase to dash-case
    const dashCaseName = optionName
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase();
    const nameDisplay =
      dashCaseName !== optionName
        ? `\`--${optionName}\`/ \`--${dashCaseName}\``
        : `\`--${optionName}\``;

    // Start with option name and description
    markdown += `- **${nameDisplay}${aliasText}**\n`;
    markdown += `  ${description}\n`;

    // Add type information
    markdown += `  - **Type:** ${optionConfig.type}\n`;

    // Add choices if available
    if (optionConfig.choices) {
      markdown += `  - **Choices:** ${optionConfig.choices.map(c => `\`${c}\``).join(', ')}\n`;
    }

    // Add default if available
    if (optionConfig.default !== undefined) {
      markdown += `  - **Default:** \`${optionConfig.default}\`\n`;
    }

    markdown += '\n';
  }

  return markdown.trim();
}

function updateReadmeWithOptionsMarkdown(optionsMarkdown: string): void {
  const readmeContent = fs.readFileSync(README_PATH, 'utf8');

  const beginMarker = '<!-- BEGIN AUTO GENERATED OPTIONS -->';
  const endMarker = '<!-- END AUTO GENERATED OPTIONS -->';

  const beginIndex = readmeContent.indexOf(beginMarker);
  const endIndex = readmeContent.indexOf(endMarker);

  if (beginIndex === -1 || endIndex === -1) {
    console.warn('Could not find auto-generated options markers in README.md');
    return;
  }

  const before = readmeContent.substring(0, beginIndex + beginMarker.length);
  const after = readmeContent.substring(endIndex);

  const updatedContent = before + '\n\n' + optionsMarkdown + '\n\n' + after;

  fs.writeFileSync(README_PATH, updatedContent);
  console.log('Updated README.md with options markdown');
}

function updateReadmeWithCliCommandsMarkdown(
  cliCommandsMarkdown: string,
): void {
  const readmeContent = fs.readFileSync(README_PATH, 'utf8');

  const beginIndex = readmeContent.indexOf(CLI_COMMANDS_README_BEGIN_MARKER);
  const endIndex = readmeContent.indexOf(CLI_COMMANDS_README_END_MARKER);

  if (beginIndex === -1 || endIndex === -1) {
    console.warn(
      'Could not find auto-generated CLI commands markers in README.md',
    );
    return;
  }

  const before = readmeContent.substring(
    0,
    beginIndex + CLI_COMMANDS_README_BEGIN_MARKER.length,
  );
  const after = readmeContent.substring(endIndex);

  const updatedContent = before + '\n\n' + cliCommandsMarkdown + '\n\n' + after;

  fs.writeFileSync(README_PATH, updatedContent);
  console.log('Updated README.md with CLI commands');
}

const TOOL_CLI_EXAMPLE_PARAMS: Record<string, Record<string, unknown> | null> =
  {
    click: {uid: '<uid>'},
    close_page: {pageId: 2},
    drag: {from_uid: '<uid>', to_uid: '<uid>'},
    emulate: {networkConditions: 'Slow 3G', cpuThrottlingRate: 4},
    evaluate_script: {function: '() => document.title'},
    fill: {uid: '<uid>', value: 'Example text'},
    fill_form: {elements: [{uid: '<uid>', value: 'Example text'}]},
    get_console_message: {msgid: 1},
    get_network_request: {reqid: 1},
    handle_dialog: {action: 'accept'},
    hover: {uid: '<uid>'},
    list_console_messages: {pageSize: 25, pageIdx: 0},
    list_network_requests: {pageSize: 25, pageIdx: 0},
    list_pages: null,
    navigate_page: {url: 'https://example.com'},
    new_page: {url: 'https://example.com'},
    performance_analyze_insight: {
      insightSetId: '<insightSetId>',
      insightName: 'LCPBreakdown',
    },
    performance_get_event_by_key: {eventKey: 'r-123'},
    performance_get_main_thread_track_summary: {min: 0, max: 1_000_000},
    performance_get_network_track_summary: {min: 0, max: 1_000_000},
    performance_start_trace: {reload: true, autoStop: true},
    performance_stop_trace: null,
    press_key: {key: 'Enter'},
    resize_page: {width: 1280, height: 720},
    select_page: {pageId: 1},
    take_change_snapshot: {baselineKey: 'default'},
    take_screenshot: {fullPage: true},
    take_snapshot: {verbose: false},
    upload_file: {uid: '<uid>', filePath: '/absolute/path/to/file'},
    wait_for: {text: 'Example text'},
  };

function getCliCommandForTool(tool: ToolWithAnnotations): string {
  const exampleParams = TOOL_CLI_EXAMPLE_PARAMS[tool.name] ?? {};

  const schemaEntries = Object.entries(
    (tool.schema ?? {}) as Record<string, ZodSchema>,
  );

  const unwrap = (
    schema: ZodSchema,
  ): {
    schema: ZodSchema;
    required: boolean;
  } => {
    let required = true;
    let def = schema._def;
    while (
      def.typeName === 'ZodOptional' ||
      def.typeName === 'ZodDefault' ||
      def.typeName === 'ZodEffects'
    ) {
      if (def.typeName === 'ZodOptional' || def.typeName === 'ZodDefault') {
        required = false;
      }
      const next = def.innerType || def.schema;
      if (!next) break;
      schema = next;
      def = schema._def;
    }
    return {schema, required};
  };

  const isPositionalFriendly = (schema: ZodSchema): boolean => {
    const {schema: unwrapped} = unwrap(schema);
    return (
      unwrapped._def.typeName === 'ZodString' ||
      unwrapped._def.typeName === 'ZodNumber' ||
      unwrapped._def.typeName === 'ZodEnum'
    );
  };

  const requiredEntries = schemaEntries.filter(([, schema]) => unwrap(schema).required);
  const positionalKeys = requiredEntries
    .filter(([, schema]) => isPositionalFriendly(schema))
    .map(([key]) => key);

  const formatCliArg = (value: unknown): string => {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'string') {
      if (value.startsWith('<') && value.endsWith('>')) {
        return value;
      }
      if (/\s/.test(value) || value.includes('"') || value.includes("'")) {
        return JSON.stringify(value);
      }
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return `'${JSON.stringify(value)}'`;
  };

  const parts: string[] = ['chrome_devtools', tool.name];

  for (const key of positionalKeys) {
    const value =
      key in exampleParams ? (exampleParams as Record<string, unknown>)[key] : `<${key}>`;
    parts.push(formatCliArg(value));
  }

  for (const [key, schema] of schemaEntries) {
    if (positionalKeys.includes(key)) {
      continue;
    }

    const hasExample = Object.prototype.hasOwnProperty.call(exampleParams, key);
    const isRequired = unwrap(schema).required;
    if (!isRequired && !hasExample) {
      continue;
    }

    const value = hasExample
      ? (exampleParams as Record<string, unknown>)[key]
      : `<${key}>`;

    const {schema: unwrapped} = unwrap(schema);
    if (unwrapped._def.typeName === 'ZodBoolean') {
      if (typeof value === 'boolean') {
        parts.push(value ? `--${key}` : `--no-${key}`);
        continue;
      }
      parts.push(`--${key}`);
      parts.push('<true|false>');
      continue;
    }

    parts.push(`--${key}`);
    parts.push(formatCliArg(value));
  }

  return parts.join(' ');
}

function generateCliCommandsMarkdown(
  categories: Record<string, ToolWithAnnotations[]>,
  sortedCategories: string[],
): string {
  let markdown = '';

  markdown +=
    'These commands are generated from the tool definitions. Replace placeholders like `<uid>` and `<insightSetId>`.\n\n';
  markdown +=
    'For multi-step flows (required for `<uid>`-based tools), start a single browser session:\n\n';
  markdown += '```bash\nchrome_devtools session --headless --isolated --format text\n```\n\n';
  markdown +=
    'Then run tools as direct commands (you can paste the same lines into `session`; the `chrome_devtools` prefix is optional):\n';

  for (const category of sortedCategories) {
    const categoryTools = categories[category];
    const categoryName = labels[category];
    markdown += `\n#### ${categoryName}\n\n`;
    markdown += '```bash\n';

    // Sort tools within category for stable output
    categoryTools.sort((a: Tool, b: Tool) => a.name.localeCompare(b.name));
    for (const tool of categoryTools) {
      markdown += `${getCliCommandForTool(tool)}\n`;
    }

    markdown += '```\n';
  }

  return markdown.trim();
}

// Helper to convert Zod schema to JSON schema-like object for docs
function getZodTypeInfo(schema: ZodSchema): TypeInfo {
  let description = schema.description;
  let def = schema._def;
  let defaultValue: unknown;

  // Unwrap optional/default/effects
  while (
    def.typeName === 'ZodOptional' ||
    def.typeName === 'ZodDefault' ||
    def.typeName === 'ZodEffects'
  ) {
    if (def.typeName === 'ZodDefault' && def.defaultValue) {
      defaultValue = def.defaultValue();
    }
    const next = def.innerType || def.schema;
    if (!next) break;
    schema = next;
    def = schema._def;
    if (!description && schema.description) description = schema.description;
  }

  const result: TypeInfo = {type: 'unknown'};
  if (description) result.description = description;
  if (defaultValue !== undefined) result.default = defaultValue;

  switch (def.typeName) {
    case 'ZodString':
      result.type = 'string';
      break;
    case 'ZodNumber':
      result.type = def.checks?.some((c: ZodCheck) => c.kind === 'int')
        ? 'integer'
        : 'number';
      break;
    case 'ZodBoolean':
      result.type = 'boolean';
      break;
    case 'ZodEnum':
      result.type = 'string';
      result.enum = def.values;
      break;
    case 'ZodArray':
      result.type = 'array';
      if (def.type) {
        result.items = getZodTypeInfo(def.type);
      }
      break;
    default:
      result.type = 'unknown';
  }
  return result;
}

function isRequired(schema: ZodSchema): boolean {
  let def = schema._def;
  while (def.typeName === 'ZodEffects') {
    if (!def.schema) break;
    schema = def.schema;
    def = schema._def;
  }
  return def.typeName !== 'ZodOptional' && def.typeName !== 'ZodDefault';
}

async function generateToolDocumentation(): Promise<void> {
  try {
    console.log('Generating tool documentation from definitions...');

    // Convert ToolDefinitions to ToolWithAnnotations
    const toolsWithAnnotations: ToolWithAnnotations[] = tools
      .filter(tool => {
        if (!tool.annotations.conditions) {
          return true;
        }
        // Only include unconditional tools.
        return tool.annotations.conditions.length === 0;
      })
      .map(tool => {
        const properties: Record<string, TypeInfo> = {};
        const required: string[] = [];

        for (const [key, schema] of Object.entries(
          tool.schema as unknown as Record<string, ZodSchema>,
        )) {
          const info = getZodTypeInfo(schema);
          properties[key] = info;
          if (isRequired(schema)) {
            required.push(key);
          }
        }

        return {
          name: tool.name,
          description: tool.description,
          inputSchema: {
            type: 'object',
            properties,
            required,
          },
          schema: tool.schema as unknown as Record<string, ZodSchema>,
          annotations: tool.annotations,
        };
      });

    console.log(`Found ${toolsWithAnnotations.length} tools`);

    // Generate markdown documentation
    let markdown = `<!-- AUTO GENERATED DO NOT EDIT - run 'npm run docs' to update-->

# Chrome DevTools CLI Tool Reference

`;

    // Group tools by category (based on annotations)
    const categories: Record<string, ToolWithAnnotations[]> = {};
    toolsWithAnnotations.forEach((tool: ToolWithAnnotations) => {
      const category = tool.annotations?.category || 'Uncategorized';
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(tool);
    });

    // Sort categories using the enum order
    const categoryOrder = Object.values(ToolCategory);
    const sortedCategories = Object.keys(categories).sort((a, b) => {
      const aIndex = categoryOrder.indexOf(a);
      const bIndex = categoryOrder.indexOf(b);
      // Put known categories first, unknown categories last
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

    // Generate table of contents
    for (const category of sortedCategories) {
      const categoryTools = categories[category];
      const categoryName = labels[category];
      const anchorName = categoryName.toLowerCase().replace(/\s+/g, '-');
      markdown += `- **[${categoryName}](#${anchorName})** (${categoryTools.length} tools)\n`;

      // Sort tools within category for TOC
      categoryTools.sort((a: Tool, b: Tool) => a.name.localeCompare(b.name));
      for (const tool of categoryTools) {
        // Generate proper markdown anchor link: backticks are removed, keep underscores, lowercase
        const anchorLink = tool.name.toLowerCase();
        markdown += `  - [\`${tool.name}\`](#${anchorLink})\n`;
      }
    }
    markdown += '\n';

    for (const category of sortedCategories) {
      const categoryTools = categories[category];
      const categoryName = labels[category];

      markdown += `## ${categoryName}\n\n`;

      // Sort tools within category
      categoryTools.sort((a: Tool, b: Tool) => a.name.localeCompare(b.name));

      for (const tool of categoryTools) {
        markdown += `### \`${tool.name}\`\n\n`;

        if (tool.description) {
          // Escape HTML tags but preserve JS function syntax
          let escapedDescription = escapeHtmlTags(tool.description);

          // Add cross-links to mentioned tools
          escapedDescription = addCrossLinks(
            escapedDescription,
            toolsWithAnnotations,
          );
          markdown += `**Description:** ${escapedDescription}\n\n`;
        }

        // Handle input schema
        if (
          tool.inputSchema &&
          tool.inputSchema.properties &&
          Object.keys(tool.inputSchema.properties).length > 0
        ) {
          const properties = tool.inputSchema.properties;
          const required = tool.inputSchema.required || [];

          markdown += '**Parameters:**\n\n';

          const propertyNames = Object.keys(properties).sort((a, b) => {
            const aRequired = required.includes(a);
            const bRequired = required.includes(b);
            if (aRequired && !bRequired) return -1;
            if (!aRequired && bRequired) return 1;
            return a.localeCompare(b);
          });
          for (const propName of propertyNames) {
            const prop = properties[propName] as TypeInfo;
            const isRequired = required.includes(propName);
            const requiredText = isRequired
              ? ' **(required)**'
              : ' _(optional)_';

            let typeInfo = prop.type || 'unknown';
            if (prop.enum) {
              typeInfo = `enum: ${prop.enum.map((v: string) => `"${v}"`).join(', ')}`;
            }

            markdown += `- **${propName}** (${typeInfo})${requiredText}`;
            if (prop.description) {
              let escapedParamDesc = escapeHtmlTags(prop.description);

              // Add cross-links to mentioned tools
              escapedParamDesc = addCrossLinks(
                escapedParamDesc,
                toolsWithAnnotations,
              );
              markdown += `: ${escapedParamDesc}`;
            }
            markdown += '\n';
          }
          markdown += '\n';
        } else {
          markdown += '**Parameters:** None\n\n';
        }

        markdown += '---\n\n';
      }
    }

    // Write the documentation to file
    fs.writeFileSync(OUTPUT_PATH, markdown.trim() + '\n');

    console.log(
      `Generated documentation for ${toolsWithAnnotations.length} tools in ${OUTPUT_PATH}`,
    );

    // Generate tools TOC and update README
    const toolsTOC = generateToolsTOC(categories, sortedCategories);
    updateReadmeWithToolsTOC(toolsTOC);

    // Generate and update configuration options
    const optionsMarkdown = generateConfigOptionsMarkdown();
    updateReadmeWithOptionsMarkdown(optionsMarkdown);

    // Generate and update CLI commands examples
    const cliCommandsMarkdown = generateCliCommandsMarkdown(
      categories,
      sortedCategories,
    );
    updateReadmeWithCliCommandsMarkdown(cliCommandsMarkdown);
    process.exit(0);
  } catch (error) {
    console.error('Error generating documentation:', error);
    process.exit(1);
  }
}

// Run the documentation generator
generateToolDocumentation().catch(console.error);
