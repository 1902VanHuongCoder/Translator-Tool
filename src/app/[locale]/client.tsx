"use client";

import React from "react";
import { CheckCircleOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { Tabs } from "antd";
import SubtitleTranslator from "./SubtitleTranslator";
import { useTranslations, useLocale } from "next-intl";
import { TranslationProvider } from "@/app/components/TranslationContext";
import { getDocUrl } from "@/app/utils";
import ToolPage from "@/app/components/styled/ToolPage";
import ApiSettingsDrawer from "@/app/components/ApiSettingsDrawer";
import SubtitleQualityCheck from "./SubtitleQualityCheck";

const ClientPage = () => {
  const tSubtitle = useTranslations("SubtitleTranslator");
  const locale = useLocale();
  const userGuideUrl = getDocUrl("guide/translation/subtitle-translator/index.html", locale);

  return (
    <TranslationProvider>
      <ToolPage icon={<VideoCameraOutlined />} toolKey="subtitleTranslator" description={tSubtitle("clientDescription")} guideUrl={userGuideUrl}>
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
          ]}
        />
      </ToolPage>
      <ApiSettingsDrawer />
    </TranslationProvider>
  );
};

export default ClientPage;
