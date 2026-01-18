
import React from 'react';

interface HeaderProps {
  isLive: boolean;
  isOfficial: boolean;
  onToggleLive: () => void;
}

const Header: React.FC<HeaderProps> = ({ isLive, isOfficial, onToggleLive }) => {
  return (
    <header className="pt-4 pb-4 px-6 border-b border-slate-800 bg-slate-950/90 backdrop-blur-3xl sticky top-0 z-[60]">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg">
             <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
          </div>
          <h1 className="text-lg font-black tracking-tighter serif">GLOBAL <span className="text-blue-500">ECHO</span></h1>
        </div>
        
        <div className="flex items-center gap-2">
          {isLive && (
             <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${isOfficial ? 'bg-red-500 text-white' : 'bg-blue-600 text-white'}`}>
                {isOfficial ? 'Live' : 'AI'}
             </div>
          )}
          <button 
            onClick={onToggleLive}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90 border ${
              isLive 
                ? (isOfficial ? 'bg-red-600 border-red-500' : 'bg-blue-600 border-blue-500')
                : 'bg-slate-800 border-slate-700'
            }`}
          >
            {isLive ? (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
            ) : (
              <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse"></div>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
