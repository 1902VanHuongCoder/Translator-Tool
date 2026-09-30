"use client";

import React, { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Flex,
  Input,
  InputNumber,
  Progress,
  Radio,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  Upload,
  theme,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { detectSubtitleFormat } from "@/app/lib/translation/formats/subtitle";
import { useLocalStorage } from "@/app/hooks/useLocalStorage";
import { parseCues, type SubtitleCue } from "./subtitleCues";

const { Dragger } = Upload;
const { Text, Paragraph, Title } = Typography;

export type LoadedSubtitle = { name: string; text: string; format: string };
export type SampleResult = { index: number; source: string; translated: string; status: "ok" | "warning" | "error" };
export type QualityReport = {
  score: number;
  sourceCount: number;
  translatedCount: number;
  timingMatches: number;
  emptyCount: number;
  unchangedCount: number;
  samples: SampleResult[];
};

export type ReviewVerdict = "PASS" | "MINOR" | "MAJOR" | "CRITICAL";
export type ReviewCategory =
  | "NONE"
  | "MISTRANSLATION"
  | "OMISSION_ADDITION"
  | "PRONOUN_TONE"
  | "TERMINOLOGY"
  | "NATURALNESS";

export type SupportedSourceLanguage = "auto" | "zh" | "vi";

export interface GeminiReview {
  index: number;
  verdict: ReviewVerdict;
  category: ReviewCategory;
  confidence: number;
  reason: string;
  thaiToVi: string;
  sourceVi?: string;
  suggestedCorrection?: string;
  original: string;
  userTranslation: string;
  contextBefore?: string;
  contextAfter?: string;
}

interface SamplePayload {
  index: number;
  original: string;
  translation: string;
  contextBefore?: string;
  contextAfter?: string;
}

/**
 * Filter out non-text modalities (TTS audio, image, video, embedding, etc.)
 */
export const isTextGenerationModel = (name: string): boolean => {
  const lower = name.toLowerCase().trim();
  if (
    lower.includes("tts") ||
    lower.includes("audio") ||
    lower.includes("image") ||
    lower.includes("imagen") ||
    lower.includes("veo") ||
    lower.includes("embedding") ||
    lower.includes("aqa") ||
    lower.includes("computer-use") ||
    lower.includes("robotics")
  ) {
    return false;
  }
  return lower.startsWith("gemini");
};

const supportedExtensions = new Set(["srt", "vtt", "ass", "ssa", "sbv"]);
const normalize = (value: string) =>
  value
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
const formatLabel = (name: string) => name.split(".").pop()?.toUpperCase() || "SUBTITLE";

const readSubtitle = async (file: File): Promise<LoadedSubtitle> => {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!supportedExtensions.has(extension)) throw new Error("Please upload an SRT, VTT, ASS, SSA, or SBV file.");
  const text = await file.text();
  const detected = detectSubtitleFormat(text.split(/\r?\n/));
  return { name: file.name, text, format: extension === "ssa" ? "ass" : detected === "error" ? extension : detected };
};

export const detectLanguageFromCues = (cues: SubtitleCue[]): "zh" | "vi" => {
  let zhCount = 0;
  let viCount = 0;
  const zhRegex = /[\u4e00-\u9fa5]/g;
  const viRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi;

  for (const cue of cues.slice(0, 150)) {
    const zhMatches = cue.text.match(zhRegex);
    if (zhMatches) zhCount += zhMatches.length;
    const viMatches = cue.text.match(viRegex);
    if (viMatches) viCount += viMatches.length;
  }
  return zhCount >= viCount ? "zh" : "vi";
};

const CHINESE_NEGATION = /[不没别非无莫未]/;
const VIETNAMESE_NEGATION = /\b(không|chẳng|chả|chưa|đừng|cấm|vô|phi)\b/i;
const THAI_NEGATION = /(ไม่|อย่า|มิ|ห้าม|มิได้|ไม่ได้)/;

const CHINESE_QUESTION = /[？?吗吧呢]/;
const VIETNAMESE_QUESTION = /[?]|(\b(hả|sao|à|chứ|nhỉ|ư|chăng|ai|gì|đâu|nào)\b)/i;
const THAI_QUESTION = /[?]|(ไหม|หรือ|มั้ย|เหรอ|นะ|คะ|ครับ|ทำไม|อะไร|ที่ไหน|ใคร)/;

export const calculateCueRiskScore = (
  sourceText: string,
  translatedText: string,
  sourceLang: "zh" | "vi"
): number => {
  const src = sourceText.trim();
  const tra = translatedText.trim();

  if (!src || !tra) return -100;
  if (/^[\[（(【].*[\]）)】]$/.test(src) || /^(music|applause|laughter|nhạc|tiếng cười)$/i.test(src)) {
    return -80;
  }
  if (src.length <= 2) return -40;

  let score = 15;

  const srcDigits = src.match(/\d+/g)?.join("") || "";
  const traDigits = tra.match(/\d+/g)?.join("") || "";
  if (srcDigits) {
    score += 25;
    if (srcDigits !== traDigits) score += 35;
  }

  const srcHasNegation = sourceLang === "zh" ? CHINESE_NEGATION.test(src) : VIETNAMESE_NEGATION.test(src);
  const traHasNegation = THAI_NEGATION.test(tra);
  if (srcHasNegation !== traHasNegation) {
    score += 45;
  } else if (srcHasNegation && traHasNegation) {
    score += 20;
  }

  const srcHasQuestion = sourceLang === "zh" ? CHINESE_QUESTION.test(src) : VIETNAMESE_QUESTION.test(src);
  const traHasQuestion = THAI_QUESTION.test(tra);
  if (srcHasQuestion !== traHasQuestion) {
    score += 30;
  }

  if (sourceLang === "zh") {
    const ratio = tra.length / Math.max(1, src.length);
    if (ratio < 1.3) score += 40;
    else if (ratio > 6.0) score += 35;
  } else {
    const ratio = tra.length / Math.max(1, src.length);
    if (ratio < 0.45) score += 40;
    else if (ratio > 2.5) score += 35;
  }

  if ((sourceLang === "zh" && src.length > 18) || (sourceLang === "vi" && src.length > 50)) {
    score += 25;
  }

  if (normalize(src) === normalize(tra)) {
    score += 60;
  }

  return score;
};

