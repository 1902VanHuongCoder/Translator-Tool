"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, App, Button, Card, Descriptions, Flex, Input, InputNumber, Progress, Select, Space, Tag, Typography, Upload, theme } from "antd";
import { CheckCircleOutlined, InboxOutlined, WarningOutlined } from "@ant-design/icons";
import { detectSubtitleFormat } from "@/app/lib/translation/formats/subtitle";
import { useTranslationContext } from "@/app/components/TranslationContext";
import { useLocalStorage } from "@/app/hooks/useLocalStorage";
import { parseCues, type SubtitleCue } from "./subtitleCues";

const { Dragger } = Upload;
const { Text, Paragraph, Title } = Typography;

type LoadedSubtitle = { name: string; text: string; format: string };
type SampleResult = { index: number; source: string; translated: string; status: "ok" | "warning" | "error" };
type QualityReport = { score: number; sourceCount: number; translatedCount: number; timingMatches: number; emptyCount: number; unchangedCount: number; samples: SampleResult[] };
type GeminiReview = { index: number; verdict: "PASS" | "REVIEW"; confidence: number; reason: string; sourceToTarget: string; uploadedToTarget: string; original: string; userTranslation: string };

const supportedExtensions = new Set(["srt", "vtt", "ass", "ssa", "sbv"]);
const normalize = (value: string) => value.replace(/\{[^}]*\}/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
const formatLabel = (name: string) => name.split(".").pop()?.toUpperCase() || "SUBTITLE";

const readSubtitle = async (file: File): Promise<LoadedSubtitle> => {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!supportedExtensions.has(extension)) throw new Error("Please upload an SRT, VTT, ASS, SSA, or SBV file.");
  const text = await file.text();
  const detected = detectSubtitleFormat(text.split(/\r?\n/));
  return { name: file.name, text, format: extension === "ssa" ? "ass" : detected === "error" ? extension : detected };
};

const getSampleIndexes = (count: number): number[] => {
  if (count <= 0) return [];
  const size = Math.min(5, count);
  if (size === count) return Array.from({ length: count }, (_, index) => index);
  return Array.from({ length: size }, (_, index) => Math.round((index * (count - 1)) / (size - 1)));
};

const getRandomSampleIndexes = (count: number, requested: number): number[] => {
  const indexes = Array.from({ length: count }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }
  return indexes.slice(0, Math.min(count, requested));
};

const parseGeminiJson = (text: string): GeminiReview[] => {
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()) as { reviews?: Array<{ index?: number; verdict?: string; confidence?: number; sourceToTarget?: string; uploadedToTarget?: string; reason?: string }> };
  if (!Array.isArray(parsed.reviews)) throw new Error("Gemini returned an invalid review format.");
  return parsed.reviews.map((review) => ({ index: Number(review.index), verdict: review.verdict === "PASS" ? "PASS" : "REVIEW", confidence: Math.max(0, Math.min(100, Math.round(Number(review.confidence) || 0))), reason: typeof review.reason === "string" ? review.reason : "Gemini không cung cấp nhận xét.", sourceToTarget: typeof review.sourceToTarget === "string" ? review.sourceToTarget : "", uploadedToTarget: typeof review.uploadedToTarget === "string" ? review.uploadedToTarget : "", original: "", userTranslation: "" }));
};

