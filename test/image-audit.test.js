/**
 * Tests for the image auditor. auditImages is async — every call is awaited.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { auditImages, parseImageList } from '../src/image/image-audit.js';

const has = (issues, code) => issues.some((i) => i.code === code);
const get = (issues, code) => issues.find((i) => i.code === code);

test('product with only a main image flags few_images and no_lifestyle', async () => {
  const { issues, imageCount } = await auditImages({
    raw: { image_link: 'https://cdn.example.com/main.jpg' },
  });
  assert.equal(imageCount, 1);

  assert.ok(has(issues, 'few_images'), 'expected few_images');
  assert.equal(get(issues, 'few_images').severity, 'medium');

  assert.ok(has(issues, 'no_lifestyle'), 'expected no_lifestyle');
  assert.equal(get(issues, 'no_lifestyle').severity, 'low');
});

test('product with no image flags no_image high and scores low', async () => {
  const { issues, score, imageCount } = await auditImages({ raw: {} });
  assert.equal(imageCount, 0);

  assert.ok(has(issues, 'no_image'), 'expected no_image');
  assert.equal(get(issues, 'no_image').severity, 'high');
  assert.ok(score <= 50, `expected low score, got ${score}`);
});

test('semicolon-separated additional images yield imageCount>=4 and no few_images', async () => {
  const { issues, imageCount } = await auditImages({
    raw: {
      image_link: 'https://cdn.example.com/main.jpg',
      additional_image_link:
        'https://cdn.example.com/a.jpg;https://cdn.example.com/b.jpg;https://cdn.example.com/c.jpg',
    },
  });
  assert.ok(imageCount >= 4, `expected >=4 images, got ${imageCount}`);
  assert.ok(!has(issues, 'few_images'), 'did not expect few_images');
});

test('vision analyzer drives low_resolution and populates visionTags', async () => {
  const visionAnalyzer = async () => ({
    width: 400,
    height: 400,
    hasWhiteBackground: true,
    tags: ['striped'],
  });

  const { issues, visionTags } = await auditImages({
    raw: { image_link: 'https://cdn.example.com/main.jpg' },
    visionAnalyzer,
  });

  assert.ok(has(issues, 'low_resolution'), 'expected low_resolution');
  assert.equal(get(issues, 'low_resolution').severity, 'medium');
  assert.ok(visionTags.includes('striped'), 'expected striped in visionTags');
});

test('parseImageList dedupes and keeps main first', () => {
  const list = parseImageList({
    image_link: 'https://cdn.example.com/main.jpg',
    additional_image_link: ['https://cdn.example.com/x.jpg', 'https://cdn.example.com/main.jpg'],
  });
  assert.deepEqual(list, ['https://cdn.example.com/main.jpg', 'https://cdn.example.com/x.jpg']);
});
