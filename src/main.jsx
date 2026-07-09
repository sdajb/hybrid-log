import "./storagePolyfill.js";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";


function isCapacitorRuntime() {
  return !!window.Capacitor || window.location.origin === "https://localhost";
}

async function clearStaleServiceWorkers() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (e) {
    console.warn("Service worker cleanup skipped", e);
  }
}

async function setupWebAppServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  if (isCapacitorRuntime()) {
    // Capacitor bundles the files locally. Service workers under
    // https://localhost can fail in Android/iOS WebViews, so keep native
    // builds service-worker-free.
    await clearStaleServiceWorkers();
    return;
  }

  try {
    const base = import.meta.env.BASE_URL || "/";
    await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  } catch (e) {
    console.warn("Service worker registration skipped", e);
  }
}

setupWebAppServiceWorker();

class RuntimeErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("Hybrid Log runtime error", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh",
          padding: 22,
          boxSizing: "border-box",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          background: "#FAF7F0",
          color: "#102033",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 12,
        }}>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Hybrid Log</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>앱 렌더링 오류</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "#45576B" }}>
            흰 화면 대신 오류를 표시하도록 복구 화면을 띄웠습니다. 아래 메시지를 복사해서 알려주세요.
          </div>
          <pre style={{
            whiteSpace: "pre-wrap",
            background: "rgba(16,32,51,0.08)",
            border: "1px solid rgba(16,32,51,0.12)",
            borderRadius: 12,
            padding: 12,
            fontSize: 12,
            lineHeight: 1.45,
            overflow: "auto",
            maxHeight: "45vh",
          }}>{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>
          <button onClick={() => {
            try {
              localStorage.clear();
            } catch (e) {}
            window.location.reload();
          }} style={{
            minHeight: 48,
            border: "none",
            borderRadius: 14,
            background: "#102033",
            color: "#FAF7F0",
            fontWeight: 800,
            fontSize: 14,
          }}>로컬 데이터 초기화 후 재시작</button>
        </div>
      );
    }
    return this.props.children;
  }
}


function showFatalRuntimeError(error) {
  try {
    const root = document.getElementById("root");
    if (!root) return;
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = [
      "min-height:100vh",
      "padding:22px",
      "box-sizing:border-box",
      "font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
      "background:#FAF7F0",
      "color:#102033",
      "display:flex",
      "flex-direction:column",
      "justify-content:center",
      "gap:12px",
    ].join(";");
    const msg = String(error?.stack || error?.message || error || "Unknown runtime error");
    wrap.innerHTML = `
      <div style="font-size:22px;font-weight:900">Hybrid Log</div>
      <div style="font-size:16px;font-weight:800">앱 실행 오류</div>
      <div style="font-size:13px;line-height:1.5;color:#45576B">
        흰 화면 대신 오류를 표시합니다. 아래 메시지를 복사해서 알려주세요.
      </div>
      <pre style="white-space:pre-wrap;background:rgba(16,32,51,0.08);border:1px solid rgba(16,32,51,0.12);border-radius:12px;padding:12px;font-size:12px;line-height:1.45;overflow:auto;max-height:45vh">${msg.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</pre>
      <button id="hybridlog-reset-runtime" style="min-height:48px;border:none;border-radius:14px;background:#102033;color:#FAF7F0;font-weight:800;font-size:14px">로컬 데이터 초기화 후 재시작</button>
    `;
    root.appendChild(wrap);
    const btn = document.getElementById("hybridlog-reset-runtime");
    if (btn) btn.onclick = () => {
      try { localStorage.clear(); } catch (e) {}
      window.location.reload();
    };
  } catch (e) {
    console.error("Failed to show fatal runtime error", e);
  }
}

window.addEventListener("error", (event) => {
  showFatalRuntimeError(event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  showFatalRuntimeError(event.reason || event);
});


ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RuntimeErrorBoundary>
      <App />
    </RuntimeErrorBoundary>
  </React.StrictMode>
);