export const getSmartSampleIndexes = (
  source: SubtitleCue[],
  translated: SubtitleCue[],
  requested: number,
  sourceLang: "zh" | "vi"
): number[] => {
  const total = Math.min(source.length, translated.length);
  if (total <= requested) {
    return Array.from({ length: total }, (_, index) => index);
  }

  const scoredCues = Array.from({ length: total }, (_, index) => ({
    index,
    score: calculateCueRiskScore(source[index].text, translated[index]?.text ?? "", sourceLang),
  }));

  const segments = 4;
  const segmentSize = Math.ceil(total / segments);
  const perSegmentQuota = Math.floor(requested / segments);
  let remainder = requested % segments;

  const selectedIndexes: number[] = [];

  for (let s = 0; s < segments; s++) {
    const start = s * segmentSize;
    const end = Math.min(total, start + segmentSize);
    if (start >= end) continue;

    const segmentCues = scoredCues.slice(start, end);
    segmentCues.sort((a, b) => (b.score + Math.random() * 8) - (a.score + Math.random() * 8));

    const quota = perSegmentQuota + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;

    for (let i = 0; i < Math.min(segmentCues.length, quota); i++) {
      selectedIndexes.push(segmentCues[i].index);
    }
  }

  if (selectedIndexes.length < requested) {
    const chosenSet = new Set(selectedIndexes);
    scoredCues.sort((a, b) => b.score - a.score);
    for (const item of scoredCues) {
      if (selectedIndexes.length >= requested) break;
      if (!chosenSet.has(item.index)) {
        selectedIndexes.push(item.index);
        chosenSet.add(item.index);
      }
    }
  }

  return selectedIndexes.sort((a, b) => a - b);
};

const getSampleIndexes = (count: number): number[] => {
  if (count <= 0) return [];
  const size = Math.min(5, count);
  if (size === count) return Array.from({ length: count }, (_, index) => index);
  return Array.from({ length: size }, (_, index) => Math.round((index * (count - 1)) / (size - 1)));
};

const parseGeminiJson = (text: string): GeminiReview[] => {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(clean) as {
    reviews?: Array<{
      index?: number;
      verdict?: string;
      category?: string;
      confidence?: number;
      sourceVi?: string;
      thaiToVi?: string;
      sourceToTarget?: string;
      uploadedToTarget?: string;
      reason?: string;
      suggestedCorrection?: string;
    }>;
  };
  if (!Array.isArray(parsed.reviews)) throw new Error("Gemini returned an invalid review format.");
  return parsed.reviews.map((review) => {
    const rawVerdict = String(review.verdict || "").toUpperCase();
    const verdict: ReviewVerdict =
      rawVerdict === "CRITICAL"
        ? "CRITICAL"
        : rawVerdict === "MAJOR"
        ? "MAJOR"
        : rawVerdict === "MINOR"
        ? "MINOR"
        : "PASS";

    const rawCat = String(review.category || "").toUpperCase();
    const category: ReviewCategory =
      rawCat === "MISTRANSLATION"
        ? "MISTRANSLATION"
        : rawCat === "OMISSION_ADDITION"
        ? "OMISSION_ADDITION"
        : rawCat === "PRONOUN_TONE"
        ? "PRONOUN_TONE"
        : rawCat === "TERMINOLOGY"
        ? "TERMINOLOGY"
        : rawCat === "NATURALNESS"
        ? "NATURALNESS"
        : "NONE";

    return {
      index: Number(review.index),
      verdict,
      category,
      confidence: Math.max(0, Math.min(100, Math.round(Number(review.confidence) || 90))),
      reason: typeof review.reason === "string" && review.reason ? review.reason : "Không có nhận xét chi tiết.",
      thaiToVi:
        typeof review.thaiToVi === "string" && review.thaiToVi
          ? review.thaiToVi
          : typeof review.uploadedToTarget === "string"
          ? review.uploadedToTarget
          : "",
      sourceVi:
        typeof review.sourceVi === "string" && review.sourceVi
          ? review.sourceVi
          : typeof review.sourceToTarget === "string"
          ? review.sourceToTarget
          : "",
      suggestedCorrection: typeof review.suggestedCorrection === "string" ? review.suggestedCorrection.trim() : "",
      original: "",
      userTranslation: "",
    };
  });
};

const listGeminiModels = async (apiKey: string): Promise<string[]> => {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": apiKey.trim() },
  });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  return (data.models ?? [])
    .filter((item) => item.name && item.supportedGenerationMethods?.includes("generateContent"))
    .map((item) => item.name!.replace(/^models\//, ""))
    .filter(isTextGenerationModel);
};

const delay = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException("Aborted", "AbortError"));
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });

