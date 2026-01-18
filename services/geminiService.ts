
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { NewsCategory, NewsItem, VoiceName, VoiceMap, NewsNetwork } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function fetchLatestNews(category: NewsCategory): Promise<NewsItem[]> {
  const prompt = `Provide the top 3-4 news stories in English for the category: ${category}. 
    Focus on providing clear, high-quality information suitable for non-native English learners.
    For each story, include a compelling title and a concise summary (exactly 3 sentences).
    Use accessible yet professional language.`;

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
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  
  const sources = groundingChunks
    .filter((chunk: any) => chunk.web)
    .map((chunk: any) => ({
      title: chunk.web.title || "Source",
      uri: chunk.web.uri
    }));

  return rawData.map((item: any, index: number) => ({
    ...item,
    id: `${category}-${index}-${Date.now()}`,
    category,
    timestamp: new Date().toLocaleTimeString('zh-CN'),
    sources: sources.length > 0 ? sources : []
  }));
}

export async function generateSpeech(text: string, voiceDisplay: VoiceName): Promise<string> {
  const actualVoice = VoiceMap[voiceDisplay] || 'Zephyr';
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Please read this news clearly and articulately for an English learner: ${text}` }] }],
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
  if (!base64Audio) {
    throw new Error("Speech generation failed");
  }

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
      thinkingConfig: {
        thinkingBudget: 24576
      },
      systemInstruction: `SYSTEM: You are the voice of Global Echo Radio, specialized in broadcasting English news for global listeners, including many English learners in Asia.
      
      Your current channel identity is: ${network}.
      
      MANDATE:
      1. REAL-TIME NEWS: Use Google Search to find the most recent world news from the last few hours.
      2. CLEAR ARTICULATION: Speak clearly and at a moderate pace. Do not use overly obscure slang. Focus on professional news reporting style.
      3. DEEP ANALYSIS: After reporting a fact, briefly explain why it matters to give listeners context.
      4. RADIO FLOW: Use transitions like "Coming up next..." or "In other news around the globe...".
      5. ENGAGEMENT: Periodically remind listeners they are tuned into Global Echo's AI Neural Radio.
      
      Start your broadcast now with the most impactful headline of the hour.`,
      tools: [{ googleSearch: {} }]
    },
  });
};
