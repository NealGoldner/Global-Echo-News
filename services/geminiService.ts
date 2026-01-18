
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { NewsCategory, NewsItem, VoiceName, VoiceMap, NewsNetwork } from "../types.ts";

const getAIClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export async function fetchLatestNews(category: NewsCategory): Promise<NewsItem[]> {
  const ai = getAIClient();
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Search for the 3 most recent news headlines in ${category} category (English). Focus on today's events. Return as JSON.`,
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
    console.error("News fetch error:", e);
    return [];
  }
}

export async function generateSpeech(text: string, voiceDisplay: VoiceName): Promise<string> {
  const ai = getAIClient();
  const actualVoice = VoiceMap[voiceDisplay] || 'Zephyr';
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Read this news report: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: actualVoice } } },
    },
  });
  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
}

export const connectLiveNews = (callbacks: any, network: NewsNetwork, newsContext: string) => {
  const ai = getAIClient();
  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    callbacks,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: `
        You are a live radio news anchor for ${network}. 
        Current Headlines to report: ${newsContext}
        
        INSTRUCTIONS:
        1. Start speaking IMMEDIATELY with: "This is ${network}, broadcasting live."
        2. Introduce yourself and start reporting the current headlines provided above.
        3. Keep the tone professional, rhythmic, and clear (standard English).
        4. Fill gaps with typical radio phrases: "Stay with us for more," "In other news," etc.
        5. You are the ONLY source of audio. Make it sound like a real 24/7 radio station.
      `,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
      }
    },
  });
};