const reviewWithGemini = async (
  apiKey: string,
  model: string,
  source: SubtitleCue[],
  translated: SubtitleCue[],
  indexes: number[],
  sourceLang: "zh" | "vi",
  availableModelsList: string[],
  signal?: AbortSignal
): Promise<GeminiReview[]> => {
  const sourceLangLabel = sourceLang === "zh" ? "Tiếng Trung (Chinese)" : "Tiếng Việt (Vietnamese)";
  const samples: SamplePayload[] = indexes.map((index) => ({
    index: index + 1,
    original: source[index].text,
    translation: translated[index]?.text ?? "",
    contextBefore: index > 0 ? source[index - 1]?.text : undefined,
    contextAfter: index < source.length - 1 ? source[index + 1]?.text : undefined,
  }));

  const systemInstructionText = `Bạn là chuyên gia thẩm định chất lượng phụ đề (LQA Lead) song ngữ chuyên sâu cho cặp ngôn ngữ:
- Ngôn ngữ gốc (Source): ${sourceLangLabel}
- Ngôn ngữ đã dịch (Target/Translation): Tiếng Thái (Thai)

Mục tiêu thẩm định:
Kiểm tra từng câu phụ đề tiếng Thái xem có truyền tải chính xác, tự nhiên, đúng ngữ cảnh đối thoại, đúng danh xưng/xưng hô nhân vật và đúng ngữ khí của câu gốc (${sourceLangLabel}) hay không.
Mỗi cue được cung cấp kèm ngữ cảnh câu trước (contextBefore) và câu sau (contextAfter) để hiểu rõ mạch phim.

QUY TẮC BẮT BUỘC:
1. Trả về JSON hợp lệ theo đúng schema được cung cấp.
2. Toàn bộ nhận xét (reason), bản dịch câu tiếng Thái sang tiếng Việt (thaiToVi), và bản dịch đối chiếu (sourceVi) BẮT BUỘC viết 100% bằng TIẾNG VIỆT để người dùng Việt Nam hiểu rõ.
3. Không trả về nhận xét bằng tiếng Trung, tiếng Thái hay tiếng Anh trong các trường reason, thaiToVi, sourceVi.
4. "verdict":
   - "PASS": Dịch chuẩn xác, tự nhiên, đúng ý nghĩa và ngữ khí trong tiếng Thái.
   - "MINOR": Lỗi nhỏ (câu hơi cứng, thiếu tự nhiên một chút hoặc lệch sắc thái nhẹ, nhưng ý chính vẫn đúng).
   - "MAJOR": Lỗi lớn (sai lệch ý nghĩa, hiểu sai từ vựng, lệch quan hệ xưng hô nhân vật, sai thời gian/số liệu).
   - "CRITICAL": Lỗi nghiêm trọng (ngược nghĩa hoàn toàn, bỏ sót thông tin cốt lõi, bịa đặt nội dung gây hỏng cốt truyện).
5. "category":
   - "NONE" (cho PASS)
   - "MISTRANSLATION" (Hiểu sai nghĩa từ/câu)
   - "OMISSION_ADDITION" (Thiếu thông tin hoặc thêm thắt sai lệch)
   - "PRONOUN_TONE" (Sai đại từ xưng hô, ngữ khí không hợp bối cảnh)
   - "TERMINOLOGY" (Sai số liệu, ngày tháng, tên riêng hoặc thuật ngữ)
   - "NATURALNESS" (Tiếng Thái gượng gạo, dịch máy móc)
6. "suggestedCorrection":
   - Nếu có lỗi (MINOR, MAJOR, CRITICAL), đề xuất 1 câu tiếng Thái tự nhiên, chuẩn xác hơn.
   - Nếu PASS, có thể để chuỗi rỗng "" hoặc câu tiếng Thái hay hơn nếu có.
7. Đánh giá công tâm, có tính đến đặc thù rút gọn độ dài của phụ đề (subtitles) - không bắt bẻ các câu rút gọn nếu ý nghĩa cốt lõi vẫn bảo toàn.`;

  const promptText = `Thẩm định danh sách các cue phụ đề sau đây:
Ngôn ngữ gốc: ${sourceLangLabel}
Bản dịch đã tải lên: Tiếng Thái (Thai)

Danh sách mẫu cần thẩm định:
${JSON.stringify(samples, null, 2)}

Hãy phân tích và trả về đối tượng JSON dạng:
{
  "reviews": [
    {
      "index": number,
      "verdict": "PASS" | "MINOR" | "MAJOR" | "CRITICAL",
      "category": "NONE" | "MISTRANSLATION" | "OMISSION_ADDITION" | "PRONOUN_TONE" | "TERMINOLOGY" | "NATURALNESS",
      "confidence": number,
      "sourceVi": string,
      "thaiToVi": string,
      "reason": string,
      "suggestedCorrection": string
    }
  ]
}`;

  const requestBodyWithSchema = {
    systemInstruction: { parts: [{ text: systemInstructionText }] },
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          reviews: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                index: { type: "INTEGER" },
                verdict: { type: "STRING", enum: ["PASS", "MINOR", "MAJOR", "CRITICAL"] },
                category: {
                  type: "STRING",
                  enum: ["NONE", "MISTRANSLATION", "OMISSION_ADDITION", "PRONOUN_TONE", "TERMINOLOGY", "NATURALNESS"],
                },
                confidence: { type: "INTEGER" },
                sourceVi: { type: "STRING" },
                thaiToVi: { type: "STRING" },
                reason: { type: "STRING" },
                suggestedCorrection: { type: "STRING" },
              },
              required: ["index", "verdict", "category", "confidence", "thaiToVi", "reason"],
            },
          },
        },
        required: ["reviews"],
      },
    },
  };

  const requestBodyWithoutSchema = {
    systemInstruction: { parts: [{ text: systemInstructionText }] },
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      responseMimeType: "application/json",
    },
  };

  // Strictly use candidates from the available models returned by Google API
  let activeModels = availableModelsList.filter(isTextGenerationModel);
  if (!activeModels.length) {
    try {
      activeModels = (await listGeminiModels(apiKey)).filter(isTextGenerationModel);
    } catch {
      activeModels = [];
    }
  }

  const requested = model.trim();
  const candidateList = [
    requested,
    ...activeModels.filter((m) => m !== requested),
  ].filter(Boolean);

  const candidates = Array.from(new Set(candidateList)).slice(0, 3);
  if (!candidates.length) {
    throw new Error("Không có model nào khả dụng. Vui lòng bấm 'Tải model khả dụng' để tải danh sách.");
  }

  let lastErrorSummary = "";
  let isRateLimited = false;

  for (const candidate of candidates) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    let useSchema = true;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      let response: Response | null = null;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidate)}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
            body: JSON.stringify(useSchema ? requestBodyWithSchema : requestBodyWithoutSchema),
            signal,
          }
        );
      } catch (networkErr) {
        if (networkErr instanceof DOMException && networkErr.name === "AbortError") {
          throw networkErr;
        }
        lastErrorSummary = networkErr instanceof Error ? networkErr.message : "Lỗi kết nối mạng đến Google API";
        if (attempt === 0) await delay(1000, signal);
        continue;
      }

      if (response.status === 400 && useSchema) {
        useSchema = false;
        continue;
      }

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        let parsedMessage = details;
        try {
          const jsonErr = JSON.parse(details) as { error?: { message?: string; status?: string } };
          if (jsonErr.error?.message) {
            parsedMessage = `${jsonErr.error.status || response.status}: ${jsonErr.error.message}`;
          }
        } catch {
          // ignore
        }

        lastErrorSummary = `${candidate} (${response.status}): ${parsedMessage.slice(0, 240)}`;

        if (response.status === 400 || response.status === 404) {
          // Model does not exist or rejects text modality - break attempt, try next candidate
          break;
        }

        if (response.status === 429) {
          isRateLimited = true;
          // Rate limited on this model; try next candidate immediately (separate quota pool)
          break;
        }

        if (response.status === 503) {
          if (attempt === 0) {
            await delay(1200, signal);
            continue;
          }
          break;
        }

        if (response.status === 403) {
          throw new Error(`API key không hợp lệ hoặc bị từ chối truy cập (HTTP 403). ${parsedMessage}`);
        }

        break;
      }

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      };
      const parts = data.candidates?.[0]?.content?.parts;
      // Filter out internal reasoning/thought tokens of Gemini 3.x
      const text = Array.isArray(parts)
        ? parts
            .filter((p) => p.thought !== true && typeof p.text === "string")
            .map((p) => p.text)
            .join("")
        : "";

      if (!text) {
        lastErrorSummary = `${candidate} trả về nội dung rỗng.`;
        break;
      }

      const parsedReviews = parseGeminiJson(text);
      return parsedReviews.map((review) => {
        const sample = samples.find((item) => item.index === review.index);
        return {
          ...review,
          original: sample?.original ?? "",
          userTranslation: sample?.translation ?? "",
          contextBefore: sample?.contextBefore,
          contextAfter: sample?.contextAfter,
        };
      });
    }
  }

  if (isRateLimited) {
    throw new Error(
      `Đạt giới hạn hạn mức Google Gemini (HTTP 429 - Quota/Rate Limit). ${lastErrorSummary}. Gợi ý: Hãy đổi sang model khác hoặc tạo API key mới trên Google AI Studio.`
    );
  }

  throw new Error(`Không thể hoàn thành review với Gemini. ${lastErrorSummary}`);
};

