
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header.tsx';
import CategoryFilter from './components/CategoryFilter.tsx';
import NewsCard from './components/NewsCard.tsx';
import AudioVisualizer from './components/AudioVisualizer.tsx';
import { NewsCategory, NewsItem, VoiceName, NewsNetwork, NetworkStreamMap, NetworkAudioMap } from './types.ts';
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
  const streamAudioRef = useRef<HTMLAudioElement | null>(null);
  const autoSwitchTimeoutRef = useRef<number | null>(null);

  const initAudio = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    // 激活静音底噪，防止 iOS 熄屏切断音频
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
    
    // 停止 AI 播报
    activeSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
    activeSourcesRef.current.clear();
    
    // 停止直连音频流
    if (streamAudioRef.current) {
      streamAudioRef.current.pause();
      streamAudioRef.current.src = '';
    }
    
    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      liveSessionRef.current = null;
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
    const networks = Object.values(NewsNetwork).filter(n => n !== NewsNetwork.GLOBAL_AI);
    const currentIndex = activeNetwork ? networks.indexOf(activeNetwork) : -1;
    const nextIndex = (currentIndex + 1) % networks.length;
    const nextNet = networks[nextIndex];
    
    stopAllAudio(false);
    selectNetwork(nextNet);
  }, [activeNetwork, isAutoSwitch, stopAllAudio]);

  const handleSyncAudio = async () => {
    setStatusMessage('正在握手音频协议...');
    await initAudio();
    setNeedsInteraction(false);
    if (activeNetwork) {
        if (isOfficialStream) {
            playOfficialStream(activeNetwork);
        } else {
            startAILive(activeNetwork);
        }
    }
  };

  const playOfficialStream = async (network: NewsNetwork) => {
    const audioUrl = NetworkAudioMap[network];
    if (audioUrl && streamAudioRef.current) {
      setStatusMessage(`正在建立音频链路: ${network}`);
      setIsSpeaking(true);
      streamAudioRef.current.src = audioUrl;
      try {
        await streamAudioRef.current.play();
        setStatusMessage(`${network} 直播中 (官方源)`);
      } catch (e) {
        setStatusMessage('播放失败，可能需要代理');
        setNeedsInteraction(true);
      }
    } else if (NetworkStreamMap[network]) {
      setStatusMessage(`${network} 视频流已载入`);
      setIsSpeaking(true);
    }
  };

  const selectNetwork = async (network: NewsNetwork) => {
    stopAllAudio(false);
    setActiveNetwork(network);
    setIsLiveMode(true);
    setNeedsInteraction(true); 
    setIsTuning(true);
    setStatusMessage(`调谐频率: ${network}...`);
    
    setTimeout(() => {
      setIsTuning(false);
    }, 800);
  };

  const startAILive = useCallback(async (network: NewsNetwork) => {
    const ctx = await initAudio();
    setIsSpeaking(true);
    setStatusMessage(`正在连接 ${network} AI 增强频道...`);
    nextStartTimeRef.current = ctx.currentTime + 0.3;

    try {
      const callbacks = {
        onopen: () => {
          setStatusMessage(`${network} AI 实时播报中...`);
          if (liveSessionRef.current) {
            liveSessionRef.current.sendRealtimeInput({
              text: `SYSTEM: Start broadcasting for ${network} channel in English. Summarize top 3 news. End with "Station switch in 5 seconds."`
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
            setStatusMessage('准备切换频道...');
            autoSwitchTimeoutRef.current = window.setTimeout(() => {
                handleNextNetwork();
            }, 6000);
          }
        },
        onerror: () => {
          setStatusMessage('信号衰减，重连中...');
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
    setStatusMessage(`正在解码快讯: ${item.title}`);
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

  const isAudioOnlySource = activeNetwork && NetworkAudioMap[activeNetwork];

  return (
    <div className="min-h-screen flex flex-col selection:bg-blue-500/30">
      <Header 
        isLive={isLiveMode} 
        isOfficial={isOfficialStream} 
        onToggleLive={() => isLiveMode ? stopAllAudio() : selectNetwork(NewsNetwork.SKY)} 
      />

      {/* 音频基础设施 */}
      <audio ref={silentAudioRef} loop playsInline src="data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==" />
      <audio ref={streamAudioRef} crossOrigin="anonymous" playsInline />

      <main className="flex-grow max-w-7xl mx-auto w-full px-4 md:px-8 py-6">
        <section className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
               <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">电台频率 (MHz)</h3>
               <button 
                  onClick={() => setIsAutoSwitch(!isAutoSwitch)}
                  className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all ${isAutoSwitch ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
               >
                  <div className={`w-2 h-2 rounded-full ${isAutoSwitch ? 'bg-blue-400 animate-pulse' : 'bg-slate-600'}`}></div>
                  <span className="text-[10px] font-bold">巡航模式 {isAutoSwitch ? 'ON' : 'OFF'}</span>
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
              >官方源 (含直接音频)</button>
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
                {isOfficialStream && NetworkAudioMap[net] && (
                    <div className="absolute top-1 right-1">
                        <svg className="w-3 h-3 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-9-3a1 1 0 00-1 1v5a1 1 0 001 1h2a1 1 0 001-1V8a1 1 0 00-1-1H9z"/></svg>
                    </div>
                )}
              </button>
            ))}
          </div>
        </section>

        <section className={`mb-10 rounded-[2.5rem] border-2 transition-all duration-700 overflow-hidden relative min-h-[500px] flex flex-col items-center justify-center ${
          isLiveMode ? 'bg-black border-slate-800 shadow-[0_0_100px_rgba(0,0,0,0.5)]' : 'bg-slate-900/30 border-slate-800'
        }`}>
          {isLiveMode ? (
            <>
              {isOfficialStream && activeNetwork && NetworkStreamMap[activeNetwork] && !isAudioOnlySource && !needsInteraction && (
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
                        <div className={`w-28 h-28 rounded-full flex items-center justify-center shadow-2xl transition-colors ${isOfficialStream ? 'bg-red-600 hover:bg-red-500 shadow-red-600/40' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/40'}`}>
                            <svg className="w-12 h-12 fill-current ml-1 text-white" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    </button>
                    <div>
                        <h4 className="text-3xl font-black text-white tracking-[0.4em] uppercase mb-4">连接频道</h4>
                        <p className="text-slate-400 text-base max-w-md mx-auto leading-relaxed">
                            {isOfficialStream 
                                ? "官方流可能受网络环境限制。如果无法载入声音，请点击上方蓝色按钮切换至【AI 播报】模式，支持国内极速直连。"
                                : "正在对齐数字频率。点击按钮开始收听。"}
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
                      {activeNetwork ? (activeNetwork.length * 5.5 + 87.5).toFixed(1) : '00.0'}
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
                            <span>MODE: {isOfficialStream ? (isAudioOnlySource ? 'DIRECT AUDIO' : 'VIDEO STREAM') : 'AI ENHANCED'}</span>
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
                针对多端优化的英语收听器。点击上方切换至 <span className="text-blue-500 font-bold underline">AI 播报</span>，无需翻墙即可流畅磨耳朵。
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
                    {isOfficialStream ? (isAudioOnlySource ? `正在接收 ${activeNetwork} 音频信号` : '官方视频同步中') : `AI 广播: ${activeNetwork} 直播中 ${isAutoSwitch ? '(自动巡航)' : ''}`}
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
