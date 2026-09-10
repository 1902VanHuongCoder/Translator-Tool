"use client";
import React, { memo, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Layout, Menu, Space, Button, Flex } from "antd";
import { SunOutlined, MoonOutlined } from "@ant-design/icons";
import { useTheme } from "next-themes";
import { useAppMenu } from "@/app/components/projects";
import { LanguageSelector } from "./LanguageSelector";

const { Header } = Layout;

// 图标样式
const iconStyle = { fontSize: 18 };

// ============ 动态组件 ============

/**
 * 从路径中提取当前菜单项的 key
 * 路径格式: /locale/tool-name 或 /locale (首页)
 */
const getCurrentMenuKey = (pathname: string): string => {
  const segments = pathname.split("/").filter(Boolean);
  return segments.length > 1 ? segments.slice(1).join("/") : "home";
};

export function Navigation() {
  const menuItems = useAppMenu();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  // useSyncExternalStore for hydration-safe client detection
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const currentMenuKey = getCurrentMenuKey(pathname);

  const handleThemeToggle = () => {
    setTheme(resolvedTheme === "light" ? "dark" : "light");
  };

  // 主题切换图标：SSR 和 hydration 前显示 MoonOutlined，挂载后显示正确图标
  const themeIcon = mounted && resolvedTheme === "light" ? <SunOutlined style={iconStyle} /> : <MoonOutlined style={iconStyle} />;

  return (
    <Header style={{ padding: 0, background: "transparent", height: 48, lineHeight: "48px" }}>
      <Flex justify="space-between" align="center" style={{ padding: "0 16px", borderBottom: "1px solid rgba(128, 128, 128, 0.25)" }}>
        <Menu selectedKeys={[currentMenuKey]} mode="horizontal" items={menuItems} style={{ flex: 1, minWidth: 0, border: "none", background: "transparent" }} />
        <Space size="middle">
          <LanguageSelector />

          <Button type="text" icon={themeIcon} onClick={handleThemeToggle} aria-label="Toggle theme" />
        </Space>
      </Flex>
    </Header>
  );
}

export default memo(Navigation);
