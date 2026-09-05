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
  assert.ok(core.capabilities.includes('plan_tasks'));
});

test('syncs newly added system tools into an existing registry', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'keen-plugin-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'plugins.json');

  // 模拟旧版注册表：只有 deepagent-core 和 tiandi-tongshou，没有 tavily 工具
  const registry = createDefaultPluginRegistry();
  const legacy = {
    ...registry,
    plugins: registry.plugins.filter(
      (plugin) =>
        !('tavily_search' === plugin.implementation ||
          'tavily_research' === plugin.implementation ||
          'tavily_crawl' === plugin.implementation ||
          'tavily_extract' === plugin.implementation),
    ),
  };
  await writeFile(filePath, JSON.stringify(legacy));

  const loaded = await loadPluginRegistry(filePath);
  const implementations = loaded.registry.plugins
    .filter((plugin) => plugin.type === 'tool')
    .map((plugin) => plugin.implementation);

  for (const expected of [
    'tiandi_tongshou',
    'tavily_search',
    'tavily_research',
    'tavily_crawl',
    'tavily_extract',
  ]) {
    assert.ok(
      implementations.includes(expected),
      `expected system tool ${expected} to be synced into registry`,
    );
  }

  // 再次加载不应重复添加
  const reloaded = await loadPluginRegistry(filePath);
  const tavilyEntries = reloaded.registry.plugins.filter(
    (plugin) => plugin.implementation === 'tavily_search',
  );
  assert.equal(tavilyEntries.length, 1);
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
    (capability) => !['write_todos', 'plan_tasks'].includes(capability),
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
  assert.ok(loadedCore.capabilities.includes('plan_tasks'));
  assert.ok(persistedCore.capabilities.includes('plan_tasks'));
});
