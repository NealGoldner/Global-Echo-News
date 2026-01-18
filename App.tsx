
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
      streamAudioRef.current.src = "";
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

    const headlines = news.slice(0, 3).map(n => n.title).join(". ");
    const newsContext = headlines || "Global breaking news and weather updates.";

    try {
      const callbacks = {
        onopen: () => {
          setStatusMessage(`${network} 已连通`);
        },
        onmessage: async (message: any) => {
          if (message.serverContent?.modelTurn) {
            setIsThinking(false);
            setIsConnecting(false);
            setStatusMessage(`${network} 直播中`);
          }

          const parts = message.serverContent?.modelTurn?.parts || [];
          for (const part of parts) {
            if (part.inlineData?.data && audioContextRef.current) {
              const currentCtx = audioContextRef.current;
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
          setStatusMessage('信号弱，请重试');
          setIsThinking(false);
          setIsConnecting(false);
        }
      };

      const sessionPromise = connectLiveNews(callbacks, network, newsContext);
      sessionPromise.then((session) => {
        liveSessionRef.current = session;
        session.send({ parts: [{ text: "Please start the radio show now." }] });
      }).catch(err => {
        setStatusMessage('网络故障');
        setIsConnecting(false);
        setIsThinking(false);
      });

    } catch (e: any) {
      setStatusMessage('初始化失败');
      setIsConnecting(false);
    }
  };

  const playOfficialStream = (url: string, network: NewsNetwork) => {
    if (!streamAudioRef.current) return;
    setIsConnecting(true);
    setStatusMessage(`正在连接 ${network} 官方广播源...`);
    
    streamAudioRef.current.src = url;
    const playPromise = streamAudioRef.current.play();
    
    if (playPromise !== undefined) {
      playPromise.then(() => {
        setIsConnecting(false);
        setStatusMessage(`${network} 官方原声直播中`);
      }).catch((e) => {
        console.warn("Official stream failed:", e);
        setStatusMessage('连接失败，尝试 AI 模拟');
        startAILive(network);
      });
    }
  };

  const selectNetwork = (network: NewsNetwork) => {
    stopAllAudio();
    setActiveNetwork(network);
    setIsLiveMode(true);
    setNeedsSync(true); 
  };

  const handleSyncSignal = async () => {
    setNeedsSync(false);
    await initAudio();
    
    if (activeNetwork) {
      const officialUrl = NetworkAudioMap[activeNetwork];
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
    setStatusMessage('TTS 生成中...');
    try {
      const base64Audio = await generateSpeech(item.summary, VoiceName.ZEPHYR);
      const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => { if(currentNewsId === item.id) setCurrentNewsId(null); setStatusMessage('就绪'); };
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
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">频道收听选择</h3>
            <div className="flex items-center gap-3">
               <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-red-500 rounded-full shadow-[0_0_5px_rgba(239,68,68,0.5)]"></div>
                  <span className="text-[8px] text-slate-500 font-bold uppercase">官方原声点</span>
               </div>
               <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                  <span className="text-[8px] text-slate-500 font-bold uppercase">AI 模拟</span>
               </div>
            </div>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3">
            {Object.values(NewsNetwork).map((net) => {
              const hasOfficialSignal = !!NetworkAudioMap[net];
              const isActive = activeNetwork === net;
              return (
                <button
                  key={net}
                  onClick={() => selectNetwork(net)}
                  className={`relative py-4 rounded-2xl border-2 transition-all active:scale-95 flex flex-col items-center gap-1.5 group ${
                    isActive 
                      ? (hasOfficialSignal ? 'bg-red-600/10 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]' : 'bg-blue-600 border-blue-500 shadow-xl') 
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* 直播信号标识点 */}
                  {hasOfficialSignal && (
                    <div className="absolute top-2 right-2 flex items-center">
                      <div className="w-1.5 h-1.5 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.9)] animate-pulse"></div>
                    </div>
                  )}

                  <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-[12px] transition-all ${
                    isActive 
                      ? (hasOfficialSignal ? 'bg-red-500 text-white scale-110' : 'bg-white text-black scale-110') 
                      : 'bg-slate-800 text-slate-500 group-hover:bg-slate-700'
                  }`}>
                    {net.charAt(0)}
                  </div>
                  <span className={`text-[9px] font-bold uppercase truncate px-1 ${
                    isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-400'
                  }`}>
                    {net.split(' ')[0]}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={`mb-8 p-12 rounded-[2.5rem] border-2 transition-all duration-500 flex flex-col items-center text-center relative overflow-hidden ${
           isLiveMode 
            ? (!!NetworkAudioMap[activeNetwork!] ? 'bg-red-950/5 border-red-900/30' : 'bg-black border-slate-700 shadow-[0_0_50px_rgba(37,99,235,0.1)]')
            : 'bg-slate-900/30 border-slate-800'
        }`}>
          {isLiveMode ? (
            <div className="z-10 w-full flex flex-col items-center">
               <div className="text-8xl font-black font-mono mb-4 text-white">
                 {(activeNetwork?.length || 0) * 3 + 89.1}<span className="text-lg opacity-30 ml-2">MHz</span>
               </div>
               <p className={`${!!NetworkAudioMap[activeNetwork!] ? 'text-red-500' : 'text-blue-400'} font-black tracking-[0.4em] uppercase text-lg mb-6`}>
                 {activeNetwork}
               </p>
               
               {needsSync ? (
                 <button 
                  onClick={handleSyncSignal}
                  className={`px-10 py-5 ${!!NetworkAudioMap[activeNetwork!] ? 'bg-red-600 hover:bg-red-500 shadow-red-600/50' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/50'} text-white rounded-full font-black text-sm tracking-widest animate-bounce shadow-2xl`}
                 >
                   CONNECT LIVE / 立即收听
                 </button>
               ) : (
                 <div className="flex flex-col items-center gap-4">
                    {(isConnecting || isThinking) ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex gap-1.5 h-6 items-center">
                          <div className={`w-2 h-2 ${!!NetworkAudioMap[activeNetwork!] ? 'bg-red-500' : 'bg-blue-500'} rounded-full animate-bounce`}></div>
                          <div className={`w-2 h-2 ${!!NetworkAudioMap[activeNetwork!] ? 'bg-red-500' : 'bg-blue-500'} rounded-full animate-bounce [animation-delay:0.2s]`}></div>
                          <div className={`w-2 h-2 ${!!NetworkAudioMap[activeNetwork!] ? 'bg-red-500' : 'bg-blue-500'} rounded-full animate-bounce [animation-delay:0.4s]`}></div>
                        </div>
                        <p className={`${!!NetworkAudioMap[activeNetwork!] ? 'text-red-500' : 'text-blue-500'} text-[10px] font-black tracking-[0.3em] animate-pulse uppercase`}>Syncing Live Broadcast...</p>
                      </div>
                    ) : (
                      <AudioVisualizer isRed={!!NetworkAudioMap[activeNetwork!]} />
                    )}
                    <p className="text-slate-500 text-[10px] font-mono tracking-widest uppercase mt-2">{statusMessage}</p>
                 </div>
               )}
            </div>
          ) : (
            <div className="opacity-40">
              <div className="w-20 h-20 rounded-[2rem] bg-slate-800 mx-auto mb-6 flex items-center justify-center border border-slate-700">
                <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              </div>
              <p className="text-sm font-bold tracking-widest text-slate-300">带 <span className="text-red-500">红点</span> 频道为官方实时广播源</p>
            </div>
          )}
        </section>

        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <h2 className="text-2xl font-black serif">今日新闻摘要</h2>
            <CategoryFilter activeCategory={activeCategory} onCategoryChange={setActiveCategory} />
          </div>
          {isLoading ? (
             <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
               {[1,2,3].map(i => <div key={i} className="h-48 bg-slate-900 animate-pulse rounded-2xl border border-slate-800"></div>)}
             </div>
          ) : (
             <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
               {news.map(n => <NewsCard key={n.id} news={n} isPlaying={currentNewsId === n.id} onPlay={() => playNewsItem(n)} />)}
             </div>
          )}
        </section>
      </main>

      <audio ref={streamAudioRef} crossOrigin="anonymous" playsInline hidden />
    </div>
  );
};

export default App;