const listGeminiModels = async (apiKey: string): Promise<string[]> => {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", { headers: { "x-goog-api-key": apiKey.trim() } });
  if (!response.ok) return [];
  const data = await response.json() as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
  return (data.models ?? [])
    .filter((item) => item.name && item.supportedGenerationMethods?.includes("generateContent"))
    .map((item) => item.name!.replace(/^models\//, ""));
};

  const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const reviewWithGemini = async (apiKey: string, model: string, source: SubtitleCue[], translated: SubtitleCue[], indexes: number[], sourceLanguage: string): Promise<GeminiReview[]> => {
  const samples = indexes.map((index) => ({ index: index + 1, original: source[index].text, translation: translated[index]?.text ?? "" }));
  const requestBody = {
      systemInstruction: { parts: [{ text: `Bạn là chuyên gia kiểm tra bản dịch phụ đề. Chỉ trả về JSON hợp lệ. sourceToTarget, uploadedToTarget và reason bắt buộc viết hoàn toàn bằng tiếng Việt. Không được dùng Simplified Chinese, tiếng Thái hoặc ngôn ngữ giao diện cho ba trường này. Hãy đánh giá ý nghĩa, không chỉ so sánh từng từ.` }] },
      contents: [{ parts: [{ text: `Với mỗi cue, hãy thực hiện hai bản dịch độc lập sang tiếng Việt: sourceToTarget là bản dịch từ câu gốc (${sourceLanguage}) sang tiếng Việt; uploadedToTarget là bản dịch từ câu trong file subtitle thứ hai sang tiếng Việt. Sau đó so sánh hai bản dịch tiếng Việt này để kiểm tra file subtitle thứ hai có truyền tải đúng ý câu gốc không.\n\nTrả về chính xác JSON dạng {"reviews":[{"index":number,"verdict":"PASS"|"REVIEW","confidence":number,"sourceToTarget":string,"uploadedToTarget":string,"reason":string}]}. Cả sourceToTarget, uploadedToTarget và reason phải bằng tiếng Việt. PASS khi hai bản dịch tiếng Việt giữ cùng ý nghĩa; REVIEW khi có khác biệt ý nghĩa quan trọng. Nhận xét phải giải thích cụ thể điểm giống hoặc khác bằng tiếng Việt.\n\n${JSON.stringify(samples)}` }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  };
  const requestedModel = model.trim();
  const availableModels = await listGeminiModels(apiKey);
  const candidates = [requestedModel, ...availableModels.filter((candidate) => candidate !== requestedModel && /flash/i.test(candidate))].filter(Boolean).slice(0, 3);
  let lastError = "";
  for (const candidate of candidates) {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidate)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
        body: JSON.stringify(requestBody),
      });
      if (response.status !== 503 && response.status !== 429) break;
      if (attempt < 2) await delay(1200 * 2 ** attempt);
    }
    if (!response) continue;
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      lastError = `${candidate}: ${response.status}${details ? ` ${details.slice(0, 180)}` : ""}`;
      if (response.status === 404 || response.status === 503 || response.status === 429) continue;
      throw new Error(`Gemini request failed (${lastError}). Check the API key and model access.`);
    }
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (!text) throw new Error(`Gemini model ${candidate} returned an empty review.`);
    const parsedReviews = parseGeminiJson(text);
    return parsedReviews.map((review) => { const sample = samples.find((item) => item.index === review.index); return { ...review, original: sample?.original ?? "", userTranslation: sample?.translation ?? "" }; });
  }
  throw new Error(`Gemini could not process this request. The selected model may be overloaded and fallback models were unavailable. ${lastError}`);
};

export const buildQualityReport = (source: SubtitleCue[], translated: SubtitleCue[]): QualityReport => {
  const count = Math.min(source.length, translated.length);
  let timingMatches = 0;
  let emptyCount = 0;
  let unchangedCount = 0;
  for (let index = 0; index < count; index++) {
    if (Math.abs(source[index].startMs - translated[index].startMs) <= 150 && Math.abs(source[index].endMs - translated[index].endMs) <= 150) timingMatches++;
    if (!normalize(translated[index].text)) emptyCount++;
    if (normalize(source[index].text) === normalize(translated[index].text)) unchangedCount++;
  }
  const score = Math.min(100, (source.length === translated.length ? 30 : Math.max(0, 30 - Math.abs(source.length - translated.length) * 5)) + (count ? Math.round((timingMatches / count) * 30) : 0) + (count ? Math.round(((count - emptyCount) / count) * 25) : 0) + (count ? Math.round(Math.max(0, 1 - unchangedCount / count) * 15) : 0));
  const samples = getSampleIndexes(count).map((index) => {
    const unchanged = normalize(source[index].text) === normalize(translated[index].text);
    const timingOk = Math.abs(source[index].startMs - translated[index].startMs) <= 150 && Math.abs(source[index].endMs - translated[index].endMs) <= 150;
    return { index: index + 1, source: source[index].text, translated: translated[index].text, status: !normalize(translated[index].text) ? "error" : !timingOk || unchanged ? "warning" : "ok" } as SampleResult;
  });
  return { score, sourceCount: source.length, translatedCount: translated.length, timingMatches, emptyCount, unchangedCount, samples };
};

