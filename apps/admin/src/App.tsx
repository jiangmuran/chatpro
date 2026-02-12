import { useEffect, useMemo, useState } from "react";
import "./App.css";

const navItems = ["数据概览", "敏感词", "公告", "用户管理", "模型配置", "访问限制", "日志", "人设审核", "设置"];

type MetricOverview = {
  date: string;
  total_requests: number;
  avg_latency: number;
  token_total: number;
  concurrent_peak: number;
};

type TrafficData = {
  devices: Record<string, number>;
  regions: Record<string, number>;
  sources: Record<string, number>;
};

type KeywordData = { word: string; count: number };
type LogItem = {
  id: string;
  action: string;
  content: string;
  ua: string;
  created_at: string;
  latency_ms: number;
  user_id?: string | null;
  ip?: string | null;
};
type Announcement = { id: string; title: string; content: string; status: string; created_at: string };
type ModelItem = { id: string; name: string; tier: string; model_id: string };
type PromptLimit = { tier: string; max_chars: number };
type UserItem = {
  user_id: string;
  username: string;
  region: string;
  tag: string;
  quota_enhanced: number;
  quota_pro: number;
  created_at: string;
};
type ConversationItem = { id: string; user_id: string; persona_id: string; model: string; created_at: string };
type MessageItem = { id: string; role: string; content: string; created_at: string };
type PersonaItem = { id: string; name: string; type: string; prompt: string; status: string };
type IpRule = { id: string; ip: string; type: string; limit_value: number | null; created_at: string };

const formatNumber = (value: number) => value.toLocaleString("zh-CN");

