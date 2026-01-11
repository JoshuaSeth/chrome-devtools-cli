/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {TextSnapshot, TextSnapshotNode} from '../McpContext.js';

export interface NormalizedAXNode {
  id: string;
  path: string;
  role?: string;
  name?: string;
  data: Record<string, unknown>;
  parentId?: string;
}

export interface NormalizedSnapshot {
  capturedAt: string;
  nodes: Record<string, NormalizedAXNode>;
}

export interface NodeChangeDetail {
  property: string;
  before: unknown;
  after: unknown;
}

export interface NodeChange {
  id: string;
  path: string;
  role?: string;
  name?: string;
  changes: NodeChangeDetail[];
}

export interface SnapshotDiff {
  added: NormalizedAXNode[];
  removed: NormalizedAXNode[];
  changed: NodeChange[];
}

export function normalizeSnapshot(snapshot: TextSnapshot): NormalizedSnapshot {
  const nodes: Record<string, NormalizedAXNode> = {};
  traverse(snapshot.root, ['0'], undefined, nodes);
  return {
    capturedAt: new Date().toISOString(),
    nodes,
  };
}

export function diffSnapshots(
  baseline: NormalizedSnapshot,
  current: NormalizedSnapshot,
): SnapshotDiff {
  const added: NormalizedAXNode[] = [];
  const removed: NormalizedAXNode[] = [];
  const changed: NodeChange[] = [];

  for (const [id, currentNode] of Object.entries(current.nodes)) {
    const previousNode = baseline.nodes[id];
    if (!previousNode) {
      added.push(currentNode);
      continue;
    }
    const nodeDiff = diffNode(previousNode, currentNode);
    if (nodeDiff.length) {
      changed.push({
        id,
        path: currentNode.path,
        role: currentNode.role ?? previousNode.role,
        name: currentNode.name ?? previousNode.name,
        changes: nodeDiff,
      });
    }
  }

  for (const [id, baselineNode] of Object.entries(baseline.nodes)) {
    if (!current.nodes[id]) {
      removed.push(baselineNode);
    }
  }

  return {added, removed, changed};
}

export function hasSnapshotChanges(diff: SnapshotDiff): boolean {
  return (
    diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0
  );
}

function traverse(
  node: TextSnapshotNode,
  pathSegments: string[],
  parentId: string | undefined,
  nodes: Record<string, NormalizedAXNode>,
) {
  const path = pathSegments.join('.');
  const id = getStableNodeId(node, path);
  const data = sanitizeNodeData(node);
  const normalized: NormalizedAXNode = {
    id,
    path,
    role: typeof data.role === 'string' ? (data.role as string) : undefined,
    name:
      typeof data.name === 'string'
        ? (data.name as string)
        : normalizeName(data.name),
    data,
    parentId,
  };
  nodes[id] = normalized;

  node.children?.forEach((child, index) => {
    traverse(child, [...pathSegments, String(index)], id, nodes);
  });
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  if (value && typeof value === 'object' && 'value' in (value as object)) {
    const probableValue = (value as Record<string, unknown>).value;
    if (
      typeof probableValue === 'string' ||
      typeof probableValue === 'number'
    ) {
      return String(probableValue);
    }
  }
  return undefined;
}

function getStableNodeId(node: TextSnapshotNode, path: string): string {
  const identifiers: string[] = [];
  const backendDOMNodeId = (node as {backendDOMNodeId?: number})
    .backendDOMNodeId;
  if (typeof backendDOMNodeId === 'number') {
    identifiers.push(`backend:${backendDOMNodeId}`);
  }
  const nodeId = (node as {nodeId?: number}).nodeId;
  if (typeof nodeId === 'number') {
    identifiers.push(`node:${nodeId}`);
  }
  const axId = (node as {axId?: string}).axId;
  if (typeof axId === 'string') {
    identifiers.push(`ax:${axId}`);
  }
  if (identifiers.length) {
    return identifiers.join('|');
  }
  return `path:${path}`;
}

function sanitizeNodeData(node: TextSnapshotNode): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'children' || key === 'id') {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    data[key] = sanitizeValue(value);
  }
  return data;
}

function sanitizeValue(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => [key, sanitizeValue(val)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  }
  return String(value);
}

function diffNode(
  baseline: NormalizedAXNode,
  current: NormalizedAXNode,
): NodeChangeDetail[] {
  const differences: NodeChangeDetail[] = [];
  const keys = new Set([
    ...Object.keys(baseline.data),
    ...Object.keys(current.data),
  ]);

  for (const key of keys) {
    const baselineValue = baseline.data[key];
    const currentValue = current.data[key];
    if (areEqual(baselineValue, currentValue)) {
      continue;
    }
    differences.push({
      property: key,
      before: baselineValue,
      after: currentValue,
    });
  }

  return differences;
}

function areEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(toComparable(value));
}

function toComparable(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => toComparable(item));
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, val]) => [key, toComparable(val)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}
