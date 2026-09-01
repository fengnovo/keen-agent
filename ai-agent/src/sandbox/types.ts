/** Docker 沙箱中由 Agent 写入 outputs 目录的候选产物。 */
export interface SandboxOutputFile {
  absolutePath: string;
  relativePath: string;
  name: string;
  size: number;
}

/** previews 下一个包含 index.html 的可发布静态网站目录。 */
export interface SandboxPreviewDirectory {
  absolutePath: string;
  name: string;
  fileCount: number;
  size: number;
}

/** 产物发布器返回给聊天层的稳定下载信息。 */
export interface PublishedArtifact {
  id?: string;
  name: string;
  size: number;
  mimeType?: string;
  url: string;
}

export interface PublishedPreview {
  id?: string;
  name: string;
  fileCount: number;
  size: number;
  url: string;
}

/** Web 服务可注入持久化发布器；CLI 未注入时保留本地文件路径。 */
export interface AgentSandboxOptions {
  /** 可信调用方提供的会话标识；只用于隔离本轮临时目录。 */
  sessionId?: string;
  /** 测试或部署时覆盖沙箱会话根，不能来自模型或普通聊天请求。 */
  rootDirectory?: string;
  /** Docker 镜像名，默认 keen-agent-sandbox:latest。 */
  image?: string;
  /** 单次 execute 超时；实现会限制在 1 秒到 10 分钟之间。 */
  commandTimeoutMs?: number;
  /** 返回给模型的 stdout/stderr 上限，文件内容不受此字段控制。 */
  maxOutputBytes?: number;
  /** Web 注入 HTTP 发布器；CLI 省略时复制到本地持久目录。 */
  publishArtifact?: (
    artifact: SandboxOutputFile,
  ) => Promise<PublishedArtifact>;
  /** Web 注入静态站点发布器；只接收已通过沙箱目录扫描的候选项。 */
  publishPreview?: (
    preview: SandboxPreviewDirectory,
  ) => Promise<PublishedPreview>;
}
