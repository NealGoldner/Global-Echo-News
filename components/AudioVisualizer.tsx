
import React from 'react';

const AudioVisualizer: React.FC = () => {
  return (
    <div className="flex items-end gap-1 h-8">
      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <div
          key={i}
          className="w-1.5 bg-blue-500 rounded-t-sm animate-pulse"
          style={{
            height: `${Math.random() * 100}%`,
            animationDelay: `${i * 0.1}s`,
            animationDuration: `${0.5 + Math.random()}s`
          }}
        />
      ))}
    </div>
  );
};

export default AudioVisualizer;
