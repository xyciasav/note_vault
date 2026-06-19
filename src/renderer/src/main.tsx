import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/app.css';

console.log('React main.tsx loaded');

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);