
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
  const [liveTranscription, setLiveTranscription] = useState<string>('');
  const [activeNetwork, setActiveNetwork] = useState<NewsNetwork | null>(null);
  const [isOfficialStream, setIsOfficialStream] = useState(true);
  const [isAutoCruise, setIsAutoCruise] = useState(false);
  const [cruiseProgress, setCruiseProgress] = useState(0);
  const [isTuning, setIsTuning] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptionBufferRef = useRef<string>('');
  const cruiseTimerRef = useRef<number | null>(null);

  // 初始化 AudioContext 的辅助函数，确保在 iOS 上被激活
  const initAudio = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const loadNews = useCallback(async (cat: NewsCategory) => {
    setIsLoading(true);
    try {
      const data = await fetchLatestNews(cat);
      setNews(data);
    } catch (error) {
      console.error("News Load Error:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNews(activeCategory);
  }, [activeCategory, loadNews]);

  const stopAllAudio = useCallback(() => {
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    activeSourcesRef.current.clear();
    
    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      liveSessionRef.current = null;
    }

    if (cruiseTimerRef.current) {
      window.clearInterval(cruiseTimerRef.current);
      cruiseTimerRef.current = null;
    }

    setIsSpeaking(false);
    setIsLiveMode(false);
    setActiveNetwork(null);
    setCurrentNewsId(null);
    nextStartTimeRef.current = 0;
    setLiveTranscription('');
    setCruiseProgress(0);
    setIsTuning(false);
    transcriptionBufferRef.current = '';
  }, []);

  const startOfficialLive = async (network: NewsNetwork) => {
    stopAllAudio();
    await initAudio(); // 重要：iOS 用户点击时激活音频
    setIsTuning(true);
    setActiveNetwork(network);
    setIsLiveMode(true);
    setIsOfficialStream(true);
    
    setTimeout(() => {
      setIsTuning(false);
    }, 1200);
  };

  const startAILive = useCallback(async (network: NewsNetwork) => {
    stopAllAudio();
    await initAudio();
    setIsTuning(true);
    setIsLiveMode(true);
    setIsOfficialStream(false);
    setIsSpeaking(true);
    setActiveNetwork(network);
    setLiveTranscription(`Neural link establishing...`);

    try {
      const ctx = await initAudio();
      const callbacks = {
        onopen: () => {
          setIsTuning(false);
          setLiveTranscription(`AI Engine linked to ${network} relay.`);
          if (sessionPromise) {
            sessionPromise.then(session => {
              session.sendRealtimeInput({
                text: `START BROADCAST: Focused on ${network}. Clear delivery.`
              });
            });
          }
        },
        onmessage: async (message: any) => {
          if (message.serverContent?.outputTranscription) {
            const text = message.serverContent.outputTranscription.text;
            transcriptionBufferRef.current += text;
            setLiveTranscription(transcriptionBufferRef.current.slice(-300));
          }

          const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (base64Audio) {
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
            const audioBytes = decode(base64Audio);
            const audioBuffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);
            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += audioBuffer.duration;
            activeSourcesRef.current.add(source);
          }
        },
        onerror: () => stopAllAudio(),
        onclose: () => { if (!isAutoCruise) setIsLiveMode(false); }
      };

      const sessionPromise = connectLiveNews(callbacks, network);
      liveSessionRef.current = await sessionPromise;
    } catch (error) {
      stopAllAudio();
    }
  }, [isAutoCruise, stopAllAudio]);

  useEffect(() => {
    if (isLiveMode && !isOfficialStream && isAutoCruise) {
      let timeLeft = 300;
      cruiseTimerRef.current = window.setInterval(() => {
        timeLeft -= 1;
        setCruiseProgress(((300 - timeLeft) / 300) * 100);
        if (timeLeft <= 0) {
          const networks = Object.values(NewsNetwork).filter(n => n !== NewsNetwork.GLOBAL_AI);
          const nextIndex = (networks.indexOf(activeNetwork!) + 1) % networks.length;
          startAILive(networks[nextIndex]);
        }
      }, 1000);
    }
    return () => { if (cruiseTimerRef.current) window.clearInterval(cruiseTimerRef.current); };
  }, [isLiveMode, isOfficialStream, isAutoCruise, activeNetwork, startAILive]);

  const playNewsItem = async (item: NewsItem) => {
    stopAllAudio();
    await initAudio();
    setCurrentNewsId(item.id);
    setIsSpeaking(true);
    try {
      const ctx = await initAudio();
      const base64Audio = await generateSpeech(item.summary, selectedVoice);
      const audioBytes = decode(base64Audio);
      const audioBuffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => { setIsSpeaking(false); setCurrentNewsId(null); };
      source.start();
      activeSourcesRef.current.add(source);
    } catch (e) { setIsSpeaking(false); }
  };

  return (
    <div className="min-h-screen flex flex-col selection:bg-blue-500/30">
      <Header 
        isLive={isLiveMode} 
        isOfficial={isOfficialStream} 
        onToggleLive={() => isLiveMode ? stopAllAudio() : startOfficialLive(NewsNetwork.ABC)} 
      />

      <main className="flex-grow max-w-7xl mx-auto w-full px-4 md:px-8 py-6">
        {/* Mobile-Friendly Control Grid */}
        <section className="mb-8">
          <div className="flex flex-col gap-4 mb-6">
            <div className="flex justify-between items-end">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Broadcast Matrix</h3>
              {isAutoCruise && <span className="text-[10px] text-blue-500 font-bold animate-pulse">AUTO-CRUISE ON</span>}
            </div>
            <div className="flex overflow-x-auto no-scrollbar bg-slate-900/50 p-1 rounded-2xl border border-slate-800">
              <button 
                onClick={() => { setIsOfficialStream(true); setIsAutoCruise(false); if(activeNetwork) startOfficialLive(activeNetwork); }}
                className={`flex-1 min-w-[100px] py-3 rounded-xl text-[10px] font-bold transition-all ${isOfficialStream ? 'bg-red-600 text-white shadow-lg' : 'text-slate-500'}`}
              >Official</button>
              <button 
                onClick={() => { setIsOfficialStream(false); setIsAutoCruise(false); if(activeNetwork) startAILive(activeNetwork); }}
                className={`flex-1 min-w-[100px] py-3 rounded-xl text-[10px] font-bold transition-all ${(!isOfficialStream && !isAutoCruise) ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500'}`}
              >AI Deep</button>
              <button 
                onClick={() => { setIsOfficialStream(false); setIsAutoCruise(true); if(activeNetwork) startAILive(activeNetwork); }}
                className={`flex-1 min-w-[100px] py-3 rounded-xl text-[10px] font-bold transition-all ${(!isOfficialStream && isAutoCruise) ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500'}`}
              >Cruise</button>
            </div>
          </div>
          
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {Object.values(NewsNetwork).map((net) => (
              <button
                key={net}
                onClick={() => isOfficialStream ? startOfficialLive(net) : startAILive(net)}
                className={`relative py-4 rounded-xl border transition-all active:scale-95 flex flex-col items-center gap-2 ${
                  activeNetwork === net
                    ? (isOfficialStream ? 'bg-red-950/30 border-red-500' : 'bg-blue-950/30 border-blue-500')
                    : 'bg-slate-900 border-slate-800'
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-[10px] ${
                  activeNetwork === net 
                    ? (isOfficialStream ? 'bg-red-600 text-white' : 'bg-blue-600 text-white') 
                    : 'bg-slate-800 text-slate-500'
                }`}>
                  {net.charAt(0)}
                </div>
                <span className={`text-[9px] font-bold uppercase truncate w-full text-center px-1 ${activeNetwork === net ? 'text-white' : 'text-slate-500'}`}>
                  {net.split(' ')[0]}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Digital Radio Display - Optimized for iPhone 16 Screen */}
        <section className={`mb-10 rounded-[2rem] border-2 transition-all duration-500 overflow-hidden relative ${
          isLiveMode 
            ? (isOfficialStream ? 'bg-black border-red-900/50 shadow-2xl' : 'bg-black border-blue-900/50 shadow-2xl') 
            : 'bg-slate-900/30 border-slate-800 p-8'
        }`}>
          {isLiveMode ? (
            <div className="relative min-h-[380px] flex flex-col items-center justify-center p-6 text-center">
              {isOfficialStream && activeNetwork && NetworkStreamMap[activeNetwork] && (
                <div className="absolute opacity-0 pointer-events-none">
                   <iframe src={`https://www.youtube.com/embed/${NetworkStreamMap[activeNetwork]}?autoplay=1&mute=0`} allow="autoplay"></iframe>
                </div>
              )}

              <div className={`text-[9px] font-mono mb-4 tracking-[0.4em] uppercase glow-text ${isOfficialStream ? 'text-red-500' : 'text-blue-500'}`}>
                {isTuning ? 'Scanning Network...' : 'Signal Authenticated'}
              </div>

              <div className={`text-6xl md:text-8xl font-black font-mono tracking-tighter glow-text transition-all ${isTuning ? 'scale-90 opacity-40 blur-sm' : 'scale-100 opacity-100'}`}>
                {activeNetwork === NewsNetwork.ABC ? '98.5' : activeNetwork === NewsNetwork.CBS ? '102.1' : '89.7'}
                <span className="text-xl ml-1 font-light opacity-50">MHz</span>
              </div>

              <div className="flex items-end gap-1.5 h-16 my-10">
                 {[...Array(16)].map((_, i) => (
                   <div 
                    key={i} 
                    className={`w-1 rounded-full transition-all duration-200 ${isOfficialStream ? 'bg-red-500' : 'bg-blue-500'}`}
                    style={{ height: isTuning ? '4px' : `${10 + Math.random() * 90}%` }}
                   />
                 ))}
              </div>

              <div className="w-full max-w-sm bg-white/5 backdrop-blur-xl rounded-2xl p-5 border border-white/10">
                 <div className="flex justify-between items-center mb-3">
                    <span className="text-[8px] font-black uppercase text-slate-500 tracking-widest">Digital Relay</span>
                    <div className="flex gap-0.5">
                       {[...Array(4)].map((_, i) => <div key={i} className={`w-3 h-1 rounded-full ${i < 3 ? (isOfficialStream ? 'bg-red-500' : 'bg-blue-500') : 'bg-slate-800'}`}></div>)}
                    </div>
                 </div>
                 <p className="text-sm text-slate-200 font-medium italic min-h-[40px] leading-relaxed">
                   {isTuning ? "Locking on satellite feed..." : (liveTranscription || `Live from ${activeNetwork}. Digital audio relay active.`)}
                 </p>
              </div>

              {isOfficialStream && !isTuning && (
                <button 
                  onClick={() => startAILive(activeNetwork!)}
                  className="mt-6 text-[10px] font-bold text-slate-500 hover:text-white uppercase tracking-widest border-b border-slate-800 pb-1"
                >
                  Signal weak? Try AI Enhancement
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center py-10">
              <div className="w-20 h-20 bg-slate-800 rounded-[2rem] flex items-center justify-center mb-6">
                 <svg className="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              </div>
              <h2 className="text-3xl font-black mb-3 serif">全球回响电台</h2>
              <p className="text-slate-500 text-sm max-w-xs leading-relaxed">连接顶级英语新闻源。无需视频，专注纯净的听力环境。</p>
            </div>
          )}
        </section>

        {/* On-Demand Archive */}
        <section className="bottom-safe">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold serif">要闻点播</h2>
            {!isLiveMode && (
              <select 
                value={selectedVoice} 
                onChange={(e) => setSelectedVoice(e.target.value as VoiceName)} 
                className="bg-slate-900 border-none rounded-lg px-2 py-1 text-[10px] font-black text-slate-500 uppercase outline-none"
              >
                {Object.values(VoiceName).map(v => <option key={v} value={v}>{v.split(' ')[0]}</option>)}
              </select>
            )}
          </div>
          <CategoryFilter activeCategory={activeCategory} onCategoryChange={setActiveCategory} />

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
              {[1, 2].map(i => <div key={i} className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl h-48 animate-pulse"></div>)}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
              {news.map((item) => <NewsCard key={item.id} news={item} isPlaying={currentNewsId === item.id} onPlay={() => playNewsItem(item)} />)}
            </div>
          )}
        </section>
      </main>

      {/* iPhone Persistent Control Bar */}
      {isSpeaking && !isOfficialStream && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-black/80 backdrop-blur-3xl border-t border-white/5 z-[100] animate-slide-up bottom-safe">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center animate-pulse ${isAutoCruise ? 'bg-indigo-600' : 'bg-blue-600'}`}>
                 <div className="w-1 h-4 bg-white rounded-full"></div>
              </div>
              <div className="max-w-[120px] overflow-hidden">
                <p className="text-[8px] font-black text-blue-500 uppercase tracking-widest mb-0.5">{isAutoCruise ? 'Auto-Cruise' : 'AI Stream'}</p>
                <p className="text-xs font-bold text-white truncate">{isLiveMode ? activeNetwork : news.find(n => n.id === currentNewsId)?.title}</p>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <AudioVisualizer />
              <button onClick={stopAllAudio} className="w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center transition-all active:scale-90">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