export const buildQualityReport = (source: SubtitleCue[], translated: SubtitleCue[]): QualityReport => {
  const count = Math.min(source.length, translated.length);
  let timingMatches = 0;
  let emptyCount = 0;
  let unchangedCount = 0;
  for (let index = 0; index < count; index++) {
    if (
      Math.abs(source[index].startMs - translated[index].startMs) <= 150 &&
      Math.abs(source[index].endMs - translated[index].endMs) <= 150
    ) {
      timingMatches++;
    }
    if (!normalize(translated[index].text)) emptyCount++;
    if (normalize(source[index].text) === normalize(translated[index].text)) unchangedCount++;
  }
  const score = Math.min(
    100,
    (source.length === translated.length ? 30 : Math.max(0, 30 - Math.abs(source.length - translated.length) * 5)) +
      (count ? Math.round((timingMatches / count) * 30) : 0) +
      (count ? Math.round(((count - emptyCount) / count) * 25) : 0) +
      (count ? Math.round(Math.max(0, 1 - unchangedCount / count) * 15) : 0)
  );
  const samples = getSampleIndexes(count).map((index) => {
    const unchanged = normalize(source[index].text) === normalize(translated[index].text);
    const timingOk =
      Math.abs(source[index].startMs - translated[index].startMs) <= 150 &&
      Math.abs(source[index].endMs - translated[index].endMs) <= 150;
    return {
      index: index + 1,
      source: source[index].text,
      translated: translated[index].text,
      status: !normalize(translated[index].text) ? "error" : !timingOk || unchanged ? "warning" : "ok",
    } as SampleResult;
  });
  return {
    score,
    sourceCount: source.length,
    translatedCount: translated.length,
    timingMatches,
    emptyCount,
    unchangedCount,
    samples,
  };
};

