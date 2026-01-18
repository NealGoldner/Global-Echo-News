
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { NewsCategory, NewsItem, VoiceName, VoiceMap, NewsNetwork } from "../types.ts";

// 检查 API KEY
const API_KEY = process.env.API_KEY;

export const getApiKeyStatus = () => {
  if (!API_KEY || API_KEY === "undefined" || API_KEY === "MISSING_KEY") return "missing";
  if (API_KEY.length < 10) return "invalid";
  return "present";
};

const ai = new GoogleGenAI({ apiKey: API_KEY || '' });

/**
 * 诊断测试：尝试发起一个极简单的内容生成请求
 */
export async function testConnection(): Promise<{success: boolean, message: string}> {
  if (getApiKeyStatus() !== "present") {
    return { success: false, message: "API Key 未在 Cloudflare 后台正确配置" };
  }
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-lite-latest",
      contents: "hi",
    });
    if (response.text) return { success: true, message: "连接成功" };
    return { success: false, message: "响应异常" };
  } catch (e: any) {
    console.error("Diagnostic failed:", e);
    return { success: false, message: e.message || "网络请求被拦截" };
  }
}

export async function fetchLatestNews(category: NewsCategory): Promise<NewsItem[]> {
  const prompt = `Provide 3 short, high-impact news stories in English for: ${category}. 
    Each story must have a title and a 3-sentence summary in clear, professional English.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
          },
          required: ["title", "summary"]
        }
      }
    },
  });

  const rawData = JSON.parse(response.text || "[]");
  return rawData.map((item: any, index: number) => ({
    ...item,
    id: `${category}-${index}-${Date.now()}`,
    category,
    timestamp: new Date().toLocaleTimeString('zh-CN'),
    sources: []
  }));
}

export async function generateSpeech(text: string, voiceDisplay: VoiceName): Promise<string> {
  const actualVoice = VoiceMap[voiceDisplay] || 'Zephyr';
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: actualVoice },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("TTS Failed");
  return base64Audio;
}

export const connectLiveNews = (callbacks: any, network: NewsNetwork = NewsNetwork.GLOBAL_AI) => {
  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    callbacks,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
      },
      systemInstruction: `SYSTEM: Lead anchor for ${network}. Speak clear English for learners.`,
      tools: [{ googleSearch: {} }]
    },
  });
};
