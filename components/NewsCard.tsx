
import React from 'react';
import { NewsItem } from '../types';

interface NewsCardProps {
  news: NewsItem;
  isPlaying: boolean;
  onPlay: () => void;
}

const NewsCard: React.FC<NewsCardProps> = ({ news, isPlaying, onPlay }) => {
  return (
    <div className={`p-6 rounded-2xl transition-all duration-300 border ${
      isPlaying 
        ? 'bg-slate-800 border-blue-500 ring-1 ring-blue-500/50 shadow-xl shadow-blue-500/10' 
        : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
    }`}>
      <div className="flex justify-between items-start mb-4">
        <span className="px-2 py-1 bg-slate-800 text-slate-400 text-[10px] font-bold uppercase tracking-widest rounded">
          {news.category}
        </span>
        <span className="text-slate-500 text-xs">{news.timestamp}</span>
      </div>
      
      <h3 className="text-xl font-semibold mb-3 leading-tight group-hover:text-blue-400 transition-colors">
        {news.title}
      </h3>
      
      <p className="text-slate-400 text-sm leading-relaxed mb-6 line-clamp-3">
        {news.summary}
      </p>

      <div className="flex items-center justify-between mt-auto">
        <button
          onClick={onPlay}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 ${
            isPlaying
              ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
              : 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-600/20'
          }`}
        >
          {isPlaying ? (
            <>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              停止播放
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              立即收听
            </>
          )}
        </button>

        {news.sources.length > 0 && (
          <div className="flex -space-x-2">
            {news.sources.slice(0, 3).map((source, i) => (
              <a
                key={i}
                href={source.uri}
                target="_blank"
                rel="noopener noreferrer"
                title={source.title}
                className="w-8 h-8 rounded-full bg-slate-800 border-2 border-slate-900 flex items-center justify-center hover:z-10 hover:border-blue-500 transition-all"
              >
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default NewsCard;