const QualityResult = ({ report }: { report: QualityReport }) => {
  const { token } = theme.useToken();
  const tSubtitle = useTranslations("SubtitleTranslator");
  const q = (key: string, fallback: string) => tSubtitle.has(key) ? tSubtitle(key) : fallback;
  return <Flex vertical gap={16} style={{ marginTop: 18 }}>
    <Progress percent={report.score} status={report.score >= 80 ? "success" : report.score >= 55 ? "normal" : "exception"} strokeColor={report.score >= 80 ? "#2f9e44" : undefined} />
    <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
      <Descriptions.Item label={q("qualityOriginalCues", "Original cues")}>{report.sourceCount}</Descriptions.Item><Descriptions.Item label={q("qualityTranslatedCues", "Translated cues")}>{report.translatedCount}</Descriptions.Item><Descriptions.Item label={q("qualityMatchingTimestamps", "Matching timestamps")}>{report.timingMatches}</Descriptions.Item><Descriptions.Item label={q("qualityEmptyTranslations", "Empty translations")}>{report.emptyCount}</Descriptions.Item><Descriptions.Item label={q("qualityUnchangedText", "Unchanged text")}>{report.unchangedCount}</Descriptions.Item>
    </Descriptions>
    <Alert type={report.score >= 80 ? "success" : report.score >= 55 ? "warning" : "error"} showIcon title={report.score >= 80 ? q("qualityStructureHealthy", "The subtitle structure looks healthy.") : q("qualityReviewWarnings", "Review the warnings before using this translation.")} description={q("qualityStructureDescription", "This checks cue counts, timestamps, empty translations, and unchanged text. Use Gemini review below for semantic checking.")} />
    <Title level={5} style={{ margin: 0 }}>{q("qualitySampledLines", "Sampled subtitle lines")}</Title>
    <Flex vertical gap={8}>{report.samples.map((sample) => <div key={sample.index} style={{ borderInlineStart: `3px solid ${sample.status === "ok" ? "#2f9e44" : sample.status === "warning" ? token.colorWarning : token.colorError}`, paddingInlineStart: 12 }}><Flex justify="space-between" align="center" gap={8}><Text type="secondary">Cue {sample.index}</Text><Tag color={sample.status === "ok" ? "success" : sample.status === "warning" ? "warning" : "error"} icon={sample.status === "ok" ? <CheckCircleOutlined /> : <WarningOutlined />}>{sample.status === "ok" ? q("qualityLooksAligned", "Looks aligned") : sample.status === "warning" ? q("qualityReview", "Review") : q("qualityMissing", "Missing")}</Tag></Flex><Paragraph style={{ margin: "6px 0 0" }}><Text strong>{q("qualityOriginal", "Original")}:</Text> {sample.source}</Paragraph><Paragraph style={{ margin: 0 }}><Text strong>{q("qualityTranslation", "Translation")}:</Text> {sample.translated || "(empty)"}</Paragraph></div>)}</Flex>
  </Flex>;
};

