import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  createDefaultPluginRegistry,
  loadPluginRegistry,
} from '../src/config/plugin-config.ts';

test('advertises write_todos as a DeepAgent core capability', () => {
  const core = createDefaultPluginRegistry().plugins.find(
    (plugin) => plugin.id === 'deepagent-core',
  );

  assert.equal(core?.type, 'builtin');
  assert.ok(core.capabilities.includes('write_todos'));
});

test('migrates an existing registry to include write_todos', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'keen-plugin-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'plugins.json');
  const registry = createDefaultPluginRegistry();
  const core = registry.plugins.find(
    (plugin) => plugin.id === 'deepagent-core',
  );
  assert.equal(core?.type, 'builtin');
  core.capabilities = core.capabilities.filter(
    (capability) => capability !== 'write_todos',
  );
  await writeFile(filePath, JSON.stringify(registry));

  const loaded = await loadPluginRegistry(filePath);
  const persisted = JSON.parse(await readFile(filePath, 'utf8'));
  const loadedCore = loaded.registry.plugins.find(
    (plugin) => plugin.id === 'deepagent-core',
  );
  const persistedCore = persisted.plugins.find(
    (plugin) => plugin.id === 'deepagent-core',
  );

  assert.equal(loadedCore.type, 'builtin');
  assert.ok(loadedCore.capabilities.includes('write_todos'));
  assert.ok(persistedCore.capabilities.includes('write_todos'));
});
