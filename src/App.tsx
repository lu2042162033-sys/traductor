import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AudioCapture } from "./audio/audio-capture";
import {
  downloadExport,
  formatClock,
  formatSessionTime,
  type ExportFormat,
} from "./export/exporters";
import {
  deleteSession,
  getSession,
  listSegments,
  listSessions,
  saveSegment,
  saveSession,
} from "./storage/database";
import {
  interpretSegment,
  TranslationRequestError,
  translateText,
} from "./translation/client";
import { TaskQueue } from "./translation/task-queue";
import {
  LANGUAGE_LABELS,
  type AudioSource,
  type CapturedSegment,
  type SegmentStatus,
  type TargetLanguage,
  type TranslationContextItem,
  type TranslationSegment,
  type TranslationSession,
} from "./types";

type RecordingState = "idle" | "starting" | "recording" | "stopping";

interface Notice {
  kind: "info" | "error";
  message: string;
}

const ACTIVE_SESSION_KEY = "traductor.active-session";
const TARGET_LANGUAGE_KEY = "traductor.target-language";
const AUDIO_SOURCE_KEY = "traductor.audio-source";

function defaultTargetLanguage(): TargetLanguage {
  return navigator.language.toLowerCase().startsWith("zh") ? "en" : "zh";
}

function readTargetLanguage(): TargetLanguage {
  const stored = localStorage.getItem(TARGET_LANGUAGE_KEY);
  return stored === "zh" || stored === "en" || stored === "es"
    ? stored
    : defaultTargetLanguage();
}

function readAudioSource(): AudioSource {
  return localStorage.getItem(AUDIO_SOURCE_KEY) === "tab"
    ? "tab"
    : "microphone";
}

function makeTitle(timestamp = Date.now()): string {
  return `翻译记录 ${formatSessionTime(timestamp)}`;
}

function makeSession(
  sourceMode: AudioSource,
  targetLanguage: TargetLanguage,
): TranslationSession {
  const startedAt = Date.now();
  return {
    id: crypto.randomUUID(),
    title: makeTitle(startedAt),
    startedAt,
    sourceMode,
    targetLanguage,
  };
}

function makeSegment(
  sessionId: string,
  sequence: number,
  captured: CapturedSegment,
): TranslationSegment {
  return {
    id: crypto.randomUUID(),
    sessionId,
    sequence,
    startedAtMs: captured.startedAtMs,
    endedAtMs: captured.endedAtMs,
    sourceText: "",
    translatedText: "",
    status: "transcribing",
  };
}

