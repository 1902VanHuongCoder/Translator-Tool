"use client";

import { App, Card, Flex, Typography, Upload } from "antd";
import { FileAddOutlined, InboxOutlined } from "@ant-design/icons";
import { downloadFile, splitFileName } from "@/app/utils/fileUtils";

const { Dragger } = Upload;
const { Paragraph, Text } = Typography;

const ThaiSubtitleTemplate = () => {
  const { message } = App.useApp();

  const handleUpload = async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "srt") {
      message.error("Please upload an .srt file.");
      return;
    }

    const { nameWithoutExt } = splitFileName(file.name, ".srt");
    const outputName = `${nameWithoutExt}_thaisub.srt`;
    await downloadFile("", outputName, "application/x-subrip;charset=utf-8");
    message.success(`Downloaded ${outputName}`);
  };

  return (
    <Card title="Create Thai subtitle file" style={{ marginTop: 24 }}>
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        Upload an SRT file to create and download an empty Thai subtitle file with the _thaisub suffix.
      </Paragraph>
      <Dragger
        accept=".srt"
        multiple={false}
        showUploadList={false}
        beforeUpload={(file) => {
          void handleUpload(file as File);
          return false;
        }}
        style={{ padding: 16 }}>
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text"><FileAddOutlined /> Upload an SRT file</p>
        <Flex justify="center"><Text type="secondary">Example: movie.srt → movie_thaisub.srt</Text></Flex>
      </Dragger>
    </Card>
  );
};

export default ThaiSubtitleTemplate;
