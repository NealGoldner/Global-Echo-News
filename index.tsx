
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

// 确保在浏览器环境下 process 对象存在，防止 API 初始化报错
if (typeof (window as any).process === 'undefined') {
  (window as any).process = { env: {} };
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