function statusLabel(status: SegmentStatus): string {
  switch (status) {
    case "pending":
      return "等待处理";
    case "transcribing":
      return "识别中";
    case "translating":
      return "翻译中";
    case "done":
      return "已完成";
    case "error":
      return "处理失败";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof TranslationRequestError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "未知错误";
}

export function App() {
  const [targetLanguage, setTargetLanguage] =
    useState<TargetLanguage>(readTargetLanguage);
  const [audioSource, setAudioSource] =
    useState<AudioSource>(readAudioSource);
  const [recordingState, setRecordingState] =
    useState<RecordingState>("idle");
  const [session, setSession] = useState<TranslationSession>();
  const [segments, setSegments] = useState<TranslationSegment[]>([]);
  const [sessions, setSessions] = useState<TranslationSession[]>([]);
  const [notice, setNotice] = useState<Notice>();
  const [queueState, setQueueState] = useState({
    active: 0,
    pending: 0,
  });
  const [isRestored, setIsRestored] = useState(false);

  const sessionRef = useRef<TranslationSession | undefined>(undefined);
  const segmentsRef = useRef<TranslationSegment[]>([]);
  const recordingStateRef = useRef<RecordingState>("idle");
  const audioCaptureRef = useRef<AudioCapture | undefined>(undefined);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const subtitlePanelRef = useRef<HTMLElement>(null);
  const nextSequenceRef = useRef(1);

  const queue = useMemo(
    () => new TaskQueue(2, setQueueState),
    [],
  );

  const commitSegments = useCallback(
    (next: TranslationSegment[]) => {
      const sorted = [...next].sort(
        (left, right) => left.sequence - right.sequence,
      );
      segmentsRef.current = sorted;
      setSegments(sorted);
    },
    [],
  );

  const upsertSegment = useCallback(
    (segment: TranslationSegment, persist = true) => {
      const existingIndex = segmentsRef.current.findIndex(
        (item) => item.id === segment.id,
      );
      const next = [...segmentsRef.current];
      if (existingIndex >= 0) {
        next[existingIndex] = segment;
      } else {
        next.push(segment);
      }
      commitSegments(next);
      if (persist) {
        void saveSegment(segment);
      }
    },
    [commitSegments],
  );

  const refreshSessions = useCallback(async () => {
    setSessions(await listSessions());
  }, []);

  const activateSession = useCallback(
    async (nextSession: TranslationSession) => {
      const storedSegments = await listSegments(nextSession.id);
      sessionRef.current = nextSession;
      setSession(nextSession);
      commitSegments(storedSegments);
      nextSequenceRef.current =
        Math.max(0, ...storedSegments.map((item) => item.sequence)) + 1;
      localStorage.setItem(ACTIVE_SESSION_KEY, nextSession.id);
      setIsRestored(true);
    },
    [commitSegments],
  );

  useEffect(() => {
    void (async () => {
      try {
        const availableSessions = await listSessions();
        setSessions(availableSessions);
        const activeId = localStorage.getItem(ACTIVE_SESSION_KEY);
        const active = activeId ? await getSession(activeId) : undefined;
        const latest = active ?? availableSessions[0];
        if (latest) {
          await activateSession(latest);
        }
      } catch (error) {
        setNotice({
          kind: "error",
          message: `无法读取本地记录：${errorMessage(error)}`,
        });
      }
    })();
  }, [activateSession]);

  useEffect(() => {
    if (segments.length === 0) {
      return;
    }
    transcriptEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [segments]);

  useEffect(() => {
    return () => {
      void audioCaptureRef.current?.stop();
    };
  }, []);

  const stopRecording = useCallback(async () => {
    if (recordingStateRef.current !== "recording") {
      return;
    }
    recordingStateRef.current = "stopping";
    setRecordingState("stopping");
    try {
      await audioCaptureRef.current?.stop();
    } finally {
      const endedAt = Date.now();
      const current = sessionRef.current;
      if (current) {
        const updated = { ...current, endedAt };
        sessionRef.current = updated;
        setSession(updated);
        await saveSession(updated);
        await refreshSessions();
      }
      recordingStateRef.current = "idle";
      setRecordingState("idle");
      setNotice({
        kind: "info",
        message: "录音已停止，剩余翻译任务会继续完成并保存。",
      });
    }
  }, [refreshSessions]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (recordingStateRef.current === "recording") {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const contextSnapshot = useCallback((): TranslationContextItem[] => {
    return segmentsRef.current
      .filter(
        (item) =>
          item.status === "done" &&
          item.sourceText &&
          item.translatedText,
      )
      .slice(-2)
      .map((item) => ({
        sourceText: item.sourceText,
        translatedText: item.translatedText,
      }));
  }, []);

  const translateCapturedSegment = useCallback(
    (
      activeSession: TranslationSession,
      captured: CapturedSegment,
    ) => {
      const segment = makeSegment(
        activeSession.id,
        nextSequenceRef.current,
        captured,
      );
      nextSequenceRef.current += 1;
      upsertSegment(segment);

      const context = contextSnapshot();
      void queue
        .enqueue(async () => {
          let translatedText = "";
          try {
            await interpretSegment({
              audio: captured.blob,
              targetLanguage: activeSession.targetLanguage,
              context,
              onSource: (text) => {
                const current =
                  segmentsRef.current.find(
                    (item) => item.id === segment.id,
                  ) ?? segment;
                const updated: TranslationSegment = {
                  ...current,
                  sourceText: text,
                  status: "translating",
                };
                upsertSegment(updated);
              },
              onTranslation: (delta) => {
                translatedText += delta;
                const current =
                  segmentsRef.current.find(
                    (item) => item.id === segment.id,
                  ) ?? segment;
                upsertSegment(
                  {
                    ...current,
                    translatedText,
                    status: "translating",
                  },
                  false,
                );
              },
              onLatency: (latencyMs) => {
                const current =
                  segmentsRef.current.find(
                    (item) => item.id === segment.id,
                  ) ?? segment;
                upsertSegment(
                  {
                    ...current,
                    translatedText,
                    latencyMs,
                    status: "done",
                    errorMessage: undefined,
                  },
                );
              },
            });
          } catch (error) {
            const current =
              segmentsRef.current.find((item) => item.id === segment.id) ??
              segment;
            upsertSegment({
              ...current,
              translatedText,
              status: "error",
              errorMessage: errorMessage(error),
            });
          }
        })
        .catch(() => {
          // Individual failures are reflected on the segment itself.
        });
    },
    [contextSnapshot, queue, upsertSegment],
  );

  const startRecording = useCallback(async () => {
    if (recordingStateRef.current !== "idle") {
      return;
    }
    if (!navigator.mediaDevices) {
      setNotice({
        kind: "error",
        message: "当前浏览器不支持媒体捕获，请使用最新版 Chrome 或 Edge",
      });
      return;
    }

    recordingStateRef.current = "starting";
    setRecordingState("starting");
    setNotice(undefined);
    const nextSession = makeSession(audioSource, targetLanguage);
    sessionRef.current = nextSession;
    setSession(nextSession);
    setIsRestored(false);
    commitSegments([]);
    nextSequenceRef.current = 1;
    localStorage.setItem(ACTIVE_SESSION_KEY, nextSession.id);
    localStorage.setItem(TARGET_LANGUAGE_KEY, targetLanguage);
    localStorage.setItem(AUDIO_SOURCE_KEY, audioSource);

    try {
      await saveSession(nextSession);
      await refreshSessions();
      const capture = new AudioCapture(
        (captured) =>
          translateCapturedSegment(nextSession, captured),
        () => {
          void stopRecording();
        },
        (message) => setNotice({ kind: "error", message }),
      );
      audioCaptureRef.current = capture;
      await capture.start(audioSource);
      recordingStateRef.current = "recording";
      setRecordingState("recording");
    } catch (error) {
      recordingStateRef.current = "idle";
      setRecordingState("idle");
      setNotice({ kind: "error", message: errorMessage(error) });
      await audioCaptureRef.current?.stop();
    }
  }, [
    audioSource,
    commitSegments,
    refreshSessions,
    stopRecording,
    targetLanguage,
    translateCapturedSegment,
  ]);

  const chooseSession = useCallback(
    async (sessionId: string) => {
      if (recordingStateRef.current !== "idle") {
        return;
      }
      const selected = sessions.find((item) => item.id === sessionId);
      if (selected) {
        await activateSession(selected);
        setNotice(undefined);
      }
    },
    [activateSession, sessions],
  );

  const removeCurrentSession = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || recordingStateRef.current !== "idle") {
      return;
    }
    if (!window.confirm(`确定删除“${current.title}”及其全部翻译内容？`)) {
      return;
    }

    await deleteSession(current.id);
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    const remaining = await listSessions();
    setSessions(remaining);
    sessionRef.current = undefined;
    setSession(undefined);
    commitSegments([]);
    nextSequenceRef.current = 1;
    if (remaining[0]) {
      await activateSession(remaining[0]);
    }
    setNotice({ kind: "info", message: "记录已删除。" });
  }, [activateSession, commitSegments]);

  const retryTranslation = useCallback(
    (segment: TranslationSegment) => {
      if (!segment.sourceText.trim()) {
        setNotice({
          kind: "error",
          message: "该段没有识别文本，只能重新录制该段语音。",
        });
        return;
      }
      const activeSession = sessionRef.current;
      if (!activeSession) {
        return;
      }

      let translatedText = "";
      const translating: TranslationSegment = {
        ...segment,
        translatedText: "",
        status: "translating",
        errorMessage: undefined,
      };
      upsertSegment(translating);
      const context = segmentsRef.current
        .filter(
          (item) =>
            item.id !== segment.id &&
            item.status === "done" &&
            item.translatedText,
        )
        .slice(-2)
        .map((item) => ({
          sourceText: item.sourceText,
          translatedText: item.translatedText,
        }));

      void queue.enqueue(async () => {
        try {
          await translateText({
            text: segment.sourceText,
            targetLanguage: activeSession.targetLanguage,
            context,
            onTranslation: (delta) => {
              translatedText += delta;
              const current =
                segmentsRef.current.find(
                  (item) => item.id === segment.id,
                ) ?? translating;
              upsertSegment(
                {
                  ...current,
                  translatedText,
                },
                false,
              );
            },
            onLatency: (latencyMs) => {
              const current =
                segmentsRef.current.find(
                  (item) => item.id === segment.id,
                ) ?? translating;
              upsertSegment(
                {
                  ...current,
                  translatedText,
                  latencyMs,
                  status: "done",
                },
              );
            },
          });
        } catch (error) {
          upsertSegment({
            ...translating,
            translatedText,
            status: "error",
            errorMessage: errorMessage(error),
          });
        }
      });
    },
    [queue, upsertSegment],
  );

  const exportCurrent = useCallback(
    (format: ExportFormat) => {
      const current = sessionRef.current;
      if (!current) {
        return;
      }
      downloadExport(format, current, segmentsRef.current);
    },
    [],
  );

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await subtitlePanelRef.current?.requestFullscreen();
    }
  }, []);

  const isBusy =
    recordingState === "starting" || recordingState === "stopping";
  const isRecording = recordingState === "recording";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-row">
            <span className="brand-mark">T</span>
            <h1>Traductor</h1>
          </div>
          <p className="tagline">DeepSeek 驱动的本地保存实时双语字幕</p>
        </div>
        <div className="topbar-badges">
          <span>本地自动保存</span>
          <span>Chrome / Edge</span>
        </div>
      </header>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role="status">
          <span>{notice.message}</span>
          <button
            type="button"
            className="icon-button"
            onClick={() => setNotice(undefined)}
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      )}

      <section className="control-panel" aria-label="翻译设置">
        <label>
          <span>音频来源</span>
          <select
            value={audioSource}
            onChange={(event) =>
              setAudioSource(event.target.value as AudioSource)
            }
            disabled={isRecording || isBusy}
          >
            <option value="microphone">麦克风</option>
            <option value="tab">标签页 / 系统音频</option>
          </select>
        </label>
        <label>
          <span>翻译为</span>
          <select
            value={targetLanguage}
            onChange={(event) => {
              const next = event.target.value as TargetLanguage;
              setTargetLanguage(next);
              localStorage.setItem(TARGET_LANGUAGE_KEY, next);
            }}
            disabled={isRecording || isBusy}
          >
            {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={isRecording ? "stop-button" : "start-button"}
          onClick={() =>
            isRecording ? void stopRecording() : void startRecording()
          }
          disabled={isBusy}
        >
          <span
            className={isRecording ? "recording-dot" : "microphone-icon"}
            aria-hidden="true"
          />
          {recordingState === "starting"
            ? "正在连接…"
            : recordingState === "stopping"
              ? "正在停止…"
              : isRecording
                ? "停止并保存"
                : "开始翻译"}
        </button>
        <div className="runtime-state">
          <span
            className={`state-light ${isRecording ? "live" : ""}`}
          />
          <span>
            {isRecording
              ? "正在监听"
              : recordingState === "starting"
                ? "请求音频权限"
                : "待机"}
          </span>
          <span className="queue-count">
            处理中 {queueState.active} · 排队 {queueState.pending}
          </span>
        </div>
      </section>

      <main className="workspace">
        <section
          ref={subtitlePanelRef}
          className="transcript-panel"
          aria-label="双语字幕"
        >
          <div className="panel-toolbar">
            <div>
              <p className="eyebrow">LIVE TRANSCRIPT</p>
              <h2>{session?.title ?? "实时双语字幕"}</h2>
              {session && (
                <p className="session-meta">
                  {formatSessionTime(session.startedAt)} · 目标{" "}
                  {LANGUAGE_LABELS[targetLanguage]}
                </p>
              )}
            </div>
            <div className="toolbar-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void toggleFullscreen()}
              >
                全屏字幕
              </button>
            </div>
          </div>

          <div className="transcript-list">
            {segments.length === 0 ? (
              <div className="empty-state">
                <div className="empty-orbit" />
                <h3>等待第一段语音</h3>
                <p>
                  选择音频来源后开始翻译。共享标签页时，请勾选“分享音频”。
                </p>
              </div>
            ) : (
              segments.map((segment) => (
                <article className="transcript-entry" key={segment.id}>
                  <div className="entry-meta">
                    <span>#{String(segment.sequence).padStart(3, "0")}</span>
                    <span>
                      {formatClock(segment.startedAtMs)} –{" "}
                      {formatClock(segment.endedAtMs)}
                    </span>
                    <span className={`status status-${segment.status}`}>
                      {statusLabel(segment.status)}
                    </span>
                    {segment.latencyMs !== undefined && (
                      <span>{Math.round(segment.latencyMs)} ms</span>
                    )}
                  </div>
                  <p
                    className={`source-text ${
                      !segment.sourceText ? "placeholder-text" : ""
                    }`}
                  >
                    {segment.sourceText ||
                      (segment.status === "error"
                        ? "语音识别失败"
                        : "正在识别语音…")}
                  </p>
                  <p
                    className={`translated-text ${
                      !segment.translatedText ? "placeholder-text" : ""
                    }`}
                  >
                    {segment.translatedText ||
                      (segment.status === "error"
                        ? "没有可用译文"
                        : "正在生成译文…")}
                  </p>
                  {segment.errorMessage && (
                    <div className="segment-error">
                      <span>{segment.errorMessage}</span>
                      {segment.sourceText && (
                        <button
                          type="button"
                          onClick={() => retryTranslation(segment)}
                        >
                          重试翻译
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>

          {isRestored && session && !isRecording && (
            <div className="restore-banner">
              已从本机恢复上次记录。重新开始会创建新的翻译会话。
            </div>
          )}
        </section>

        <aside className="sidebar">
          <section className="sidebar-section">
            <div className="sidebar-heading">
              <div>
                <p className="eyebrow">EXPORT</p>
                <h2>导出当前记录</h2>
              </div>
            </div>
            <div className="export-grid">
              <button
                type="button"
                onClick={() => exportCurrent("markdown")}
                disabled={!session}
              >
                Markdown
              </button>
              <button
                type="button"
                onClick={() => exportCurrent("txt")}
                disabled={!session}
              >
                TXT
              </button>
              <button
                type="button"
                onClick={() => exportCurrent("srt")}
                disabled={!session}
              >
                SRT 字幕
              </button>
              <button
                type="button"
                onClick={() => exportCurrent("json")}
                disabled={!session}
              >
                JSON
              </button>
            </div>
            <button
              type="button"
              className="danger-button"
              onClick={() => void removeCurrentSession()}
              disabled={!session || recordingState !== "idle"}
            >
              删除当前记录
            </button>
          </section>

          <section className="sidebar-section history-section">
            <div className="sidebar-heading">
              <div>
                <p className="eyebrow">HISTORY</p>
                <h2>本机记录</h2>
              </div>
              <span>{sessions.length}</span>
            </div>
            <div className="history-list">
              {sessions.length === 0 ? (
                <p className="muted-text">还没有保存的翻译记录。</p>
              ) : (
                sessions.map((item) => (
                  <button
                    type="button"
                    className={`history-item ${
                      item.id === session?.id ? "selected" : ""
                    }`}
                    key={item.id}
                    onClick={() => void chooseSession(item.id)}
                    disabled={recordingState !== "idle"}
                  >
                    <span>{item.title}</span>
                    <small>
                      {LANGUAGE_LABELS[item.targetLanguage]} ·{" "}
                      {item.sourceMode === "microphone"
                        ? "麦克风"
                        : "系统音频"}
                    </small>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="privacy-note">
            <strong>本地优先</strong>
            <p>
              翻译内容只保存在当前浏览器。音频会临时发送给 DeepSeek
              处理，不会写入本地数据库或 Worker 日志。
            </p>
          </section>
        </aside>
      </main>

      <footer>
        <span>DeepSeek ASR + deepseek-flash</span>
        <span>公开接口设有每日限额</span>
      </footer>
    </div>
  );
}