function App() {
  const [activeTab, setActiveTab] = useState(navItems[0]);
  const [token, setToken] = useState<string | null>(() => {
    const saved = window.localStorage.getItem("admin-token");
    if (!saved || saved === "undefined" || saved === "null") return null;
    return saved;
  });
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [overview, setOverview] = useState<MetricOverview | null>(null);
  const [traffic, setTraffic] = useState<TrafficData | null>(null);
  const [keywords, setKeywords] = useState<KeywordData[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [promptLimits, setPromptLimits] = useState<PromptLimit[]>([]);
  const [sensitiveWords, setSensitiveWords] = useState<string[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [personas, setPersonas] = useState<PersonaItem[]>([]);
  const [ipRules, setIpRules] = useState<IpRule[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  const [newWord, setNewWord] = useState("");
  const [wordQuery, setWordQuery] = useState("");
  const [newAnnTitle, setNewAnnTitle] = useState("");
  const [newAnnContent, setNewAnnContent] = useState("");
  const [modelTier, setModelTier] = useState("normal");
  const [modelId, setModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [blockIp, setBlockIp] = useState("");
  const [limitIp, setLimitIp] = useState("");
  const [limitValue, setLimitValue] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRegion, setNewUserRegion] = useState("CN");
  const [newUserQuotaEnhanced, setNewUserQuotaEnhanced] = useState("10");
  const [newUserQuotaPro, setNewUserQuotaPro] = useState("5");
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editUserTag, setEditUserTag] = useState("");
  const [editUserName, setEditUserName] = useState("");
  const [editUserRegion, setEditUserRegion] = useState("");
  const [editUserQuotaEnhanced, setEditUserQuotaEnhanced] = useState("");
  const [editUserQuotaPro, setEditUserQuotaPro] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [rechargeEnhanced, setRechargeEnhanced] = useState("0");
  const [rechargePro, setRechargePro] = useState("0");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [limitTier, setLimitTier] = useState("normal");
  const [limitChars, setLimitChars] = useState("1200");
  const [userConversations, setUserConversations] = useState<ConversationItem[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationItem | null>(null);
  const [conversationMessages, setConversationMessages] = useState<MessageItem[]>([]);
  const [editingPersona, setEditingPersona] = useState<PersonaItem | null>(null);
  const [personaName, setPersonaName] = useState("");
  const [personaType, setPersonaType] = useState("scenario");
  const [personaPrompt, setPersonaPrompt] = useState("");
  const [personaStatus, setPersonaStatus] = useState("pending");
  const [personaQuery, setPersonaQuery] = useState("");
  const [personaStatusFilter, setPersonaStatusFilter] = useState("all");
  const [logQuery, setLogQuery] = useState("");
  const [logAction, setLogAction] = useState("");
  const [logUserId, setLogUserId] = useState("");
  const [logIp, setLogIp] = useState("");
  const [selectedLog, setSelectedLog] = useState<LogItem | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  const notify = (message: string) => setStatus(message);

  const runAction = async (action: () => Promise<void>, successMessage?: string) => {
    try {
      setActionBusy(true);
      setError(null);
      await action();
      if (successMessage) notify(successMessage);
    } catch (err: any) {
      setError(err.message || "操作失败");
    } finally {
      setActionBusy(false);
    }
  };

  const fetchJson = async (url: string, options?: RequestInit) => {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(headers as Record<string, string>), ...(options?.headers || {}) }
    });
    if (response.status === 401) {
      window.localStorage.removeItem("admin-token");
      setToken(null);
      throw new Error("登录已过期，请重新登录");
    }
    const json = await response.json();
    if (json.code && json.code !== 0) throw new Error(json.message || "请求失败");
    return json.data;
  };

  const loadAll = async (silent = false, options?: { respectFilters?: boolean }) => {
    if (!token) return;
    try {
      setLoading(true);
      const [
        overviewData,
        trafficData,
        keywordsData,
        logsData,
        annData,
        modelData,
        limitData,
        wordsData,
        userData,
        personaData,
        ipRuleData
      ] = await Promise.all([
        fetchJson("/api/admin/metrics/overview"),
        fetchJson("/api/admin/metrics/traffic"),
        fetchJson("/api/admin/metrics/keywords"),
        fetchJson("/api/admin/logs?limit=200"),
        fetchJson("/api/admin/announcements"),
        fetchJson("/api/admin/models"),
        fetchJson("/api/admin/prompt-limits"),
        fetchJson("/api/admin/sensitive-words"),
        fetchJson("/api/admin/users"),
        fetchJson("/api/admin/personas"),
        fetchJson("/api/admin/ip-rules")
      ]);
      setOverview(overviewData);
      setTraffic(trafficData);
      const shouldRespectFilters = options?.respectFilters;
      if (!shouldRespectFilters || (!wordQuery.trim() && !logQuery.trim() && !logAction.trim() && !logUserId.trim() && !logIp.trim())) {
        setKeywords(keywordsData || []);
        setLogs(logsData || []);
      }
      setAnnouncements(annData || []);
      setModels(modelData || []);
      setPromptLimits(limitData || []);
      if (!shouldRespectFilters || !wordQuery.trim()) {
        setSensitiveWords(wordsData || []);
      }
      setUsers(userData || []);
      setSelectedUser((prev) => {
        if (!prev) return prev;
        const updated = (userData || []).find((item: UserItem) => item.user_id === prev.user_id);
        return updated || prev;
      });
      setPersonas(personaData || []);
      setIpRules(ipRuleData || []);
      setError(null);
      if (!silent) setStatus("数据已更新");
      setLastSyncAt(new Date());
    } catch (err: any) {
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    loadAll(true, { respectFilters: true });
    const timer = window.setInterval(() => loadAll(true, { respectFilters: true }), 10000);
    return () => window.clearInterval(timer);
  }, [token]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 3500);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!token || !selectedUser) return;
    fetchJson(`/api/admin/users/${selectedUser.user_id}`)
      .then((data) => {
        if (data?.user) setSelectedUser(data.user);
        if (Array.isArray(data?.conversations)) setUserConversations(data.conversations);
      })
      .catch(() => null);
  }, [token, selectedUser?.user_id, lastSyncAt]);

  useEffect(() => {
    if (!selectedUser) return;
    setEditUserName(selectedUser.username || "");
    setEditUserRegion(selectedUser.region || "");
    setEditUserTag(selectedUser.tag || "");
    setEditUserQuotaEnhanced(String(selectedUser.quota_enhanced));
    setEditUserQuotaPro(String(selectedUser.quota_pro));
  }, [selectedUser]);

  const handleLogin = async () => {
    runAction(async () => {
      const data = await fetchJson("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username: loginUser, password: loginPass })
      });
      window.localStorage.setItem("admin-token", data.token);
      setToken(data.token);
    }, "登录成功");
  };

  const handleAddWord = async () => {
    if (!newWord.trim()) return;
    await runAction(async () => {
      await fetchJson("/api/admin/sensitive-words", {
        method: "POST",
        body: JSON.stringify({ word: newWord.trim() })
      });
      setNewWord("");
      loadAll(true);
    }, "敏感词已添加");
  };

  const handleSearchWords = async () => {
    const query = wordQuery.trim();
    await runAction(async () => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      const data = await fetchJson(`/api/admin/sensitive-words?${params.toString()}`);
      setSensitiveWords(data || []);
    }, query ? "已筛选敏感词" : "敏感词已刷新");
  };

  const handleAddAnnouncement = async () => {
    if (!newAnnTitle.trim() || !newAnnContent.trim()) return;
    await runAction(async () => {
      await fetchJson("/api/admin/announcements", {
        method: "POST",
        body: JSON.stringify({ title: newAnnTitle.trim(), content: newAnnContent.trim() })
      });
      setNewAnnTitle("");
      setNewAnnContent("");
      loadAll(true);
    }, "公告已发布");
  };

  const handleUpdateModel = async () => {
    if (!modelTier || !modelId.trim()) return;
    await runAction(async () => {
      await fetchJson("/api/admin/models", {
        method: "POST",
        body: JSON.stringify({ tier: modelTier, modelId: modelId.trim(), name: modelName.trim() || modelTier })
      });
      setModelId("");
      setModelName("");
      loadAll(true);
    }, "模型配置已更新");
  };

  const handleBlockIp = async () => {
    if (!blockIp.trim()) return;
    await runAction(async () => {
      await fetchJson("/api/admin/ip/block", {
        method: "POST",
        body: JSON.stringify({ ip: blockIp.trim() })
      });
      setBlockIp("");
      loadAll(true);
    }, "IP 已封禁");
  };

  const handleLimitIp = async () => {
    if (!limitIp.trim() || !limitValue.trim()) return;
    await runAction(async () => {
      await fetchJson("/api/admin/ip/limit", {
        method: "POST",
        body: JSON.stringify({ ip: limitIp.trim(), limit: Number(limitValue) })
      });
      setLimitIp("");
      setLimitValue("");
      loadAll(true);
    }, "限流规则已更新");
  };

  const handleDeleteIpRule = async (id: string) => {
    if (!window.confirm("确认移除该 IP 规则？")) return;
    await runAction(async () => {
      await fetchJson(`/api/admin/ip-rules/${id}`, { method: "DELETE" });
      loadAll(true);
    }, "IP 规则已移除");
  };

  const handleCreateUser = async () => {
    if (!newUserName.trim()) return;
    await runAction(async () => {
      await fetchJson("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: newUserName.trim(),
          region: newUserRegion.trim() || "CN",
          quotaEnhanced: Number(newUserQuotaEnhanced),
          quotaPro: Number(newUserQuotaPro)
        })
      });
      setNewUserName("");
      loadAll(true);
    }, "用户已创建");
  };

  const handleSelectUser = (user: UserItem) => {
    setSelectedUser(user);
    setEditUserId(user.user_id);
    fetchJson(`/api/admin/users/${user.user_id}`)
      .then((data) => {
        setUserConversations(data.conversations || []);
        setSelectedConversation(null);
        setConversationMessages([]);
      })
      .catch(() => null);
  };

  const handleUpdateUser = async () => {
    if (!editUserId) return;
    await runAction(async () => {
      await fetchJson(`/api/admin/users/${editUserId}`, {
        method: "PUT",
        body: JSON.stringify({
          username: editUserName.trim(),
          region: editUserRegion.trim(),
          tag: editUserTag.trim(),
          quotaEnhanced: Number(editUserQuotaEnhanced),
          quotaPro: Number(editUserQuotaPro)
        })
      });
      setEditUserId(null);
      loadAll(true);
    }, "用户信息已更新");
  };

  const handleRechargeUser = async () => {
    if (!editUserId) return;
    await runAction(async () => {
      await fetchJson(`/api/admin/users/${editUserId}/recharge`, {
        method: "POST",
        body: JSON.stringify({
          enhanced: Number(rechargeEnhanced),
          pro: Number(rechargePro)
        })
      });
      setRechargeEnhanced("0");
      setRechargePro("0");
      loadAll(true);
    }, "额度已充值");
  };

  const handleDeleteUser = async () => {
    if (!editUserId) return;
    if (!window.confirm("确认删除该用户及其会话记录？")) return;
    await runAction(async () => {
      await fetchJson(`/api/admin/users/${editUserId}`, { method: "DELETE" });
      setEditUserId(null);
      setSelectedUser(null);
      loadAll(true);
    }, "用户已删除");
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) return;
    await runAction(async () => {
      await fetchJson("/api/admin/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setCurrentPassword("");
      setNewPassword("");
    }, "密码已更新");
  };

  const handleSearchLogs = async () => {
    const query = new URLSearchParams({
      q: logQuery.trim(),
      action: logAction.trim(),
      userId: logUserId.trim(),
      ip: logIp.trim(),
      limit: "200"
    });
    await runAction(async () => {
      const data = await fetchJson(`/api/admin/logs?${query.toString()}`);
      setLogs(data || []);
    }, "日志已筛选");
  };

  const handleUpdatePromptLimit = async () => {
    await runAction(async () => {
      await fetchJson("/api/admin/prompt-limits", {
        method: "POST",
        body: JSON.stringify({ tier: limitTier, maxChars: Number(limitChars) })
      });
      setLimitChars("");
      loadAll(true);
    }, "Prompt 上限已更新");
  };

  const handleSelectConversation = async (conversation: ConversationItem) => {
    setSelectedConversation(conversation);
    const data = await fetchJson(`/api/admin/conversations/${conversation.id}`);
    setConversationMessages(data.messages || []);
  };

  const openPersonaEditor = (persona: PersonaItem) => {
    setEditingPersona(persona);
    setPersonaName(persona.name);
    setPersonaType(persona.type);
    setPersonaPrompt(persona.prompt);
    setPersonaStatus(persona.status);
  };

  const handleSavePersona = async () => {
    if (!editingPersona) return;
    await runAction(async () => {
      await fetchJson(`/api/admin/personas/${editingPersona.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: personaName.trim(),
          type: personaType,
          prompt: personaPrompt.trim(),
          status: personaStatus
        })
      });
      setEditingPersona(null);
      loadAll(true);
    }, "人设卡已保存");
  };

  const handleDeletePersona = async () => {
    if (!editingPersona) return;
    if (!window.confirm("确认删除该人设卡？")) return;
    await runAction(async () => {
      await fetchJson(`/api/admin/personas/${editingPersona.id}`, { method: "DELETE" });
      setEditingPersona(null);
      loadAll(true);
    }, "人设卡已删除");
  };

  const handleApprovePersona = async (id: string) => {
    await runAction(async () => {
      await fetchJson(`/api/admin/personas/${id}/approve`, { method: "POST" });
      loadAll(true);
    }, "人设卡已通过");
  };

  const metricCards = overview
    ? [
        { label: "今日请求量", value: formatNumber(overview.total_requests) },
        { label: "实时并发峰值", value: formatNumber(overview.concurrent_peak) },
        { label: "平均响应", value: `${overview.avg_latency}ms` },
        { label: "Token 消耗", value: formatNumber(overview.token_total) }
      ]
    : [];

  const pendingPersonas = useMemo(
    () => personas.filter((item) => item.status !== "approved").length,
    [personas]
  );

  const filteredUsers = useMemo(() => {
    const query = userQuery.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) =>
      [user.user_id, user.username, user.region, user.tag]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(query))
    );
  }, [users, userQuery]);

  const filteredPersonas = useMemo(() => {
    const query = personaQuery.trim().toLowerCase();
    return personas.filter((persona) => {
      const matchesStatus = personaStatusFilter === "all" ? true : persona.status === personaStatusFilter;
      const matchesQuery = query
        ? [persona.name, persona.type, persona.prompt].some((field) =>
            String(field).toLowerCase().includes(query)
          )
        : true;
      return matchesStatus && matchesQuery;
    });
  }, [personas, personaQuery, personaStatusFilter]);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <svg className="brand-logo" viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r="18" fill="currentColor" />
            <path
              d="M20 32l2.6-6.2c.3-.7-.2-1.5-1-1.5h-5.6c-1.1 0-1.8 1.1-1.3 2.1l4.5 7.7c.4.7 1.4.6 1.8-.1z"
              fill="#0b0f14"
            />
            <circle cx="29.5" cy="19" r="4" fill="#0b0f14" />
          </svg>
          <div>
            <div className="brand-title">chatpro admin</div>
            <div className="brand-sub">运营与合规控制台</div>
          </div>
        </div>
        <nav className="admin-nav">
          {navItems.map((item) => (
            <button
              key={item}
              className={item === activeTab ? "nav-item active" : "nav-item"}
              onClick={() => setActiveTab(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        <div className="admin-footnote">数据每 10 秒刷新</div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <div className="topbar-title">{activeTab}</div>
            <div className="topbar-sub">实时并发、模型与合规配置</div>
            <div className="topbar-meta">
              <span className="pill">自动刷新 10s</span>
              {lastSyncAt ? (
                <span className="pill subtle">最近同步 {lastSyncAt.toLocaleTimeString()}</span>
              ) : null}
            </div>
            {status ? <div className="status-line">{status}</div> : null}
          </div>
          <div className="topbar-actions">
            <button className="ghost" onClick={() => loadAll()} disabled={loading}>
              {loading ? "同步中" : "刷新数据"}
            </button>
            <button className="primary" onClick={() => window.open("/api/admin/export/logs", "_blank")}
              disabled={actionBusy}
            >
              导出日志
            </button>
          </div>
        </header>
        {error ? <div className="error-banner">{error}</div> : null}

        {activeTab === "数据概览" ? (
          <>
            <section className="summary-grid">
              <div className="summary-card">
                <div className="summary-label">今日日期</div>
                <div className="summary-value">{overview?.date || "--"}</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">模型配置</div>
                <div className="summary-value">{models.length} 个</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">敏感词条</div>
                <div className="summary-value">{sensitiveWords.length} 条</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">待审人设</div>
                <div className="summary-value">{pendingPersonas} 个</div>
              </div>
            </section>
            <section className="metric-grid">
              {metricCards.map((metric) => (
                <div key={metric.label} className="metric-card">
                  <div className="metric-label">{metric.label}</div>
                  <div className="metric-value">{metric.value}</div>
                </div>
              ))}
            </section>
            <section className="panel-grid">
              <div className="panel">
                <div className="panel-title">流量来源</div>
                <div className="panel-body">
                  <div className="panel-list">
                    <div>设备: {traffic ? `移动 ${traffic.devices.mobile || 0} / 桌面 ${traffic.devices.desktop || 0}` : "--"}</div>
                    <div>来源: {traffic ? Object.entries(traffic.sources).map(([key, value]) => `${key} ${value}`).join(" / ") : "--"}</div>
                    <div>地区: {traffic ? Object.entries(traffic.regions).slice(0, 3).map(([key, value]) => `${key} ${value}`).join(" / ") : "--"}</div>
                  </div>
                </div>
              </div>
              <div className="panel">
                <div className="panel-title">模型映射</div>
                <div className="panel-body">
                  <ul className="model-list">
                    {models.map((model) => (
                      <li key={model.id}>
                        <span>{model.name}</span>
                        <span className="muted">{model.model_id}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="panel wide">
                <div className="panel-title">今日请求关键词</div>
                <div className="panel-body">
                  <div className="keyword-grid">
                    {keywords.length ? keywords.map((item) => (
                      <div key={item.word} className="keyword-chip">
                        <span>{item.word}</span>
                        <span>{item.count}</span>
                      </div>
                    )) : <div className="muted">暂无数据</div>}
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {activeTab === "敏感词" ? (
          <section className="panel">
            <div className="panel-title">敏感词库</div>
            <div className="panel-body">
              <div className="form-row">
                <input value={newWord} onChange={(event) => setNewWord(event.target.value)} placeholder="新增敏感词" />
                <button className="primary" onClick={handleAddWord} disabled={actionBusy}>添加</button>
              </div>
              <div className="form-row">
                <input value={wordQuery} onChange={(event) => setWordQuery(event.target.value)} placeholder="搜索敏感词" />
                <button className="ghost" onClick={handleSearchWords} disabled={actionBusy}>筛选</button>
                <button className="ghost" onClick={() => { setWordQuery(""); loadAll(true); }} disabled={actionBusy}>重置</button>
              </div>
              <div className="panel-sub">当前展示 {sensitiveWords.length} 条</div>
              <div className="word-grid">
                {sensitiveWords.slice(0, 80).map((word) => (
                  <span key={word} className="word-pill">{word}</span>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "公告" ? (
          <section className="panel-grid">
            <div className="panel">
              <div className="panel-title">发布公告</div>
              <div className="panel-body">
                <div className="form-stack">
                  <input value={newAnnTitle} onChange={(event) => setNewAnnTitle(event.target.value)} placeholder="公告标题" />
                  <textarea value={newAnnContent} onChange={(event) => setNewAnnContent(event.target.value)} placeholder="公告内容" rows={4} />
                  <button className="primary" onClick={handleAddAnnouncement} disabled={actionBusy}>发布公告</button>
                </div>
              </div>
            </div>
            <div className="panel">
              <div className="panel-title">公告列表</div>
              <div className="panel-body">
                <div className="announcement-list">
                  {announcements.length ? announcements.map((item) => (
                    <div key={item.id} className="announcement">
                      <div className="announcement-title">{item.title}</div>
                      <div className="announcement-content">{item.content}</div>
                      <div className="muted">{new Date(item.created_at).toLocaleString()}</div>
                    </div>
                  )) : <div className="empty-state">暂无公告</div>}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "用户管理" ? (
          <section className="panel">
            <div className="panel-title">用户管理</div>
            <div className="panel-body">
              <div className="user-layout">
                <div className="panel soft">
                  <div className="panel-title">创建用户</div>
                  <div className="panel-body">
                    <div className="form-row">
                      <input value={newUserName} onChange={(event) => setNewUserName(event.target.value)} placeholder="用户名" />
                      <input value={newUserRegion} onChange={(event) => setNewUserRegion(event.target.value)} placeholder="地区" />
                      <input value={newUserQuotaEnhanced} onChange={(event) => setNewUserQuotaEnhanced(event.target.value)} placeholder="增强额度" />
                      <input value={newUserQuotaPro} onChange={(event) => setNewUserQuotaPro(event.target.value)} placeholder="专业额度" />
                      <button className="primary" onClick={handleCreateUser} disabled={actionBusy}>创建用户</button>
                    </div>
                    <div className="form-row">
                      <input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="搜索用户 / 地区 / 标签" />
                      <div className="panel-sub">共 {filteredUsers.length} 位用户</div>
                    </div>
                    <div className="table-wrap">
                      <table className="log-table">
                        <thead>
                          <tr>
                            <th>用户ID</th>
                            <th>用户名</th>
                            <th>地区</th>
                            <th>增强/专业</th>
                            <th>标签</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredUsers.length ? filteredUsers.map((user) => (
                            <tr
                              key={user.user_id}
                              className={selectedUser?.user_id === user.user_id ? "active" : ""}
                              onClick={() => handleSelectUser(user)}
                            >
                              <td>{user.user_id}</td>
                              <td>{user.username || "-"}</td>
                              <td>{user.region || "-"}</td>
                              <td>{user.quota_enhanced}/{user.quota_pro}</td>
                              <td>{user.tag || "-"}</td>
                            </tr>
                          )) : (
                            <tr>
                              <td colSpan={5} className="empty-state">暂无用户</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="panel soft">
                  <div className="panel-title">用户详情</div>
                  <div className="panel-body">
                    {editUserId ? (
                      <>
                        <div className="info-grid">
                          <div>
                            <div className="info-label">用户ID</div>
                            <div className="info-value">{editUserId}</div>
                          </div>
                          <div>
                            <div className="info-label">用户名</div>
                            <div className="info-value">{selectedUser?.username || "-"}</div>
                          </div>
                          <div>
                            <div className="info-label">地区</div>
                            <div className="info-value">{selectedUser?.region || "-"}</div>
                          </div>
                          <div>
                            <div className="info-label">增强额度</div>
                            <div className="info-value">{selectedUser?.quota_enhanced ?? "-"}</div>
                          </div>
                          <div>
                            <div className="info-label">专业额度</div>
                            <div className="info-value">{selectedUser?.quota_pro ?? "-"}</div>
                          </div>
                        </div>
                        <div className="form-row">
                          <input value={editUserName} onChange={(event) => setEditUserName(event.target.value)} placeholder="用户名" />
                          <input value={editUserRegion} onChange={(event) => setEditUserRegion(event.target.value)} placeholder="地区" />
                          <input value={editUserTag} onChange={(event) => setEditUserTag(event.target.value)} placeholder="用户标签" />
                          <input value={editUserQuotaEnhanced} onChange={(event) => setEditUserQuotaEnhanced(event.target.value)} placeholder="增强额度" />
                          <input value={editUserQuotaPro} onChange={(event) => setEditUserQuotaPro(event.target.value)} placeholder="专业额度" />
                          <button className="primary" onClick={handleUpdateUser} disabled={actionBusy}>保存更新</button>
                        </div>
                        <div className="muted">标签设置为 `trusted` 可跳过敏感词审查</div>
                        <div className="form-row">
                          <input value={rechargeEnhanced} onChange={(event) => setRechargeEnhanced(event.target.value)} placeholder="充值增强" />
                          <input value={rechargePro} onChange={(event) => setRechargePro(event.target.value)} placeholder="充值专业" />
                          <button className="primary" onClick={handleRechargeUser} disabled={actionBusy}>充值额度</button>
                          <button className="ghost" onClick={handleDeleteUser} disabled={actionBusy}>删除用户</button>
                        </div>
                      </>
                    ) : (
                      <div className="empty-state">选择用户查看详情与会话</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="user-detail">
                <div className="panel soft">
                  <div className="panel-title">用户会话</div>
                  <div className="panel-body">
                    <div className="conversation-list">
                      {userConversations.length ? userConversations.map((conv) => (
                        <button
                          key={conv.id}
                          className={selectedConversation?.id === conv.id ? "conversation active" : "conversation"}
                          onClick={() => handleSelectConversation(conv)}
                        >
                          <div>{conv.id}</div>
                          <div className="muted">{new Date(conv.created_at).toLocaleString()}</div>
                        </button>
                      )) : <div className="empty-state">暂无会话</div>}
                    </div>
                  </div>
                </div>
                <div className="panel soft">
                  <div className="panel-title">会话消息</div>
                  <div className="panel-body">
                    <div className="message-list">
                      {conversationMessages.length ? conversationMessages.map((msg) => (
                        <div key={msg.id} className={`message-row ${msg.role}`}>
                          <div className="muted">{msg.role}</div>
                          <div>{msg.content}</div>
                        </div>
                      )) : <div className="empty-state">选择会话查看消息</div>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "模型配置" ? (
          <section className="panel">
            <div className="panel-title">模型映射配置</div>
            <div className="panel-body">
              <div className="panel-grid">
                <div className="panel soft">
                  <div className="panel-title">模型映射</div>
                  <div className="panel-body">
                    <div className="form-row">
                      <select value={modelTier} onChange={(event) => setModelTier(event.target.value)}>
                        <option value="normal">普通</option>
                        <option value="enhanced">增强</option>
                        <option value="pro">专业</option>
                      </select>
                      <input value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="显示名称" />
                      <input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="上游模型 ID" />
                      <button className="primary" onClick={handleUpdateModel} disabled={actionBusy}>保存</button>
                    </div>
                    <ul className="model-list">
                      {models.map((model) => (
                        <li key={model.id} className="model-row">
                          <div>
                            <span className="model-tier">{model.tier}</span>
                            <div>{model.name}</div>
                            <div className="muted">{model.model_id}</div>
                          </div>
                          <button
                            className="ghost"
                            onClick={() => {
                              if (!window.confirm("确认删除该模型映射？")) return;
                              fetchJson(`/api/admin/models/${model.tier}`, { method: "DELETE" }).then(loadAll);
                            }}
                          >
                            删除
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="panel soft">
                  <div className="panel-title">Prompt 上限</div>
                  <div className="panel-body">
                    <div className="form-row">
                      <select value={limitTier} onChange={(event) => setLimitTier(event.target.value)}>
                        <option value="normal">普通 prompt 上限</option>
                        <option value="enhanced">增强 prompt 上限</option>
                        <option value="pro">专业 prompt 上限</option>
                      </select>
                      <input value={limitChars} onChange={(event) => setLimitChars(event.target.value)} placeholder="最大字符数" />
                      <button className="primary" onClick={handleUpdatePromptLimit} disabled={actionBusy}>更新上限</button>
                    </div>
                    <ul className="model-list">
                      {promptLimits.map((limit) => (
                        <li key={limit.tier} className="model-row">
                          <div>
                            <span className="model-tier">{limit.tier}</span>
                            <div className="muted">{limit.max_chars} chars</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "访问限制" ? (
          <section className="panel">
            <div className="panel-title">IP 黑名单与限流</div>
            <div className="panel-body">
              <div className="form-row">
                <input value={blockIp} onChange={(event) => setBlockIp(event.target.value)} placeholder="封禁 IP" />
                <button className="primary" onClick={handleBlockIp} disabled={actionBusy}>封禁</button>
              </div>
              <div className="form-row">
                <input value={limitIp} onChange={(event) => setLimitIp(event.target.value)} placeholder="限流 IP" />
                <input value={limitValue} onChange={(event) => setLimitValue(event.target.value)} placeholder="每日上限" />
                <button className="primary" onClick={handleLimitIp} disabled={actionBusy}>设置限流</button>
              </div>
              <div className="table-wrap">
                <table className="log-table">
                  <thead>
                    <tr>
                      <th>IP</th>
                      <th>类型</th>
                      <th>限额</th>
                      <th>时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ipRules.length ? ipRules.map((rule) => (
                      <tr key={rule.id}>
                        <td>{rule.ip}</td>
                        <td>{rule.type === "block" ? "封禁" : "限流"}</td>
                        <td>{rule.type === "limit" ? rule.limit_value : "-"}</td>
                        <td>{new Date(rule.created_at).toLocaleString()}</td>
                        <td>
                          <button className="ghost" onClick={() => handleDeleteIpRule(rule.id)} disabled={actionBusy}>移除</button>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={5} className="empty-state">暂无规则</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "日志" ? (
          <section className="panel">
            <div className="panel-title">调用日志</div>
            <div className="panel-body">
              <div className="form-row">
                <button className="ghost" onClick={() => window.open("/api/admin/export/logs", "_blank")}>导出日志</button>
                <button className="ghost" onClick={() => window.open("/api/admin/export/conversations", "_blank")}>导出对话</button>
                <button className="ghost" onClick={() => window.open("/api/admin/export/visitors", "_blank")}>导出访客</button>
                <button className="ghost" onClick={() => window.open("/api/admin/export/guests", "_blank")}>导出游客对话</button>
              </div>
              <div className="form-row">
                <input value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="关键词" />
                <input value={logAction} onChange={(event) => setLogAction(event.target.value)} placeholder="动作 (chat)" />
                <input value={logUserId} onChange={(event) => setLogUserId(event.target.value)} placeholder="用户ID" />
                <input value={logIp} onChange={(event) => setLogIp(event.target.value)} placeholder="IP" />
                <button className="primary" onClick={handleSearchLogs} disabled={actionBusy}>筛选</button>
              </div>
              <div className="panel-sub">当前 {logs.length} 条日志</div>
              <table className="log-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>动作</th>
                    <th>用户</th>
                    <th>IP</th>
                    <th>内容</th>
                    <th>延迟</th>
                    <th>详情</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((item) => (
                    <tr key={item.id}>
                      <td>{new Date(item.created_at).toLocaleTimeString()}</td>
                      <td>{item.action}</td>
                      <td>{item.user_id || "游客"}</td>
                      <td>{item.ip || "-"}</td>
                      <td className="cell-clip">{item.content}</td>
                      <td>{item.latency_ms}ms</td>
                      <td>
                        <button className="ghost" onClick={() => setSelectedLog(item)}>查看</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === "人设审核" ? (
          <section className="panel">
            <div className="panel-title">人设卡审核</div>
            <div className="panel-body">
              <div className="form-row">
                <input value={personaQuery} onChange={(event) => setPersonaQuery(event.target.value)} placeholder="搜索人设/类型/内容" />
                <select value={personaStatusFilter} onChange={(event) => setPersonaStatusFilter(event.target.value)}>
                  <option value="all">全部状态</option>
                  <option value="pending">待审核</option>
                  <option value="approved">已通过</option>
                </select>
                <div className="panel-sub">待审 {pendingPersonas} 个</div>
              </div>
              <div className="persona-grid">
                {filteredPersonas.length ? filteredPersonas.map((persona) => (
                  <div key={persona.id} className="persona-card">
                    <div className="persona-title">{persona.name}</div>
                    <div className="muted">{persona.type}</div>
                    <div className="persona-prompt">{persona.prompt}</div>
                    <div className="persona-actions">
                      <span className={persona.status === "approved" ? "status ok" : "status pending"}>{persona.status}</span>
                      <button className="ghost" onClick={() => openPersonaEditor(persona)}>编辑</button>
                      {persona.status !== "approved" ? (
                        <button className="primary" onClick={() => handleApprovePersona(persona.id)} disabled={actionBusy}>通过</button>
                      ) : null}
                    </div>
                  </div>
                )) : <div className="empty-state">暂无人设</div>}
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "设置" ? (
          <section className="panel">
            <div className="panel-title">后台设置</div>
            <div className="panel-body">
              <div className="form-stack">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="当前密码"
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="新密码（至少 6 位）"
                />
                <button className="primary" onClick={handleChangePassword} disabled={actionBusy}>修改密码</button>
              </div>
            </div>
          </section>
        ) : null}
      </main>

      {!token ? (
        <div className="overlay">
          <div className="modal">
            <div className="modal-title">管理员登录</div>
            <p className="modal-sub">使用后台账号密码登录后才能访问管理功能。</p>
            {error ? <div className="error">{error}</div> : null}
            <div className="form-stack">
              <input value={loginUser} onChange={(event) => setLoginUser(event.target.value)} placeholder="用户名" />
              <input type="password" value={loginPass} onChange={(event) => setLoginPass(event.target.value)} placeholder="密码" />
              <button className="primary" onClick={handleLogin} disabled={actionBusy}>登录</button>
            </div>
          </div>
        </div>
      ) : null}
      {editingPersona ? (
        <div className="overlay" onClick={() => setEditingPersona(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title">编辑人设卡</div>
            <p className="modal-sub">人设卡本质是提示词，修改后可直接生效。</p>
            <div className="form-stack">
              <input value={personaName} onChange={(event) => setPersonaName(event.target.value)} placeholder="人设名称" />
              <select value={personaType} onChange={(event) => setPersonaType(event.target.value)}>
                <option value="scenario">情景</option>
                <option value="professional">专业</option>
              </select>
              <select value={personaStatus} onChange={(event) => setPersonaStatus(event.target.value)}>
                <option value="pending">待审核</option>
                <option value="approved">已通过</option>
              </select>
              <textarea value={personaPrompt} onChange={(event) => setPersonaPrompt(event.target.value)} rows={6} placeholder="提示词内容" />
              <div className="form-row">
                <button className="ghost" onClick={() => setEditingPersona(null)}>取消</button>
                <button className="ghost" onClick={handleDeletePersona}>删除</button>
                <button className="primary" onClick={handleSavePersona} disabled={actionBusy}>保存</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {selectedLog ? (
        <div className="overlay" onClick={() => setSelectedLog(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title">日志详情</div>
            <p className="modal-sub">完整内容与访问环境</p>
            <div className="log-detail">
              <div><strong>时间:</strong> {new Date(selectedLog.created_at).toLocaleString()}</div>
              <div><strong>动作:</strong> {selectedLog.action}</div>
              <div><strong>延迟:</strong> {selectedLog.latency_ms}ms</div>
              <div><strong>用户:</strong> {selectedLog.user_id || "游客"}</div>
              <div><strong>IP:</strong> {selectedLog.ip}</div>
              <div><strong>UA:</strong> {selectedLog.ua}</div>
              <div><strong>内容:</strong></div>
              <div className="log-content">{selectedLog.content}</div>
            </div>
            <div className="form-row">
              <button className="primary" onClick={() => setSelectedLog(null)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
