import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { ChatMessage, Conversation, ModelTier, Persona, ThemeId } from "@chatpro/shared";
import "./App.css";

type UserProfile = {
  token: string | null;
  userId: string | null;
  username: string | null;
  region: string;
  modelQuota: { enhanced: number; pro: number };
};

type ColorMode = "light" | "dark";

type SystemError = {
  id: string;
  text: string;
  retryContent?: string;
};

type ReplyMeta = {
  id: string;
  role: "user" | "assistant";
  excerpt: string;
};

const THEME_KEY = "chatpro-theme";
const CONVERSATIONS_KEY = "chatpro-conversations";
const PROFILE_KEY = "chatpro-profile";
const COLOR_MODE_KEY = "chatpro-color-mode";

const builtInPersonas: Persona[] = [
  {
    id: "miku",
    name: "初音未来",
    type: "scenario",
    prompt: "你是初音未来，语气清新，鼓励与陪伴。"
  },
  {
    id: "architect",
    name: "程序架构师",
    type: "professional",
    prompt: "你是资深架构师，回答结构化、可执行。"
  }
];

const modelLabels: Record<ModelTier, string> = {
  normal: "普通",
  enhanced: "增强",
  pro: "专业"
};

const themeLabels: Record<ThemeId, string> = {
  chatgpt: "经典",
  soft: "柔和",
  miku: "清新"
};

const emptyProfile: UserProfile = {
  token: null,
  userId: null,
  username: null,
  region: "CN",
  modelQuota: { enhanced: 10, pro: 5 }
};

const createMessage = (role: "user" | "assistant", content: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  createdAt: new Date().toISOString()
});

const createConversation = (overrides?: Partial<Conversation>): Conversation => ({
  id: crypto.randomUUID(),
  title: "新对话",
  personaId: null,
  model: "normal",
  messages: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides
});

const readLocal = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeLocal = (key: string, value: unknown) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

const getDefaultMode = (): ColorMode => {
  if (typeof window === "undefined") return "light";
  const stored = readLocal<ColorMode | null>(COLOR_MODE_KEY, null);
  if (stored) return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
};

