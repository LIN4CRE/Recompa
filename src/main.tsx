import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing from index.html');

// The boundary sits outside StrictMode so it survives a full tree failure and
// can offer recovery instead of a blank page.
createRoot(container).render(
  <ErrorBoundary>
    <StrictMode>
      <App />
    </StrictMode>
  </ErrorBoundary>,
);
