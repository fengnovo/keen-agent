import { readFile, readdir, stat } from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { parseSkillMetadata } from 'deepagents';

import type { SkillPluginConfig } from '../config/plugin-config.ts';
import { REPOSITORY_ROOT, SKILLS_ROOT } from '../config/paths.ts';

const MAX_SKILL_BYTES = 64 * 1024;
const MAX_SKILL_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SKILL_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_SKILL_FILE_COUNT = 128;
const IGNORED_SKILL_ENTRIES = new Set([
  '.DS_Store',
  '.git',
  '__pycache__',
  'node_modules',
]);
const TEXT_FILE_EXTENSIONS = new Set([
  '.c',
  '.conf',
  '.cpp',
  '.css',
  '.csv',
  '.env',
  '.h',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.py',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);
const BINARY_MIME_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.webp': 'image/webp',
};

export interface LoadedSkill {
  id: string;
  name: string;
  description: string;
  filePath: string;
  content: string;
  files: LoadedSkillFile[];
}

export interface LoadedSkillFile {
  /** 相对于 Skill 根目录的 POSIX 路径。 */
  relativePath: string;
  content: string | Uint8Array;
  mimeType: string;
}

const findExistingPath = async (paths: string[]): Promise<string> => {
  for (const path of paths) {
    try {
      await stat(path);
      return path;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`找不到 Skill 路径：${paths[0]}`);
};

const resolveSkillFile = async (configuredPath: string): Promise<string> => {
  const candidates = isAbsolute(configuredPath)
    ? [configuredPath]
    : [
        resolve(REPOSITORY_ROOT, configuredPath),
        // 兼容只填写 Skill 目录名的 Pi 风格配置。
        resolve(SKILLS_ROOT, configuredPath),
      ];
  const absolutePath = await findExistingPath(candidates);
  const pathStats = await stat(absolutePath);

  return pathStats.isDirectory() ? join(absolutePath, 'SKILL.md') : absolutePath;
};

const normalizeSkillRelativePath = (skillRoot: string, filePath: string) => {
  const relativePath = relative(skillRoot, filePath).replaceAll('\\', '/');

  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.includes('/../')
  ) {
    throw new Error(`Skill 文件超出目录范围：${filePath}`);
  }

  return relativePath;
};

const loadSkillDirectory = async (
  skillRoot: string,
): Promise<LoadedSkillFile[]> => {
  const files: LoadedSkillFile[] = [];
  let totalBytes = 0;

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (IGNORED_SKILL_ENTRIES.has(entry.name)) continue;

      const entryPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        // 不跟随符号链接，避免插件把虚拟 Skill 目录扩展到任意宿主路径。
        continue;
      }
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= MAX_SKILL_FILE_COUNT) {
        throw new Error(`Skill 文件数量不能超过 ${MAX_SKILL_FILE_COUNT}`);
      }

      const fileStats = await stat(entryPath);
      if (fileStats.size > MAX_SKILL_FILE_BYTES) {
        throw new Error(`Skill 单个文件不能超过 10 MB：${entryPath}`);
      }
      totalBytes += fileStats.size;
      if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
        throw new Error('Skill 目录总大小不能超过 20 MB');
      }

      const extension = extname(entry.name).toLowerCase();
      const buffer = await readFile(entryPath);
      const isText =
        entry.name === 'SKILL.md' || TEXT_FILE_EXTENSIONS.has(extension);

      files.push({
        relativePath: normalizeSkillRelativePath(skillRoot, entryPath),
        content: isText ? buffer.toString('utf8') : new Uint8Array(buffer),
        mimeType: isText
          ? 'text/plain; charset=utf-8'
          : (BINARY_MIME_TYPES[extension] ?? 'application/octet-stream'),
      });
    }
  };

  await visit(skillRoot);
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
};

/** 读取并校验 Skill；相对路径默认以仓库根目录或 ai-agent/.skills 为基准。 */
export const loadSkill = async (
  plugin: SkillPluginConfig,
): Promise<LoadedSkill> => {
  const filePath = await resolveSkillFile(plugin.path);
  const fileStats = await stat(filePath);

  if (!fileStats.isFile()) {
    throw new Error(`Skill 路径不是文件：${filePath}`);
  }
  if (fileStats.size > MAX_SKILL_BYTES) {
    throw new Error(`Skill 文件不能超过 ${MAX_SKILL_BYTES / 1024} KB`);
  }

  const metadata = parseSkillMetadata(filePath, 'project');
  if (!metadata) {
    throw new Error(`无法解析 Skill 元数据：${filePath}`);
  }
  const directoryName = basename(dirname(filePath));
  if (metadata.name !== directoryName) {
    throw new Error(
      `Skill 名称 ${metadata.name} 必须与目录名称 ${directoryName} 一致`,
    );
  }
  const files = await loadSkillDirectory(dirname(filePath));
  const skillDocument = files.find(
    (file) => file.relativePath === 'SKILL.md',
  );
  if (!skillDocument || typeof skillDocument.content !== 'string') {
    throw new Error(`Skill 目录缺少文本格式的 SKILL.md：${filePath}`);
  }

  return {
    id: plugin.id,
    name: metadata.name,
    description: metadata.description,
    filePath,
    content: skillDocument.content,
    files,
  };
};
