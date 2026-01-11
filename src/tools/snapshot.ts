/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';
import {
  diffSnapshots,
  hasSnapshotChanges,
  normalizeSnapshot,
  type NodeChange,
  type NormalizedAXNode,
} from '../utils/accessibilityDiff.js';

import {ToolCategory} from './categories.js';
import {defineTool, timeoutSchema} from './ToolDefinition.js';

export const takeSnapshot = defineTool({
  name: 'take_snapshot',
  description: `Take a text snapshot of the currently selected page based on the a11y tree. The snapshot lists page elements along with a unique
identifier (uid). Always use the latest snapshot. Prefer taking a snapshot over taking a screenshot. The snapshot indicates the element selected
in the DevTools Elements panel (if any).`,
  annotations: {
    category: ToolCategory.DEBUGGING,
    // Not read-only due to filePath param.
    readOnlyHint: false,
  },
  schema: {
    verbose: zod
      .boolean()
      .optional()
      .describe(
        'Whether to include all possible information available in the full a11y tree. Default is false.',
      ),
    filePath: zod
      .string()
      .optional()
      .describe(
        'The absolute path, or a path relative to the current working directory, to save the snapshot to instead of attaching it to the response.',
      ),
  },
  handler: async (request, response) => {
    response.includeSnapshot({
      verbose: request.params.verbose ?? false,
      filePath: request.params.filePath,
    });
  },
});

export const waitFor = defineTool({
  name: 'wait_for',
  description: `Wait for the specified text to appear on the selected page.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {
    text: zod.string().describe('Text to appear on the page'),
    ...timeoutSchema,
  },
  handler: async (request, response, context) => {
    await context.waitForTextOnPage(
      request.params.text,
      request.params.timeout,
    );

    response.appendResponseLine(
      `Element with text "${request.params.text}" found.`,
    );

    response.includeSnapshot();
  },
});

export const takeChangeSnapshot = defineTool({
  name: 'take_change_snapshot',
  description:
    'Capture accessibility (AX) changes compared to a stored baseline and report only the differences. Use this when you are polling dynamic views—think WebSocket chats, live dashboards, or any SPA regions that refresh while you wait—to confirm that expected elements appeared or attributes flipped without flooding the context with the entire tree.',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    baselineKey: zod
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Identifier used to store the baseline snapshot. Defaults to "default".',
      ),
    replaceBaseline: zod
      .boolean()
      .optional()
      .describe(
        'Whether to replace the stored baseline with the latest snapshot. Defaults to true.',
      ),
    compareTo: zod
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Compare against a different baseline key. When omitted, compares against the same key as baselineKey.',
      ),
  },
  handler: async (request, response, context) => {
    const baselineKey = request.params.baselineKey?.trim() || 'default';
    const compareKey = request.params.compareTo?.trim() || baselineKey;
    const replaceBaseline = request.params.replaceBaseline ?? true;

    await context.createTextSnapshot(false, {});
    const snapshot = context.getTextSnapshot();
    if (!snapshot) {
      response.appendResponseLine(
        'Unable to capture accessibility snapshot for the current page.',
      );
      return;
    }

    const normalizedSnapshot = normalizeSnapshot(snapshot);
    const baseline = context.getAccessibilityBaseline(compareKey);

    if (!baseline) {
      context.setAccessibilityBaseline(baselineKey, normalizedSnapshot);
      response.appendResponseLine(
        compareKey === baselineKey
          ? `No baseline found for key "${compareKey}". Created a baseline with the current snapshot.`
          : `No baseline found for key "${compareKey}". Created a baseline under "${baselineKey}" with the current snapshot.`,
      );
      return;
    }

    const diff = diffSnapshots(baseline, normalizedSnapshot);

    if (!hasSnapshotChanges(diff)) {
      response.appendResponseLine(
        `No accessibility changes compared to baseline "${compareKey}".`,
      );
    } else {
      response.appendResponseLine(
        `Accessibility changes compared to baseline "${compareKey}":`,
      );
      response.appendResponseLine(
        `Added nodes: ${diff.added.length}, Removed nodes: ${diff.removed.length}, Changed nodes: ${diff.changed.length}`,
      );

      if (diff.added.length) {
        response.appendResponseLine('## Added');
        for (const node of diff.added) {
          response.appendResponseLine(`- ${formatNodeSummary(node)}`);
        }
      }
      if (diff.removed.length) {
        response.appendResponseLine('## Removed');
        for (const node of diff.removed) {
          response.appendResponseLine(`- ${formatNodeSummary(node)}`);
        }
      }
      if (diff.changed.length) {
        response.appendResponseLine('## Changed');
        for (const change of diff.changed) {
          response.appendResponseLine(`- ${formatChangeSummary(change)}`);
          for (const detail of change.changes) {
            response.appendResponseLine(
              `  - ${detail.property}: ${formatDiffValue(detail.before)} -> ${formatDiffValue(detail.after)}`,
            );
          }
        }
      }
    }

    if (replaceBaseline) {
      context.setAccessibilityBaseline(baselineKey, normalizedSnapshot);
    }
  },
});

function formatNodeSummary(node: NormalizedAXNode): string {
  const role = node.role ? `[${node.role}]` : '[unknown role]';
  const name = node.name ? ` "${node.name}"` : '';
  return `${role}${name} at path ${node.path}`;
}

function formatChangeSummary(change: NodeChange): string {
  const role = change.role ? `[${change.role}]` : '[unknown role]';
  const name = change.name ? ` "${change.name}"` : '';
  return `${role}${name} at path ${change.path}`;
}

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
