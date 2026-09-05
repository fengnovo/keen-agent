import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, symlink, link, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DockerSandboxBackend } from '../src/sandbox/docker-sandbox.ts';
import { createCapabilityPolicy, createWorkerPolicy } from '../src/core/autonomy/policy.ts';
import { taskSpecSchema } from '../src/core/autonomy/task-plan.ts';

test('sandbox-backed worker rejects symlink and hardlink scope bypass without Docker', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'keen-autonomy-path-'));
  const backend = await DockerSandboxBackend.create({ rootDirectory: directory, sessionId: 'policy' }, []);
  t.after(async () => { await backend.close(); await rm(directory, { recursive: true, force: true }); });
  const hostWorkspace = join(directory, 'policy', 'user-data', 'workspace');
  const allowed = '/mnt/user-data/workspace/allowed';
  const outside = '/mnt/user-data/workspace/outside.txt';
  await backend.write(outside, 'unchanged');
  await mkdir(join(hostWorkspace, 'allowed'));
  await symlink(join(hostWorkspace, 'outside.txt'), join(hostWorkspace, 'allowed', 'alias.txt'));
  await symlink(hostWorkspace, join(hostWorkspace, 'allowed', 'directory-alias'));
  await link(join(hostWorkspace, 'outside.txt'), join(hostWorkspace, 'allowed', 'hardlink.txt'));
  const spec = taskSpecSchema.parse({ id: 'writer', title: 'write', role: 'dynamic', objective: 'write scoped file',
    successCriteria: ['scoped'], access: 'write', capabilities: ['filesystem_write'], writeScopes: [allowed] });
  const middleware = createWorkerPolicy(spec, createCapabilityPolicy([], true), path => backend.assertWritablePath(path));
  let executed = 0;
  for (const file of ['alias.txt', 'directory-alias/outside.txt', 'hardlink.txt']) {
    await assert.rejects(middleware.wrapToolCall({ toolCall: { name: 'write_file', args: { file_path: `${allowed}/${file}` } } },
      async () => { executed++; }), /链接/);
  }
  assert.equal(executed, 0);
  assert.ok((await backend.write(`${allowed}/alias.txt`, 'must not write')).error);
  assert.equal(await readFile(join(hostWorkspace, 'outside.txt'), 'utf8'), 'unchanged');
  await backend.assertWritablePath(`${allowed}/new/nested.txt`);
});
