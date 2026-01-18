
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header.tsx';
import CategoryFilter from './components/CategoryFilter.tsx';
import NewsCard from './components/NewsCard.tsx';
import AudioVisualizer from './components/AudioVisualizer.tsx';
import { NewsCategory, NewsItem, VoiceName, NewsNetwork, NetworkStreamMap } from './types.ts';
import { fetchLatestNews, generateSpeech, connectLiveNews } from './services/geminiService.ts';
import { decode, decodeAudioData } from './utils/audio.ts';

const App: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<NewsCategory>(NewsCategory.GENERAL);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentNewsId, setCurrentNewsId] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(VoiceName.ZEPHYR);
  const [activeNetwork, setActiveNetwork] = useState<NewsNetwork | null>(null);
  const [isOfficialStream, setIsOfficialStream] = useState(false);
  const [isAutoSwitch, setIsAutoSwitch] = useState(true); 
  const [isTuning, setIsTuning] = useState(false);
  const [needsInteraction, setNeedsInteraction] = useState(false);
  const [statusMessage, setStatusMessage] = useState('等待发射信号');
  
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
      setIsAutoSwitch(false);
      setStatusMessage('已停止');
    }
    setCurrentNewsId(null);
    nextStartTimeRef.current = 0;
    setIsTuning(false);
    setNeedsInteraction(false);
  }, []);

  const handleNextNetwork = useCallback(() => {
    if (!isAutoSwitch) return;

    const networks = Object.values(NewsNetwork);
    const currentIndex = activeNetwork ? networks.indexOf(activeNetwork) : -1;
    const nextIndex = (currentIndex + 1) % networks.length;
    const nextNet = networks[nextIndex];
    
    setStatusMessage(`即将自动切换至: ${nextNet}`);
    
    stopAllAudio(false);
    setActiveNetwork(nextNet);
    setIsLiveMode(true);
    setIsTuning(true);
    
    setTimeout(() => {
      setIsTuning(false);
      startAILive(nextNet);
    }, 2000);
  }, [activeNetwork, isAutoSwitch, stopAllAudio]);

  const handleSyncAudio = async () => {
    setStatusMessage('正在初始化音频引擎...');
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
    setStatusMessage(`正在调谐至 ${network}...`);
    
    setTimeout(() => {
      setIsTuning(false);
    }, 800);
  };

  const startAILive = useCallback(async (network: NewsNetwork) => {
    const ctx = await initAudio();
    setIsSpeaking(true);
    setStatusMessage(`正在连接 ${network} 神经链路...`);
    nextStartTimeRef.current = ctx.currentTime + 0.3;

    try {
      const callbacks = {
        onopen: () => {
          setStatusMessage(`${network} 播报中...`);
          if (sessionPromise) {
            sessionPromise.then(session => {
              session.sendRealtimeInput({
                text: `SYSTEM: 开始英语播报频道：${network}。请总结并播报最新的3条重要英语新闻。完成后请说 "Station switch in 5 seconds." 并停止说话。`
              });
            });
          }
        },
        onmessage: async (message: any) => {
          const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (base64Audio) {
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
          
          if (message.serverContent?.turnComplete && isAutoSwitch) {
            setStatusMessage('本轮播报结束，准备切换频道...');
            autoSwitchTimeoutRef.current = window.setTimeout(() => {
                handleNextNetwork();
            }, 6000);
          }
        },
        onerror: () => {
          setStatusMessage('信号干扰，正在重试...');
          if (isAutoSwitch) handleNextNetwork();
          else stopAllAudio();
        },
        onclose: () => {}
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
    setStatusMessage(`正在合成快讯: ${item.title}`);
    try {
      const base64Audio = await generateSpeech(item.summary, selectedVoice);
      const audioBytes = decode(base64Audio);
      const audioBuffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => { setIsSpeaking(false); setCurrentNewsId(null); activeSourcesRef.current.delete(source); setStatusMessage('就绪'); };
      source.start();
      activeSourcesRef.current.add(source);
    } catch (e) { setIsSpeaking(false); setStatusMessage('播放出错'); }
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
               <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">电台频率选择</h3>
               <button 
                  onClick={() => setIsAutoSwitch(!isAutoSwitch)}
                  className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all ${isAutoSwitch ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
               >
                  <div className={`w-2 h-2 rounded-full ${isAutoSwitch ? 'bg-blue-400 animate-pulse' : 'bg-slate-600'}`}></div>
                  <span className="text-[10px] font-bold">自动巡航播报 {isAutoSwitch ? 'ON' : 'OFF'}</span>
               </button>
            </div>
            <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1">
              <button 
                onClick={() => { setIsOfficialStream(false); if(activeNetwork) selectNetwork(activeNetwork); }}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all ${(!isOfficialStream) ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500'}`}
              >AI 播报 (国内直连)</button>
              <button 
                onClick={() => { setIsOfficialStream(true); if(activeNetwork) selectNetwork(activeNetwork); }}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all ${isOfficialStream ? 'bg-red-600 text-white shadow-lg' : 'text-slate-500'}`}
              >原声视频 (需VPN)</button>
            </div>
          </div>
          
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {Object.values(NewsNetwork).map((net) => (
              <button
                key={net}
                onClick={() => selectNetwork(net)}
                className={`relative py-4 rounded-2xl border-2 transition-all active:scale-95 flex flex-col items-center gap-1.5 ${
                  activeNetwork === net
                    ? (isOfficialStream ? 'bg-red-950/20 border-red-500 shadow-2xl' : 'bg-blue-950/20 border-blue-500 shadow-2xl')
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-[11px] ${
                  activeNetwork === net ? 'bg-white text-black' : 'bg-slate-800 text-slate-500'
                }`}>
                  {net.charAt(0)}
                </div>
                <span className={`text-[9px] font-black uppercase truncate px-1 tracking-tighter ${activeNetwork === net ? 'text-white' : 'text-slate-400'}`}>{net.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={`mb-10 rounded-[2.5rem] border-2 transition-all duration-700 overflow-hidden relative min-h-[500px] flex flex-col items-center justify-center ${
          isLiveMode ? 'bg-black border-slate-800 shadow-[0_0_100px_rgba(0,0,0,0.5)]' : 'bg-slate-900/30 border-slate-800'
        }`}>
          {isLiveMode ? (
            <>
              {isOfficialStream && activeNetwork && NetworkStreamMap[activeNetwork] && !needsInteraction && (
                <div className="absolute inset-0 z-0 opacity-40">
                   <iframe 
                    src={`https://www.youtube.com/embed/${NetworkStreamMap[activeNetwork]}?autoplay=1&mute=0&controls=0&modestbranding=1&rel=0`}
                    className="w-full h-full object-cover scale-110 blur-sm"
                    allow="autoplay; encrypted-media"
                   />
                </div>
              )}

              <div className="relative z-20 text-center px-6 w-full max-w-2xl">
                {needsInteraction ? (
                  <div className="flex flex-col items-center gap-10">
                    <button 
                        onClick={handleSyncAudio}
                        className="group relative w-44 h-44 flex items-center justify-center transition-all active:scale-90"
                    >
                        <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-20"></div>
                        <div className="w-28 h-28 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-[0_0_80px_rgba(37,99,235,0.4)] hover:bg-blue-500 transition-colors">
                            <svg className="w-12 h-12 fill-current ml-1" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    </button>
                    <div>
                        <h4 className="text-3xl font-black text-white tracking-[0.4em] uppercase mb-4">开启英语广播</h4>
                        <p className="text-slate-400 text-base max-w-md mx-auto leading-relaxed">
                            {isOfficialStream 
                                ? "官方流受地区限制可能无法加载。推荐点击右上角切换至【AI 播报】模式，免 VPN 流畅磨耳朵。"
                                : "正在建立神经网络链接。点击按钮开始收听。"}
                        </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="absolute top-[-140px] left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
                        <div className="flex items-center gap-2 px-6 py-2 bg-slate-950 border border-slate-700 rounded-full shadow-2xl backdrop-blur-md">
                           <div className={`w-3 h-3 rounded-full animate-ping ${isOfficialStream ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                           <span className="text-sm font-black font-mono tracking-widest text-white uppercase">
                              {isTuning ? '同步中...' : statusMessage}
                           </span>
                        </div>
                    </div>

                    <div className={`text-9xl sm:text-[14rem] font-black font-mono tracking-tighter transition-all duration-700 select-none ${isTuning ? 'blur-3xl opacity-20' : 'blur-0 opacity-100'}`}>
                      {activeNetwork ? (activeNetwork.length * 5.5 + 87.5).toFixed(2) : '00.00'}
                      <span className="text-2xl ml-2 opacity-20 font-light">MHz</span>
                    </div>

                    <div className="flex items-end justify-center gap-1.5 h-36 my-12 w-full px-12">
                       {[...Array(40)].map((_, i) => (
                         <div 
                          key={i} 
                          className={`flex-1 rounded-full transition-all duration-150 ${isOfficialStream ? 'bg-red-500' : 'bg-blue-500'}`}
                          style={{ 
                            height: isTuning ? '5%' : `${20 + Math.random() * 80}%`, 
                            opacity: 0.1 + (i / 40) * 0.9,
                            animation: !isTuning ? `pulse-bar ${0.3 + Math.random() * 0.6}s infinite alternate` : 'none'
                          }}
                         />
                       ))}
                    </div>

                    <div className="flex flex-col items-center gap-4">
                        <p className="text-white font-black text-3xl uppercase tracking-[0.6em] drop-shadow-[0_0_20px_rgba(255,255,255,0.3)]">
                          {activeNetwork}
                        </p>
                        <div className="flex items-center gap-6 text-slate-500 text-xs font-mono mt-4">
                            <span>MODE: {isOfficialStream ? 'OFFICIAL RAW' : 'AI ENHANCED'}</span>
                            <span className="w-2 h-2 bg-slate-800 rounded-full"></span>
                            <span>AUTO-SCAN: {isAutoSwitch ? 'ENABLED' : 'DISABLED'}</span>
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
              <h2 className="text-4xl font-black mb-6 serif tracking-tight">AI 英语电台</h2>
              <p className="text-slate-400 text-lg leading-relaxed font-light">
                针对中国用户优化。选择左侧频道开启 <span className="text-blue-500 font-bold underline">AI 播报</span> 模式，免 VPN 收听全球新闻，系统将自动循环切换。
              </p>
            </div>
          )}
        </section>

        <section className="bottom-safe mt-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <h2 className="text-3xl font-black serif">最新快讯存档</h2>
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
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-black/95 backdrop-blur-3xl border-t border-white/5 z-[100] animate-slide-up bottom-safe">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
            <div className="flex items-center gap-5 flex-1 overflow-hidden">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center animate-pulse shadow-2xl ${isOfficialStream ? 'bg-red-600' : 'bg-blue-600'}`}>
                 <div className="w-3 h-3 bg-white rounded-full"></div>
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-[0.4em] truncate mb-1">{activeNetwork || '系统就绪'}</p>
                <p className="text-base font-bold text-white truncate uppercase tracking-tight">
                    {isOfficialStream ? '正在同步原声信号' : `AI 广播: ${activeNetwork} 直播中 ${isAutoSwitch ? '(自动巡航)' : ''}`}
                </p>
              </div>
            </div>
            <div className="hidden lg:block">
                <AudioVisualizer />
            </div>
            <button 
                onClick={() => stopAllAudio(true)} 
                className="w-14 h-14 bg-slate-800/80 hover:bg-red-600 text-white rounded-2xl flex items-center justify-center transition-all active:scale-90 border border-slate-700 shadow-lg"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}
      
      <style>{`
        @keyframes pulse-bar {
          from { transform: scaleY(0.6); }
          to { transform: scaleY(1.4); }
        }
      `}</style>
    </div>
  );
};

export default App;
