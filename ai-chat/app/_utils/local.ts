import zhCN from 'antd/locale/zh_CN';
import type { Locale } from '@ant-design/x/es/locale';

const locale: Locale = {
  ...zhCN,
  locale: 'zh-cn',
  Conversations: {
    create: '新建会话',
  },
  Actions: {
    feedbackLike: '点赞',
    feedbackDislike: '点踩',
    audio: '语音',
    audioRunning: '语音播放中',
    audioError: '语音播放失败',
    audioLoading: '语音加载中',
  },
  Sender: {
    stopLoading: '停止生成',
    speechRecording: '录音中',
  },
  Bubble: {
    editableOk: '确定',
    editableCancel: '取消',
  },
  Mermaid: {
    zoomIn: '放大',
    zoomOut: '缩小',
    zoomReset: '重置',
    download: '下载',
    code: '代码',
    image: '图片',
  },
  Folder: {
    selectFile: '选择文件',
    loadError: '加载失败',
    noService: '服务不可用',
    loadFailed: '加载失败',
  },
};

export const texts = {
  // Conversations
  today: '今天',
  yesterday: '昨天',
  curConversation: '当前会话',
  newConversation: '新会话',
  rename: '重命名',
  delete: '删除',
  collapseSidebar: '收起侧栏',
  expandSidebar: '展开侧栏',
  resizeSidebar: '拖动调整侧栏宽度，双击恢复默认宽度',
  startNewConversation: '新开对话',
  modelManagement: '模型管理',
  pluginManagement: '插件管理',
  selectModel: '选择模型',
  earlier: '更早',

  // Welcome
  welcome: '欢迎使用 Keen AI',
  welcomeDescription:
    '基于 Ant Design 的 AI 对话组件库，帮助你快速构建 AI 聊天界面。',

  // Hot Topics
  hotTopics: '热门话题',
  whatComponentsAreInAntDesignX: '你好',
  newAgiHybridInterface: '你好',
  comeAndDiscoverNewDesignParadigm: '你好',
  howToQuicklyInstallAndImportComponents: '你好',

  // Design Guide
  designGuide: '设计指南',
  intention: '意图',
  aiUnderstandsUserNeedsAndProvidesSolutions: 'AI 理解用户需求并提供解决方案',
  role: '角色',
  aiPublicPersonAndImage: 'AI 公众人物与形象',
  chat: '对话',
  howAICanExpressItselfWayUsersUnderstand: 'AI 如何以用户理解的方式表达',
  interface: '界面',
  aiBalances: 'AI 平衡美观与功能',

  // Sender Prompts
  upgrades: '升级亮点',
  components: '组件介绍',
  richGuide: '丰富引导',
  installationIntroduction: '安装简介',

  // Thought Chain
  modelIsRunning: '模型运行中',
  modelExecutionCompleted: '模型执行完成',
  executionFailed: '执行失败',
  aborted: '已中止',

  // Think
  deepThinking: '深度思考',
  deepThinkingDescription: '为当前会话启用更充分的分析',
  toolCalling: '工具调用',
  toolCallingDescription: '允许当前会话中的 Agent 调用已注册工具',
  completeThinking: '思考完成',

  // Footer Actions
  retry: '重试',
  isMock: '这是模拟功能',

  // Attachments
  uploadFile: '上传图片',
  uploadFiles: '上传图片',
  clickOrDragFilesToUpload: '支持 JPG、PNG、GIF、WebP，最多 3 张',
  dropFileHere: '将图片拖到此处',
  addImage: '添加图片',
  unsupportedImageType: '仅支持 JPG、PNG、GIF 和 WebP 图片',
  imageTooLarge: '单张图片不能超过 4 MB',
  tooManyImages: '每次最多上传 3 张图片',
  imagesTooLarge: '图片总大小不能超过 6 MB',
  imageReadFailed: '图片读取失败',
  describeImages: '请描述这些图片。',

  // Sender
  askOrInputUseSkills: '输入问题或使用技能',

  // Status
  noData: '暂无数据',
  requestAborted: '请求已中止',
  requestFailed: '请求失败',

  // Messages
  itIsNowANewConversation: '当前已是新会话',

  // AI Messages
  aiMessage_1: '我很好😌',
  aiMessage_2: '有啥事',

  // What is Keen AI
  whatIsAntDesignX: '什么是 Keen AI？',
};

export default locale;
