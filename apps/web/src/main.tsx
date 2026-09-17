import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import './fonts.css';
import '@c360/ui/design-system.css';
import '@c360/ui/tokens.css';
import '@c360/ui/tokens-2026.css';
import '@c360/ui/primitives.css';
import './shell/shell.css';
import { App } from './App.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Refetching on window focus would fire a burst of requests every time
      // the user tabs back; explicit invalidation after mutations is enough.
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
    mutations: {
      // A state-changing request is never retried automatically: a silent
      // retry is how duplicate work and duplicate cost get created.
      retry: false,
    },
  },
});

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