const SubtitleQualityCheck = () => {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { sourceLanguage } = useTranslationContext();
  const tSubtitle = useTranslations("SubtitleTranslator");
  const q = (key: string, fallback: string) => tSubtitle.has(key) ? tSubtitle(key) : fallback;
  const sourceLanguageLabel = sourceLanguage;
  const [source, setSource] = useState<LoadedSubtitle | null>(null);
  const [translated, setTranslated] = useState<LoadedSubtitle | null>(null);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [geminiReviews, setGeminiReviews] = useState<GeminiReview[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useLocalStorage("subtitle-quality-gemini-api-key", "");
  const [geminiModel, setGeminiModel] = useLocalStorage("subtitle-quality-gemini-model-v2", "gemini-3.7-flash");
  const [geminiSampleCount, setGeminiSampleCount] = useLocalStorage("subtitle-quality-gemini-sample-count-v2", 20);
  const [availableGeminiModels, setAvailableGeminiModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const canCheck = Boolean(source && translated);
  const sourceHint = useMemo(() => source ? `${formatLabel(source.name)} · ${parseCues(source.text, source.format).length} cues` : "Upload the original subtitle", [source]);
  const translatedHint = useMemo(() => translated ? `${formatLabel(translated.name)} · ${parseCues(translated.text, translated.format).length} cues` : "Upload the translated subtitle", [translated]);

  const load = async (file: File, kind: "source" | "translated") => { try { const value = await readSubtitle(file); if (kind === "source") setSource(value); else setTranslated(value); setReport(null); setGeminiReviews(null); } catch (error) { message.error(error instanceof Error ? error.message : "Could not read this subtitle file."); } };
  const check = () => { if (!source || !translated) return; setLoading(true); setReport(buildQualityReport(parseCues(source.text, source.format), parseCues(translated.text, translated.format))); setLoading(false); };
  const checkWithGemini = async () => { if (!source || !translated || !geminiApiKey.trim()) return; setGeminiLoading(true); try { const sourceCues = parseCues(source.text, source.format); const translatedCues = parseCues(translated.text, translated.format); const indexes = getRandomSampleIndexes(Math.min(sourceCues.length, translatedCues.length), geminiSampleCount); setGeminiReviews(await reviewWithGemini(geminiApiKey, geminiModel, sourceCues, translatedCues, indexes, sourceLanguage)); } catch (error) { message.error(error instanceof Error ? error.message : "Gemini review failed."); } finally { setGeminiLoading(false); } };
  const loadGeminiModels = async () => { if (!geminiApiKey.trim()) return; setModelsLoading(true); try { const models = await listGeminiModels(geminiApiKey); setAvailableGeminiModels(models); if (models.length && !models.includes(geminiModel)) setGeminiModel(models[0]); if (!models.length) message.warning("This API key returned no models that support generateContent."); } catch (error) { message.error(error instanceof Error ? error.message : "Could not load Gemini models."); } finally { setModelsLoading(false); } };
  const uploader = (kind: "source" | "translated", hint: string) => <Dragger multiple={false} showUploadList={false} accept=".srt,.vtt,.ass,.ssa,.sbv" beforeUpload={(file) => { void load(file as File, kind); return false; }} style={{ padding: 12 }}><p className="ant-upload-drag-icon"><InboxOutlined /></p><p className="ant-upload-text">{hint}</p><p className="ant-upload-hint">{q("qualitySupportedFormats", "SRT, VTT, ASS, SSA or SBV")}</p></Dragger>;

  return <Card title={q("qualityTitle", "Subtitle quality check")} style={{ marginTop: 24 }}>
    <Paragraph type="secondary" style={{ marginTop: 0 }}>{q("qualityDescription", "Upload the original and translated files to detect missing cues, shifted timestamps, empty lines, and suspiciously unchanged samples.")}</Paragraph>
    <Flex gap={16} wrap><div style={{ flex: "1 1 320px", minWidth: 0 }}>{uploader("source", source ? sourceHint : q("qualityUploadOriginal", "Upload the original subtitle"))}</div><div style={{ flex: "1 1 320px", minWidth: 0 }}>{uploader("translated", translated ? translatedHint : q("qualityUploadTranslated", "Upload the translated subtitle"))}</div></Flex>
    <Button type="primary" icon={<CheckCircleOutlined />} disabled={!canCheck} loading={loading} onClick={check} style={{ marginTop: 16 }}>{q("qualityCheckStructure", "Check translation structure")}</Button>
    {report && <QualityResult report={report} />}
    <Card type="inner" title={q("qualityGeminiTitle", "Gemini AI semantic review")} style={{ marginTop: 24 }}>
      <Paragraph type="secondary" style={{ marginTop: 0 }}>{q("qualityGeminiDescription", "Gemini reviews a small random sample and explains whether each translation preserves the meaning. It does not modify or replace your subtitle file.")}</Paragraph>
      <Space wrap><Input.Password placeholder={q("qualityApiKeyPlaceholder", "Gemini API key")} value={geminiApiKey} onChange={(event) => { setGeminiApiKey(event.target.value); setAvailableGeminiModels([]); setGeminiReviews(null); }} style={{ width: 280 }} /><Button loading={modelsLoading} disabled={!geminiApiKey.trim()} onClick={() => void loadGeminiModels()}>{q("qualityLoadModels", "Load available models")}</Button><Select virtual={false} showSearch placeholder={q("qualityLoadModelsFirst", "Load models first")} value={availableGeminiModels.includes(geminiModel) ? geminiModel : undefined} onChange={(value) => { setGeminiModel(value); setGeminiReviews(null); }} options={availableGeminiModels.map((model) => ({ label: model, value: model }))} style={{ width: 220 }} />{!availableGeminiModels.length && <Input placeholder={q("qualityExactModel", "Exact model name")} value={geminiModel} onChange={(event) => { setGeminiModel(event.target.value); setGeminiReviews(null); }} style={{ width: 190 }} />}<Space.Compact><Text type="secondary" style={{ display: "inline-flex", alignItems: "center", paddingInline: 11, border: `1px solid ${token.colorBorder}`, borderInlineEnd: 0, background: token.colorFillQuaternary }}>{q("qualityRandomSamples", "Random samples")}</Text><InputNumber min={1} max={20} value={geminiSampleCount} onChange={(value) => setGeminiSampleCount(value ?? 20)} /></Space.Compact></Space>
      <Flex gap={8} align="center" wrap style={{ marginTop: 12 }}><Button type="primary" icon={<CheckCircleOutlined />} disabled={!canCheck || !geminiApiKey.trim()} loading={geminiLoading} onClick={() => void checkWithGemini()}>{q("qualityReviewWithGemini", "Review with Gemini")}</Button><Text type="secondary">{q("qualityKeyStoredLocally", "The key is stored only in this browser.")}</Text></Flex>
      {geminiReviews && <Flex vertical gap={12} style={{ marginTop: 16 }}><Alert type={geminiReviews.every((review) => review.verdict === "PASS") ? "success" : "warning"} showIcon title={`${geminiReviews.filter((review) => review.verdict === "PASS").length}/${geminiReviews.length} ${q("qualityPassed", "sampled translations passed Gemini review")}`} description={q("qualityComparisonDescription", "Both comparison translations and Gemini's explanation are in Vietnamese.")} />{geminiReviews.map((review) => <Card key={review.index} size="small" style={{ borderInlineStart: `3px solid ${review.verdict === "PASS" ? "#2f9e44" : token.colorWarning}` }}><Flex justify="space-between" align="center" gap={12}><Text strong>Cue {review.index}</Text><Tag color={review.verdict === "PASS" ? "success" : "warning"}>{review.verdict} · {review.confidence}%</Tag></Flex><Descriptions size="small" column={1} style={{ marginTop: 8 }}><Descriptions.Item label={`${q("qualitySourceLanguage", "Source language")} (${sourceLanguageLabel})`}>{review.original}</Descriptions.Item><Descriptions.Item label={q("qualityUploadedFile", "Translation in uploaded file")}>{review.userTranslation}</Descriptions.Item><Descriptions.Item label={q("qualityGeminiSourceVietnamese", "Gemini translation of source to Vietnamese")}>{review.sourceToTarget || q("qualityNoResult", "(no result)")}</Descriptions.Item><Descriptions.Item label={q("qualityGeminiUploadedVietnamese", "Gemini translation of uploaded file to Vietnamese")}>{review.uploadedToTarget || q("qualityNoResult", "(no result)")}</Descriptions.Item><Descriptions.Item label={q("qualityGeminiAssessment", "Gemini assessment (Vietnamese)")}>{review.reason}</Descriptions.Item></Descriptions></Card>)}</Flex>}
    </Card>
  </Card>;
};

export default SubtitleQualityCheck;
