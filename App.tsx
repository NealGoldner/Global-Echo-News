
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header.tsx';
import CategoryFilter from './components/CategoryFilter.tsx';
import NewsCard from './components/NewsCard.tsx';
import AudioVisualizer from './components/AudioVisualizer.tsx';
import { NewsCategory, NewsItem, VoiceName, NewsNetwork, NetworkStreamMap, NetworkAudioMap } from './types.ts';
import { fetchLatestNews, generateSpeech, connectLiveNews, testConnection, getApiKeyStatus } from './services/geminiService.ts';
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
  
  // 诊断状态
  const [diagResult, setDiagResult] = useState<{status: 'idle' | 'checking' | 'success' | 'error', msg: string}>({status: 'idle', msg: ''});

  const audioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamAudioRef = useRef<HTMLAudioElement | null>(null);
  const autoSwitchTimeoutRef = useRef<number | null>(0);

  // 执行网络检查
  const runDiagnostic = async () => {
    setDiagResult({status: 'checking', msg: '正在测试 Google API 连接...'});
    const result = await testConnection();
    if (result.success) {
      setDiagResult({status: 'success', msg: '网络通畅，API 正常'});
    } else {
      setDiagResult({status: 'error', msg: result.message});
    }
  };

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
      autoSwitchTimeoutRef.current = 0;
    }
    activeSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
    activeSourcesRef.current.clear();
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
        if (isOfficialStream) playOfficialStream(activeNetwork);
        else startAILive(activeNetwork);
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
        setStatusMessage('播放失败');
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
    setTimeout(() => setIsTuning(false), 800);
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
              text: `SYSTEM: Start news broadcast for ${network} in English.`
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
            autoSwitchTimeoutRef.current = window.setTimeout(() => handleNextNetwork(), 6000);
          }
        },
        onerror: (e: any) => {
          console.error("Live Error:", e);
          setStatusMessage('信号衰减');
          if (isAutoSwitch) handleNextNetwork();
          else stopAllAudio();
        },
        onclose: () => {}
      };
      const sessionPromise = connectLiveNews(callbacks, network);
      liveSessionRef.current = await sessionPromise;
    } catch (error: any) { 
      setStatusMessage(error.message || '连接失败');
      if (isAutoSwitch) handleNextNetwork();
      else stopAllAudio(); 
    }
  }, [isAutoSwitch, handleNextNetwork, stopAllAudio]);

  const loadNews = useCallback(async (category: NewsCategory) => {
    setIsLoading(true);
    try {
      const data = await fetchLatestNews(category);
      setNews(data);
    } catch (error: any) { 
      console.error(error);
      setDiagResult({status: 'error', msg: `加载新闻失败: ${error.message}`});
    } finally { setIsLoading(false); }
  }, []);

  useEffect(() => { loadNews(activeCategory); }, [activeCategory, loadNews]);

  const playNewsItem = async (item: NewsItem) => {
    stopAllAudio();
    const ctx = await initAudio();
    setCurrentNewsId(item.id);
    setIsSpeaking(true);
    setStatusMessage(`正在解码快讯...`);
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
    } catch (e: any) { 
        setIsSpeaking(false); 
        setStatusMessage(`播放失败: ${e.message}`);
    }
  };

  const isAudioOnlySource = activeNetwork && NetworkAudioMap[activeNetwork];

  return (
    <div className="min-h-screen flex flex-col selection:bg-blue-500/30">
      <Header 
        isLive={isLiveMode} 
        isOfficial={isOfficialStream} 
        onToggleLive={() => isLiveMode ? stopAllAudio() : selectNetwork(NewsNetwork.SKY)} 
      />

      {/* 诊断栏 - 仅在报错或检查时显示 */}
      {diagResult.status !== 'idle' && (
        <div className={`px-6 py-2 text-[10px] font-bold flex items-center justify-between gap-4 transition-all ${
            diagResult.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 
            diagResult.status === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
        }`}>
            <span className="flex-1 truncate uppercase tracking-widest">
                [诊断] {diagResult.msg}
            </span>
            <button onClick={() => setDiagResult({status: 'idle', msg: ''})} className="underline opacity-50 hover:opacity-100">关闭</button>
        </div>
      )}

      <audio ref={silentAudioRef} loop playsInline src="data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==" />
      <audio ref={streamAudioRef} crossOrigin="anonymous" playsInline />

      <main className="flex-grow max-w-7xl mx-auto w-full px-4 md:px-8 py-6">
        <section className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
               <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">频率选择</h3>
               <button onClick={runDiagnostic} className="text-[10px] text-blue-500 border border-blue-500/30 px-2 py-0.5 rounded hover:bg-blue-500/10">点击测试网络</button>
            </div>
            <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1">
              <button 
                onClick={() => { setIsOfficialStream(false); if(activeNetwork) selectNetwork(activeNetwork); }}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all ${(!isOfficialStream) ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500'}`}
              >AI 播报 (国内推荐)</button>
              <button 
                onClick={() => { setIsOfficialStream(true); if(activeNetwork) selectNetwork(activeNetwork); }}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all ${isOfficialStream ? 'bg-red-600 text-white shadow-lg' : 'text-slate-500'}`}
              >官方源 (海外节点)</button>
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
                {/* 信号红点标识 */}
                {NetworkAudioMap[net] && (
                  <div className="absolute top-2 right-2 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </div>
                )}

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
            <div className="relative z-20 text-center px-6 w-full max-w-2xl">
              {needsInteraction ? (
                <div className="flex flex-col items-center gap-10">
                  <button onClick={handleSyncAudio} className="group relative w-44 h-44 flex items-center justify-center transition-all active:scale-90">
                      <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-20"></div>
                      <div className={`w-28 h-28 rounded-full flex items-center justify-center shadow-2xl transition-colors ${isOfficialStream ? 'bg-red-600' : 'bg-blue-600'}`}>
                          <svg className="w-12 h-12 fill-current ml-1 text-white" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      </div>
                  </button>
                  <div>
                      <h4 className="text-3xl font-black text-white tracking-[0.4em] uppercase mb-4">连接频道</h4>
                      <p className="text-slate-400 text-sm max-w-md mx-auto leading-relaxed">
                          提示：带有红点的频道拥有直接音频流，收听更稳定。若开启 VPN 仍无法连接，请在 VPN 设置中确认已代理 <b>generativelanguage.googleapis.com</b> 域名。
                      </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className={`text-9xl sm:text-[14rem] font-black font-mono tracking-tighter transition-all duration-700 select-none ${isTuning ? 'blur-3xl opacity-20' : 'blur-0 opacity-100'}`}>
                    {activeNetwork ? (activeNetwork.length * 5.5 + 87.5).toFixed(1) : '00.0'}
                    <span className="text-2xl ml-2 opacity-20 font-light">MHz</span>
                  </div>
                  <div className="flex flex-col items-center gap-4 mt-12">
                      <p className="text-white font-black text-3xl uppercase tracking-[0.6em]">
                        {activeNetwork}
                      </p>
                      <div className="flex items-center gap-6 text-slate-500 text-xs font-mono mt-4">
                          <span>{isOfficialStream ? 'REMOTE STREAM' : 'AI SYNTHESIZED'}</span>
                          <span className="text-blue-500 animate-pulse">{statusMessage}</span>
                      </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center p-12 text-center max-w-sm">
              <div className="w-24 h-24 bg-slate-800 rounded-[2.5rem] flex items-center justify-center mb-10 border border-slate-700">
                 <svg className="w-12 h-12 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              </div>
              <h2 className="text-4xl font-black mb-6 serif">AI 英语电台</h2>
              <p className="text-slate-400 text-lg leading-relaxed font-light">
                带有 <span className="text-red-500 font-bold">红点</span> 的频道拥有直接音频信号。
              </p>
              <div className="mt-8 flex gap-2">
                <div className={`px-3 py-1 rounded text-[10px] font-bold ${getApiKeyStatus() === 'present' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                    API KEY: {getApiKeyStatus() === 'present' ? '已配置' : '未检测到'}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="mt-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <h2 className="text-3xl font-black serif">快讯存档</h2>
            <CategoryFilter activeCategory={activeCategory} onCategoryChange={setActiveCategory} />
          </div>
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => <div key={i} className="bg-slate-900/40 h-64 rounded-3xl animate-pulse"></div>)}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {news.map((item) => <NewsCard key={item.id} news={item} isPlaying={currentNewsId === item.id} onPlay={() => playNewsItem(item)} />)}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default App;
