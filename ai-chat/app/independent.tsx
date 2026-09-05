/**
 * 独立聊天页面组件
 * 整合服务端会话、模型选择、聊天列表和输入框。
 */

'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { XProvider } from '@ant-design/x';
import { message } from 'antd';
import {
  useXChat,
  useXConversations,
  type ConversationData,
} from '@ant-design/x-sdk';
import type { BubbleListRef } from '@ant-design/x/es/bubble';
import dayjs from 'dayjs';
import '@ant-design/x-markdown/themes/light.css';

import { ChatList } from './_components/ChatList';
import { ChatSender } from './_components/ChatSender';
import { ChatSide } from './_components/ChatSide';
import {
  createConversation,
  deleteConversation,
  listConversations,
  updateConversation,
  type ChatConversation,
  type ConversationSummary,
} from './_utils/conversation-api';
import locale, { texts } from './_utils/local';
import { listModels, type ModelRegistry } from './_utils/model-api';
import { filesToChatImages } from './_utils/image';
import {
  historyMessageFactory,
  providerFactory,
  type ChatRequestParams,
  type ModelStreamOutput,
} from './_utils/provider';
import { useStyle } from './_utils/styles';
import { designTheme } from './_utils/theme';
import { ChatContext, type ChatMessage } from './_utils/types';