const QualityResult = ({ report }: { report: QualityReport }) => {
  const { token } = theme.useToken();
  const tSubtitle = useTranslations("SubtitleTranslator");
  const q = (key: string, fallback: string) => (tSubtitle.has(key) ? tSubtitle(key) : fallback);
  return (
    <Flex vertical gap={16} style={{ marginTop: 18 }}>
      <Progress
        percent={report.score}
        status={report.score >= 80 ? "success" : report.score >= 55 ? "normal" : "exception"}
        strokeColor={report.score >= 80 ? "#2f9e44" : undefined}
      />
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
        <Descriptions.Item label={q("qualityOriginalCues", "Original cues")}>{report.sourceCount}</Descriptions.Item>
        <Descriptions.Item label={q("qualityTranslatedCues", "Translated cues")}>
          {report.translatedCount}
        </Descriptions.Item>
        <Descriptions.Item label={q("qualityMatchingTimestamps", "Matching timestamps")}>
          {report.timingMatches}
        </Descriptions.Item>
        <Descriptions.Item label={q("qualityEmptyTranslations", "Empty translations")}>
          {report.emptyCount}
        </Descriptions.Item>
        <Descriptions.Item label={q("qualityUnchangedText", "Unchanged text")}>
          {report.unchangedCount}
        </Descriptions.Item>
      </Descriptions>
      <Alert
        type={report.score >= 80 ? "success" : report.score >= 55 ? "warning" : "error"}
        showIcon
        title={
          report.score >= 80
            ? q("qualityStructureHealthy", "The subtitle structure looks healthy.")
            : q("qualityReviewWarnings", "Review the warnings before using this translation.")
        }
        description={q(
          "qualityStructureDescription",
          "This checks cue counts, timestamps, empty translations, and unchanged text. Use Gemini review below for semantic checking."
        )}
      />
      <Title level={5} style={{ margin: 0 }}>
        {q("qualitySampledLines", "Sampled subtitle lines")}
      </Title>
      <Flex vertical gap={8}>
        {report.samples.map((sample) => (
          <div
            key={sample.index}
            style={{
              borderInlineStart: `3px solid ${
                sample.status === "ok" ? "#2f9e44" : sample.status === "warning" ? token.colorWarning : token.colorError
              }`,
              paddingInlineStart: 12,
            }}
          >
            <Flex justify="space-between" align="center" gap={8}>
              <Text type="secondary">Cue {sample.index}</Text>
              <Tag
                color={sample.status === "ok" ? "success" : sample.status === "warning" ? "warning" : "error"}
                icon={sample.status === "ok" ? <CheckCircleOutlined /> : <WarningOutlined />}
              >
                {sample.status === "ok"
                  ? q("qualityLooksAligned", "Looks aligned")
                  : sample.status === "warning"
                  ? q("qualityReview", "Review")
                  : q("qualityMissing", "Missing")}
              </Tag>
            </Flex>
            <Paragraph style={{ margin: "6px 0 0" }}>
              <Text strong>{q("qualityOriginal", "Original")}:</Text> {sample.source}
            </Paragraph>
            <Paragraph style={{ margin: 0 }}>
              <Text strong>{q("qualityTranslation", "Translation")}:</Text> {sample.translated || "(empty)"}
            </Paragraph>
          </div>
        ))}
      </Flex>
    </Flex>
  );
};

