/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {McpResponse} from '../../src/McpResponse.js';
import {
  takeChangeSnapshot,
  takeSnapshot,
  waitFor,
} from '../../src/tools/snapshot.js';
import {html, withMcpContext} from '../utils.js';

describe('snapshot', () => {
  describe('browser_snapshot', () => {
    it('includes a snapshot', async () => {
      await withMcpContext(async (response, context) => {
        await takeSnapshot.handler({params: {}}, response, context);
        assert.ok(response.includeSnapshot);
      });
    });
  });
  describe('take_change_snapshot', () => {
    it('creates a baseline and then reports diffs', async () => {
      await withMcpContext(async (_response, context) => {
        const page = context.getSelectedPage();
        await page.setContent(html`<main><div>Hello</div></main>`);

        const baselineResponse = new McpResponse();
        await takeChangeSnapshot.handler(
          {params: {baselineKey: 'default'}},
          baselineResponse,
          context,
        );

        assert.match(
          baselineResponse.responseLines.join('\n'),
          /No baseline found/,
        );

        await page.setContent(
          html`<main><div>Hello</div><div>World</div></main>`,
        );

        const diffResponse = new McpResponse();
        await takeChangeSnapshot.handler(
          {params: {baselineKey: 'default'}},
          diffResponse,
          context,
        );

        assert.match(
          diffResponse.responseLines.join('\n'),
          /Accessibility changes compared to baseline/,
        );

        const noChangeResponse = new McpResponse();
        await takeChangeSnapshot.handler(
          {params: {baselineKey: 'default'}},
          noChangeResponse,
          context,
        );

        assert.match(
          noChangeResponse.responseLines.join('\n'),
          /No accessibility changes compared to baseline/,
        );
      });
    });
  });
  describe('browser_wait_for', () => {
    it('should work', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPage();

        await page.setContent(
          html`<main><span>Hello</span><span> </span><div>World</div></main>`,
        );
        await waitFor.handler(
          {
            params: {
              text: 'Hello',
            },
          },
          response,
          context,
        );

        assert.equal(
          response.responseLines[0],
          'Element with text "Hello" found.',
        );
        assert.ok(response.includeSnapshot);
      });
    });
    it('should work with element that show up later', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPage();

        const handlePromise = waitFor.handler(
          {
            params: {
              text: 'Hello World',
            },
          },
          response,
          context,
        );

        await page.setContent(
          html`<main><span>Hello</span><span> </span><div>World</div></main>`,
        );

        await handlePromise;

        assert.equal(
          response.responseLines[0],
          'Element with text "Hello World" found.',
        );
        assert.ok(response.includeSnapshot);
      });
    });
    it('should work with aria elements', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPage();

        await page.setContent(
          html`<main><h1>Header</h1><div>Text</div></main>`,
        );

        await waitFor.handler(
          {
            params: {
              text: 'Header',
            },
          },
          response,
          context,
        );

        assert.equal(
          response.responseLines[0],
          'Element with text "Header" found.',
        );
        assert.ok(response.includeSnapshot);
      });
    });

    it('should work with iframe content', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPage();

        await page.setContent(
          html`<h1>Top level</h1>
            <iframe srcdoc="<p>Hello iframe</p>"></iframe>`,
        );

        await waitFor.handler(
          {
            params: {
              text: 'Hello iframe',
            },
          },
          response,
          context,
        );

        assert.equal(
          response.responseLines[0],
          'Element with text "Hello iframe" found.',
        );
        assert.ok(response.includeSnapshot);
      });
    });
  });
});
