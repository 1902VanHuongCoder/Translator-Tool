"use client";

import React, { useMemo, useState } from "react";
import { Alert, App, Button, Card, Descriptions, Flex, Input, InputNumber, Progress, Select, Space, Tag, Typography, Upload, theme } from "antd";
import { CheckCircleOutlined, InboxOutlined, WarningOutlined } from "@ant-design/icons";
import { detectSubtitleFormat } from "@/app/lib/translation/formats/subtitle";
import { translationServices } from "@/app/lib/translation";
import { useTranslationContext } from "@/app/components/TranslationContext";
import { useLocalStorage } from "@/app/hooks/useLocalStorage";
import { parseCues, type SubtitleCue } from "./subtitleCues";

const { Dragger } = Upload;
const { Text, Paragraph, Title } = Typography;

type LoadedSubtitle = { name: string; text: string; format: string };
type SampleResult = { index: number; source: string; translated: string; status: "ok" | "warning" | "error"; semanticScore?: number; gtxScore?: number; deeplxScore?: number; engineAgreement?: number };
type QualityReport = { score: number; sourceCount: number; translatedCount: number; timingMatches: number; emptyCount: number; unchangedCount: number; samples: SampleResult[]; semanticChecked: boolean; semanticMatches: number; engineAgreement: number };
type GeminiReview = { index: number; verdict: "PASS" | "REVIEW"; confidence: number; reason: string };

const supportedExtensions = new Set(["srt", "vtt", "ass", "ssa", "sbv"]);
const normalize = (value: string) => value.replace(/\{[^}]*\}/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
const formatLabel = (name: string) => name.split(".").pop()?.toUpperCase() || "SUBTITLE";

const semanticSimilarity = (left: string, right: string): number => {
  const tokens = (value: string) => value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  const tokenIntersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenDice = leftTokens.size && rightTokens.size ? (2 * tokenIntersection) / (leftTokens.size + rightTokens.size) : 0;
  const grams = (value: string) => {
    const compact = normalize(value).replace(/\s/g, "");
    const result = new Set<string>();
    for (let index = 0; index < compact.length - 1; index++) result.add(compact.slice(index, index + 2));
    return result;
  };
  const leftGrams = grams(left);
  const rightGrams = grams(right);
  const gramIntersection = [...leftGrams].filter((gram) => rightGrams.has(gram)).length;
  const gramDice = leftGrams.size && rightGrams.size ? (2 * gramIntersection) / (leftGrams.size + rightGrams.size) : 0;
  return Math.round(Math.max(tokenDice, gramDice) * 100);
};

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
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()) as { reviews?: Array<{ index?: number; verdict?: string; confidence?: number; reason?: string }> };
  if (!Array.isArray(parsed.reviews)) throw new Error("Gemini returned an invalid review format.");
  return parsed.reviews.map((review) => ({ index: Number(review.index), verdict: review.verdict === "PASS" ? "PASS" : "REVIEW", confidence: Math.max(0, Math.min(100, Math.round(Number(review.confidence) || 0))), reason: typeof review.reason === "string" ? review.reason : "Gemini did not provide a reason." }));
};

