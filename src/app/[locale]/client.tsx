"use client";

import React from "react";
import { CheckCircleOutlined, FileAddOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { Tabs } from "antd";
import SubtitleTranslator from "./SubtitleTranslator";
import { useTranslations } from "next-intl";
import { TranslationProvider } from "@/app/components/TranslationContext";
import ToolPage from "@/app/components/styled/ToolPage";
import ApiSettingsDrawer from "@/app/components/ApiSettingsDrawer";
import SubtitleQualityCheck from "./SubtitleQualityCheck";
import ThaiSubtitleTemplate from "./ThaiSubtitleTemplate";

const ClientPage = () => {
  const tSubtitle = useTranslations("SubtitleTranslator");
  return (
    <TranslationProvider>
      <ToolPage icon={<VideoCameraOutlined />} toolKey="subtitleTranslator" description={tSubtitle("clientDescription")}>
        <Tabs
          defaultActiveKey="translator"
          items={[
            {
              key: "translator",
              label: "Subtitle Translator",
              icon: <VideoCameraOutlined />,
              children: <SubtitleTranslator />,
            },
            {
              key: "quality-check",
              label: "Quality Check",
              icon: <CheckCircleOutlined />,
              children: <SubtitleQualityCheck />,
            },
            {
              key: "thai-subtitle-template",
              label: "Thai Subtitle File",
              icon: <FileAddOutlined />,
              children: <ThaiSubtitleTemplate />,
            },
          ]}
        />
      </ToolPage>
      <ApiSettingsDrawer />
    </TranslationProvider>
  );
};

export default ClientPage;
