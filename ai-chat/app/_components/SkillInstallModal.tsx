'use client';

import React, { useState } from 'react';
import {
  Alert,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Typography,
  message,
} from 'antd';

import {
  installSkills,
  type PluginRegistry,
  type SkillInstallResult,
  type SkillInstallRunner,
} from '../_utils/plugin-api';

interface SkillInstallModalProps {
  open: boolean;
  onClose: () => void;
  onRegistryChange: (registry: PluginRegistry) => void;
}

interface SkillInstallFormValues {
  runner: SkillInstallRunner;
  command: string;
}

/**
 * 把用户熟悉的单行命令拆成 argv。后端直接 spawn(argv) 且不经过 shell；
 * 这里仅保留引号分组和反斜杠转义，不执行管道、重定向或变量替换。
 */
const parseCommandArguments = (command: string): string[] => {
  const args: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | undefined;
  let escaped = false;
  let tokenStarted = false;

  for (const character of command.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      tokenStarted = true;
      continue;
    }
    if (character === '\\' && quote !== 'single') {
      escaped = true;
      tokenStarted = true;
      continue;
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? undefined : 'single';
      tokenStarted = true;
      continue;
    }
    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? undefined : 'double';
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character) && !quote) {
      if (tokenStarted) {
        args.push(current);
        current = '';
        tokenStarted = false;
      }
      continue;
    }

    current += character;
    tokenStarted = true;
  }

  if (escaped) current += '\\';
  if (quote) throw new Error('安装命令中存在未闭合的引号');
  if (tokenStarted) args.push(current);
  return args;
};

export const SkillInstallModal: React.FC<SkillInstallModalProps> = ({
  open,
  onClose,
  onRegistryChange,
}) => {
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<SkillInstallFormValues>();
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<SkillInstallResult>();
  const runner = Form.useWatch('runner', form) ?? 'npx';

  const handleInstall = async (values: SkillInstallFormValues) => {
    setInstalling(true);
    setResult(undefined);
    try {
      const args = parseCommandArguments(values.command);
      const pastedRunner = args[0];
      if (
        pastedRunner === 'npx' ||
        pastedRunner === 'uvx' ||
        pastedRunner === 'ux'
      ) {
        const normalizedRunner = pastedRunner === 'ux' ? 'uvx' : pastedRunner;
        if (normalizedRunner !== values.runner) {
          throw new Error(`请选择与命令一致的执行器：${normalizedRunner}`);
        }
        args.shift();
      }
      if (args.length === 0) throw new Error('请输入要执行的安装命令');

      const installResult = await installSkills(values.runner, args);
      setResult(installResult);
      onRegistryChange(installResult.registry);
      if (installResult.installed.length > 0) {
        messageApi.success(installResult.message);
      } else {
        messageApi.warning(installResult.message);
      }
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : 'Skill 下载安装失败',
      );
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        open={open}
        title='脚本下载安装 Skill'
        okText='下载安装'
        cancelText='关闭'
        confirmLoading={installing}
        okButtonProps={{ disabled: installing }}
        onOk={() => form.submit()}
        onCancel={onClose}
        destroyOnHidden
      >
        <Space orientation='vertical' size='middle' style={{ width: '100%' }}>
          <Alert
            showIcon
            type='warning'
            title='安装脚本会在 AI Server 宿主机执行'
            description='仅支持 npx 与 uvx（ux）执行器；命令不会经过 shell。请只安装可信来源，并为公网环境保护插件管理 API。'
          />

          <Form
            form={form}
            layout='vertical'
            initialValues={{ runner: 'npx', command: '' }}
            onFinish={(values) => void handleInstall(values)}
          >
            <Form.Item
              name='runner'
              label='执行器'
              rules={[{ required: true }]}
            >
              <Select
                options={[
                  { label: 'npx（Node.js）', value: 'npx' },
                  { label: 'uvx / ux（Python）', value: 'uvx' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name='command'
              label='安装命令'
              tooltip='可以粘贴完整命令，也可以省略开头的 npx / uvx'
              rules={[{ required: true, message: '请输入安装命令' }]}
            >
              <Input.TextArea
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder={
                  runner === 'npx'
                    ? 'npx skills add owner/repo --skill skill-name --agent codex --copy --yes'
                    : 'uvx your-skill-installer ...'
                }
              />
            </Form.Item>
            <Typography.Text type='secondary'>
              工作目录固定为 ai-agent。安装完成后，系统会扫描 .skills、.agents/skills
              和常见 Agent Skills 目录，校验并自动注册新增 Skill。
            </Typography.Text>
          </Form>

          {result ? (
            <>
              <Alert
                showIcon
                type={result.installed.length > 0 ? 'success' : 'warning'}
                title={result.message}
                description={
                  result.installed.length > 0
                    ? result.installed
                        .map((skill) => `${skill.name}（${skill.path}）`)
                        .join('、')
                    : '请确认安装器把 SKILL.md 写入了支持的项目目录。'
                }
              />
              {result.output ? (
                <pre
                  aria-label='安装命令输出'
                  style={{
                    maxHeight: 180,
                    margin: 0,
                    overflow: 'auto',
                    padding: 12,
                    borderRadius: 8,
                    background: '#f5f5f5',
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {result.output}
                </pre>
              ) : null}
            </>
          ) : null}
        </Space>
      </Modal>
    </>
  );
};
