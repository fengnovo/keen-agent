import type React from 'react';
import type { ThemeConfig } from 'antd';

/**
 * Design 主题色配置。
 * 修改 primary 即可统一替换按钮、选中态和交互高亮颜色。
 */
export const DESIGN_THEME_COLORS = {
  primary: '#000000',
  primaryHover: '#262626',
  primaryActive: '#000000',
  background: '#ffffff',
  surface: '#f5f5f5',
  surfaceStrong: '#ebebeb',
  border: '#d9d9d9',
  borderSecondary: '#eeeeee',
  text: '#141414',
  textSecondary: '#595959',
  textTertiary: '#8c8c8c',
} as const;

/** Keen AI 的 Ant Design / Ant Design X 统一主题。 */
export const designTheme: ThemeConfig = {
  token: {
    colorPrimary: DESIGN_THEME_COLORS.primary,
    colorPrimaryHover: DESIGN_THEME_COLORS.primaryHover,
    colorPrimaryActive: DESIGN_THEME_COLORS.primaryActive,
    colorInfo: DESIGN_THEME_COLORS.primary,
    colorSuccess: DESIGN_THEME_COLORS.primaryHover,
    colorWarning: DESIGN_THEME_COLORS.textSecondary,
    colorError: DESIGN_THEME_COLORS.text,
    colorTextBase: DESIGN_THEME_COLORS.text,
    colorText: DESIGN_THEME_COLORS.text,
    colorTextSecondary: DESIGN_THEME_COLORS.textSecondary,
    colorTextTertiary: DESIGN_THEME_COLORS.textTertiary,
    colorBgBase: DESIGN_THEME_COLORS.background,
    colorBgContainer: DESIGN_THEME_COLORS.background,
    colorBgElevated: DESIGN_THEME_COLORS.background,
    colorBgLayout: DESIGN_THEME_COLORS.surface,
    colorFillSecondary: DESIGN_THEME_COLORS.surfaceStrong,
    colorBorder: DESIGN_THEME_COLORS.border,
    colorBorderSecondary: DESIGN_THEME_COLORS.borderSecondary,
    borderRadius: 10,
  },
  components: {
    Button: {
      primaryShadow: 'none',
      defaultHoverColor: DESIGN_THEME_COLORS.primary,
      defaultHoverBorderColor: DESIGN_THEME_COLORS.primary,
      defaultActiveColor: DESIGN_THEME_COLORS.primaryActive,
      defaultActiveBorderColor: DESIGN_THEME_COLORS.primaryActive,
    },
  },
};

/** XMarkdown light 主题的黑白定制变量。 */
export const markdownThemeStyle = {
  '--primary-color': DESIGN_THEME_COLORS.primary,
  '--primary-color-hover': DESIGN_THEME_COLORS.primaryHover,
  '--heading-color': DESIGN_THEME_COLORS.text,
  '--text-color': DESIGN_THEME_COLORS.text,
  '--thinking-text-color': DESIGN_THEME_COLORS.textTertiary,
  '--thinking-heading-color': DESIGN_THEME_COLORS.textSecondary,
  '--thinking-title-color': DESIGN_THEME_COLORS.textSecondary,
  '--light-bg': DESIGN_THEME_COLORS.surface,
  '--table-head-bg': DESIGN_THEME_COLORS.surface,
  '--table-body-bg': DESIGN_THEME_COLORS.background,
  '--border-color': DESIGN_THEME_COLORS.borderSecondary,
  '--line-color': DESIGN_THEME_COLORS.borderSecondary,
  '--cite-bg': DESIGN_THEME_COLORS.surface,
  '--cite-hover-bg': DESIGN_THEME_COLORS.surfaceStrong,
  '--xmd-tail-color': DESIGN_THEME_COLORS.primary,
  '--margin-block': '0 0 8px 0',
  '--margin-ul-ol': '0 0 10px 22px',
  '--margin-li': '0 0 6px 0',
  '--margin-pre': '0 0 10px 0',
  '--hr-margin': '8px 0',
  '--table-margin': '0 0 12px 0',
} as React.CSSProperties;