/** Ant Design 会话项附带服务端元数据，便于切换会话和模型时直接定位。 */
interface ConversationListItem extends ConversationData {
  key: string;
  label: string;
  group: string;
  modelId: string;
  thinkingEnabled: boolean;
  toolsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/** 首屏并行请求模型注册表和会话摘要后的组合结果。 */
interface InitialChatData {
  conversations: ConversationSummary[];
  modelRegistry: ModelRegistry;
}

/** 按最后更新时间生成侧边栏分组，不把易变化的分组信息写入磁盘。 */
const getConversationGroup = (updatedAt: string) => {
  const updatedDate = dayjs(updatedAt);

  if (updatedDate.isSame(dayjs(), 'day')) return texts.today;
  if (updatedDate.isSame(dayjs().subtract(1, 'day'), 'day')) {
    return texts.yesterday;
  }
  return texts.earlier;
};

/** 将 Nest 返回的详情或摘要统一转换成 Ant Design 会话项。 */
const toConversationItem = (
  conversation:
    | ConversationSummary
    | (ChatConversation & { messageCount?: number }),
): ConversationListItem => ({
  key: conversation.id,
  label: conversation.title,
  group: getConversationGroup(conversation.updatedAt),
  modelId: conversation.modelId,
  thinkingEnabled: conversation.thinkingEnabled,
  toolsEnabled: conversation.toolsEnabled,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
  messageCount:
    'messages' in conversation
      ? conversation.messages.length
      : conversation.messageCount,
});

/**
 * 同时加载模型和会话以消除首屏请求瀑布；首次使用时自动创建一个空会话。
 */
const loadInitialChatData = async (): Promise<InitialChatData> => {
  const [modelRegistry, existingConversations] = await Promise.all([
    listModels(),
    listConversations(),
  ]);

  if (existingConversations.length > 0) {
    return { modelRegistry, conversations: existingConversations };
  }

  // 不传 modelId，由 Nest 统一继承上次选择，避免前端缓存过期。
  const conversation = await createConversation();
  const { messages, ...conversationSummary } = conversation;

  return {
    modelRegistry,
    conversations: [
      {
        ...conversationSummary,
        messageCount: messages.length,
      },
    ],
  };
};

/** Markdown 主题 hook。 */
function useMarkdownTheme(): [string] {
  return ['x-markdown-light x-markdown-theme'];
}

const Independent: React.FC = () => {
  const { styles } = useStyle();
  const [messageApi, contextHolder] = message.useMessage();
  const [className] = useMarkdownTheme();
  const [inputValue, setInputValue] = useState('');
  const [modelRegistry, setModelRegistry] = useState<ModelRegistry>();
  const [initializing, setInitializing] = useState(true);
  const [updatingFeature, setUpdatingFeature] = useState<
    'thinkingEnabled' | 'toolsEnabled'
  >();
  // 复用初始化 Promise，避免 React 开发模式重复执行 Effect 时创建两条默认会话。
  const initializationRef = useRef<Promise<InitialChatData> | undefined>(
    undefined,
  );
  const listRef = useRef<BubbleListRef>(null);

  const {
    conversations,
    activeConversationKey,
    setActiveConversationKey,
    addConversation,
    removeConversation,
    setConversation,
    setConversations,
  } = useXConversations({
    defaultConversations: [],
    defaultActiveConversationKey: '',
  });

  /** useXConversations 保留了扩展字段，但其公开类型只声明 ConversationData。 */
  const conversationItems = conversations as ConversationListItem[];
  const activeConversation = conversationItems.find(
    (conversation) => conversation.key === activeConversationKey,
  );
  // 模型被删除时回退到上次选择的有效模型，避免会话停留在无效 ID 上。
  const selectedModelId = modelRegistry?.models.some(
    (model) => model.id === activeConversation?.modelId,
  )
    ? activeConversation?.modelId
    : modelRegistry?.activeModelId;

  /** 首次挂载时从 Nest 恢复模型与会话，而不是使用前端演示数据。 */
  useEffect(() => {
    let cancelled = false;

    initializationRef.current ??= loadInitialChatData();
    void initializationRef.current
      .then((data) => {
        if (cancelled) return;

        const nextConversations = data.conversations.map(toConversationItem);
        setModelRegistry(data.modelRegistry);
        setConversations(nextConversations);
        setActiveConversationKey(nextConversations[0]?.key ?? '');
      })
      .catch((error) => {
        if (!cancelled) {
          messageApi.error(
            error instanceof Error ? error.message : '聊天服务初始化失败',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [messageApi, setActiveConversationKey, setConversations]);

  /** 聊天结束后刷新摘要，使自动标题、更新时间和排序与服务端保持一致。 */
  const refreshConversations = useCallback(async () => {
    try {
      const nextConversations = await listConversations();
      setConversations(nextConversations.map(toConversationItem));
    } catch (error) {
      messageApi.warning(
        error instanceof Error ? error.message : '无法刷新会话列表',
      );
    }
  }, [messageApi, setConversations]);

  /** 每个“会话 + 模型”组合使用独立 Provider，避免请求参数在会话间串用。 */
  const provider = useMemo(() => {
    if (!activeConversationKey || !selectedModelId) return undefined;

    return providerFactory(activeConversationKey, selectedModelId, () => {
      void refreshConversations();
    });
  }, [activeConversationKey, refreshConversations, selectedModelId]);

  /** useXChat 负责前端流状态，历史消息和实际模型请求都来自 Nest。 */
  const {
    onRequest,
    messages,
    isRequesting,
    isDefaultMessagesRequesting,
    abort,
    onReload,
    setMessage,
  } = useXChat<
    ChatMessage,
    ChatMessage,
    ChatRequestParams,
    ModelStreamOutput
  >({
    provider,
    conversationKey: activeConversationKey,
    defaultMessages: historyMessageFactory,
    requestPlaceholder: () => ({
      content: '<think>正在准备并分析问题…',
      role: 'assistant',
    }),
    requestFallback: (_, { error, errorInfo, messageInfo }) => {
      if (error.name === 'AbortError') {
        return {
          content: messageInfo?.message?.content || texts.requestAborted,
          role: 'assistant',
        };
      }
      return {
        content: errorInfo?.error?.message || texts.requestFailed,
        role: 'assistant',
      };
    },
  });

  /** 新会话由 Nest 继承上次主动选择的模型，不复制正在浏览的旧会话模型。 */
  const handleCreateConversation = useCallback(async () => {
    try {
      const conversation = await createConversation();
      const nextConversation = toConversationItem(conversation);

      addConversation(nextConversation, 'prepend');
      setActiveConversationKey(nextConversation.key);
      return true;
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : '新建会话失败',
      );
      return false;
    }
  }, [addConversation, messageApi, setActiveConversationKey]);

  /** 删除当前最后一条会话时自动补建空会话，保证输入区始终有归属。 */
  const handleDeleteConversation = useCallback(
    async (key: string) => {
      try {
        await deleteConversation(key);
        const remainingConversations = conversationItems.filter(
          (conversation) => conversation.key !== key,
        );

        removeConversation(key);

        if (key === activeConversationKey) {
          if (remainingConversations.length > 0) {
            setActiveConversationKey(remainingConversations[0].key);
          } else {
            // 补建会话也遵循“继承上次选择”，与手动新建保持一致。
            const replacement = await createConversation();
            const replacementItem = toConversationItem(replacement);
            addConversation(replacementItem, 'prepend');
            setActiveConversationKey(replacementItem.key);
          }
        }
        return true;
      } catch (error) {
        messageApi.error(
          error instanceof Error ? error.message : '删除会话失败',
        );
        return false;
      }
    },
    [
      activeConversationKey,
      addConversation,
      conversationItems,
      messageApi,
      removeConversation,
      setActiveConversationKey,
    ],
  );

  /** 服务端更新成功后再更新本地标题，失败时保留原值。 */
  const handleRenameConversation = useCallback(
    async (key: string, title: string) => {
      try {
        const conversation = await updateConversation(key, { title });
        setConversation(key, toConversationItem(conversation));
        return true;
      } catch (error) {
        messageApi.error(
          error instanceof Error ? error.message : '重命名会话失败',
        );
        return false;
      }
    },
    [messageApi, setConversation],
  );

  /**
   * 只修改当前会话的模型；Nest 另行记住这次选择，供未来新会话继承。
   * 其他历史会话各自持久化的 modelId 不会被改写。
   */
  const handleModelChange = useCallback(
    async (modelId: string) => {
      if (!activeConversationKey) return;

      try {
        const conversation = await updateConversation(activeConversationKey, {
          modelId,
        });
        setConversation(
          activeConversationKey,
          toConversationItem(conversation),
        );
        // 同步服务端保存的“上次选择”，让本地回退逻辑立即使用新模型。
        setModelRegistry((currentRegistry) =>
          currentRegistry
            ? { ...currentRegistry, activeModelId: modelId }
            : currentRegistry,
        );
      } catch (error) {
        messageApi.error(
          error instanceof Error ? error.message : '切换模型失败',
        );
      }
    },
    [activeConversationKey, messageApi, setConversation],
  );

  /**
   * Agent 能力是会话配置而非浏览器临时状态；服务端保存成功后再更新按钮。
   * 关闭工具后，下一轮请求创建的 DeepAgent 将不会收到任何工具定义。
   */
  const handleFeatureChange = useCallback(
    async (
      feature: 'thinkingEnabled' | 'toolsEnabled',
      enabled: boolean,
    ) => {
      if (!activeConversationKey) return;

      setUpdatingFeature(feature);
      try {
        const conversation = await updateConversation(activeConversationKey, {
          [feature]: enabled,
        });
        setConversation(
          activeConversationKey,
          toConversationItem(conversation),
        );
      } catch (error) {
        messageApi.error(
          error instanceof Error ? error.message : '更新会话能力失败',
        );
      } finally {
        setUpdatingFeature(undefined);
      }
    },
    [activeConversationKey, messageApi, setConversation],
  );

  /** 将本轮消息、会话 ID 和当前模型交给 Nest 流式接口。 */
  const handleSubmit = async (value: string, files: File[]) => {
    const content = value.trim() || (files.length ? texts.describeImages : '');
    if (!content || !activeConversationKey || !selectedModelId) return false;

    try {
      const images = await filesToChatImages(files);

      onRequest({
        conversationId: activeConversationKey,
        model: selectedModelId,
        messages: [{ role: 'user', content, images }],
      });
      listRef.current?.scrollTo({ top: 'bottom' });
      return true;
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : texts.imageReadFailed,
      );
      return false;
    }
  };

  /** 只在模型注册表变化时重建 Select 选项。 */
  const modelOptions = useMemo(
    () =>
      modelRegistry?.models.map((model) => ({
        label: model.name,
        value: model.id,
      })) ?? [],
    [modelRegistry?.models],
  );

  // 会话历史尚未恢复时禁止输入，避免新消息覆盖异步加载结果。
  const chatDisabled =
    initializing ||
    isDefaultMessagesRequesting ||
    !activeConversationKey ||
    !selectedModelId;

  return (
    <XProvider locale={locale} theme={designTheme}>
      <ChatContext.Provider value={{ onReload, setMessage }}>
        {contextHolder}
        <div className={styles.layout}>
          <ChatSide
            conversations={conversationItems}
            activeConversationKey={activeConversationKey}
            setActiveConversationKey={setActiveConversationKey}
            onCreateConversation={handleCreateConversation}
            onDeleteConversation={handleDeleteConversation}
            onRenameConversation={handleRenameConversation}
            onModelRegistryChange={setModelRegistry}
          />

          <div className={styles.chat}>
            <ChatList
              messages={messages}
              className={className}
              listRef={listRef}
            />
            <ChatSender
              key={activeConversationKey}
              inputValue={inputValue}
              setInputValue={setInputValue}
              onSubmit={handleSubmit}
              isRequesting={isRequesting}
              abort={abort}
              modelOptions={modelOptions}
              selectedModelId={selectedModelId}
              onModelChange={(modelId) => void handleModelChange(modelId)}
              thinkingEnabled={activeConversation?.thinkingEnabled ?? true}
              toolsEnabled={activeConversation?.toolsEnabled ?? true}
              updatingFeature={updatingFeature}
              onThinkingChange={(enabled) =>
                void handleFeatureChange('thinkingEnabled', enabled)
              }
              onToolsChange={(enabled) =>
                void handleFeatureChange('toolsEnabled', enabled)
              }
              modelsLoading={initializing}
              disabled={chatDisabled}
              onAttachmentError={(error) => void messageApi.error(error)}
            />
          </div>
        </div>
      </ChatContext.Provider>
    </XProvider>
  );
};

export default Independent;
