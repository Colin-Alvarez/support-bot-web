import React from "react";
import SupportBotWidget from "./components/SupportBotWidget";

export default function App() {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>Support Bot — Working Beta</h1>
      <p style={{ opacity: 0.8, marginBottom: 24 }}>
        Click the 💬 button in the bottom-right to open the chat.
      </p>
      <SupportBotWidget
        // falls back to env if omitted
        functionUrl={import.meta.env.VITE_FUNCTION_URL}
        title="Need help? Ask the Support Bot"
      />
    </div>
  );
}
