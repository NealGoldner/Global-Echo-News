
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header';
import CategoryFilter from './components/CategoryFilter';
import NewsCard from './components/NewsCard';
import AudioVisualizer from './components/AudioVisualizer';
import { NewsCategory, NewsItem, VoiceName, NewsNetwork, NetworkStreamMap } from './types';
import { fetchLatestNews, generateSpeech, connectLiveNews } from './services/geminiService';
import { decode, decodeAudioData } from './utils/audio';

const App: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<NewsCategory>(NewsCategory.GENERAL);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentNewsId, setCurrentNewsId] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(VoiceName.ZEPHYR);
  const [activeNetwork, setActiveNetwork] = useState<NewsNetwork | null>(null);
  const [isOfficialStream, setIsOfficialStream] = useState(false); // 默认 AI 模式，确保必响
  const [isTuning, setIsTuning] = useState(false);
  const [needsInteraction, setNeedsInteraction] = useState(false);
  const [dataRate, setDataRate] = useState(0); 
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);

  const initAudio = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    if (silentAudioRef.current) {
      try { await silentAudioRef.current.play(); } catch(e) {}
    }
    return audioContextRef.current;
  };

  const stopAllAudio = useCallback(() => {
    activeSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
    activeSourcesRef.current.clear();
    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      liveSessionRef.current = null;
    }
    if (silentAudioRef.current) {
      silentAudioRef.current.pause();
      silentAudioRef.current.currentTime = 0;
    }
    
    setIsSpeaking(false);
    setIsLiveMode(false);
    setActiveNetwork(null);
    setCurrentNewsId(null);
    nextStartTimeRef.current = 0;
    setIsTuning(false);
    setDataRate(0);
    setNeedsInteraction(false);
  }, []);

  const handleSyncAudio = async () => {
    await initAudio();
    setNeedsInteraction(false);
    if (!isOfficialStream && activeNetwork) {
        startAILive(activeNetwork);
    }
  };

  const selectNetwork = async (network: NewsNetwork) => {
    stopAllAudio();
    setActiveNetwork(network);
    setIsLiveMode(true);
    setNeedsInteraction(true); 
    setIsTuning(true);
    
    setTimeout(() => {
      setIsTuning(false);
    }, 800);
  };

  const startAILive = useCallback(async (network: NewsNetwork) => {
    const ctx = await initAudio();
    setIsSpeaking(true);
    // 稍微延迟开始时间以适应初始缓冲
    nextStartTimeRef.current = ctx.currentTime + 0.3;

    try {
      const callbacks = {
        onopen: () => {
          if (sessionPromise) {
            sessionPromise.then(session => {
              session.sendRealtimeInput({
                text: `SYSTEM: START LIVE ENGLISH BROADCAST. NETWORK: ${network}. SUMMARIZE CURRENT GLOBAL HEADLINES AS THEY BREAK.`
              });
            });
          }
        },
        onmessage: async (message: any) => {
          const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (base64Audio) {
            setDataRate(prev => prev + 1024);
            const currentCtx = audioContextRef.current!;
            
            // 调度逻辑：确保音频块无缝连接
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, currentCtx.currentTime);
            const audioBytes = decode(base64Audio);
            const audioBuffer = await decodeAudioData(audioBytes, currentCtx, 24000, 1);
            
            const source = currentCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(currentCtx.destination);
            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += audioBuffer.duration;
            
            activeSourcesRef.current.add(source);
            source.onended = () => activeSourcesRef.current.delete(source);
          }
        },
        onerror: () => stopAllAudio(),
        onclose: () => { setIsLiveMode(false); }
      };

      const sessionPromise = connectLiveNews(callbacks, network);
      liveSessionRef.current = await sessionPromise;
    } catch (error) { stopAllAudio(); }
  }, [stopAllAudio]);

  const loadNews = useCallback(async (category: NewsCategory) => {
    setIsLoading(true);
    try {
      const data = await fetchLatestNews(category);
      setNews(data);
    } catch (error) { console.error(error); } finally { setIsLoading(false); }
  }, []);

  useEffect(() => { loadNews(activeCategory); }, [activeCategory, loadNews]);

  const playNewsItem = async (item: NewsItem) => {
    stopAllAudio();
    const ctx = await initAudio();
    setCurrentNewsId(item.id);
    setIsSpeaking(true);
    try {
      const base64Audio = await generateSpeech(item.summary, selectedVoice);
      const audioBytes = decode(base64Audio);
      const audioBuffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => { setIsSpeaking(false); setCurrentNewsId(null); activeSourcesRef.current.delete(source); };
      source.start();
      activeSourcesRef.current.add(source);
    } catch (e) { setIsSpeaking(false); }
  };

  return (
    <div className="min-h-screen flex flex-col selection:bg-blue-500/30">
      <Header 
        isLive={isLiveMode} 
        isOfficial={isOfficialStream} 
        onToggleLive={() => isLiveMode ? stopAllAudio() : selectNetwork(NewsNetwork.SKY)} 
      />

      <audio ref={silentAudioRef} loop playsInline src="data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==" />

      <main className="flex-grow max-w-7xl mx-auto w-full px-4 md:px-8 py-6">
        <section className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">News Signal Matrix</h3>
            <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1">
              <button 
                onClick={() => { setIsOfficialStream(false); if(activeNetwork) selectNetwork(activeNetwork); }}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all ${(!isOfficialStream) ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:text-slate-300'}`}
              >AI Deep Analysis (推荐: 100% 成功播放)</button>
              <button 
                onClick={() => { setIsOfficialStream(true); if(activeNetwork) selectNetwork(activeNetwork); }}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all ${isOfficialStream ? 'bg-red-600 text-white shadow-lg shadow-red-500/20' : 'text-slate-500 hover:text-slate-300'}`}
              >Official Video Feed</button>
            </div>
          </div>
          
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {Object.values(NewsNetwork).map((net) => (
              <button
                key={net}
                onClick={() => selectNetwork(net)}
                className={`relative py-4 rounded-2xl border-2 transition-all active:scale-95 flex flex-col items-center gap-1.5 ${
                  activeNetwork === net
                    ? (isOfficialStream ? 'bg-red-950/20 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]' : 'bg-blue-950/20 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.2)]')
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-[11px] ${
                  activeNetwork === net ? 'bg-white text-black' : 'bg-slate-800 text-slate-500'
                }`}>
                  {net.charAt(0)}
                </div>
                <span className={`text-[9px] font-black uppercase truncate px-1 tracking-tighter ${activeNetwork === net ? 'text-white' : 'text-slate-500'}`}>{net.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={`mb-10 rounded-[2.5rem] border-2 transition-all duration-700 overflow-hidden relative min-h-[540px] flex flex-col items-center justify-center ${
          isLiveMode ? 'bg-black border-slate-800' : 'bg-slate-900/30 border-slate-800'
        }`}>
          {isLiveMode ? (
            <>
              {isOfficialStream && activeNetwork && NetworkStreamMap[activeNetwork] && !needsInteraction && (
                <div className="absolute inset-0 z-0">
                   <iframe 
                    src={`https://www.youtube.com/embed/${NetworkStreamMap[activeNetwork]}?autoplay=1&mute=0&controls=1&modestbranding=1&rel=0&enablejsapi=1&origin=${window.location.origin}`}
                    className="w-full h-full object-cover"
                    allow="autoplay; encrypted-media; picture-in-picture"
                   />
                   <div className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-none"></div>
                   
                   {/* 救急手动按钮：如果 iframe 无法显示，直接外部打开 */}
                   <div className="absolute top-6 right-6 z-40">
                      <a 
                        href={`https://www.youtube.com/watch?v=${NetworkStreamMap[activeNetwork]}`} 
                        target="_blank" 
                        className="px-4 py-2 bg-red-600/80 hover:bg-red-600 rounded-full text-[10px] font-bold text-white shadow-xl transition-all"
                      >
                        外部收听 (如果视频显示私享)
                      </a>
                   </div>
                </div>
              )}

              <div className="relative z-20 text-center px-6 w-full max-w-2xl">
                {needsInteraction ? (
                  <div className="flex flex-col items-center gap-8">
                    <button 
                        onClick={handleSyncAudio}
                        className="group relative w-40 h-40 flex items-center justify-center transition-all active:scale-95"
                    >
                        <div className="absolute inset-0 bg-white rounded-full animate-ping opacity-20"></div>
                        <div className="w-28 h-28 rounded-full bg-white text-black flex items-center justify-center shadow-[0_0_80px_rgba(255,255,255,0.4)]">
                            <svg className="w-12 h-12 fill-current ml-1" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    </button>
                    <div>
                        <h4 className="text-3xl font-black text-white tracking-[0.4em] uppercase mb-4">Start Broadcast</h4>
                        <p className="text-slate-400 text-base max-w-md mx-auto leading-relaxed">
                            {isOfficialStream 
                                ? "官方视频流可能受版权保护无法在此处直接播放。若显示错误，请点击上方按钮切换到 AI Deep Analysis 模式。"
                                : "正在建立神经网络链接，点击上方按钮开始收听实时英语新闻播报。"}
                        </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="absolute top-[-150px] left-1/2 -translate-x-1/2 flex flex-col items-center gap-4">
                        <div className="flex items-center gap-2 px-6 py-2 bg-slate-950/80 border border-slate-700 rounded-full shadow-2xl backdrop-blur-md">
                           <div className={`w-3 h-3 rounded-full animate-ping ${isOfficialStream ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                           <span className="text-sm font-black font-mono tracking-widest text-white uppercase">
                              {isTuning ? 'SYNCHRONIZING...' : 'SIGNAL LOCKED'}
                           </span>
                        </div>
                        {!isOfficialStream && (
                            <div className="text-[10px] font-mono text-emerald-500 bg-emerald-500/10 px-4 py-1.5 rounded-full uppercase border border-emerald-500/20 flex items-center gap-2">
                                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                                Direct Neural Uplink Active
                            </div>
                        )}
                    </div>

                    <div className={`text-9xl sm:text-[13rem] font-black font-mono tracking-tighter transition-all duration-700 select-none ${isTuning ? 'blur-3xl opacity-0 scale-90' : 'blur-0 opacity-100 scale-100'}`}>
                      {activeNetwork ? (activeNetwork.length * 5.5 + 87.5).toFixed(2) : '00.00'}
                      <span className="text-2xl ml-2 opacity-20 font-light tracking-normal">MHz</span>
                    </div>

                    <div className="flex items-end justify-center gap-2 h-40 my-10 w-full px-4">
                       {[...Array(40)].map((_, i) => (
                         <div 
                          key={i} 
                          className={`flex-1 rounded-full transition-all duration-150 ${isOfficialStream ? 'bg-red-500/40' : 'bg-blue-500/60'}`}
                          style={{ 
                            height: isTuning ? '5%' : `${20 + Math.random() * 80}%`, 
                            opacity: 0.1 + (i / 40) * 0.9,
                            animation: !isTuning ? `wave-anim ${0.3 + Math.random() * 0.4}s infinite alternate` : 'none'
                          }}
                         />
                       ))}
                    </div>

                    <div className="flex flex-col items-center gap-4">
                        <p className="text-white font-black text-2xl uppercase tracking-[0.5em] glow-text drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
                          {activeNetwork}
                        </p>
                        <div className="flex items-center gap-6 text-slate-500 text-xs font-mono mt-2">
                            <span>MODE: {isOfficialStream ? 'ENCRYPTED FEED' : 'AI NEURAL'}</span>
                            <span className="w-2 h-2 bg-slate-800 rounded-full"></span>
                            <span>ENCODING: {isOfficialStream ? 'H.264+PCM' : 'HI-RES FLOAT'}</span>
                        </div>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center p-12 text-center max-w-sm">
              <div className="w-24 h-24 bg-slate-800 rounded-[2.5rem] flex items-center justify-center mb-10 shadow-3xl border border-slate-700 animate-float">
                 <svg className="w-12 h-12 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              </div>
              <h2 className="text-4xl font-black mb-6 serif tracking-tight">English Uplink</h2>
              <p className="text-slate-400 text-lg leading-relaxed font-light">
                如果遇到视频“私享”或无法播放，这是因为 YouTube 官方流的版权限制。请务必使用 <span className="text-blue-500 font-bold underline">AI Deep Analysis</span> 模式，它是直接从服务器流式传输，收听效果最稳且画质极佳。
              </p>
            </div>
          )}
        </section>

        <section className="bottom-safe mt-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <h2 className="text-3xl font-black serif">Latest Bulletins</h2>
            <CategoryFilter activeCategory={activeCategory} onCategoryChange={setActiveCategory} />
          </div>
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {[1, 2, 3].map(i => <div key={i} className="bg-slate-900/40 h-72 rounded-[2.5rem] animate-pulse border border-slate-800/50"></div>)}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {news.map((item) => <NewsCard key={item.id} news={item} isPlaying={currentNewsId === item.id} onPlay={() => playNewsItem(item)} />)}
            </div>
          )}
        </section>
      </main>

      {(isSpeaking || (isLiveMode && !needsInteraction)) && (
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-black/95 backdrop-blur-3xl border-t border-white/5 z-[100] animate-slide-up bottom-safe shadow-[0_-20px_50px_rgba(0,0,0,0.8)]">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
            <div className="flex items-center gap-5 flex-1 overflow-hidden">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center animate-pulse shadow-2xl ${isOfficialStream ? 'bg-red-600' : 'bg-blue-600'}`}>
                 <div className="w-3 h-3 bg-white rounded-full"></div>
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-[0.4em] truncate mb-1">{activeNetwork || 'AI NEURAL CORE'}</p>
                <p className="text-base font-bold text-white truncate uppercase tracking-tight">
                    {isOfficialStream ? 'Syncing Official Video Signal' : 'AI Neural Broadcast: Live Global Analysis'}
                </p>
              </div>
            </div>
            <div className="hidden lg:block">
                <AudioVisualizer />
            </div>
            <button 
                onClick={stopAllAudio} 
                className="w-14 h-14 bg-slate-800/80 hover:bg-red-600 text-white rounded-2xl flex items-center justify-center transition-all active:scale-90 border border-slate-700 shadow-xl"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}
      
      <style>{`
        @keyframes wave-anim {
          from { transform: scaleY(0.7); }
          to { transform: scaleY(1.3); }
        }
      `}</style>
    </div>
  );
};

export default App;
