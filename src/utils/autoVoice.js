export function startAutoVoiceCapture({ onStatus, onText, onError, silenceMs = 1700 }) {
  let recorder = null;
  let stream = null;
  let audioContext = null;
  let animationFrame = null;
  let stopped = false;
  let speechStartedAt = 0;
  let lastSoundAt = 0;
  let chunks = [];

  const stop = () => {
    stopped = true;
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (audioContext && audioContext.state !== "closed") audioContext.close().catch(() => {});
  };

  const start = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error("Запись аудио не поддерживается этим браузером. Попробуй Chrome или Edge.");
      }

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (stopped) return;
        stopped = true;
        stream?.getTracks().forEach((track) => track.stop());
        onStatus?.("idle");
        onError?.("Не удалось записать звук. Попробуй ещё раз.");
      };
      recorder.onstop = async () => {
        stream?.getTracks().forEach((track) => track.stop());
        if (audioContext && audioContext.state !== "closed") audioContext.close().catch(() => {});
        if (stopped && !chunks.length) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        chunks = [];
        if (!blob.size) {
          onStatus?.("idle");
          onError?.("Не удалось услышать ответ. Попробуй ещё раз.");
          return;
        }
        onStatus?.("transcribing");
        try {
          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": blob.type },
            body: blob,
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || data.detail || "Ошибка распознавания речи.");
          if (!data.text?.trim()) throw new Error("Не удалось разобрать речь. Попробуй ещё раз.");
          onText?.(data.text.trim());
        } catch (error) {
          onError?.(error.message || "Ошибка отправки аудио на распознавание.");
        } finally {
          onStatus?.("idle");
        }
      };

      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      recorder.start();
      onStatus?.("listening");

      const startedAt = performance.now();
      const monitor = () => {
        if (stopped || !recorder || recorder.state === "inactive") return;
        analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
        const rms = Math.sqrt(energy / samples.length);
        const now = performance.now();

        if (rms > 0.015) {
          if (!speechStartedAt) speechStartedAt = now;
          lastSoundAt = now;
        } else if (speechStartedAt && now - lastSoundAt >= silenceMs) {
          stopped = true;
          recorder.stop();
          return;
        }

        if (!speechStartedAt && now - startedAt > 12000) {
          stopped = true;
          recorder.stop();
          onError?.("Не удалось услышать речь. Попробуй ещё раз.");
          return;
        }
        if (now - startedAt > 20000) {
          stopped = true;
          recorder.stop();
          return;
        }
        animationFrame = requestAnimationFrame(monitor);
      };
      animationFrame = requestAnimationFrame(monitor);
    } catch (error) {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
      onStatus?.("idle");
      onError?.(error.name === "NotAllowedError"
        ? "Разреши доступ к микрофону в браузере."
        : error.message || "Не удалось включить микрофон. Проверь подключение.");
    }
  };

  return { start, stop };
}
