import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function openAiTranscriptionPlugin(apiKey) {
  return {
    name: "openai-audio-transcription",
    configureServer(server) {
      server.middlewares.use("/api/transcribe", async (req, res) => {
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        };
        if (req.method !== "POST") return send(405, { error: "Method not allowed" });
        if (!apiKey) return send(503, { error: "Не задан OPENAI_API_KEY в файле .env." });
        try {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 20 * 1024 * 1024) return send(413, { error: "Аудиофайл слишком большой (максимум 20 МБ)." });
            chunks.push(chunk);
          }
          if (!size) return send(400, { error: "Аудиозапись пустая." });
          const type = String(req.headers["content-type"] || "audio/webm").split(";")[0];
          const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg"
            : type.includes("wav") ? "wav" : type.includes("mpeg") ? "mp3" : "webm";
          const form = new FormData();
          form.append("file", new Blob([Buffer.concat(chunks)], { type }), `recording.${ext}`);
          form.append("model", "gpt-4o-mini-transcribe");
          form.append("language", "en");
          const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
          });
          const data = await upstream.json();
          if (!upstream.ok) {
            console.error("OpenAI transcription error:", data);
            return send(upstream.status, { error: data.error?.message || "OpenAI не смог распознать аудио." });
          }
          return send(200, { text: data.text || "" });
        } catch (error) {
          console.error("Transcription request failed:", error);
          return send(500, { error: "Не удалось связаться с сервисом распознавания." });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), openAiTranscriptionPlugin(env.OPENAI_API_KEY)],
    server: { port: 5173, strictPort: true },
  };
});
