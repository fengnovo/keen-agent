'use client';

import React, { useCallback, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tooltip,
  message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

import {
  createModel,
  deleteModel,
  listModels,
  updateModel,
  type ModelConfig,
  type ModelRegistry,
} from '../_utils/model-api';

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const DEFAULT_MODEL: ModelConfig = {
  id: '',
  name: '',
  provider: 'anthropic',
  model: '',
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  temperature: 0,
  timeoutMs: 15_000,
  maxRetries: 1,
};

interface ModelManagerModalProps {
  /** 是否显示模型管理弹窗。 */
  open: boolean;
  /** 关闭弹窗。 */
  onClose: () => void;
  /** 模型 CRUD 后把最新注册表同步给聊天页和模型选择器。 */
  onRegistryChange?: (registry: ModelRegistry) => void;
}

const normalizeModel = (values: ModelConfig): ModelConfig => ({
  ...values,
  id: values.id.trim(),
  name: values.name.trim(),
  model: values.model.trim(),
  apiKeyEnv: values.apiKeyEnv.trim(),
  baseUrl: values.baseUrl?.trim() || undefined,
  baseUrlEnv: values.baseUrlEnv?.trim() || undefined,
  maxTokens: values.maxTokens || undefined,
});

export const ModelManagerModal: React.FC<ModelManagerModalProps> = ({
  open,
  onClose,
  onRegistryChange,
}) => {
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<ModelConfig>();
  const [registry, setRegistry] = useState<ModelRegistry>();
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelConfig>();

  /** 读取共享模型注册表，并同步更新聊天页的下拉选项。 */
  const loadRegistry = useCallback(async () => {
    setLoading(true);
    setLoadError('');

    try {
      const nextRegistry = await listModels();
      setRegistry(nextRegistry);
      onRegistryChange?.(nextRegistry);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : '无法读取模型配置',
      );
    } finally {
      setLoading(false);
    }
  }, [onRegistryChange]);

  const openCreateEditor = () => {
    setEditingModel(undefined);
    form.resetFields();
    form.setFieldsValue(DEFAULT_MODEL);
    setEditorOpen(true);
  };

  const openEditEditor = (model: ModelConfig) => {
    setEditingModel(model);
    form.resetFields();
    form.setFieldsValue(model);
    setEditorOpen(true);
  };

  /** 新建和编辑共用同一表单，保存成功后以服务端返回值为准。 */
  const submitModel = async (values: ModelConfig) => {
    setSaving(true);

    try {
      const model = normalizeModel(values);
      const nextRegistry = editingModel
        ? await updateModel(editingModel.id, model)
        : await createModel(model);

      setRegistry(nextRegistry);
      onRegistryChange?.(nextRegistry);
      setLoadError('');
      setEditorOpen(false);
      messageApi.success(editingModel ? '模型已更新' : '模型已创建');
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : '保存模型失败',
      );
    } finally {
      setSaving(false);
    }
  };

  /** 删除成功后使用服务端返回的完整注册表同步所有模型选择器。 */
  const runModelAction = async (
    actionKey: string,
    action: () => Promise<ModelRegistry>,
    successMessage: string,
  ) => {
    setPendingAction(actionKey);

    try {
      const nextRegistry = await action();
      setRegistry(nextRegistry);
      onRegistryChange?.(nextRegistry);
      setLoadError('');
      messageApi.success(successMessage);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : '模型操作失败',
      );
    } finally {
      setPendingAction('');
    }
  };

  const columns: TableProps<ModelConfig>['columns'] = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 190,
      render: (name: string, model) => (
        <Space orientation='vertical' size={0}>
          <span>{name}</span>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>{model.id}</span>
        </Space>
      ),
    },
    {
      title: '请求模型',
      dataIndex: 'model',
      width: 210,
      ellipsis: true,
    },
    {
      title: 'API Key 环境变量',
      dataIndex: 'apiKeyEnv',
      width: 190,
      ellipsis: true,
    },
    {
      title: '参数',
      width: 150,
      render: (_, model) => (
        <span style={{ color: '#595959', fontSize: 12 }}>
          T {model.temperature} · {model.timeoutMs}ms · 重试 {model.maxRetries}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 110,
      render: (_, model) => {
        const isLastModel = registry?.models.length === 1;

        return (
          <Space size='small'>
            <Button
              type='text'
              size='small'
              icon={<EditOutlined />}
              aria-label={`编辑 ${model.name}`}
              onClick={() => openEditEditor(model)}
            />
            <Tooltip title={isLastModel ? '至少需要保留一个模型' : undefined}>
              <span>
                <Popconfirm
                  title={`删除模型“${model.name}”？`}
                  okText='删除'
                  cancelText='取消'
                  okButtonProps={{ danger: true }}
                  disabled={isLastModel}
                  onConfirm={() =>
                    runModelAction(
                      `delete:${model.id}`,
                      () => deleteModel(model.id),
                      `已删除 ${model.name}`,
                    )
                  }
                >
                  <Button
                    danger
                    type='text'
                    size='small'
                    icon={<DeleteOutlined />}
                    aria-label={`删除 ${model.name}`}
                    disabled={isLastModel}
                    loading={pendingAction === `delete:${model.id}`}
                  />
                </Popconfirm>
              </span>
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <>
      {contextHolder}
      <Modal
        open={open}
        title='模型管理'
        width={960}
        onCancel={onClose}
        afterOpenChange={(isOpen) => {
          if (isOpen && !registry) void loadRegistry();
        }}
        footer={
          <Button type='primary' onClick={onClose}>
            完成
          </Button>
        }
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        <Space orientation='vertical' size='middle' style={{ width: '100%' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ color: '#595959' }}>
              配置与命令行 AI Agent 共用；这里只保存环境变量名，不保存 API Key。
            </span>
            <Space>
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
                onClick={openCreateEditor}
              >
                新建模型
              </Button>
            </Space>
          </div>

          {loadError ? (
            <Alert
              showIcon
              type='error'
              message='模型服务不可用'
              description={loadError}
              action={
                <Button size='small' onClick={() => void loadRegistry()}>
                  重试
                </Button>
              }
            />
          ) : null}

          <Table<ModelConfig>
            rowKey='id'
            columns={columns}
            dataSource={registry?.models ?? []}
            loading={loading}
            pagination={false}
            scroll={{ x: 950 }}
            locale={{ emptyText: loadError ? '暂时无法加载模型' : '暂无模型' }}
          />
        </Space>
      </Modal>

      <Modal
        open={editorOpen}
        title={editingModel ? '编辑模型' : '新建模型'}
        okText='保存'
        cancelText='取消'
        confirmLoading={saving}
        forceRender
        onOk={() => form.submit()}
        onCancel={() => setEditorOpen(false)}
      >
        <Form<ModelConfig>
          form={form}
          layout='vertical'
          initialValues={DEFAULT_MODEL}
          onFinish={(values) => void submitModel(values)}
        >
          <Form.Item
            label='模型 ID'
            name='id'
            rules={[
              { required: true, whitespace: true, message: '请输入模型 ID' },
            ]}
          >
            <Input placeholder='例如 claude-sonnet' autoComplete='off' />
          </Form.Item>

          <Form.Item
            label='显示名称'
            name='name'
            rules={[
              { required: true, whitespace: true, message: '请输入显示名称' },
            ]}
          >
            <Input placeholder='例如 Claude Sonnet' autoComplete='off' />
          </Form.Item>

          <Form.Item label='Provider' name='provider'>
            <Input disabled />
          </Form.Item>

          <Form.Item
            label='模型标识'
            name='model'
            rules={[
              { required: true, whitespace: true, message: '请输入请求模型标识' },
            ]}
          >
            <Input placeholder='例如 claude-sonnet-4-6' autoComplete='off' />
          </Form.Item>

          <Form.Item
            label='API Key 环境变量'
            name='apiKeyEnv'
            rules={[
              { required: true, message: '请输入 API Key 环境变量名' },
              {
                pattern: ENV_NAME_PATTERN,
                message: '请输入合法的环境变量名',
              },
            ]}
          >
            <Input placeholder='ANTHROPIC_API_KEY' autoComplete='off' />
          </Form.Item>

          <Form.Item
            label='Base URL（可选）'
            name='baseUrl'
            rules={[{ type: 'url', message: '请输入完整 URL' }]}
          >
            <Input placeholder='https://api.example.com' autoComplete='off' />
          </Form.Item>

          <Form.Item
            label='Base URL 环境变量（可选）'
            name='baseUrlEnv'
            rules={[
              {
                pattern: ENV_NAME_PATTERN,
                message: '请输入合法的环境变量名',
              },
            ]}
          >
            <Input placeholder='ANTHROPIC_BASE_URL' autoComplete='off' />
          </Form.Item>

          <Space size='middle' wrap align='start'>
            <Form.Item label='Temperature' name='temperature'>
              <InputNumber min={0} max={1} step={0.1} />
            </Form.Item>
            <Form.Item label='超时（毫秒）' name='timeoutMs'>
              <InputNumber min={1} step={1000} />
            </Form.Item>
            <Form.Item label='最大重试次数' name='maxRetries'>
              <InputNumber min={0} max={10} step={1} />
            </Form.Item>
            <Form.Item label='最大 Token（可选）' name='maxTokens'>
              <InputNumber min={1} step={1} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  );
};
