
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { NewsCategory, NewsItem, VoiceName, VoiceMap, NewsNetwork } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function fetchLatestNews(category: NewsCategory): Promise<NewsItem[]> {
  const prompt = `Provide 3 short, high-impact news stories in English for: ${category}. 
    Each story must have a title and a 3-sentence summary in clear, professional English.
    Ensure all information is from the last 24 hours.`;

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
    contents: [{ parts: [{ text: `Broadcast clearly: ${text}` }] }],
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
      thinkingConfig: { thinkingBudget: 12000 },
      systemInstruction: `SYSTEM: You are the lead anchor for Global Echo AI Radio (Channel: ${network}).
      
      MANDATE:
      1. REAL-TIME: Search Google for the top 3 headlines right now.
      2. CLARITY: Speak clearly for advanced English learners. Maintain a professional BBC/NPR style.
      3. FLOW: Keep the broadcast to 2 minutes. Summarize each news story concisely.
      4. ENDING: Always end your broadcast with exactly: "That concludes our bulletin for ${network}. Station switch in 5 seconds." and then STOP speaking.
      
      Begin the broadcast now with a global impact headline.`,
      tools: [{ googleSearch: {} }]
    },
  });
};
