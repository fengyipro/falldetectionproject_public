import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";

// Global error handler for debugging white screen issues
window.addEventListener('error', (e) => {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<pre style="padding:16px;color:red;font-size:12px;white-space:pre-wrap;word-break:break-all">JS Error: ${e.message}\n${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack || ''}</pre>`;
  }
});
window.addEventListener('unhandledrejection', (e) => {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<pre style="padding:16px;color:red;font-size:12px;white-space:pre-wrap;word-break:break-all">Promise Rejection: ${e.reason}\n${e.reason?.stack || ''}</pre>`;
  }
});

createRoot(document.getElementById("root")!).render(
  <AppWrapper>
    <App />
  </AppWrapper>
);
