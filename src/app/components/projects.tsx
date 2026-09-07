"use client";

import { VideoCameraOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { TOOL_REGISTRY, TOOL_KEYS, type ToolKey } from "@/app/lib/toolRegistry";

// 子项目导航：本仓库对应的工具走相对首页 `/${locale}`，其余工具指向主站。
// 工具集合 / 分组 / 标题全部从 TOOL_REGISTRY + i18n 派生 —— 不再硬编码、不再有
// onlyzh 隐藏（文本类工具均已 i18n 化，应在所有语言下显示）。
// ⚠ 每个子项目只改这一行：本仓库对应工具的 path（见 TOOL_REGISTRY）。
const CURRENT_TOOL_PATH = "subtitle-translator";

/** Per-tool icon — icons are React nodes (UI-only), so they live here, not in
 *  TOOL_REGISTRY. TS enforces one entry per ToolKey. */
const TOOL_ICONS: Record<ToolKey, React.ReactNode> = {
  subtitleTranslator: <VideoCameraOutlined />,
};

/** path → toolKey, for looking up icon / i18n title from a category path. */
const PATH_TO_KEY = TOOL_KEYS.reduce<Record<string, ToolKey>>((acc, k) => {
  acc[TOOL_REGISTRY[k].path] = k;
  return acc;
}, {});

/** UI grouping derived from TOOL_REGISTRY — single source of truth. */
export const useAppMenu = () => {
  const t = useTranslations();
  const locale = useLocale();

  const currentToolKey = PATH_TO_KEY[CURRENT_TOOL_PATH];

  const menuItems = [
    {
      label: <Link href={`/${locale}`} prefetch={false}>{currentToolKey ? t(`tools.${currentToolKey}.title`) : t("navigation.home")}</Link>,
      key: "home",
      icon: currentToolKey ? TOOL_ICONS[currentToolKey] : undefined,
    },
  ];

  return menuItems;
};
