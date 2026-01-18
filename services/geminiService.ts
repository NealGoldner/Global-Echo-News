
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { NewsCategory, NewsItem, VoiceName, VoiceMap, NewsNetwork } from "../types.ts";

const API_KEY = process.env.API_KEY;

export async function fetchLatestNews(category: NewsCategory): Promise<NewsItem[]> {
  const ai = new GoogleGenAI({ apiKey: API_KEY || '' });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Search for 3 latest news in ${category} category in English. Provide detailed summaries. Return as JSON.`,
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
  } catch (e: any) {
    throw new Error(e.message || "Fetch News Failed");
  }
}

export async function generateSpeech(text: string, voiceDisplay: VoiceName): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: API_KEY || '' });
  const actualVoice = VoiceMap[voiceDisplay] || 'Zephyr';
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Read this news report professionally: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: actualVoice } } },
    },
  });
  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
}

export const connectLiveNews = (callbacks: any, network: NewsNetwork = NewsNetwork.GLOBAL_AI) => {
  const ai = new GoogleGenAI({ apiKey: API_KEY || '' });
  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    callbacks,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: `
        You are a professional radio news anchor for ${network}. 
        
        CRITICAL INSTRUCTION:
        1. DO NOT WAIT. As soon as you hear from the user or the session starts, START SPEAKING IMMEDIATELY.
        2. Your first sentence must be: "This is ${network}, bringing you the latest updates from across the globe."
        3. While you are speaking your intro, use Google Search to find the absolute latest headlines for today.
        4. Continue broadcasting like a real 24/7 news station. If there's a delay in searching, fill it with professional radio banter: "We are just checking our news wires for the latest developments in..."
        5. Maintain an authoritative, clear, and engaging English broadcast tone.
      `,
      tools: [{ googleSearch: {} }]
    },
  });
};