const SubtitleQualityCheck = () => {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const tSubtitle = useTranslations("SubtitleTranslator");
  const q = (key: string, fallback: string) => (tSubtitle.has(key) ? tSubtitle(key) : fallback);

  const [source, setSource] = useState<LoadedSubtitle | null>(null);
  const [translated, setTranslated] = useState<LoadedSubtitle | null>(null);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [geminiReviews, setGeminiReviews] = useState<GeminiReview[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<"all" | "issues" | "pass">("all");

  const [sourceLangSetting, setSourceLangSetting] = useLocalStorage<SupportedSourceLanguage>(
    "subtitle-quality-source-lang",
    "auto"
  );
  const [geminiApiKey, setGeminiApiKey] = useLocalStorage("subtitle-quality-gemini-api-key", "");
  const [geminiModel, setGeminiModel] = useLocalStorage("subtitle-quality-gemini-model-custom", "");
  const [geminiSampleCount, setGeminiSampleCount] = useLocalStorage("subtitle-quality-gemini-sample-count-v2", 10);
  const [availableGeminiModels, setAvailableGeminiModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const canCheck = Boolean(source && translated);

  const parsedSourceCues = useMemo(() => {
    if (!source) return [];
    return parseCues(source.text, source.format);
  }, [source]);

  const parsedTranslatedCues = useMemo(() => {
    if (!translated) return [];
    return parseCues(translated.text, translated.format);
  }, [translated]);

  const autoDetectedLang = useMemo(() => {
    if (!parsedSourceCues.length) return "zh";
    return detectLanguageFromCues(parsedSourceCues);
  }, [parsedSourceCues]);

  const effectiveSourceLang: "zh" | "vi" = sourceLangSetting === "auto" ? autoDetectedLang : sourceLangSetting;
  const sourceLangLabel = effectiveSourceLang === "zh" ? "Tiếng Trung (Chinese)" : "Tiếng Việt (Vietnamese)";

  const sourceHint = useMemo(
    () => (source ? `${formatLabel(source.name)} · ${parsedSourceCues.length} cues` : "Upload the original subtitle"),
    [source, parsedSourceCues.length]
  );
  const translatedHint = useMemo(
    () =>
      translated
        ? `${formatLabel(translated.name)} · ${parsedTranslatedCues.length} cues`
        : "Upload the translated subtitle",
    [translated, parsedTranslatedCues.length]
  );

  const load = async (file: File, kind: "source" | "translated") => {
    try {
      const value = await readSubtitle(file);
      if (kind === "source") setSource(value);
      else setTranslated(value);
      setReport(null);
      setGeminiReviews(null);
      setGeminiError(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Could not read this subtitle file.");
    }
  };

  const check = () => {
    if (!source || !translated) return;
    setLoading(true);
    setReport(buildQualityReport(parsedSourceCues, parsedTranslatedCues));
    setLoading(false);
  };

  const cancelReview = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setGeminiLoading(false);
      message.info("Đã gửi lệnh hủy review.");
    }
  };

  const checkWithGemini = async () => {
    if (!source || !translated || !geminiApiKey.trim()) return;
    setGeminiLoading(true);
    setGeminiError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const indexes = getSmartSampleIndexes(
        parsedSourceCues,
        parsedTranslatedCues,
        geminiSampleCount,
        effectiveSourceLang
      );
      const reviews = await reviewWithGemini(
        geminiApiKey,
        geminiModel,
        parsedSourceCues,
        parsedTranslatedCues,
        indexes,
        effectiveSourceLang,
        availableGeminiModels,
        controller.signal
      );
      setGeminiReviews(reviews);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        message.info("Đã hủy tiến trình review.");
        return;
      }
      const msg = error instanceof Error ? error.message : "Gemini review failed.";
      setGeminiError(msg);
      message.error("Thẩm định bằng Gemini thất bại. Chi tiết lỗi hiển thị bên dưới.");
    } finally {
      setGeminiLoading(false);
      abortControllerRef.current = null;
    }
  };

  const loadGeminiModels = async () => {
    if (!geminiApiKey.trim()) return;
    setModelsLoading(true);
    setGeminiError(null);
    try {
      const models = await listGeminiModels(geminiApiKey.trim());
      setAvailableGeminiModels(models);
      if (models.length) {
        if (!geminiModel || !models.includes(geminiModel)) {
          // Select the first valid model returned by Google
          setGeminiModel(models[0]);
        }
        message.success(`Đã tải thành công ${models.length} model khả dụng từ Google.`);
      } else {
        message.warning("Không tìm thấy model chat/văn bản phù hợp từ API key này.");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Could not load Gemini models.";
      setGeminiError(msg);
      message.error("Không thể tải danh sách model từ Google.");
    } finally {
      setModelsLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(q("qualityCopySuccess", "Đã copy câu gợi ý vào clipboard!"));
    } catch {
      message.error("Copy failed.");
    }
  };

  const uploader = (kind: "source" | "translated", hint: string) => (
    <Dragger
      multiple={false}
      showUploadList={false}
      accept=".srt,.vtt,.ass,.ssa,.sbv"
      beforeUpload={(file) => {
        void load(file as File, kind);
        return false;
      }}
      style={{ padding: 12 }}
    >
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p className="ant-upload-text">{hint}</p>
      <p className="ant-upload-hint">{q("qualitySupportedFormats", "SRT, VTT, ASS, SSA or SBV")}</p>
    </Dragger>
  );

  const reviewStats = useMemo(() => {
    if (!geminiReviews) return null;
    const passCount = geminiReviews.filter((r) => r.verdict === "PASS").length;
    const minorCount = geminiReviews.filter((r) => r.verdict === "MINOR").length;
    const majorCount = geminiReviews.filter((r) => r.verdict === "MAJOR").length;
    const criticalCount = geminiReviews.filter((r) => r.verdict === "CRITICAL").length;
    return { passCount, minorCount, majorCount, criticalCount, total: geminiReviews.length };
  }, [geminiReviews]);

  const filteredReviews = useMemo(() => {
    if (!geminiReviews) return [];
    if (reviewFilter === "issues") return geminiReviews.filter((r) => r.verdict !== "PASS");
    if (reviewFilter === "pass") return geminiReviews.filter((r) => r.verdict === "PASS");
    return geminiReviews;
  }, [geminiReviews, reviewFilter]);

  const getVerdictTag = (verdict: ReviewVerdict, confidence: number) => {
    switch (verdict) {
      case "PASS":
        return (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            PASS · {confidence}%
          </Tag>
        );
      case "MINOR":
        return (
          <Tag color="blue" icon={<InfoCircleOutlined />}>
            MINOR · {confidence}%
          </Tag>
        );
      case "MAJOR":
        return (
          <Tag color="warning" icon={<WarningOutlined />}>
            MAJOR · {confidence}%
          </Tag>
        );
      case "CRITICAL":
        return (
          <Tag color="error" icon={<CloseCircleOutlined />}>
            CRITICAL · {confidence}%
          </Tag>
        );
    }
  };

  const getCategoryTag = (category: ReviewCategory) => {
    switch (category) {
      case "MISTRANSLATION":
        return <Tag color="volcano">{q("qualityCatMistranslation", "Sai lệch nghĩa")}</Tag>;
      case "OMISSION_ADDITION":
        return <Tag color="orange">{q("qualityCatOmission", "Thiếu / Thừa ý")}</Tag>;
      case "PRONOUN_TONE":
        return <Tag color="geekblue">{q("qualityCatPronounTone", "Xưng hô / Ngữ khí")}</Tag>;
      case "TERMINOLOGY":
        return <Tag color="purple">{q("qualityCatTerminology", "Thuật ngữ / Số liệu")}</Tag>;
      case "NATURALNESS":
        return <Tag color="cyan">{q("qualityCatNaturalness", "Độ tự nhiên")}</Tag>;
      case "NONE":
      default:
        return null;
    }
  };

  return (
    <Card title={q("qualityTitle", "Subtitle quality check")} style={{ marginTop: 24 }}>
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        {q(
          "qualityDescription",
          "Upload the original and translated files to detect missing cues, shifted timestamps, empty lines, and suspiciously unchanged samples."
        )}
      </Paragraph>
      <Flex gap={16} wrap>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          {uploader("source", source ? sourceHint : q("qualityUploadOriginal", "Upload the original subtitle"))}
        </div>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          {uploader("translated", translated ? translatedHint : q("qualityUploadTranslated", "Upload the translated subtitle"))}
        </div>
      </Flex>
      <Button
        type="primary"
        icon={<CheckCircleOutlined />}
        disabled={!canCheck}
        loading={loading}
        onClick={check}
        style={{ marginTop: 16 }}
      >
        {q("qualityCheckStructure", "Check translation structure")}
      </Button>
      {report && <QualityResult report={report} />}

      <Card
        type="inner"
        title={
          <Flex align="center" gap={8}>
            <ThunderboltOutlined style={{ color: token.colorPrimary }} />
            <span>{q("qualityGeminiTitle", "Gemini AI semantic review")}</span>
          </Flex>
        }
        style={{ marginTop: 24 }}
      >
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          Thẩm định song ngữ chuyên sâu (Tiếng Trung/Tiếng Việt → Tiếng Thái). Tự động chọn mẫu rủi ro cao (Smart
          Sampling), phân tích ngữ cảnh câu trước/sau và đề xuất câu sửa tối ưu.
        </Paragraph>

        <Flex gap={12} wrap align="center" style={{ marginBottom: 12 }}>
          <Space>
            <Text strong>{q("qualitySourceLanguage", "Ngôn ngữ gốc")}:</Text>
            <Select<SupportedSourceLanguage>
              value={sourceLangSetting}
              onChange={(value) => {
                setSourceLangSetting(value);
                setGeminiReviews(null);
                setGeminiError(null);
              }}
              style={{ width: 230 }}
              options={[
                {
                  label: `${q("qualitySourceLangAuto", "Tự động nhận diện")} (${
                    autoDetectedLang === "zh" ? "Trung" : "Việt"
                  })`,
                  value: "auto",
                },
                { label: q("qualitySourceLangZh", "Tiếng Trung (Chinese)"), value: "zh" },
                { label: q("qualitySourceLangVi", "Tiếng Việt (Vietnamese)"), value: "vi" },
              ]}
            />
          </Space>
          <Tag color="cyan" style={{ fontSize: 13, padding: "3px 10px", lineHeight: "22px" }}>
            {q("qualityTargetLangThai", "Đích: Tiếng Thái (Thai)")}
          </Tag>
        </Flex>

        <Space wrap>
          <Input.Password
            placeholder={q("qualityApiKeyPlaceholder", "Gemini API key")}
            value={geminiApiKey}
            onChange={(event) => {
              setGeminiApiKey(event.target.value);
              setAvailableGeminiModels([]);
              setGeminiReviews(null);
              setGeminiError(null);
            }}
            style={{ width: 260 }}
          />
          <Button loading={modelsLoading} disabled={!geminiApiKey.trim()} onClick={() => void loadGeminiModels()}>
            {q("qualityLoadModels", "Tải model khả dụng")}
          </Button>
          <Select
            virtual={false}
            showSearch
            value={geminiModel || undefined}
            onChange={(value) => {
              setGeminiModel(value);
              setGeminiReviews(null);
              setGeminiError(null);
            }}
            options={availableGeminiModels.map((m) => ({ label: m, value: m }))}
            style={{ minWidth: 260 }}
            placeholder={
              modelsLoading
                ? "Đang tải danh sách model..."
                : availableGeminiModels.length
                ? "Chọn model khả dụng"
                : "Bấm 'Tải model khả dụng'"
            }
          />
          <Space.Compact>
            <Tooltip title="Lấy mẫu thông minh phân bổ đều khắp timeline, tập trung câu chứa số, phủ định, câu phức và lệch độ dài">
              <Text
                type="secondary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  paddingInline: 11,
                  border: `1px solid ${token.colorBorder}`,
                  borderInlineEnd: 0,
                  background: token.colorFillQuaternary,
                  cursor: "help",
                }}
              >
                Smart samples
              </Text>
            </Tooltip>
            <InputNumber
              min={1}
              max={30}
              value={geminiSampleCount}
              onChange={(value) => setGeminiSampleCount(value ?? 10)}
            />
          </Space.Compact>
        </Space>

        <Flex gap={8} align="center" wrap style={{ marginTop: 12 }}>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            disabled={!canCheck || !geminiApiKey.trim() || !geminiModel}
            loading={geminiLoading}
            onClick={() => void checkWithGemini()}
          >
            {q("qualityReviewWithGemini", "Review với Gemini")}
          </Button>
          {geminiLoading && (
            <Button
              danger
              icon={<CloseCircleOutlined />}
              onClick={cancelReview}
            >
              Hủy review
            </Button>
          )}
          <Text type="secondary">{q("qualityKeyStoredLocally", "The key is stored only in this browser.")}</Text>
        </Flex>

        {geminiError && (
          <Alert
            type="error"
            showIcon
            closable
            onClose={() => setGeminiError(null)}
            title="Thẩm định Gemini chưa thành công"
            description={
              <div style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
                {geminiError}
              </div>
            }
            style={{ marginTop: 14 }}
          />
        )}

        {geminiReviews && reviewStats && (
          <Flex vertical gap={12} style={{ marginTop: 16 }}>
            <Alert
              type={reviewStats.criticalCount > 0 ? "error" : reviewStats.majorCount > 0 ? "warning" : "success"}
              showIcon
              title={
                <Flex gap={12} align="center" wrap>
                  <Text strong>
                    Kết quả thẩm định: {reviewStats.passCount}/{reviewStats.total} mẫu đạt chuẩn (
                    {Math.round((reviewStats.passCount / reviewStats.total) * 100)}%)
                  </Text>
                  <Space size={4}>
                    <Tag color="success">PASS: {reviewStats.passCount}</Tag>
                    {reviewStats.minorCount > 0 && <Tag color="blue">MINOR: {reviewStats.minorCount}</Tag>}
                    {reviewStats.majorCount > 0 && <Tag color="warning">MAJOR: {reviewStats.majorCount}</Tag>}
                    {reviewStats.criticalCount > 0 && <Tag color="error">CRITICAL: {reviewStats.criticalCount}</Tag>}
                  </Space>
                </Flex>
              }
              description="Toàn bộ phân tích ngữ nghĩa, bản dịch kiểm chứng tiếng Thái và nhận xét đều được trình bày bằng tiếng Việt."
            />

            <Flex justify="space-between" align="center" wrap gap={8}>
              <Radio.Group
                value={reviewFilter}
                onChange={(e) => setReviewFilter(e.target.value as "all" | "issues" | "pass")}
                size="small"
              >
                <Radio.Button value="all">{q("qualityFilterAll", "Tất cả")} ({geminiReviews.length})</Radio.Button>
                <Radio.Button value="issues">
                  {q("qualityFilterIssues", "Chỉ câu có vấn đề")} ({geminiReviews.length - reviewStats.passCount})
                </Radio.Button>
                <Radio.Button value="pass">{q("qualityFilterPass", "Chỉ câu đạt")} ({reviewStats.passCount})</Radio.Button>
              </Radio.Group>
            </Flex>

            {filteredReviews.map((review) => {
              const borderLeftColor =
                review.verdict === "PASS"
                  ? "#2f9e44"
                  : review.verdict === "MINOR"
                  ? token.colorInfo
                  : review.verdict === "MAJOR"
                  ? token.colorWarning
                  : token.colorError;

              return (
                <Card
                  key={review.index}
                  size="small"
                  style={{
                    borderInlineStart: `4px solid ${borderLeftColor}`,
                    background:
                      review.verdict === "CRITICAL"
                        ? token.colorErrorBg
                        : review.verdict === "MAJOR"
                        ? token.colorWarningBg
                        : undefined,
                  }}
                >
                  <Flex justify="space-between" align="center" gap={12} wrap>
                    <Space>
                      <Text strong style={{ fontSize: 15 }}>
                        Cue #{review.index}
                      </Text>
                      {getVerdictTag(review.verdict, review.confidence)}
                      {getCategoryTag(review.category)}
                    </Space>
                  </Flex>

                  {(review.contextBefore || review.contextAfter) && (
                    <div
                      style={{
                        margin: "8px 0",
                        padding: "6px 10px",
                        fontSize: 12,
                        background: token.colorFillQuaternary,
                        borderRadius: 4,
                      }}
                    >
                      {review.contextBefore && (
                        <div>
                          <Text type="secondary">{q("qualityContextBefore", "Ngữ cảnh trước")}:</Text>{" "}
                          <Text italic>{review.contextBefore}</Text>
                        </div>
                      )}
                      {review.contextAfter && (
                        <div>
                          <Text type="secondary">{q("qualityContextAfter", "Ngữ cảnh sau")}:</Text>{" "}
                          <Text italic>{review.contextAfter}</Text>
                        </div>
                      )}
                    </div>
                  )}

                  <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
                    <Descriptions.Item label={`${q("qualityOriginal", "Bản gốc")} (${sourceLangLabel})`}>
                      <Text strong>{review.original}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label={`${q("qualityTranslation", "Bản dịch trong file")} (Tiếng Thái)`}>
                      <Text strong style={{ color: token.colorPrimaryText }}>
                        {review.userTranslation}
                      </Text>
                    </Descriptions.Item>
                    {review.thaiToVi && (
                      <Descriptions.Item label={q("qualityThaiToVietnamese", "Bản dịch câu tiếng Thái sang tiếng Việt")}>
                        <Text style={{ color: token.colorSuccessText }}>{review.thaiToVi}</Text>
                      </Descriptions.Item>
                    )}
                    {effectiveSourceLang === "zh" && review.sourceVi && (
                      <Descriptions.Item label={q("qualityChineseToVietnamese", "Bản dịch câu tiếng Trung sang tiếng Việt")}>
                        {review.sourceVi}
                      </Descriptions.Item>
                    )}
                    <Descriptions.Item label={q("qualityGeminiAssessment", "Đánh giá của Gemini (tiếng Việt)")}>
                      <Text>{review.reason}</Text>
                    </Descriptions.Item>
                  </Descriptions>

                  {review.suggestedCorrection && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: "8px 12px",
                        background: token.colorFillAlter,
                        borderRadius: token.borderRadiusSM,
                        border: `1px dashed ${token.colorPrimaryBorder}`,
                      }}
                    >
                      <Flex justify="space-between" align="center" gap={8}>
                        <Text strong style={{ color: token.colorPrimary }}>
                          {q("qualitySuggestedCorrection", "Gợi ý câu tiếng Thái chuẩn hơn")}:
                        </Text>
                        <Button
                          size="small"
                          icon={<CopyOutlined />}
                          onClick={() => void copyToClipboard(review.suggestedCorrection!)}
                        >
                          Copy
                        </Button>
                      </Flex>
                      <Paragraph
                        style={{ margin: "4px 0 0", fontSize: 14, color: token.colorTextHeading }}
                        copyable={{ text: review.suggestedCorrection }}
                      >
                        {review.suggestedCorrection}
                      </Paragraph>
                    </div>
                  )}
                </Card>
              );
            })}
          </Flex>
        )}
      </Card>
    </Card>
  );
};

export default SubtitleQualityCheck;
