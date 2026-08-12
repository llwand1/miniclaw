import React from 'react';
import ReactDOM from 'react-dom/client';
import FloatingApp from './FloatingApp';
import { ThemeProvider } from './components/ThemeContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <FloatingApp />
    </ThemeProvider>
  </React.StrictMode>,
);
