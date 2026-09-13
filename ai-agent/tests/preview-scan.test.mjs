import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { DockerSandboxBackend } from '../src/sandbox/docker-sandbox.ts';

const writeFileAt = async (file, content = 'ok') => {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
};

/** 建一个只扫描宿主目录的沙箱；不会调用 docker。 */
const createSandbox = async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'preview-scan-'));
  const sandbox = await DockerSandboxBackend.create(
    { rootDirectory: root, sessionId: 'preview-scan' },
    [],
  );
  t.after(async () => {
    await sandbox.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  return {
    sandbox,
    previewsRoot: join(root, 'preview-scan', 'user-data', 'previews'),
  };
};

test('缺少 index.html 的目录只跳过，不再让整轮预览发布失败', async (t) => {
  const { sandbox, previewsRoot } = await createSandbox(t);
  await writeFileAt(join(previewsRoot, 'ok-site', 'index.html'));
  await writeFileAt(join(previewsRoot, 'ok-site', 'assets', 'app.js'));
  // 依赖没装成功、构建没跑过的残留目录。
  await writeFileAt(join(previewsRoot, 'claude-portfolio', 'src', 'App.tsx'));
  await writeFileAt(join(previewsRoot, 'claude-portfolio', 'package.json'));

  const scan = await sandbox.listPreviewDirectories();

  assert.deepEqual(
    scan.previews.map((preview) => preview.name),
    ['ok-site'],
  );
  assert.equal(scan.previews[0].absolutePath, join(previewsRoot, 'ok-site'));
  assert.equal(scan.previews[0].fileCount, 2);

  const skipped = scan.skipped.find(
    (item) => item.name === 'claude-portfolio',
  );
  assert.ok(skipped, '目录应被记录为跳过而不是抛错');
  assert.match(skipped.reason, /index\.html/);
  assert.match(skipped.reason, /npm run build/);
});

test('整个 dist 目录被复制进 previews 时仍能发布', async (t) => {
  const { sandbox, previewsRoot } = await createSandbox(t);
  await writeFileAt(join(previewsRoot, 'vite-app', 'dist', 'index.html'));
  await writeFileAt(
    join(previewsRoot, 'vite-app', 'dist', 'assets', 'index.js'),
  );
  await writeFileAt(join(previewsRoot, 'vite-app', 'package.json'));

  const scan = await sandbox.listPreviewDirectories();

  assert.deepEqual(
    scan.previews.map((preview) => preview.name),
    ['vite-app'],
  );
  assert.equal(
    scan.previews[0].absolutePath,
    join(previewsRoot, 'vite-app', 'dist'),
    '站点根应指向 dist',
  );
  assert.equal(scan.previews[0].fileCount, 2);
  assert.deepEqual(scan.skipped, []);
});

test('目录自身的 index.html 优先于 dist', async (t) => {
  const { sandbox, previewsRoot } = await createSandbox(t);
  await writeFileAt(join(previewsRoot, 'site', 'index.html'));
  await writeFileAt(join(previewsRoot, 'site', 'dist', 'index.html'));

  const scan = await sandbox.listPreviewDirectories();

  assert.equal(scan.previews[0].absolutePath, join(previewsRoot, 'site'));
});

test('含符号链接的站点只跳过自己，不影响同轮其他站点', async (t) => {
  const { sandbox, previewsRoot } = await createSandbox(t);
  await writeFileAt(join(previewsRoot, 'good-site', 'index.html'));
  await writeFileAt(join(previewsRoot, 'linky-site', 'index.html'));
  await symlink('/etc/passwd', join(previewsRoot, 'linky-site', 'leak.txt'));
  // 一级目录本身是符号链接：整体忽略，不进 published 也不进 skipped。
  await symlink(
    join(previewsRoot, 'good-site'),
    join(previewsRoot, 'aliased-site'),
  );

  const scan = await sandbox.listPreviewDirectories();

  assert.deepEqual(
    scan.previews.map((preview) => preview.name),
    ['good-site'],
  );
  const skipped = scan.skipped.find((item) => item.name === 'linky-site');
  assert.ok(skipped);
  assert.match(skipped.reason, /符号链接/);
  assert.equal(
    scan.skipped.some((item) => item.name === 'aliased-site'),
    false,
  );
});
