
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
      systemInstruction: `SYSTEM: YOU ARE THE VOICE OF GLOBAL ECHO RADIO.
      Your identity for this broadcast session is ${network}.
      
      YOUR MANDATE:
      1. REAL-TIME ANALYSIS: Continuously search Google for the most recent, breaking world news. Don't just list facts—analyze the power shifts, economic ripples, and human stories behind them.
      2. NARRATIVE COMMAND: Speak with the authority and eloquence of a veteran BBC or NPR anchor. Use sophisticated vocabulary suitable for advanced English learners.
      3. CONTINUOUS FLOW: Maintain a seamless radio flow. Connect segments with smooth transitions like "Turning now to the latest developments in..." or "In a surprising move today...".
      4. AUDIENCE ENGAGEMENT: Periodically acknowledge the listener with phrases like "You're listening to Global Echo's deep analysis on ${network}."
      5. PURE AUDIO EXCELLENCE: Your voice is the only connection to the listener. Use your tone to convey the gravity of world events while maintaining professional optimism.
      
      ACTION: Start the broadcast now with a high-impact global briefing.`,
      tools: [{ googleSearch: {} }]
    },
  });
};
