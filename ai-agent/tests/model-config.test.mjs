import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  getMaximumOutputTokens,
  loadModelRegistry,
  modelConfigSchema,
} from '../src/config/model-config.ts';

const baseModel = {
  id: 'model',
  name: 'Model',
  provider: 'anthropic',
  model: 'qwen3.8-max',
  apiKeyEnv: 'TEST_API_KEY',
};

test('uses the maximum output token limit for every configured model family', () => {
  assert.equal(getMaximumOutputTokens('qwen3.8-max'), 131_072);
  assert.equal(getMaximumOutputTokens('qwen3.8-flash'), 131_072);
  assert.equal(getMaximumOutputTokens('qwen3.8-2.4t-a95b'), 131_072);
  assert.equal(getMaximumOutputTokens('kimi-k3'), 131_072);
  assert.equal(getMaximumOutputTokens('qwen3.5-ocr'), 16_384);
  assert.equal(getMaximumOutputTokens('deepseek-v4-pro'), 393_216);
  assert.equal(getMaximumOutputTokens('deepseek-v4-flash'), 393_216);
  assert.equal(getMaximumOutputTokens('deepseek-v4-pro-0813'), 393_216);
});

test('overrides a lower maxTokens value for a known model', () => {
  const parsed = modelConfigSchema.parse({ ...baseModel, maxTokens: 4_096 });
  assert.equal(parsed.maxTokens, 131_072);
});

test('migrates a registry without maxTokens and persists the normalized limit', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'keen-model-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'models.json');
  const legacyRegistry = {
    version: 1,
    activeModelId: 'model',
    models: [baseModel],
  };

  await writeFile(filePath, JSON.stringify(legacyRegistry));

  const loaded = await loadModelRegistry(filePath);
  const persisted = JSON.parse(await readFile(filePath, 'utf8'));

  assert.equal(loaded.registry.models[0].maxTokens, 131_072);
  assert.equal(persisted.models[0].maxTokens, 131_072);
});
