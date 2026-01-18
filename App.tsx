
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header.tsx';
import CategoryFilter from './components/CategoryFilter.tsx';
import NewsCard from './components/NewsCard.tsx';
import AudioVisualizer from './components/AudioVisualizer.tsx';
import { NewsCategory, NewsItem, VoiceName, NewsNetwork, NetworkAudioMap } from './types.ts';
import { fetchLatestNews, generateSpeech, connectLiveNews } from './services/geminiService.ts';
import { decode, decodeAudioData } from './utils/audio.ts';

const App: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<NewsCategory>(NewsCategory.GENERAL);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentNewsId, setCurrentNewsId] = useState<string | null>(null);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [activeNetwork, setActiveNetwork] = useState<NewsNetwork | null>(null);
  const [statusMessage, setStatusMessage] = useState('就绪');
  const [isConnecting, setIsConnecting] = useState(false);
  const [needsSync, setNeedsSync] = useState(false);
  const [isThinking, setIsThinking] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const streamAudioRef = useRef<HTMLAudioElement | null>(null);

  const initAudio = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const stopAllAudio = useCallback(() => {
    activeSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    activeSourcesRef.current.clear();
    
    if (streamAudioRef.current) {
      streamAudioRef.current.pause();
      streamAudioRef.current.removeAttribute('src');
      streamAudioRef.current.load();
    }

    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      liveSessionRef.current = null;
    }

    setIsLiveMode(false);
    setActiveNetwork(null);
    setNeedsSync(false);
    setIsConnecting(false);
    setIsThinking(false);
    setStatusMessage('已停止');
  }, []);

  const startAILive = async (network: NewsNetwork) => {
    setIsConnecting(true);
    setIsThinking(true);
    setStatusMessage(`${network} 信号同步中...`);
    const ctx = await initAudio();
    nextStartTimeRef.current = ctx.currentTime;

    try {
      const callbacks = {
        onopen: () => {
          setStatusMessage(`${network} 已连接，正在启动播报...`);
          // 这里的关键：连接一开，立刻推一个消息让 AI 开口，不要等它自己想
          liveSessionRef.current?.sendRealtimeInput?.({ 
            media: { data: "", mimeType: "audio/pcm;rate=16000" } 
          });
          // 兜底：发送一段文字提示
          setTimeout(() => {
            liveSessionRef.current?.send?.({ parts: [{ text: "Start your news broadcast now." }] });
          }, 100);
        },
        onmessage: async (message: any) => {
          // 只要收到任何 modelTurn，说明 AI 开始说话了
          if (message.serverContent?.modelTurn) {
            setIsThinking(false);
            setIsConnecting(false);
            setStatusMessage(`${network} 播报中`);
          }

          const parts = message.serverContent?.modelTurn?.parts || [];
          for (const part of parts) {
            if (part.inlineData?.data && audioContextRef.current) {
              const currentCtx = audioContextRef.current;
              // 确保时间轴平滑
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, currentCtx.currentTime);
              
              const audioBytes = decode(part.inlineData.data);
              const audioBuffer = await decodeAudioData(audioBytes, currentCtx, 24000, 1);
              
              const source = currentCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(currentCtx.destination);
              source.start(nextStartTimeRef.current);
              
              nextStartTimeRef.current += audioBuffer.duration;
              activeSourcesRef.current.add(source);
              source.onended = () => activeSourcesRef.current.delete(source);
            }
          }
        },
        onerror: (e: any) => {
          console.error("Live session error:", e);
          setStatusMessage('信号干扰，请重试');
          setIsThinking(false);
          setIsConnecting(false);
        },
        onclose: () => {
          setStatusMessage('连接已关闭');
        }
      };
      liveSessionRef.current = await connectLiveNews(callbacks, network);
    } catch (e: any) {
      setStatusMessage('连接超时');
      setIsThinking(false);
      setIsConnecting(false);
    }
  };

  const playOfficialStream = (url: string, network: NewsNetwork) => {
    if (!streamAudioRef.current) return;
    setIsConnecting(true);
    setStatusMessage(`正在连接 ${network} 直播源...`);
    
    streamAudioRef.current.src = url;
    streamAudioRef.current.play().then(() => {
      setIsConnecting(false);
      setStatusMessage(`${network} 官方流播放中`);
    }).catch((e) => {
      console.warn("Official stream failed, switching to AI mode:", e);
      startAILive(network);
    });
  };

  const selectNetwork = (network: NewsNetwork) => {
    stopAllAudio();
    setActiveNetwork(network);
    setIsLiveMode(true);
    setNeedsSync(true); 
  };

  const handleSyncSignal = async () => {
    setNeedsSync(false);
    // 在这里点击同步时，彻底激活 AudioContext
    await initAudio();
    
    if (activeNetwork) {
      const officialUrl = NetworkAudioMap[activeNetwork];
      // 只有 BBC 走官方流，其他一律走 AI 模拟，确保 100% 成功率
      if (officialUrl) {
        playOfficialStream(officialUrl, activeNetwork);
      } else {
        startAILive(activeNetwork);
      }
    }
  };

  const loadNews = useCallback(async (category: NewsCategory) => {
    setIsLoading(true);
    try {
      const data = await fetchLatestNews(category);
      setNews(data);
    } catch (error) {
      console.error(error);
    } finally { setIsLoading(false); }
  }, []);

  useEffect(() => { loadNews(activeCategory); }, [activeCategory, loadNews]);

  const playNewsItem = async (item: NewsItem) => {
    stopAllAudio();
    const ctx = await initAudio();
    setCurrentNewsId(item.id);
    setStatusMessage('正在生成语音摘要...');
    try {
      const base64Audio = await generateSpeech(item.summary, VoiceName.ZEPHYR);
      const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => { setCurrentNewsId(null); setStatusMessage('就绪'); };
      source.start();
      activeSourcesRef.current.add(source);
    } catch (e) { 
      setCurrentNewsId(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#050810] text-slate-200">
      <Header isLive={isLiveMode} isOfficial={!!(activeNetwork && NetworkAudioMap[activeNetwork])} onToggleLive={stopAllAudio} />
      
      <main className="flex-grow max-w-7xl mx-auto w-full px-4 py-6">
        <section className="mb-8">
          <div className="flex justify-between items-end mb-4 px-1">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">选择频道</h3>
            <span className="text-[9px] text-blue-500 font-bold tracking-tighter uppercase">AI & 官方源自动切换</span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {Object.values(NewsNetwork).map((net) => (
              <button
                key={net}
                onClick={() => selectNetwork(net)}
                className={`relative py-4 rounded-2xl border-2 transition-all active:scale-95 flex flex-col items-center gap-1.5 ${
                  activeNetwork === net ? 'bg-blue-600 border-blue-500 shadow-xl' : 'bg-slate-900 border-slate-800'
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-[11px] ${activeNetwork === net ? 'bg-white text-black' : 'bg-slate-800 text-slate-500'}`}>{net.charAt(0)}</div>
                <span className={`text-[9px] font-bold uppercase truncate px-1 ${activeNetwork === net ? 'text-white' : 'text-slate-400'}`}>{net.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={`mb-8 p-12 rounded-[2.5rem] border-2 transition-all duration-500 flex flex-col items-center text-center relative overflow-hidden ${
           isLiveMode ? 'bg-black border-slate-700 shadow-[0_0_50px_rgba(37,99,235,0.1)]' : 'bg-slate-900/30 border-slate-800'
        }`}>
          {isLiveMode ? (
            <div className="z-10 w-full flex flex-col items-center">
               <div className="text-8xl font-black font-mono mb-4 text-white">
                 {(activeNetwork?.length || 0) * 3 + 88.5}<span className="text-lg opacity-30 ml-2">MHz</span>
               </div>
               <p className="text-blue-500 font-black tracking-[0.4em] uppercase text-lg mb-6">{activeNetwork}</p>
               
               {needsSync ? (
                 <button 
                  onClick={handleSyncSignal}
                  className="px-10 py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-black text-sm tracking-widest animate-bounce shadow-2xl shadow-blue-600/50"
                 >
                   CONNECT / 点击同步信号
                 </button>
               ) : (
                 <div className="flex flex-col items-center gap-4">
                    {(isConnecting || isThinking) ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex gap-1.5 h-6 items-center">
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                        </div>
                        <p className="text-blue-500 text-[10px] font-black tracking-[0.3em] animate-pulse">正在解码英语信号...</p>
                      </div>
                    ) : (
                      <AudioVisualizer />
                    )}
                    <p className="text-slate-500 text-[10px] font-mono tracking-widest uppercase">{statusMessage}</p>
                 </div>
               )}
            </div>
          ) : (
            <div className="opacity-40">
              <div className="w-20 h-20 rounded-[2rem] bg-slate-800 mx-auto mb-6 flex items-center justify-center border border-slate-700">
                <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              </div>
              <p className="text-sm font-bold tracking-widest text-slate-300">点击上方电台 开启沉浸式英语</p>
            </div>
          )}
        </section>

        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <h2 className="text-2xl font-black serif">今日热点摘要</h2>
            <CategoryFilter activeCategory={activeCategory} onCategoryChange={setActiveCategory} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {news.map(n => <NewsCard key={n.id} news={n} isPlaying={currentNewsId === n.id} onPlay={() => playNewsItem(n)} />)}
          </div>
        </section>
      </main>

      <audio ref={streamAudioRef} crossOrigin="anonymous" playsInline hidden />
    </div>
  );
};

export default App;
