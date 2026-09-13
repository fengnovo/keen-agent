'use client';

import React from 'react';
import {
  CheckOutlined,
  LoadingOutlined,
  MinusOutlined,
} from '@ant-design/icons';
import type { TodoItem } from '../_utils/reasoning-trace';

interface TodoListProps {
  todos: TodoItem[];
}

const statusIcon = (status: TodoItem['status']): React.ReactNode => {
  if (status === 'completed') {
    return <CheckOutlined className='todo-icon todo-icon-done' />;
  }
  if (status === 'in_progress') {
    return <LoadingOutlined spin className='todo-icon todo-icon-active' />;
  }
  return <MinusOutlined className='todo-icon todo-icon-pending' />;
};

/**
 * 复杂任务的状态列表：实时展示 pending / 进行中 / 已完成。
 * 数据来自服务端 todoListMiddleware 的 todos 状态快照，随流更新。
 */
export const TodoList: React.FC<TodoListProps> = React.memo(function TodoList({
  todos,
}) {
  if (todos.length === 0) return null;

  return (
    <div className='todo-list' role='list' aria-label='任务清单'>
      {todos.map((todo, index) => (
        <div
          key={`${todo.content}:${index}`}
          className={`todo-item todo-item-${todo.status}`}
          role='listitem'
        >
          {statusIcon(todo.status)}
          <span className='todo-content'>{todo.content}</span>
        </div>
      ))}
    </div>
  );
});