function App() {
  const [theme, setTheme] = useState<ThemeId | null>(() => readLocal(THEME_KEY, null));
  const [colorMode, setColorMode] = useState<ColorMode>(() => getDefaultMode());
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    readLocal(CONVERSATIONS_KEY, [
      createConversation({
        title: "欢迎使用 chatpro",
        messages: [createMessage("assistant", "你好，我是 chatpro。选择风格后就可以开始对话。")]
      })
    ])
  );
  const [activeId, setActiveId] = useState(() => conversations[0]?.id ?? "");
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>(() => readLocal(PROFILE_KEY, emptyProfile));
  const [showThemePicker, setShowThemePicker] = useState(() => !readLocal(THEME_KEY, null));
  const [showLogin, setShowLogin] = useState(false);
  const [loginToken, setLoginToken] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [personas, setPersonas] = useState<Persona[]>(builtInPersonas);
  const [showPersonaBuilder, setShowPersonaBuilder] = useState(false);
  const [personaName, setPersonaName] = useState("");
  const [personaPrompt, setPersonaPrompt] = useState("");
  const [personaRefining, setPersonaRefining] = useState(false);
  const [personaError, setPersonaError] = useState<string | null>(null);
  const [systemNote, setSystemNote] = useState<string | null>(null);
  const [systemError, setSystemError] = useState<SystemError | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [conversationQuery, setConversationQuery] = useState("");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyMeta | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"online" | "offline">(
    typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline"
  );
  const chatAreaRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeId) ?? conversations[0],
    [activeId, conversations]
  );

  const displayedConversations = useMemo(() => {
    const query = conversationQuery.trim().toLowerCase();
    const list = conversations.filter((conversation) => {
      if (!query) return true;
      return conversation.title.toLowerCase().includes(query);
    });
    return list.sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt).getTime();
      return bTime - aTime;
    });
  }, [conversations, conversationQuery]);

  const favoriteCount = useMemo(() => {
    if (!activeConversation) return 0;
    return activeConversation.messages.filter((msg) => msg.favorite).length;
  }, [activeConversation]);

  const displayedMessages = useMemo(() => {
    if (!activeConversation) return [] as ChatMessage[];
    return activeConversation.messages.filter((message) => (showFavoritesOnly ? message.favorite : true));
  }, [activeConversation, showFavoritesOnly]);


  useEffect(() => {
    const appliedTheme = theme || "chatgpt";
    writeLocal(THEME_KEY, theme);
    document.body.dataset.theme = appliedTheme;
  }, [theme]);

  useEffect(() => {
    writeLocal(COLOR_MODE_KEY, colorMode);
    document.body.dataset.mode = colorMode;
  }, [colorMode]);

  useEffect(() => {
    writeLocal(CONVERSATIONS_KEY, conversations);
  }, [conversations]);

  useEffect(() => {
    const openDb = () =>
      new Promise<IDBDatabase | null>((resolve) => {
        if (!window.indexedDB) return resolve(null);
        const request = window.indexedDB.open("chatpro-db", 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("conversations");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });

    const load = async () => {
      const db = await openDb();
      if (!db) return;
      const tx = db.transaction("conversations", "readonly");
      const store = tx.objectStore("conversations");
      const request = store.get("all");
      request.onsuccess = () => {
        const data = request.result as Conversation[] | undefined;
        if (data?.length) setConversations(data);
      };
    };
    load();
  }, []);

  useEffect(() => {
    const openDb = () =>
      new Promise<IDBDatabase | null>((resolve) => {
        if (!window.indexedDB) return resolve(null);
        const request = window.indexedDB.open("chatpro-db", 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("conversations");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });

    const save = async () => {
      const db = await openDb();
      if (!db) return;
      const tx = db.transaction("conversations", "readwrite");
      const store = tx.objectStore("conversations");
      store.put(conversations, "all");
    };
    save();
  }, [conversations]);

  useEffect(() => {
    writeLocal(PROFILE_KEY, profile);
  }, [profile]);

  useEffect(() => {
    const handleOnline = () => setConnectionStatus("online");
    const handleOffline = () => setConnectionStatus("offline");
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

  useEffect(() => {
    if (!profile.token) return;
    fetch("/api/auth/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: profile.token })
    })
      .then((response) => response.json())
      .then((json) => {
        if (json.code !== 0) return;
        setProfile((prev) => ({
          ...prev,
          userId: json.data?.userId ?? prev.userId,
          username: json.data?.username ?? prev.username,
          region: json.data?.region ?? prev.region,
          modelQuota: json.data?.modelQuota ?? prev.modelQuota
        }));
      })
      .catch(() => null);
  }, [profile.token]);

  useEffect(() => {
    if (!activeConversation) return;
    setActiveId(activeConversation.id);
  }, [activeConversation]);

  useEffect(() => {
    const loadPersonas = async () => {
      try {
        const response = await fetch("/api/personas");
        const json = await response.json();
        if (json?.data?.length) {
          setPersonas((prev) => {
            const merged = [...json.data, ...prev];
            const seen = new Set<string>();
            return merged.filter((item: Persona) => {
              if (seen.has(item.id)) return false;
              seen.add(item.id);
              return true;
            });
          });
        }
      } catch {
        setSystemNote("无法加载人设列表，已使用本地默认。未影响继续使用。");
      }
    };
    loadPersonas();
  }, []);

  useEffect(() => {
    const updateViewport = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      const offset = Math.max(window.innerHeight - height, 0);
      document.documentElement.style.setProperty("--keyboard-offset", `${offset}px`);
    };
    updateViewport();
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    return () => {
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  useEffect(() => {
    const resizeTextarea = () => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      const nextHeight = Math.min(el.scrollHeight, 200);
      el.style.height = `${nextHeight}px`;
      el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
    };
    resizeTextarea();
  }, [inputValue]);

  useEffect(() => {
    const syncComposerHeight = () => {
      const height = composerRef.current?.offsetHeight ?? 160;
      document.documentElement.style.setProperty("--composer-height", `${height}px`);
    };
    syncComposerHeight();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncComposerHeight) : null;
    if (composerRef.current && observer) observer.observe(composerRef.current);
    window.addEventListener("resize", syncComposerHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncComposerHeight);
    };
  }, []);

  const handleNewConversation = () => {
    const nextConversation = createConversation();
    setConversations((prev) => [nextConversation, ...prev]);
    setActiveId(nextConversation.id);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleClearConversation = () => {
    if (!activeConversation) return;
    if (!window.confirm("确认清空当前会话内容？")) return;
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversation.id
          ? { ...conversation, messages: [], updatedAt: new Date().toISOString() }
          : conversation
      )
    );
  };

  const handleDeleteConversation = (conversationId: string) => {
    if (!window.confirm("确认删除该会话？")) return;
    setConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId));
    if (conversationId === activeId) {
      const next = conversations.find((item) => item.id !== conversationId);
      if (next) setActiveId(next.id);
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    requestAnimationFrame(() => {
      if (chatAreaRef.current) {
        chatAreaRef.current.scrollTo({
          top: chatAreaRef.current.scrollHeight,
          behavior
        });
      }
      chatEndRef.current?.scrollIntoView({ behavior, block: "end" });
    });
  };

  useEffect(() => {
    if (!autoScroll) return;
    scrollToBottom(isTyping ? "auto" : "smooth");
  }, [activeConversation?.messages.length, isTyping, autoScroll]);

  useEffect(() => {
    setAutoScroll(true);
    scrollToBottom("auto");
  }, [activeConversation?.id]);

  const handleSend = async (overrideContent?: string) => {
    const trimmed = (overrideContent ?? inputValue).trim();
    if (!trimmed || !activeConversation || isTyping) return;
    const messageContent = trimmed;
    setInputValue("");
    setAutoScroll(true);
    setLastLatencyMs(null);
    const startedAt = Date.now();

    let nextMessages: ChatMessage[] = [];
    const baseMessages = activeConversation.messages.map((msg) => msg);
    const existingIndex = editingMessageId
      ? baseMessages.findIndex((msg) => msg.id === editingMessageId)
      : -1;
    if (existingIndex >= 0) {
      baseMessages[existingIndex] = {
        ...baseMessages[existingIndex],
        content: messageContent,
        replyTo: replyTo ?? baseMessages[existingIndex].replyTo
      };
      if (baseMessages[existingIndex + 1]?.role === "assistant") {
        baseMessages.splice(existingIndex + 1, 1);
      }
      nextMessages = baseMessages;
    } else {
      const userMessage = createMessage("user", messageContent);
      if (replyTo) userMessage.replyTo = replyTo;
      nextMessages = [...baseMessages, userMessage];
    }
    const assistantId = crypto.randomUUID();
    const pendingAssistant = createMessage("assistant", "");
    pendingAssistant.id = assistantId;

    setConversations((prev) =>
      prev.map((conversation) => {
        if (conversation.id !== activeConversation.id) return conversation;
        return {
          ...conversation,
          title: conversation.title === "新对话" ? messageContent.slice(0, 12) : conversation.title,
          updatedAt: new Date().toISOString(),
          messages: [...nextMessages, pendingAssistant]
        };
      })
    );

    setEditingMessageId(null);
    setReplyTo(null);
    setIsTyping(true);
    setSystemNote(null);
    setSystemError(null);

    const compressIfNeeded = async (messages: ChatMessage[]) => {
      if (messages.length <= 18) return messages;
      const keep = 8;
      const slicePoint = Math.max(messages.length - keep, 1);
      const toCompress = messages.slice(0, slicePoint);
      const payload = toCompress.map((message) => ({ role: message.role, content: message.content }));
      const response = await fetch("/api/chat/compress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload })
      });
      const json = await response.json();
      if (json.code !== 0) return messages;
      const summaryText = json.data?.summary || "";
      if (!summaryText) return messages;
      const summaryMessage = createMessage("assistant", `【摘要】${summaryText}`);
      return [summaryMessage, ...messages.slice(-keep)];
    };

    let effectiveMessages = nextMessages;
    try {
      effectiveMessages = await compressIfNeeded(nextMessages);
      if (effectiveMessages !== nextMessages) {
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === activeConversation.id
              ? { ...conversation, messages: [...effectiveMessages, pendingAssistant] }
              : conversation
          )
        );
      }
    } catch {
      // ignore
    }

  const payload = {
      conversationId: activeConversation.id,
      model: activeConversation.model,
      personaId: activeConversation.personaId,
      personaPrompt: activeConversation.personaId
        ? personas.find((p) => p.id === activeConversation.personaId)?.prompt || null
        : null,
      messages: effectiveMessages.map((message) => ({ role: message.role, content: message.content })),
      client: {
        device: window.innerWidth < 960 ? "mobile" : "desktop",
        ua: navigator.userAgent,
        region: profile.region
      },
      userProfile: {
        username: profile.username,
        region: profile.region
      },
      userToken: profile.token,
      stream: true
    };

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.message || "请求失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (!completed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const line = part.split("\n").find((item) => item.startsWith("data:"));
          if (!line) continue;
          const dataText = line.replace("data:", "").trim();
          if (dataText === "[DONE]") {
            completed = true;
            continue;
          }
          try {
            const data = JSON.parse(dataText);
            if (data?.delta) {
              setConversations((prev) =>
                prev.map((conversation) => {
                  if (conversation.id !== activeConversation.id) return conversation;
                  return {
                    ...conversation,
                    messages: conversation.messages.map((msg) =>
                      msg.id === assistantId ? { ...msg, content: msg.content + data.delta } : msg
                    )
                  };
                })
              );
            }
            if (data?.replace && data?.content) {
              setConversations((prev) =>
                prev.map((conversation) => {
                  if (conversation.id !== activeConversation.id) return conversation;
                  return {
                    ...conversation,
                    messages: conversation.messages.map((msg) =>
                      msg.id === assistantId ? { ...msg, content: data.content } : msg
                    )
                  };
                })
              );
            }
            if (data?.done) {
              setLastLatencyMs(Date.now() - startedAt);
              if (data.quotaLeft) {
                setProfile((prev) => ({
                  ...prev,
                  modelQuota: {
                    enhanced: data.quotaLeft.enhanced ?? prev.modelQuota.enhanced,
                    pro: data.quotaLeft.pro ?? prev.modelQuota.pro
                  }
                }));
              }
              completed = true;
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (error: any) {
      if (error?.name === "AbortError") {
        setSystemNote("已停止生成。");
      } else {
        setSystemError({
          id: crypto.randomUUID(),
          text: error.message || "服务不可用，请稍后再试。",
          retryContent: messageContent
        });
      }
    } finally {
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  };

  const handleRetry = (messageId: string) => {
    if (!activeConversation || isTyping) return;
    const index = activeConversation.messages.findIndex((msg) => msg.id === messageId);
    const previous = activeConversation.messages.slice(0, index).reverse().find((msg) => msg.role === "user");
    if (!previous) return;
    handleSend(previous.content);
  };

  const handleEdit = (messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setInputValue(content);
    textareaRef.current?.focus();
  };

  const handleFavorite = (messageId: string) => {
    if (!activeConversation) return;
    setConversations((prev) =>
      prev.map((conversation) => {
        if (conversation.id !== activeConversation.id) return conversation;
        return {
          ...conversation,
          messages: conversation.messages.map((msg) =>
            msg.id === messageId ? { ...msg, favorite: !msg.favorite } : msg
          )
        };
      })
    );
  };

  const handleReply = (message: ChatMessage) => {
    const excerpt = message.content.slice(0, 80);
    setReplyTo({ id: message.id, role: message.role, excerpt });
    textareaRef.current?.focus();
  };

  const handleFileSelect = async (file: File | null) => {
    if (!file) return;
    if (file.size > 120 * 1024) {
      setSystemNote("文件过大，请上传 120KB 内的文本文件。");
      return;
    }
    try {
      const text = await file.text();
      const snippet = text.length > 6000 ? `${text.slice(0, 6000)}\n...\n[已截断]` : text;
      const block = `\n\n[文件: ${file.name}]\n\n\`\`\`\n${snippet}\n\`\`\`\n`;
      setInputValue((prev) => `${prev}${block}`);
      textareaRef.current?.focus();
    } catch {
      setSystemNote("读取文件失败，请重试。");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePersonaChange = (nextPersonaId: string) => {
    if (!activeConversation) return;
    if (nextPersonaId === activeConversation.personaId) return;
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversation.id
          ? { ...conversation, personaId: nextPersonaId || null }
          : conversation
      )
    );
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleModelChange = (nextModel: ModelTier) => {
    if (!activeConversation) return;
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversation.id ? { ...conversation, model: nextModel } : conversation
      )
    );
  };

  const handleThemeSelect = (nextTheme: ThemeId) => {
    setTheme(nextTheme);
    setShowThemePicker(false);
  };

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      return;
    }
  };

  const handleLogin = () => {
    if (!loginToken.trim()) return;
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: loginToken.trim(), username: loginUsername.trim() || null })
    })
      .then((response) => response.json())
      .then((json) => {
        if (json.code !== 0) throw new Error(json.message || "登录失败");
        setProfile((prev) => ({
          ...prev,
          token: loginToken.trim(),
          userId: json.data?.userId ?? prev.userId,
          username: json.data?.username ?? (loginUsername.trim() || prev.username),
          region: json.data?.region ?? prev.region,
          modelQuota: json.data?.modelQuota ?? prev.modelQuota
        }));
        setShowLogin(false);
        setLoginToken("");
        setLoginUsername("");
        setSystemNote(null);
      })
      .catch((error) => {
        setSystemNote(error.message || "登录失败");
      });
  };

  const handleOpenPersonaBuilder = () => {
    setPersonaName("");
    setPersonaPrompt("");
    setPersonaError(null);
    setSidebarOpen(false);
    setShowPersonaBuilder(true);
  };

  const handlePersonaSave = () => {
    const name = personaName.trim();
    const prompt = personaPrompt.trim();
    if (!name || !prompt) {
      setPersonaError("请填写角色名称和详细提示词。");
      return;
    }
    const persona: Persona = {
      id: crypto.randomUUID(),
      name,
      type: "scenario",
      prompt
    };
    setPersonas((prev) => [persona, ...prev]);
    setShowPersonaBuilder(false);
    setPersonaError(null);
    if (activeConversation) {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === activeConversation.id ? { ...conversation, personaId: persona.id } : conversation
        )
      );
    }
    fetch("/api/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: persona.name, type: persona.type, prompt: persona.prompt })
    }).catch(() => null);
  };

  const handlePersonaRefine = async () => {
    const name = personaName.trim();
    const prompt = personaPrompt.trim();
    if (!name || !prompt || personaRefining) return;
    setPersonaRefining(true);
    setPersonaError(null);
    try {
      const response = await fetch("/api/personas/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, prompt })
      });
      const json = await response.json();
      if (json.code !== 0) throw new Error(json.message || "细化失败");
      if (json.data?.prompt) setPersonaPrompt(json.data.prompt);
    } catch (error: any) {
      setPersonaError(error.message || "细化失败");
    } finally {
      setPersonaRefining(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsTyping(false);
  };

  const renderMarkdown = (content: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ inline, className, children }: any) {
          const match = /language-(\w+)/.exec(className || "");
          const language = match?.[1];
          const code = String(children).replace(/\n$/, "");
          if (inline) {
            return <code className="inline-code">{children}</code>;
          }
          return (
            <div className="code-block">
              <div className="code-block-header">
                <span className="code-lang">{language || "code"}</span>
                <button className="copy-btn" onClick={() => handleCopy(code)}>
                  复制
                </button>
              </div>
              <SyntaxHighlighter
                language={language}
                style={colorMode === "dark" ? oneDark : oneLight}
                PreTag="div"
                customStyle={{ margin: 0, background: "transparent" }}
              >
                {code}
              </SyntaxHighlighter>
            </div>
          );
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="brand">
            <svg className="brand-logo" viewBox="0 0 48 48" aria-hidden="true">
              <circle cx="24" cy="24" r="18" fill="currentColor" />
              <path
                d="M20 32l2.6-6.2c.3-.7-.2-1.5-1-1.5h-5.6c-1.1 0-1.8 1.1-1.3 2.1l4.5 7.7c.4.7 1.4.6 1.8-.1z"
                fill="#fff"
              />
              <circle cx="29.5" cy="19" r="4" fill="#fff" />
            </svg>
            <div className="brand-text">
              <div className="brand-title">chatpro</div>
              <div className="brand-sub">内容优先，交互隐形</div>
            </div>
          </div>
          <button className="ghost sidebar-close" onClick={() => setSidebarOpen(false)}>
            关闭
          </button>
          <div className="sidebar-actions">
            <button className="primary" onClick={() => handleNewConversation()}>
              新建对话
            </button>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="section-title">人设</div>
          <select
            value={activeConversation?.personaId ?? ""}
            onChange={(event) => handlePersonaChange(event.target.value)}
          >
            <option value="">默认人设</option>
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={handleOpenPersonaBuilder}>
            新建人设
          </button>
        </div>

        <div className="sidebar-section">
          <div className="section-title">模型</div>
          <div className="model-buttons">
            {(Object.keys(modelLabels) as ModelTier[]).map((model) => (
              <button
                key={model}
                className={
                  activeConversation?.model === model
                    ? "chip active"
                    : !profile.token && model !== "normal"
                      ? "chip disabled"
                      : "chip"
                }
                onClick={() => {
                  if (!profile.token && model !== "normal") {
                    setSystemNote("游客模式仅支持普通模型，请登录后解锁。");
                    return;
                  }
                  handleModelChange(model);
                }}
              >
                {modelLabels[model]}
              </button>
            ))}
          </div>
          {(activeConversation?.model === "enhanced" || activeConversation?.model === "pro") && (
            <div className="quota">剩余次数: 增强 {profile.modelQuota.enhanced} / 专业 {profile.modelQuota.pro}</div>
          )}
        </div>

        <div className="sidebar-section conversations">
          <div className="section-title">历史对话</div>
          <div className="conversation-tools">
            <input
              value={conversationQuery}
              onChange={(event) => setConversationQuery(event.target.value)}
              placeholder="搜索会话"
            />
            <button
              className={showFavoritesOnly ? "ghost active" : "ghost"}
              onClick={() => setShowFavoritesOnly((prev) => !prev)}
            >
              收藏 {favoriteCount}
            </button>
          </div>
          <div className="conversation-list">
            {displayedConversations.map((conversation) => (
              <div
                key={conversation.id}
                className={conversation.id === activeId ? "conversation active" : "conversation"}
              >
                <button
                  className="conversation-main"
                  onClick={() => {
                    setActiveId(conversation.id);
                    if (window.innerWidth < 768) setSidebarOpen(false);
                  }}
                >
                  <div className="conversation-title">{conversation.title}</div>
                  <div className="muted">{new Date(conversation.createdAt).toLocaleDateString()}</div>
                </button>
                <button className="ghost delete-conversation" onClick={() => handleDeleteConversation(conversation.id)}>
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>


        <div className="sidebar-section">
          <div className="section-title">设置</div>
          <div className="settings-grid">
            <button className="ghost" onClick={() => setShowLogin(true)}>
              {profile.token ? "切换登录" : "登录"}
            </button>
            <button className="ghost" onClick={() => {
              setSidebarOpen(false);
              setShowThemePicker(true);
            }}>
              风格设置
            </button>
            <button className="ghost" onClick={() => setColorMode((prev) => (prev === "dark" ? "light" : "dark"))}>
              {colorMode === "dark" ? "浅色" : "深色"}
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="ghost menu" onClick={() => setSidebarOpen((prev) => !prev)}>
              菜单
            </button>
            <div className="conversation-meta">
              <div className="conversation-name">{activeConversation?.title || "对话"}</div>
              <div className="conversation-sub">
                {activeConversation?.personaId
                  ? personas.find((p) => p.id === activeConversation.personaId)?.name
                  : "默认人设"}
                <span className="dot">·</span>
                {activeConversation ? modelLabels[activeConversation.model] : "普通"}
                <span className="dot">·</span>
                {theme ? themeLabels[theme] : "经典"}
              </div>
            </div>
          </div>
          <div className="topbar-right">
            <div className={`status-pill ${connectionStatus}`}>
              {connectionStatus === "online" ? "在线" : "离线"}
            </div>
            {lastLatencyMs !== null ? <div className="status-pill subtle">{lastLatencyMs}ms</div> : null}
            {profile.username ? <span className="username">{profile.username}</span> : null}
            <button className="ghost" onClick={handleClearConversation}>
              清空对话
            </button>
          </div>
        </header>

        <section
          className="chat-area"
          ref={chatAreaRef}
          onScroll={() => {
            const el = chatAreaRef.current;
            if (!el) return;
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            setAutoScroll(nearBottom);
          }}
        >
          <div className="messages">
            {systemNote ? (
              <div className="message-row system">
                <div className="system-bubble">{systemNote}</div>
              </div>
            ) : null}
            {systemError ? (
              <div className="message-row system">
                <div className="system-bubble error">
                  <span>{systemError.text}</span>
                  {systemError.retryContent ? (
                    <button className="ghost" onClick={() => handleSend(systemError.retryContent)}>
                      重试
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {displayedMessages.map((message) => (
              <div key={message.id} className={`message-row ${message.role}`}>
                {message.role === "assistant" ? <div className="avatar">AI</div> : null}
                <div className="message-bubble">
                  {message.replyTo ? (
                    <div className="reply-preview">
                      <span className="reply-role">{message.replyTo.role === "user" ? "你" : "AI"}</span>
                      <span className="reply-text">{message.replyTo.excerpt}</span>
                    </div>
                  ) : null}
                  <div className="message-meta">
                    <span>{message.role === "user" ? profile.username || "你" : "AI"}</span>
                    <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <div className={`message-content ${message.role === "assistant" ? "markdown" : "plain"}`}>
                    {message.role === "assistant" ? renderMarkdown(message.content) : message.content}
                  </div>
                  <div className="message-actions">
                    <button className="link" onClick={() => handleCopy(message.content)}>
                      复制
                    </button>
                    <button className="link" onClick={() => handleReply(message)}>
                      回复
                    </button>
                    <button className={`link ${message.favorite ? "active" : ""}`} onClick={() => handleFavorite(message.id)}>
                      收藏
                    </button>
                    {message.role === "user" ? (
                      <button className="link" onClick={() => handleEdit(message.id, message.content)}>
                        编辑
                      </button>
                    ) : (
                      <button className="link" onClick={() => handleRetry(message.id)}>
                        重试
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {isTyping ? (
              <div className="message-row assistant">
                <div className="avatar">AI</div>
                <div className="message-bubble typing">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              </div>
            ) : null}
            <div ref={chatEndRef} />
          </div>
          {!autoScroll ? (
            <button className="jump-to-bottom" onClick={() => scrollToBottom("smooth")}>
              回到底部
            </button>
          ) : null}
        </section>

        <section className="composer" ref={composerRef}>
          <div className="composer-inner">
            {replyTo ? (
              <div className="reply-banner">
                <span>回复 {replyTo.role === "user" ? "你" : "AI"}:</span>
                <span className="reply-text">{replyTo.excerpt}</span>
                <button className="ghost" onClick={() => setReplyTo(null)}>
                  取消
                </button>
              </div>
            ) : null}
            <div className="input-wrapper">
              <textarea
                ref={textareaRef}
                placeholder={editingMessageId ? "编辑内容并重新发送" : "输入消息，回车发送"}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="text/plain,text/markdown,application/json,text/csv"
                className="file-input"
                onChange={(event) => handleFileSelect(event.target.files?.[0] ?? null)}
              />
              <div className="composer-actions">
                <button className="ghost" onClick={() => fileInputRef.current?.click()}>
                  上传文件
                </button>
                <button className="ghost" onClick={() => setInputValue("")}
                  disabled={!inputValue.trim()}
                >
                  清空
                </button>
                {isTyping ? (
                  <button className="primary stop" onClick={handleStop}>
                    停止生成
                  </button>
                ) : (
                  <button className="primary" onClick={() => handleSend()} disabled={!inputValue.trim()}>
                    发送
                  </button>
                )}
              </div>
            </div>
            <div className="disclaimer">内容由 AI 生成，仅供参考。</div>
          </div>
        </section>
      </main>

      {showThemePicker ? (
        <div className="overlay">
          <div className="modal">
            <div className="modal-title">选择风格</div>
            <p className="modal-sub">轻量风格调整，仅改变强调色与对比度。</p>
            <div className="theme-grid">
              {(Object.keys(themeLabels) as ThemeId[]).map((item) => (
                <button key={item} className={`theme-card ${item}`} onClick={() => handleThemeSelect(item)}>
                  <div className="theme-name">{themeLabels[item]}</div>
                  <div className="theme-desc">{item === "chatgpt" ? "克制" : item === "soft" ? "温和" : "清透"}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {showLogin ? (
        <div className="overlay">
          <div className="modal">
            <div className="modal-title">登录</div>
            <p className="modal-sub">输入唯一字符串，验证后保存至本地。</p>
            <div className="field">
              <label>登录字符串</label>
              <input
                value={loginToken}
                onChange={(event) => setLoginToken(event.target.value)}
                placeholder="user-unique-string"
              />
            </div>
            <div className="field">
              <label>用户名（可选）</label>
              <input value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} placeholder="可选" />
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setShowLogin(false)}>
                取消
              </button>
              <button className="primary" onClick={handleLogin}>
                登录
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showPersonaBuilder ? (
        <div className="overlay">
          <div className="modal">
            <div className="modal-title">创建人设</div>
            <p className="modal-sub">填写角色名称与详细提示词，可使用 AI 细化。</p>
            <div className="field">
              <label>角色名称</label>
              <input value={personaName} onChange={(event) => setPersonaName(event.target.value)} placeholder="例如：城市向导" />
            </div>
            <div className="field">
              <label>详细提示词</label>
              <textarea
                value={personaPrompt}
                onChange={(event) => setPersonaPrompt(event.target.value)}
                rows={6}
                placeholder="描述角色背景、语气、擅长领域、禁忌等"
              />
            </div>
            {personaError ? <div className="field-error">{personaError}</div> : null}
            <div className="modal-actions persona-actions">
              <button className="ghost" onClick={() => setShowPersonaBuilder(false)}>
                取消
              </button>
              <button className="ghost" onClick={handlePersonaRefine} disabled={personaRefining || !personaName.trim() || !personaPrompt.trim()}>
                {personaRefining ? "细化中..." : "AI 细化"}
              </button>
              <button className="primary" onClick={handlePersonaSave}>
                保存人设
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {sidebarOpen ? <div className="overlay overlay-dark" onClick={() => setSidebarOpen(false)} /> : null}
    </div>
  );
}

export default App;
