'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

import {
  createPlugin,
  deletePlugin,
  listPlugins,
  setPluginEnabled,
  testPlugin,
  updatePlugin,
  type McpPluginConfig,
  type PluginConfig,
  type PluginRegistry,
  type SkillPluginConfig,
} from '../_utils/plugin-api';

const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const JSON_OBJECT_EXAMPLE = '{\n  "Authorization": "MCP_API_TOKEN"\n}';

interface PluginManagerModalProps {
  open: boolean;
  onClose: () => void;
}

interface PluginFormValues {
  type: 'mcp' | 'skill';
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  serverName?: string;
  transport?: 'stdio' | 'http';
  command?: string;
  argsText?: string;
  cwd?: string;
  envVarsText?: string;
  url?: string;
  headerEnvText?: string;
  timeoutMs?: number;
  path?: string;
}

const TYPE_META: Record<PluginConfig['type'], { label: string; color: string }> = {
  builtin: { label: 'DeepAgent 内置', color: 'purple' },
  tool: { label: '本地工具', color: 'blue' },
  mcp: { label: 'MCP', color: 'green' },
  skill: { label: 'Skill', color: 'orange' },
};

const parseJsonMap = (value: string | undefined, label: string) => {
  if (!value?.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label}必须是合法的 JSON 对象`);
  }

  if (
    !parsed ||
    Array.isArray(parsed) ||
    typeof parsed !== 'object' ||
    Object.values(parsed).some((item) => typeof item !== 'string')
  ) {
    throw new Error(`${label}的键和值都必须是字符串`);
  }

  return parsed as Record<string, string>;
};

const toFormValues = (
  plugin: McpPluginConfig | SkillPluginConfig,
): PluginFormValues => {
  if (plugin.type === 'skill') {
    return {
      type: 'skill',
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      enabled: plugin.enabled,
      path: plugin.path,
    };
  }

  return {
    type: 'mcp',
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    enabled: plugin.enabled,
    serverName: plugin.serverName,
    transport: plugin.transport,
    command: plugin.command,
    argsText: plugin.args.join('\n'),
    cwd: plugin.cwd,
    envVarsText: JSON.stringify(plugin.envVars, null, 2),
    url: plugin.url,
    headerEnvText: JSON.stringify(plugin.headerEnv, null, 2),
    timeoutMs: plugin.timeoutMs,
  };
};

const normalizePlugin = (
  values: PluginFormValues,
): McpPluginConfig | SkillPluginConfig => {
  const base = {
    id: values.id.trim(),
    name: values.name.trim(),
    description: values.description.trim(),
    enabled: values.enabled,
    system: false as const,
  };

  if (values.type === 'skill') {
    return { ...base, type: 'skill', path: values.path?.trim() ?? '' };
  }

  return {
    ...base,
    type: 'mcp',
    serverName: values.serverName?.trim() ?? '',
    transport: values.transport ?? 'stdio',
    command: values.command?.trim() || undefined,
    args:
      values.argsText
        ?.split('\n')
        .map((item) => item.trim())
        .filter(Boolean) ?? [],
    cwd: values.cwd?.trim() || undefined,
    envVars: parseJsonMap(values.envVarsText, '环境变量映射'),
    url: values.url?.trim() || undefined,
    headerEnv: parseJsonMap(values.headerEnvText, 'Header 映射'),
    timeoutMs: values.timeoutMs ?? 30_000,
  };
};

const getPluginDetails = (plugin: PluginConfig): string[] => {
  if (plugin.type === 'builtin') return plugin.capabilities;
  if (plugin.type === 'tool') return plugin.toolNames;
  if (plugin.type === 'skill') return [plugin.path];
  return plugin.transport === 'stdio'
    ? [`${plugin.command ?? ''} ${plugin.args.join(' ')}`.trim()]
    : [plugin.url ?? ''];
};

export const PluginManagerModal: React.FC<PluginManagerModalProps> = ({
  open,
  onClose,
}) => {
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<PluginFormValues>();
  const [registry, setRegistry] = useState<PluginRegistry>();
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [pendingAction, setPendingAction] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPlugin, setEditingPlugin] = useState<
    McpPluginConfig | SkillPluginConfig
  >();
  // setFieldsValue 发生在编辑弹窗挂载前，首次渲染用表单当前值兜底。
  const pluginType = Form.useWatch('type', form) ?? form.getFieldValue('type');
  const mcpTransport =
    Form.useWatch('transport', form) ?? form.getFieldValue('transport');

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setRegistry(await listPlugins());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '无法读取插件配置');
    } finally {
      setLoading(false);
    }
  }, []);

  const openCreateEditor = (type: 'mcp' | 'skill' = 'mcp') => {
    setEditingPlugin(undefined);
    form.resetFields();
    form.setFieldsValue({
      type,
      id: '',
      name: '',
      description: '',
      enabled: true,
      transport: 'stdio',
      argsText: '',
      envVarsText: '{}',
      headerEnvText: '{}',
      timeoutMs: 30_000,
    });
    setEditorOpen(true);
  };

  const openEditEditor = (plugin: McpPluginConfig | SkillPluginConfig) => {
    setEditingPlugin(plugin);
    form.resetFields();
    form.setFieldsValue(toFormValues(plugin));
    setEditorOpen(true);
  };

  const submitPlugin = async (values: PluginFormValues) => {
    setPendingAction('save');
    try {
      const plugin = normalizePlugin(values);
      const nextRegistry = editingPlugin
        ? await updatePlugin(editingPlugin.id, plugin)
        : await createPlugin(plugin);
      setRegistry(nextRegistry);
      setEditorOpen(false);
      messageApi.success(editingPlugin ? '插件已更新' : '插件已创建');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '保存插件失败');
    } finally {
      setPendingAction('');
    }
  };

  const runRegistryAction = async (
    actionKey: string,
    action: () => Promise<PluginRegistry>,
    successMessage: string,
  ) => {
    setPendingAction(actionKey);
    try {
      setRegistry(await action());
      messageApi.success(successMessage);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '插件操作失败');
    } finally {
      setPendingAction('');
    }
  };

  const handleTest = async (plugin: PluginConfig) => {
    const actionKey = `test:${plugin.id}`;
    setPendingAction(actionKey);
    try {
      const result = await testPlugin(plugin.id);
      const details = result.tools?.length
        ? `：${result.tools.join('、')}`
        : result.skill
          ? `：${result.skill.filePath}`
          : '';
      messageApi.success(`${result.message}${details}`, 5);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '插件测试失败');
    } finally {
      setPendingAction('');
    }
  };

  const filteredPlugins = useMemo(() => {
    const plugins = registry?.plugins ?? [];
    if (activeTab === 'all') return plugins;
    if (activeTab === 'system') {
      return plugins.filter((plugin) => plugin.system);
    }
    return plugins.filter((plugin) => plugin.type === activeTab);
  }, [activeTab, registry?.plugins]);

  const columns: TableProps<PluginConfig>['columns'] = [
    {
      title: '插件',
      dataIndex: 'name',
      width: 220,
      render: (name: string, plugin) => (
        <Space orientation='vertical' size={0}>
          <Space size={6}>
            <span>{name}</span>
            {plugin.system ? <Tag variant='filled'>系统</Tag> : null}
          </Space>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>{plugin.id}</span>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 130,
      render: (type: PluginConfig['type']) => (
        <Tag color={TYPE_META[type].color}>{TYPE_META[type].label}</Tag>
      ),
    },
    {
      title: '能力 / 连接',
      key: 'details',
      ellipsis: true,
      render: (_, plugin) => (
        <Tooltip title={getPluginDetails(plugin).join('、')}>
          <span style={{ color: '#595959' }}>
            {getPluginDetails(plugin).join('、')}
          </span>
        </Tooltip>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 90,
      render: (enabled: boolean, plugin) => (
        <Switch
          checked={enabled}
          loading={pendingAction === `toggle:${plugin.id}`}
          aria-label={`${enabled ? '停用' : '启用'} ${plugin.name}`}
          onChange={(checked) =>
            void runRegistryAction(
              `toggle:${plugin.id}`,
              () => setPluginEnabled(plugin.id, checked),
              checked ? `已启用 ${plugin.name}` : `已停用 ${plugin.name}`,
            )
          }
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 145,
      render: (_, plugin) => (
        <Space size='small'>
          <Tooltip title='测试插件'>
            <Button
              type='text'
              size='small'
              icon={<CheckCircleOutlined />}
              aria-label={`测试 ${plugin.name}`}
              loading={pendingAction === `test:${plugin.id}`}
              onClick={() => void handleTest(plugin)}
            />
          </Tooltip>
          {!plugin.system ? (
            <>
              <Button
                type='text'
                size='small'
                icon={<EditOutlined />}
                aria-label={`编辑 ${plugin.name}`}
                onClick={() =>
                  openEditEditor(plugin as McpPluginConfig | SkillPluginConfig)
                }
              />
              <Popconfirm
                title={`删除插件“${plugin.name}”？`}
                okText='删除'
                cancelText='取消'
                okButtonProps={{ danger: true }}
                onConfirm={() =>
                  runRegistryAction(
                    `delete:${plugin.id}`,
                    () => deletePlugin(plugin.id),
                    `已删除 ${plugin.name}`,
                  )
                }
              >
                <Button
                  danger
                  type='text'
                  size='small'
                  icon={<DeleteOutlined />}
                  aria-label={`删除 ${plugin.name}`}
                  loading={pendingAction === `delete:${plugin.id}`}
                />
              </Popconfirm>
            </>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <>
      {contextHolder}
      <Modal
        open={open}
        title='插件管理'
        width={1_020}
        onCancel={onClose}
        afterOpenChange={(isOpen) => {
          if (isOpen && !registry) void loadRegistry();
        }}
        footer={
          <Button type='primary' onClick={onClose}>
            完成
          </Button>
        }
        styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
      >
        <Space orientation='vertical' size='middle' style={{ width: '100%' }}>
          <Alert
            showIcon
            type='info'
            title='会话中的“工具调用”是总开关；这里决定哪些插件可以被 Agent 使用。'
            description='这是管理员能力：MCP 密钥仅填写环境变量名称。系统插件可以停用但不能删除；Skill 路径相对于仓库根目录。'
          />

          <div
            style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
          >
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                { key: 'all', label: '全部' },
                { key: 'system', label: '系统工具' },
                { key: 'mcp', label: 'MCP' },
                { key: 'skill', label: 'Skills' },
              ]}
            />
            <Space align='start'>
              <Button
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => void loadRegistry()}
              >
                刷新
              </Button>
              <Button
                type='primary'
                icon={<PlusOutlined />}
                onClick={() => openCreateEditor()}
              >
                新建插件
              </Button>
            </Space>
          </div>

          {loadError ? (
            <Alert
              showIcon
              type='error'
              title='插件服务不可用'
              description={loadError}
            />
          ) : null}

          <Table<PluginConfig>
            rowKey='id'
            size='middle'
            loading={loading}
            columns={columns}
            dataSource={filteredPlugins}
            pagination={false}
            scroll={{ x: 880 }}
          />
        </Space>
      </Modal>

      <Modal
        open={editorOpen}
        title={editingPlugin ? '编辑插件' : '新建插件'}
        okText='保存'
        cancelText='取消'
        confirmLoading={pendingAction === 'save'}
        onOk={() => form.submit()}
        onCancel={() => setEditorOpen(false)}
        destroyOnHidden
      >
        <Form
          form={form}
          layout='vertical'
          preserve={false}
          initialValues={{
            type: 'mcp',
            enabled: true,
            transport: 'stdio',
            argsText: '',
            envVarsText: '{}',
            headerEnvText: '{}',
            timeoutMs: 30_000,
          }}
          onFinish={(values) => void submitPlugin(values)}
        >
          <Form.Item name='type' label='插件类型' rules={[{ required: true }]}>
            <Select
              disabled={Boolean(editingPlugin)}
              options={[
                { label: 'MCP 服务', value: 'mcp' },
                { label: 'Skill', value: 'skill' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name='id'
            label='插件 ID'
            rules={[
              { required: true, message: '请输入插件 ID' },
              { pattern: PLUGIN_ID_PATTERN, message: '仅支持小写字母、数字和连字符' },
            ]}
          >
            <Input placeholder='weather-mcp' />
          </Form.Item>
          <Form.Item name='name' label='名称' rules={[{ required: true }]}>
            <Input placeholder='天气查询' />
          </Form.Item>
          <Form.Item name='description' label='说明' rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder='告诉 Agent 这个插件适合完成什么任务' />
          </Form.Item>
          <Form.Item name='enabled' label='创建后启用' valuePropName='checked'>
            <Switch />
          </Form.Item>

          {pluginType === 'skill' ? (
            <Form.Item
              name='path'
              label='SKILL.md 或目录路径'
              tooltip='可只填 .skills 下的 Skill 名称；目录名必须与 SKILL.md 的 name 一致'
              rules={[{ required: true }]}
            >
              <Input placeholder='example-skill' />
            </Form.Item>
          ) : null}

          {pluginType === 'mcp' ? (
            <>
              <Form.Item
                name='serverName'
                label='MCP 服务名称'
                rules={[{ required: true }]}
              >
                <Input prefix={<ApiOutlined />} placeholder='weather' />
              </Form.Item>
              <Form.Item name='transport' label='传输方式' rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: 'stdio（本地进程）', value: 'stdio' },
                    { label: 'Streamable HTTP', value: 'http' },
                  ]}
                />
              </Form.Item>
              {mcpTransport === 'http' ? (
                <>
                  <Form.Item
                    name='url'
                    label='服务地址'
                    rules={[{ required: true, type: 'url' }]}
                  >
                    <Input placeholder='https://example.com/mcp' />
                  </Form.Item>
                  <Form.Item
                    name='headerEnvText'
                    label='Header → 环境变量映射（JSON）'
                    tooltip='值是 AI Server 中的环境变量名称，不是密钥本身'
                  >
                    <Input.TextArea rows={4} placeholder={JSON_OBJECT_EXAMPLE} />
                  </Form.Item>
                </>
              ) : (
                <>
                  <Form.Item name='command' label='启动命令' rules={[{ required: true }]}>
                    <Input placeholder='npx' />
                  </Form.Item>
                  <Form.Item name='argsText' label='命令参数（每行一个）'>
                    <Input.TextArea
                      rows={4}
                      placeholder={
                        '-y\n@modelcontextprotocol/server-filesystem\n/path'
                      }
                    />
                  </Form.Item>
                  <Form.Item name='cwd' label='工作目录（可选）'>
                    <Input placeholder='.（相对于 .mcp/<插件 ID>/）' />
                  </Form.Item>
                  <Form.Item
                    name='envVarsText'
                    label='子进程变量 → 宿主环境变量映射（JSON）'
                    tooltip='例如 { "API_KEY": "WEATHER_API_KEY" }'
                  >
                    <Input.TextArea rows={4} placeholder={'{\n  "API_KEY": "WEATHER_API_KEY"\n}'} />
                  </Form.Item>
                </>
              )}
              <Form.Item name='timeoutMs' label='工具超时（毫秒）'>
                <InputNumber
                  min={1_000}
                  max={300_000}
                  step={1_000}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Modal>
    </>
  );
};
