
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { NewsCategory, NewsItem, VoiceName, VoiceMap, NewsNetwork } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function fetchLatestNews(category: NewsCategory): Promise<NewsItem[]> {
  const prompt = `Provide the top 3-4 news stories in English for the category: ${category}. 
    Each story should be targeted at someone learning English or wanting global updates.
    For each story, include a compelling title and a concise summary (exactly 3 sentences) in English suitable for a professional radio broadcast.
    Focus on events from the last 24-48 hours.`;

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
      title: chunk.web.title || "来源",
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
    contents: [{ parts: [{ text: `Please read this news bulletin clearly and professionally in English: ${text}` }] }],
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
    throw new Error("生成语音失败");
  }

  return base64Audio;
}

// Fix: Corrected NewsNetwork.GLOBAL to NewsNetwork.GLOBAL_AI as 'GLOBAL' does not exist in the enum definition.
export const connectLiveNews = (callbacks: any, network: NewsNetwork = NewsNetwork.GLOBAL_AI) => {
  // Fix: Corrected comparison check to use NewsNetwork.GLOBAL_AI.
  const networkContext = network === NewsNetwork.GLOBAL_AI 
    ? 'top global news stories'
    : `breaking news and exclusive reports from ${network}`;

  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    callbacks,
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
      },
      systemInstruction: `You are the lead anchor for a 24/7 Rolling News Station. 
      YOUR GOAL: Provide a continuous, in-depth broadcast that lasts as long as the session is open. 
      
      1. STYLE: Imitate the professional, authoritative, and fast-paced delivery of ${network}. 
      2. DEPTH: NEVER give short summaries. For every news item you find via Google Search, you MUST provide a detailed 3-5 minute report. This should include:
         - The main event (What happened in the last hour).
         - Background context (Why it matters).
         - Expert perspectives (Simulate common viewpoints found in reports).
         - Future outlook (What to expect next).
      3. CONTINUITY: After finishing a 5-minute deep dive on one story, immediately say "Next up in our coverage..." and use Google Search to find the next major story. 
      4. ZERO SILENCE: If you are waiting for search results, provide live analysis of the current global situation or a "Network ID" (e.g., "You are listening to the ${network} live relay on Global Echo").
      5. STARTING: Upon session open, start immediately with a high-energy "Breaking News" intro for ${network} and report the top story you found.`,
      tools: [{ googleSearch: {} }]
    },
  });
};
