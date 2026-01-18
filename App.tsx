
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
  const [isOfficialStream, setIsOfficialStream] = useState(false); // 默认为 AI 模式，国内环境最稳
  const [isAutoSwitch, setIsAutoSwitch] = useState(true); // 默认开启自动换台
  const [isTuning, setIsTuning] = useState(false);
  const [needsInteraction, setNeedsInteraction] = useState(false);
  const [dataRate, setDataRate] = useState(0); 
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const autoSwitchTimeoutRef = useRef<number | null>(null);

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

  const stopAllAudio = useCallback((manual = true) => {
    if (autoSwitchTimeoutRef.current) {
      window.clearTimeout(autoSwitchTimeoutRef.current);
      autoSwitchTimeoutRef.current = null;
    }
    
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
    if (manual) {
      setIsLiveMode(false);
      setActiveNetwork(null);
      setIsAutoSwitch(false); // 手动停止则关闭自动换台
    }
    setCurrentNewsId(null);
    nextStartTimeRef.current = 0;
    setIsTuning(false);
    setDataRate(0);
    setNeedsInteraction(false);
  }, []);

  const handleNextNetwork = useCallback(() => {
    const networks = Object.values(NewsNetwork);
    const currentIndex = activeNetwork ? networks.indexOf(activeNetwork) : -1;
    const nextIndex = (currentIndex + 1) % networks.length;
    const nextNet = networks[nextIndex];
    
    // 自动切换逻辑
    stopAllAudio(false);
    setActiveNetwork(nextNet);
    setIsLiveMode(true);
    setIsTuning(true);
    
    // 自动换台无需用户再次点击按钮（如果 AudioContext 已经激活）
    setTimeout(() => {
      setIsTuning(false);
      startAILive(nextNet);
    }, 1500);
  }, [activeNetwork, stopAllAudio]);

  const handleSyncAudio = async () => {
    await initAudio();
    setNeedsInteraction(false);
    if (!isOfficialStream && activeNetwork) {
        startAILive(activeNetwork);
    }
  };

  const selectNetwork = async (network: NewsNetwork) => {
    stopAllAudio(false);
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
    nextStartTimeRef.current = ctx.currentTime + 0.2;

    try {
      const callbacks = {
        onopen: () => {
          if (sessionPromise) {
            sessionPromise.then(session => {
              session.sendRealtimeInput({
                text: `SYSTEM: 开始英语新闻直播。频道：${network}。请搜索并播报最新的全球新闻，播报时间控制在2-3分钟。播报结束后请保持安静。`
              });
            });
          }
        },
        onmessage: async (message: any) => {
          const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (base64Audio) {
            setDataRate(prev => prev + 1024);
            const currentCtx = audioContextRef.current!;
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
          
          // 如果收到结束标志且开启了自动换台
          if (message.serverContent?.turnComplete && isAutoSwitch) {
            // 给用户几秒钟反应时间，然后切换到下一个频道
            autoSwitchTimeoutRef.current = window.setTimeout(() => {
                handleNextNetwork();
            }, 5000);
          }
        },
        onerror: () => {
          if (isAutoSwitch) handleNextNetwork();
          else stopAllAudio();
        },
        onclose: () => {
           // 正常关闭不立即触发换台，除非是报错或结束
        }
      };

      const sessionPromise = connectLiveNews(callbacks, network);
      liveSessionRef.current = await sessionPromise;
    } catch (error) { 
      if (isAutoSwitch) handleNextNetwork();
      else stopAllAudio(); 
    }
  }, [isAutoSwitch, handleNextNetwork, stopAllAudio]);

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
            <div className="flex items-center gap-3">
               <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">电台信号矩阵</h3>
               <label className="flex items-center gap-2 cursor-pointer group">
                  <div 
                    onClick={() => setIsAutoSwitch(!isAutoSwitch)}
                    className={`w-8 h-4 rounded-full relative transition-all ${isAutoSwitch ? 'bg-blue-600' : 'bg-slate-700'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isAutoSwitch ? 'left-4.5' : 'left-0.5'}`}></div>
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 group-hover:text-blue-400 transition-colors">自动轮播换台</span>
               </label>
            </div>
            <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1">
              <button 
                onClick={() => { setIsOfficialStream(false); if(activeNetwork) selectNetwork(activeNetwork); }}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all ${(!isOfficialStream) ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:text-slate-300'}`}
              >AI 智能播报 (极速直连)</button>
              <button 
                onClick={() => { setIsOfficialStream(true); if(activeNetwork) selectNetwork(activeNetwork); }}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all ${isOfficialStream ? 'bg-red-600 text-white shadow-lg shadow-red-500/20' : 'text-slate-500 hover:text-slate-300'}`}
              >官方视频流 (需VPN)</button>
            </div>
          </div>
          
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {Object.values(NewsNetwork).map((net) => (
              <button
                key={net}
                onClick={() => selectNetwork(net)}
                className={`relative py-4 rounded-2xl border-2 transition-all active:scale-95 flex flex-col items-center gap-1.5 ${
                  activeNetwork === net
                    ? (isOfficialStream ? 'bg-red-950/20 border-red-500 ring-2 ring-red-500/20' : 'bg-blue-950/20 border-blue-500 ring-2 ring-blue-500/20')
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

        <section className={`mb-10 rounded-[2.5rem] border-2 transition-all duration-700 overflow-hidden relative min-h-[500px] flex flex-col items-center justify-center ${
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
                   <div className="absolute inset-0 bg-black/60 backdrop-blur-md pointer-events-none"></div>
                </div>
              )}

              <div className="relative z-20 text-center px-6 w-full max-w-2xl">
                {needsInteraction ? (
                  <div className="flex flex-col items-center gap-8">
                    <button 
                        onClick={handleSyncAudio}
                        className="group relative w-36 h-36 flex items-center justify-center transition-all active:scale-95"
                    >
                        <div className="absolute inset-0 bg-white rounded-full animate-ping opacity-20"></div>
                        <div className="w-24 h-24 rounded-full bg-white text-black flex items-center justify-center shadow-[0_0_60px_rgba(255,255,255,0.4)]">
                            <svg className="w-10 h-10 fill-current ml-1" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    </button>
                    <div>
                        <h4 className="text-2xl font-black text-white tracking-[0.3em] uppercase mb-4">开启实时播报</h4>
                        <p className="text-slate-400 text-sm max-w-sm mx-auto leading-relaxed">
                            {isOfficialStream 
                                ? "官方流可能受网络环境限制。若无法加载，请切换至【AI 智能播报】模式，支持国内网络直连。已开启自动轮播模式。"
                                : "正在连接 Gemini 神经网络，点击上方按钮收听为您定制的英语新闻流。"}
                        </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="absolute top-[-140px] left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
                        <div className="flex items-center gap-2 px-5 py-2 bg-slate-950 border border-slate-700 rounded-full shadow-2xl">
                           <div className={`w-2.5 h-2.5 rounded-full animate-ping ${isOfficialStream ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                           <span className="text-xs font-black font-mono tracking-widest text-white uppercase">
                              {isTuning ? '正在校准信号...' : '信号已锁定'}
                           </span>
                        </div>
                        {!isOfficialStream && <div className="text-[10px] font-mono text-emerald-500 bg-emerald-500/10 px-3 py-1 rounded-full uppercase border border-emerald-500/20">AI 神经网络传输中 {isAutoSwitch && '• 自动换台已开启'}</div>}
                    </div>

                    <div className={`text-9xl sm:text-[12rem] font-black font-mono tracking-tighter transition-all duration-700 select-none ${isTuning ? 'blur-3xl opacity-0 scale-90' : 'blur-0 opacity-100 scale-100'}`}>
                      {activeNetwork ? (activeNetwork.length * 5.5 + 87.5).toFixed(2) : '00.00'}
                      <span className="text-2xl ml-2 opacity-20 font-light">MHz</span>
                    </div>

                    <div className="flex items-end justify-center gap-2 h-32 my-12 w-full">
                       {[...Array(32)].map((_, i) => (
                         <div 
                          key={i} 
                          className={`flex-1 rounded-full transition-all duration-150 ${isOfficialStream ? 'bg-red-500' : 'bg-blue-600'}`}
                          style={{ 
                            height: isTuning ? '5%' : `${20 + Math.random() * 80}%`, 
                            opacity: 0.1 + (i / 32) * 0.8,
                            animation: !isTuning ? `pulse-bar ${0.5 + Math.random()}s infinite alternate` : 'none'
                          }}
                         />
                       ))}
                    </div>

                    <div className="flex flex-col items-center gap-4">
                        <p className="text-white font-black text-xl uppercase tracking-[0.4em]">
                          {activeNetwork}
                        </p>
                        <div className="flex items-center gap-5 text-slate-500 text-[11px] font-mono mt-2">
                            <span>模式: {isOfficialStream ? '官方原声' : 'AI 深度解析'}</span>
                            <span className="w-1.5 h-1.5 bg-slate-800 rounded-full"></span>
                            <span>比特率: {isOfficialStream ? '720P' : 'HI-FI 直连'}</span>
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
              <h2 className="text-4xl font-black mb-6 serif tracking-tight">全球回响电台</h2>
              <p className="text-slate-400 text-lg leading-relaxed font-light">
                针对中国用户优化。推荐使用 <span className="text-blue-500 font-bold underline">AI 智能播报</span> 模式，免翻墙收听最新全球英语新闻，系统将自动循环切换频道。
              </p>
            </div>
          )}
        </section>

        <section className="bottom-safe mt-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <h2 className="text-3xl font-black serif">新闻快讯存档</h2>
            <CategoryFilter activeCategory={activeCategory} onCategoryChange={setActiveCategory} />
          </div>
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => <div key={i} className="bg-slate-900/40 h-64 rounded-3xl animate-pulse border border-slate-800/50"></div>)}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {news.map((item) => <NewsCard key={item.id} news={item} isPlaying={currentNewsId === item.id} onPlay={() => playNewsItem(item)} />)}
            </div>
          )}
        </section>
      </main>

      {(isSpeaking || (isLiveMode && !needsInteraction)) && (
        <div className="fixed bottom-0 left-0 right-0 p-5 bg-black/95 backdrop-blur-3xl border-t border-white/5 z-[100] animate-slide-up bottom-safe shadow-[0_-20px_50px_rgba(0,0,0,0.5)]">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-1 overflow-hidden">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center animate-pulse shadow-xl ${isOfficialStream ? 'bg-red-600' : 'bg-blue-600'}`}>
                 <div className="w-2.5 h-2.5 bg-white rounded-full"></div>
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] truncate mb-0.5">{activeNetwork || 'AI 智能中枢'}</p>
                <p className="text-sm font-bold text-white truncate uppercase tracking-tight">
                    {isOfficialStream ? '正在同步官方视频流' : `AI 广播：${activeNetwork} 直播中 ${isAutoSwitch ? '(自动换台中)' : ''}`}
                </p>
              </div>
            </div>
            <div className="hidden md:block">
                <AudioVisualizer />
            </div>
            <button 
                onClick={() => stopAllAudio(true)} 
                className="w-12 h-12 bg-slate-800/80 hover:bg-red-600 text-white rounded-2xl flex items-center justify-center transition-all active:scale-90 border border-slate-700 shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}
      
      <style>{`
        @keyframes pulse-bar {
          from { transform: scaleY(0.8); }
          to { transform: scaleY(1.2); }
        }
      `}</style>
    </div>
  );
};

export default App;
