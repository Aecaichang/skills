import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../src/html.mjs';

const pages = [{ name: 'a', heading: 'ภาพ A', svg: '<svg viewBox="0 0 10 10"></svg>', source: 'flowchart TD\nA-->B' }];

test('square: one 1080x1080 card per page, no Mermaid source block', () => {
  const html = buildHtml(pages, { title: 'ทดสอบ', square: true });
  assert.equal((html.match(/class="sq"/g) ?? []).length, 1);
  assert.match(html, /\.sq\{width:1080px;height:1080px/);
  assert.doesNotMatch(html, /<details>/);
});

test('default: normal page, no square card', () => {
  const html = buildHtml(pages, { title: 'ทดสอบ' });
  assert.doesNotMatch(html, /<section class="sq">/);
  assert.match(html, /<details>/);
});