const listGeminiModels = async (apiKey: string): Promise<string[]> => {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", { headers: { "x-goog-api-key": apiKey.trim() } });
  if (!response.ok) return [];
  const data = await response.json() as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
  return (data.models ?? [])
    .filter((item) => item.name && item.supportedGenerationMethods?.includes("generateContent"))
    .map((item) => item.name!.replace(/^models\//, ""));
};

const reviewWithGemini = async (apiKey: string, model: string, source: SubtitleCue[], translated: SubtitleCue[], indexes: number[], sourceLanguage: string, targetLanguage: string): Promise<GeminiReview[]> => {
  const samples = indexes.map((index) => ({ index: index + 1, original: source[index].text, translation: translated[index]?.text ?? "" }));
  const requestBody = {
      systemInstruction: { parts: [{ text: "Bạn là người kiểm duyệt bản dịch phụ đề. Hãy đánh giá ý nghĩa, không chỉ so sánh từng từ. Chấp nhận cách diễn đạt tự nhiên, tỉnh lược trong hội thoại, tên riêng và bản địa hóa nếu ý nghĩa được giữ nguyên. Chỉ trả về JSON hợp lệ. QUAN TRỌNG: trường reason bắt buộc phải viết bằng TIẾNG VIỆT. Không được viết reason bằng tiếng Thái, tiếng Trung, tiếng Anh hoặc ngôn ngữ đích. Ví dụ reason hợp lệ: Bản dịch giữ nguyên ý nghĩa của câu gốc. / Bản dịch bỏ sót chi tiết quan trọng về con mèo." }] },
      contents: [{ parts: [{ text: `Hãy kiểm tra các mẫu phụ đề dịch từ ${sourceLanguage} sang ${targetLanguage}. Trả về chính xác {"reviews":[{"index":number,"verdict":"PASS"|"REVIEW","confidence":number,"reason":string}]}. PASS nghĩa là bản dịch giữ đúng ý; REVIEW nghĩa là bản dịch sai hoặc bỏ sót ý quan trọng. Mọi reason phải là câu tiếng Việt rõ ràng, ngắn gọn. Tuyệt đối không dùng tiếng Thái dù ngôn ngữ đích là tiếng Thái.\n\n${JSON.stringify(samples)}` }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  };
  const requestedModel = model.trim();
  const availableModels = await listGeminiModels(apiKey);
  const candidates = [requestedModel, ...availableModels.filter((candidate) => candidate !== requestedModel && /flash/i.test(candidate))].filter(Boolean).slice(0, 3);
  let lastError = "";
  for (const candidate of candidates) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidate)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      lastError = `${candidate}: ${response.status}${details ? ` ${details.slice(0, 180)}` : ""}`;
      if (response.status === 503 || response.status === 429) continue;
      throw new Error(`Gemini request failed (${lastError}). Check the API key and model access.`);
    }
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (!text) throw new Error(`Gemini model ${candidate} returned an empty review.`);
    return parseGeminiJson(text);
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
  return { score, sourceCount: source.length, translatedCount: translated.length, timingMatches, emptyCount, unchangedCount, samples, semanticChecked: false, semanticMatches: 0, engineAgreement: 0 };
};

const addSemanticReport = async (report: QualityReport, source: SubtitleCue[], translated: SubtitleCue[], sourceLanguage: string, targetLanguage: string): Promise<QualityReport> => {
  if (!source.length || !translated.length || sourceLanguage === targetLanguage) return report;
  const indexes = getSampleIndexes(Math.min(source.length, translated.length));
  const translate = (method: "gtxFreeAPI" | "deeplx", index: number) => translationServices[method]({ text: source[index].text, cacheSuffix: `quality-check-${method}-${index}`, translationMethod: method, sourceLanguage, targetLanguage, useCache: false });
  const independent = await Promise.all(indexes.map(async (index) => {
    const [gtx, deeplx] = await Promise.allSettled([translate("gtxFreeAPI", index), translate("deeplx", index)]);
    return { gtx: gtx.status === "fulfilled" ? gtx.value : "", deeplx: deeplx.status === "fulfilled" ? deeplx.value : "" };
  }));
  let semanticMatches = 0;
  let engineAgreement = 0;
  const samples = report.samples.map((sample, sampleIndex) => {
    const result = independent[sampleIndex];
    const userText = translated[sample.index - 1]?.text ?? "";
    const gtxScore = semanticSimilarity(result.gtx, userText);
    const deeplxScore = semanticSimilarity(result.deeplx, userText);
    const agreement = semanticSimilarity(result.gtx, result.deeplx);
    const scores = [gtxScore, deeplxScore].filter((score) => score > 0);
    const semanticScore = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
    if (semanticScore >= 35) semanticMatches++;
    if (agreement >= 35) engineAgreement++;
    const warning = !scores.length || semanticScore < 20 || (result.gtx && result.deeplx && agreement < 20 && Math.max(gtxScore, deeplxScore) < 50);
    return { ...sample, semanticScore, gtxScore, deeplxScore, engineAgreement: agreement, status: warning ? "warning" : sample.status } as SampleResult;
  });
  return { ...report, samples, semanticChecked: true, semanticMatches, engineAgreement };
};

const QualityResult = ({ report }: { report: QualityReport }) => {
  const { token } = theme.useToken();
  const healthy = !report.semanticChecked || report.semanticMatches > 0;
  return <Flex vertical gap={16} style={{ marginTop: 18 }}>
    <Progress percent={report.score} status={report.score >= 80 && healthy ? "success" : report.score >= 55 ? "normal" : "exception"} strokeColor={report.score >= 80 && healthy ? "#2f9e44" : undefined} />
    <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
      <Descriptions.Item label="Original cues">{report.sourceCount}</Descriptions.Item><Descriptions.Item label="Translated cues">{report.translatedCount}</Descriptions.Item><Descriptions.Item label="Matching timestamps">{report.timingMatches}</Descriptions.Item><Descriptions.Item label="Empty translations">{report.emptyCount}</Descriptions.Item><Descriptions.Item label="Unchanged text">{report.unchangedCount}</Descriptions.Item>
    </Descriptions>
    <Alert type={report.score >= 80 && healthy ? "success" : report.score >= 55 ? "warning" : "error"} showIcon title={report.score >= 80 && healthy ? "The subtitle structure looks healthy." : "Review the warnings before using this translation."} description={report.semanticChecked ? `Two independent free-machine checks: ${report.semanticMatches}/${report.samples.length} samples are close, and the engines agree on ${report.engineAgreement}/${report.samples.length}.` : "This is a structural and sampling check. Run the independent free-machine check for an additional semantic warning."} />
    <Title level={5} style={{ margin: 0 }}>Sampled subtitle lines</Title>
    <Flex vertical gap={8}>{report.samples.map((sample) => <div key={sample.index} style={{ borderInlineStart: `3px solid ${sample.status === "ok" ? "#2f9e44" : sample.status === "warning" ? token.colorWarning : token.colorError}`, paddingInlineStart: 12 }}><Flex justify="space-between" align="center" gap={8}><Text type="secondary">Cue {sample.index}</Text><Tag color={sample.status === "ok" ? "success" : sample.status === "warning" ? "warning" : "error"} icon={sample.status === "ok" ? <CheckCircleOutlined /> : <WarningOutlined />}>{sample.status === "ok" ? "Looks aligned" : sample.status === "warning" ? "Review" : "Missing"}</Tag></Flex><Paragraph style={{ margin: "6px 0 0" }}><Text strong>Original:</Text> {sample.source}</Paragraph><Paragraph style={{ margin: 0 }}><Text strong>Translation:</Text> {sample.translated || "(empty)"}</Paragraph>{sample.semanticScore !== undefined && <Text type="secondary">Combined: {sample.semanticScore}% · GTX: {sample.gtxScore || 0}% · DeepLX: {sample.deeplxScore || 0}% · Agreement: {sample.engineAgreement || 0}%</Text>}</div>)}</Flex>
  </Flex>;
};

const SubtitleQualityCheck = () => {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { sourceLanguage, targetLanguage } = useTranslationContext();
  const [source, setSource] = useState<LoadedSubtitle | null>(null);
  const [translated, setTranslated] = useState<LoadedSubtitle | null>(null);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [geminiReviews, setGeminiReviews] = useState<GeminiReview[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);
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
  const checkSemantics = async () => { if (!report || !source || !translated) return; setSemanticLoading(true); try { setReport(await addSemanticReport(report, parseCues(source.text, source.format), parseCues(translated.text, translated.format), sourceLanguage, targetLanguage)); } catch (error) { message.error(error instanceof Error ? error.message : "The free translation check failed."); } finally { setSemanticLoading(false); } };
  const checkWithGemini = async () => { if (!source || !translated || !geminiApiKey.trim()) return; setGeminiLoading(true); try { const sourceCues = parseCues(source.text, source.format); const translatedCues = parseCues(translated.text, translated.format); const indexes = getRandomSampleIndexes(Math.min(sourceCues.length, translatedCues.length), geminiSampleCount); setGeminiReviews(await reviewWithGemini(geminiApiKey, geminiModel, sourceCues, translatedCues, indexes, sourceLanguage, targetLanguage)); } catch (error) { message.error(error instanceof Error ? error.message : "Gemini review failed."); } finally { setGeminiLoading(false); } };
  const loadGeminiModels = async () => { if (!geminiApiKey.trim()) return; setModelsLoading(true); try { const models = await listGeminiModels(geminiApiKey); setAvailableGeminiModels(models); if (models.length && !models.includes(geminiModel)) setGeminiModel(models[0]); if (!models.length) message.warning("This API key returned no models that support generateContent."); } catch (error) { message.error(error instanceof Error ? error.message : "Could not load Gemini models."); } finally { setModelsLoading(false); } };
  const uploader = (kind: "source" | "translated", hint: string) => <Dragger multiple={false} showUploadList={false} accept=".srt,.vtt,.ass,.ssa,.sbv" beforeUpload={(file) => { void load(file as File, kind); return false; }} style={{ padding: 12 }}><p className="ant-upload-drag-icon"><InboxOutlined /></p><p className="ant-upload-text">{hint}</p><p className="ant-upload-hint">SRT, VTT, ASS, SSA or SBV</p></Dragger>;

  return <Card title="Subtitle quality check" style={{ marginTop: 24 }}>
    <Paragraph type="secondary" style={{ marginTop: 0 }}>Upload the original and translated files to detect missing cues, shifted timestamps, empty lines, and suspiciously unchanged samples.</Paragraph>
    <Flex gap={16} wrap><div style={{ flex: "1 1 320px", minWidth: 0 }}>{uploader("source", sourceHint)}</div><div style={{ flex: "1 1 320px", minWidth: 0 }}>{uploader("translated", translatedHint)}</div></Flex>
    <Button type="primary" icon={<CheckCircleOutlined />} disabled={!canCheck} loading={loading} onClick={check} style={{ marginTop: 16 }}>Check translation</Button>
    {report && !report.semanticChecked && <Button icon={<CheckCircleOutlined />} loading={semanticLoading} onClick={() => void checkSemantics()} style={{ marginTop: 16, marginInlineStart: 8 }}>Check sample meaning with free machine translation</Button>}
    {report && <QualityResult report={report} />}
    <Card type="inner" title="Gemini AI semantic review" style={{ marginTop: 24 }}>
      <Paragraph type="secondary" style={{ marginTop: 0 }}>Gemini reviews a small random sample and explains whether each translation preserves the meaning. It does not modify or replace your subtitle file.</Paragraph>
      <Space wrap><Input.Password placeholder="Gemini API key" value={geminiApiKey} onChange={(event) => { setGeminiApiKey(event.target.value); setAvailableGeminiModels([]); setGeminiReviews(null); }} style={{ width: 280 }} /><Button loading={modelsLoading} disabled={!geminiApiKey.trim()} onClick={() => void loadGeminiModels()}>Load available models</Button><Select showSearch placeholder="Load models first" value={availableGeminiModels.includes(geminiModel) ? geminiModel : undefined} onChange={(value) => { setGeminiModel(value); setGeminiReviews(null); }} options={availableGeminiModels.map((model) => ({ label: model, value: model }))} style={{ width: 220 }} />{!availableGeminiModels.length && <Input placeholder="Exact model name" value={geminiModel} onChange={(event) => { setGeminiModel(event.target.value); setGeminiReviews(null); }} style={{ width: 190 }} />}<Space.Compact><Text type="secondary" style={{ display: "inline-flex", alignItems: "center", paddingInline: 11, border: `1px solid ${token.colorBorder}`, borderInlineEnd: 0, background: token.colorFillQuaternary }}>Random samples</Text><InputNumber min={1} max={20} value={geminiSampleCount} onChange={(value) => setGeminiSampleCount(value ?? 20)} /></Space.Compact></Space>
      <Flex gap={8} align="center" wrap style={{ marginTop: 12 }}><Button type="primary" icon={<CheckCircleOutlined />} disabled={!canCheck || !geminiApiKey.trim()} loading={geminiLoading} onClick={() => void checkWithGemini()}>Review with Gemini</Button><Text type="secondary">The key is stored only in this browser.</Text></Flex>
      {geminiReviews && <Flex vertical gap={8} style={{ marginTop: 16 }}><Alert type={geminiReviews.every((review) => review.verdict === "PASS") ? "success" : "warning"} showIcon title={`${geminiReviews.filter((review) => review.verdict === "PASS").length}/${geminiReviews.length} sampled translations passed Gemini review`} description="Use REVIEW items for human inspection. Gemini is an assistant and should not be treated as a final linguistic authority." />{geminiReviews.map((review) => <Flex key={review.index} justify="space-between" align="start" gap={12} style={{ borderInlineStart: `3px solid ${review.verdict === "PASS" ? "#2f9e44" : token.colorWarning}`, paddingInlineStart: 12 }}><Text><strong>Cue {review.index}:</strong> {review.reason}</Text><Tag color={review.verdict === "PASS" ? "success" : "warning"}>{review.verdict} · {review.confidence}%</Tag></Flex>)}</Flex>}
    </Card>
  </Card>;
};

export default SubtitleQualityCheck;
