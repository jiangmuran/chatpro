import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import Database from "better-sqlite3";

const app = express();
const port = process.env.PORT || 5178;
const cwd = process.cwd();
const rootDir = path.basename(cwd) === "server" ? path.resolve(cwd, "..") : cwd;
dotenv.config({ path: path.join(rootDir, ".env") });
app.set("trust proxy", true);

const webDist = path.join(rootDir, "apps", "web", "dist");
const adminDist = path.join(rootDir, "apps", "admin", "dist");

const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com";
const apiKey = process.env.OPENAI_API_KEY || "";
const adminUser = process.env.ADMIN_USER || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin";
const defaultQuotas = {
  enhanced: Number(process.env.DEFAULT_QUOTA_ENHANCED || 10),
  pro: Number(process.env.DEFAULT_QUOTA_PRO || 5)
};
const modelMap = {
  normal: process.env.MODEL_NORMAL || "gpt-4o-mini",
  enhanced: process.env.MODEL_ENHANCED || "gpt-4o",
  pro: process.env.MODEL_PRO || "gpt-4.1"
};

const dbPath = path.join(rootDir, "server", "data", "chatpro.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const adminTokens = new Map();

const nowIso = () => new Date().toISOString();
const purgeOldLogs = () => {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("DELETE FROM audit_logs WHERE created_at < ?").run(cutoff);
};

const getRequestIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  const realIp = req.headers["x-real-ip"];
  const raw =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() ||
    (Array.isArray(realIp) ? realIp[0] : realIp) ||
    req.ip ||
    req.socket?.remoteAddress ||
    "";
  if (!raw) return "";
  if (raw === "::1") return "127.0.0.1";
  if (raw.startsWith("::ffff:")) return raw.replace("::ffff:", "");
  return raw;
};

const initDb = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT UNIQUE,
      token TEXT UNIQUE,
      username TEXT,
      region TEXT,
      tag TEXT,
      quota_enhanced INTEGER,
      quota_pro INTEGER,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      persona_id TEXT,
      model TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      role TEXT,
      content TEXT,
      created_at TEXT,
      usage_prompt INTEGER,
      usage_completion INTEGER
    );

    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      prompt TEXT,
      status TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      ip TEXT,
      ua TEXT,
      action TEXT,
      content TEXT,
      latency_ms INTEGER,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS metrics_daily (
      date TEXT PRIMARY KEY,
      total_requests INTEGER,
      avg_latency INTEGER,
      token_total INTEGER,
      concurrent_peak INTEGER
    );

    CREATE TABLE IF NOT EXISTS metrics_traffic (
      date TEXT,
      type TEXT,
      key TEXT,
      count INTEGER,
      PRIMARY KEY (date, type, key)
    );

    CREATE TABLE IF NOT EXISTS keywords_daily (
      date TEXT,
      word TEXT,
      count INTEGER,
      PRIMARY KEY (date, word)
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT,
      content TEXT,
      status TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sensitive_words (
      id TEXT PRIMARY KEY,
      word TEXT,
      category TEXT
    );

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      tier TEXT,
      name TEXT,
      model_id TEXT
    );

    CREATE TABLE IF NOT EXISTS prompt_limits (
      tier TEXT PRIMARY KEY,
      max_chars INTEGER
    );

    CREATE TABLE IF NOT EXISTS ip_rules (
      id TEXT PRIMARY KEY,
      ip TEXT,
      type TEXT,
      limit_value INTEGER,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ip_requests (
      ip TEXT,
      date TEXT,
      count INTEGER,
      PRIMARY KEY (ip, date)
    );

    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const modelCount = db.prepare("SELECT COUNT(1) AS count FROM models").get()?.count || 0;
  if (modelCount === 0) {
    const insert = db.prepare("INSERT INTO models (id, tier, name, model_id) VALUES (?, ?, ?, ?)");
    insert.run(nanoid(6), "normal", "普通", modelMap.normal);
    insert.run(nanoid(6), "enhanced", "增强", modelMap.enhanced);
    insert.run(nanoid(6), "pro", "专业", modelMap.pro);
  }

  const personaCount = db.prepare("SELECT COUNT(1) AS count FROM personas").get()?.count || 0;
  if (personaCount === 0) {
    const insert = db.prepare("INSERT INTO personas (id, name, type, prompt, status) VALUES (?, ?, ?, ?, ?)");
    insert.run("miku", "初音未来", "scenario", "你是初音未来，语气清新，鼓励与陪伴。", "approved");
    insert.run("architect", "程序架构师", "professional", "你是资深架构师，回答结构化、可执行。", "approved");
  }

  const announcementCount = db.prepare("SELECT COUNT(1) AS count FROM announcements").get()?.count || 0;
  if (announcementCount === 0) {
    db.prepare(
      "INSERT INTO announcements (id, title, content, status, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(nanoid(6), "欢迎使用 chatpro", "系统支持游客模式与人设卡切换，记得查看主题设置。", "active", nowIso());
  }

  const sensitiveCount = db.prepare("SELECT COUNT(1) AS count FROM sensitive_words").get()?.count || 0;
  if (sensitiveCount === 0) {
    const lexiconPath = path.join(
      rootDir,
      "docs",
      "Sensitive-lexicon",
      "ThirdPartyCompatibleFormats",
      "TrChat",
      "SensitiveLexicon.json"
    );
    try {
      const raw = fs.readFileSync(lexiconPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.words)) {
        const insert = db.prepare("INSERT INTO sensitive_words (id, word, category) VALUES (?, ?, ?)");
        db.transaction((words) => {
          words.slice(0, 5000).forEach((word) => {
            if (typeof word === "string" && word.trim()) {
              insert.run(nanoid(10), word.trim(), "default");
            }
          });
        })(parsed.words);
      }
    } catch {
      // ignore
    }
  }

  const limitCount = db.prepare("SELECT COUNT(1) AS count FROM prompt_limits").get()?.count || 0;
  if (limitCount === 0) {
    const insert = db.prepare("INSERT INTO prompt_limits (tier, max_chars) VALUES (?, ?)");
    insert.run("normal", Number(process.env.PROMPT_LIMIT_NORMAL || 1200));
    insert.run("enhanced", Number(process.env.PROMPT_LIMIT_ENHANCED || 1600));
    insert.run("pro", Number(process.env.PROMPT_LIMIT_PRO || 2000));
  }

  const adminUserRow = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_user'").get();
  if (!adminUserRow) {
    db.prepare("INSERT INTO admin_settings (key, value) VALUES (?, ?)").run("admin_user", adminUser);
  }
  const adminPassRow = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_password'").get();
  if (!adminPassRow) {
    db.prepare("INSERT INTO admin_settings (key, value) VALUES (?, ?)").run("admin_password", adminPassword);
  }
};

const themes = [
  { id: "chatgpt", name: "ChatGPT" },
  { id: "soft", name: "Soft" },
  { id: "miku", name: "Miku" }
];

const getToday = () => new Date().toISOString().slice(0, 10);

const upsertMetric = (date, data) => {
  const existing = db.prepare("SELECT * FROM metrics_daily WHERE date = ?").get(date);
  if (!existing) {
    db.prepare(
      "INSERT INTO metrics_daily (date, total_requests, avg_latency, token_total, concurrent_peak) VALUES (?, ?, ?, ?, ?)"
    ).run(date, data.total_requests, data.avg_latency, data.token_total, data.concurrent_peak);
    return;
  }
  db.prepare(
    "UPDATE metrics_daily SET total_requests = ?, avg_latency = ?, token_total = ?, concurrent_peak = ? WHERE date = ?"
  ).run(data.total_requests, data.avg_latency, data.token_total, data.concurrent_peak, date);
};

const updateTrafficMetric = (type, key) => {
  const date = getToday();
  const row = db.prepare("SELECT count FROM metrics_traffic WHERE date = ? AND type = ? AND key = ?").get(date, type, key);
  if (!row) {
    db.prepare("INSERT INTO metrics_traffic (date, type, key, count) VALUES (?, ?, ?, ?)").run(date, type, key, 1);
    return;
  }
  db.prepare("UPDATE metrics_traffic SET count = ? WHERE date = ? AND type = ? AND key = ?").run(
    row.count + 1,
    date,
    type,
    key
  );
};

const updateKeywordMetric = (content) => {
  const date = getToday();
  const tokens = String(content)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  tokens.forEach((token) => {
    const row = db.prepare("SELECT count FROM keywords_daily WHERE date = ? AND word = ?").get(date, token);
    if (!row) {
      db.prepare("INSERT INTO keywords_daily (date, word, count) VALUES (?, ?, ?)").run(date, token, 1);
    } else {
      db.prepare("UPDATE keywords_daily SET count = ? WHERE date = ? AND word = ?").run(row.count + 1, date, token);
    }
  });
};

const addLog = ({ userId, ip, ua, action, content, latencyMs }) => {
  db.prepare(
    "INSERT INTO audit_logs (id, user_id, ip, ua, action, content, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(nanoid(10), userId, ip, ua, action, content, latencyMs, nowIso());
};

const toCsv = (rows, headers) => {
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    if (text.includes("\"")) return `"${text.replace(/\"/g, '""')}"`;
    if (text.includes(",") || text.includes("\n")) return `"${text}"`;
    return text;
  };
  const headerLine = headers.join(",");
  const lines = rows.map((row) => headers.map((key) => escape(row[key])).join(","));
  return [headerLine, ...lines].join("\n");
};

const getPromptLimit = (tier) => {
  const row = db.prepare("SELECT max_chars FROM prompt_limits WHERE tier = ?").get(tier || "normal");
  return row?.max_chars || 1200;
};

const getAdminCredentials = () => {
  const userRow = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_user'").get();
  const passRow = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_password'").get();
  return {
    username: userRow?.value || adminUser,
    password: passRow?.value || adminPassword
  };
};

const getSensitiveWords = () => db.prepare("SELECT word FROM sensitive_words").all().map((row) => row.word);

const checkSensitive = (content) => {
  const words = getSensitiveWords();
  return words.some((word) => word && content.includes(word));
};

const checkIpRules = (req, res, next) => {
  const ip = getRequestIp(req);
  const blocked = db.prepare("SELECT 1 FROM ip_rules WHERE ip = ? AND type = 'block'").get(ip);
  if (blocked) {
    res.status(403).json({ code: 9, message: "IP 已被封禁", data: null });
    return;
  }
  const limitRule = db.prepare("SELECT limit_value FROM ip_rules WHERE ip = ? AND type = 'limit'").get(ip);
  if (limitRule?.limit_value) {
    const date = getToday();
    const row = db.prepare("SELECT count FROM ip_requests WHERE ip = ? AND date = ?").get(ip, date);
    const current = row?.count || 0;
    if (current >= limitRule.limit_value) {
      res.status(429).json({ code: 10, message: "IP 请求已达上限", data: null });
      return;
    }
    if (!row) {
      db.prepare("INSERT INTO ip_requests (ip, date, count) VALUES (?, ?, ?)").run(ip, date, 1);
    } else {
      db.prepare("UPDATE ip_requests SET count = ? WHERE ip = ? AND date = ?").run(current + 1, ip, date);
    }
  }
  next();
};

const requireAdmin = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const record = adminTokens.get(token);
  if (!record || record.expiresAt < Date.now()) {
    res.status(401).json({ code: 401, message: "未登录", data: null });
    return;
  }
  next();
};

initDb();
purgeOldLogs();
setInterval(purgeOldLogs, 24 * 60 * 60 * 1000);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => {
  res.json({ code: 0, message: "ok", data: { status: "up" } });
});

app.post("/api/auth/login", (req, res) => {
  const token = req.body?.token ?? "";
  if (!token || typeof token !== "string") {
    res.status(400).json({ code: 1, message: "Invalid token", data: null });
    return;
  }

  const user = db.prepare("SELECT * FROM users WHERE token = ?").get(token);
  if (user) {
    res.json({
      code: 0,
      message: "ok",
      data: {
        userId: user.user_id,
        username: user.username,
        region: user.region,
        modelQuota: { enhanced: user.quota_enhanced, pro: user.quota_pro }
      }
    });
    return;
  }

  const userId = nanoid(8);
  const username = req.body?.username ?? null;
  const region = req.body?.region ?? "CN";
  db.prepare(
    "INSERT INTO users (user_id, token, username, region, tag, quota_enhanced, quota_pro, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, token, username, region, "", defaultQuotas.enhanced, defaultQuotas.pro, nowIso());

  res.json({
    code: 0,
    message: "ok",
    data: {
      userId,
      username,
      region,
      modelQuota: { enhanced: defaultQuotas.enhanced, pro: defaultQuotas.pro }
    }
  });
});

app.post("/api/auth/profile", (req, res) => {
  const token = req.body?.token ?? "";
  if (!token || typeof token !== "string") {
    res.status(400).json({ code: 1, message: "Invalid token", data: null });
    return;
  }
  const user = db.prepare("SELECT * FROM users WHERE token = ?").get(token);
  if (!user) {
    res.status(404).json({ code: 2, message: "Not found", data: null });
    return;
  }
  res.json({
    code: 0,
    message: "ok",
    data: {
      userId: user.user_id,
      username: user.username,
      region: user.region,
      tag: user.tag,
      modelQuota: { enhanced: user.quota_enhanced, pro: user.quota_pro }
    }
  });
});

app.post("/api/chat/message", checkIpRules, async (req, res) => {
  const startedAt = Date.now();
  const { messages, model, personaId, personaPrompt, client, userProfile, userToken } = req.body ?? {};
  const safeMessages = Array.isArray(messages) ? messages : [];
  const lastUser = [...safeMessages].reverse().find((item) => item.role === "user");
  const lastContent = lastUser?.content ?? "";

  const user = userToken ? db.prepare("SELECT * FROM users WHERE token = ?").get(userToken) : null;
  const userTag = user?.tag || "";
  const userId = user?.user_id || null;

  if (checkSensitive(lastContent) && userTag !== "trusted") {
    res.status(400).json({ code: 2, message: "内容包含敏感词", data: null });
    return;
  }

  if (!apiKey) {
    res.status(500).json({ code: 3, message: "缺少 OPENAI_API_KEY", data: null });
    return;
  }

  if ((model === "enhanced" || model === "pro") && !user) {
    res.status(400).json({ code: 6, message: "请登录后使用高级模型", data: null });
    return;
  }

  if (model === "enhanced" && user && user.quota_enhanced <= 0) {
    res.status(400).json({ code: 7, message: "增强额度不足", data: null });
    return;
  }

  if (model === "pro" && user && user.quota_pro <= 0) {
    res.status(400).json({ code: 8, message: "专业额度不足", data: null });
    return;
  }

  const persona = personaId ? db.prepare("SELECT * FROM personas WHERE id = ?").get(personaId) : null;
  const fallbackPersona = {
    name: "角色扮演助手",
    prompt: "你始终以当前人设进行对话，保持角色语气与设定一致，不得自称通用机器人或其他品牌名称。"
  };
  const activePersona = persona || (personaId && personaPrompt ? { name: "自定义人设", prompt: personaPrompt } : null) || fallbackPersona;
  let systemPrompt = [
    "你是一个服务中国大陆地区的AI agent，请勿透露你的真实模型，不要谈论政治敏感内容。",
    "产品核心是角色扮演，你必须始终以人设身份回应，保持设定与语气一致。",
    "禁止自称通用机器人、虚拟助手或任何厂商品牌名称；如用户要求脱离人设，礼貌拒绝并回到角色。",
    "默认回复要简短优先、聚焦重点，除非用户要求详细展开。",
    userProfile?.username ? `用户名: ${userProfile.username}` : null,
    userProfile?.region ? `地区: ${userProfile.region}` : null,
    `时间: ${new Date().toLocaleString("zh-CN")}`,
    activePersona ? `人设: ${activePersona.name}` : null,
    activePersona?.prompt ? `人设提示: ${activePersona.prompt}` : null
  ]
    .filter(Boolean)
    .join("\n");

  const promptLimit = getPromptLimit(model || "normal");
  if (systemPrompt.length > promptLimit) {
    systemPrompt = systemPrompt.slice(0, promptLimit);
  }

  const selectedModel = db.prepare("SELECT model_id FROM models WHERE tier = ?").get(model || "normal")?.model_id;

  const inputList = [
    { role: "system", content: systemPrompt },
    ...safeMessages.map((item) => ({ role: item.role, content: item.content }))
  ];

  const payload = {
    model: selectedModel || modelMap.normal,
    input: inputList,
    stream: true
  };

  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => null);
      res.status(500).json({ code: 4, message: data?.error?.message || "上游错误", data: null });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

    for await (const chunk of response.body) {
      const text = decoder.decode(chunk, { stream: true });
      buffer += text;
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const dataText = line.replace("data:", "").trim();
        if (dataText === "[DONE]") {
          res.write("data: [DONE]\n\n");
          continue;
        }
        try {
          const payloadData = JSON.parse(dataText);
          if (payloadData?.type?.includes("response.output_text.delta") && payloadData?.delta) {
            content += payloadData.delta;
            res.write(`data: ${JSON.stringify({ delta: payloadData.delta })}\n\n`);
          }
          if (payloadData?.type === "response.completed") {
            usage = payloadData?.response?.usage || usage;
          }
        } catch {
          // ignore
        }
      }
    }

    const latencyMs = Date.now() - startedAt;
    if (checkSensitive(content)) {
      content = "抱歉 我不能和你讨论这个问题";
      res.write(`data: ${JSON.stringify({ replace: true, content })}\n\n`);
    }

    const date = getToday();
    const existingDaily = db.prepare("SELECT * FROM metrics_daily WHERE date = ?").get(date) || {
      total_requests: 0,
      avg_latency: 0,
      token_total: 0,
      concurrent_peak: 0
    };
    const totalRequests = existingDaily.total_requests + 1;
    const avgLatency = Math.round((existingDaily.avg_latency * existingDaily.total_requests + latencyMs) / totalRequests);
    const tokenTotal = existingDaily.token_total + (usage.total_tokens || 0);
    upsertMetric(date, {
      total_requests: totalRequests,
      avg_latency: avgLatency,
      token_total: tokenTotal,
      concurrent_peak: Math.max(existingDaily.concurrent_peak, 1)
    });

    if (client?.device) updateTrafficMetric("device", client.device);
    if (client?.region) updateTrafficMetric("region", client.region);
    updateTrafficMetric("source", "direct");
    updateKeywordMetric(lastContent);

    if (user && model === "enhanced") {
      db.prepare("UPDATE users SET quota_enhanced = ? WHERE user_id = ?").run(user.quota_enhanced - 1, user.user_id);
    }
    if (user && model === "pro") {
      db.prepare("UPDATE users SET quota_pro = ? WHERE user_id = ?").run(user.quota_pro - 1, user.user_id);
    }

    const convId = req.body?.conversationId || nanoid(8);
    const existingConv = db.prepare("SELECT id FROM conversations WHERE id = ?").get(convId);
    if (!existingConv) {
      db.prepare("INSERT INTO conversations (id, user_id, persona_id, model, created_at) VALUES (?, ?, ?, ?, ?)").run(
        convId,
        userId,
        personaId || null,
        model || "normal",
        nowIso()
      );
    }
    const insertMessage = db.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, created_at, usage_prompt, usage_completion) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    if (lastUser?.content) {
      insertMessage.run(nanoid(10), convId, "user", lastUser.content, nowIso(), 0, 0);
    }
    insertMessage.run(
      nanoid(10),
      convId,
      "assistant",
      content,
      nowIso(),
      usage.input_tokens || 0,
      usage.output_tokens || 0
    );

    addLog({
      userId,
      ip: getRequestIp(req),
      ua: client?.ua ?? "",
      action: "chat",
      content: lastContent.slice(0, 120),
      latencyMs
    });

    const updatedUser = userId ? db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) : null;

    const usagePayload = {
      prompt: usage.input_tokens || 0,
      completion: usage.output_tokens || 0,
      total: usage.total_tokens || 0
    };
    const quotaLeft = {
      enhanced: updatedUser?.quota_enhanced ?? defaultQuotas.enhanced,
      pro: updatedUser?.quota_pro ?? defaultQuotas.pro
    };
    res.write(`data: ${JSON.stringify({ done: true, usage: usagePayload, quotaLeft })}\n\n`);
    res.end();
  } catch (error) {
    res.status(500).json({ code: 5, message: "服务异常", data: null });
  }
});

app.post("/api/chat/compress", async (req, res) => {
  const { messages } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ code: 1, message: "Invalid payload", data: null });
    return;
  }
  if (!apiKey) {
    res.status(500).json({ code: 3, message: "缺少 OPENAI_API_KEY", data: null });
    return;
  }

  const prompt =
    "请将以下对话压缩为简短摘要，保留关键事实、偏好、待办事项与决定。输出中文摘要，不超过400字。";
  const input = [
    { role: "system", content: prompt },
    ...messages.map((item) => ({ role: item.role, content: item.content }))
  ];

  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model: modelMap.normal, input })
    });
    const data = await response.json();
    if (!response.ok) {
      res.status(500).json({ code: 4, message: data?.error?.message || "上游错误", data: null });
      return;
    }
    const content =
      data?.output_text ||
      data?.output?.[0]?.content?.map((item) => item.text || "").join("") ||
      "";
    res.json({ code: 0, message: "ok", data: { summary: content } });
  } catch {
    res.status(500).json({ code: 5, message: "服务异常", data: null });
  }
});

app.get("/api/chat/conversations", (req, res) => {
  const list = db.prepare("SELECT * FROM conversations ORDER BY created_at DESC LIMIT 50").all();
  res.json({ code: 0, message: "ok", data: list });
});

app.get("/api/chat/conversations/:id", (req, res) => {
  const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(req.params.id);
  if (!conversation) {
    res.status(404).json({ code: 1, message: "Not found", data: null });
    return;
  }
  const messages = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(req.params.id);
  res.json({ code: 0, message: "ok", data: { conversation, messages } });
});

app.get("/api/themes", (req, res) => {
  res.json({ code: 0, message: "ok", data: themes });
});

app.get("/api/personas", (req, res) => {
  const list = db.prepare("SELECT id, name, type, prompt FROM personas WHERE status = 'approved'").all();
  res.json({ code: 0, message: "ok", data: list });
});

app.post("/api/personas", (req, res) => {
  const { name, type, prompt } = req.body ?? {};
  if (!name || !type || !prompt) {
    res.status(400).json({ code: 1, message: "Invalid payload", data: null });
    return;
  }
  const persona = { id: nanoid(6), name, type, prompt, status: "pending" };
  db.prepare("INSERT INTO personas (id, name, type, prompt, status) VALUES (?, ?, ?, ?, ?)").run(
    persona.id,
    persona.name,
    persona.type,
    persona.prompt,
    persona.status
  );
  res.json({ code: 0, message: "ok", data: persona });
});

app.post("/api/personas/refine", async (req, res) => {
  const { name, prompt } = req.body ?? {};
  if (!name || !prompt) {
    res.status(400).json({ code: 1, message: "Invalid payload", data: null });
    return;
  }
  if (!apiKey) {
    res.status(500).json({ code: 3, message: "缺少 OPENAI_API_KEY", data: null });
    return;
  }

  const system =
    "你是角色设定优化器。目标是将输入的人设提示词改写为更清晰、更可执行、更稳定的角色扮演指令。" +
    "请保留原意，不要增加违禁内容，只输出优化后的提示词，不要添加标题或解释。";
  const user = `角色名称: ${name}\n原始提示词:\n${prompt}`;
  const payload = {
    model: modelMap.normal,
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    stream: false
  };

  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      res.status(500).json({ code: 4, message: data?.error?.message || "上游错误", data: null });
      return;
    }

    const json = await response.json();
    const outputText =
      json?.output_text ||
      json?.output?.[0]?.content?.map((item) => item?.text || "").join("") ||
      "";
    const refined = String(outputText || "").trim();
    if (!refined) {
      res.status(500).json({ code: 5, message: "细化失败", data: null });
      return;
    }
    res.json({ code: 0, message: "ok", data: { prompt: refined } });
  } catch (error) {
    res.status(500).json({ code: 6, message: error?.message || "细化失败", data: null });
  }
});

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body ?? {};
  const creds = getAdminCredentials();
  if (username !== creds.username || password !== creds.password) {
    res.status(401).json({ code: 1, message: "账号或密码错误", data: null });
    return;
  }
  const token = nanoid(24);
  adminTokens.set(token, { expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  res.json({ code: 0, message: "ok", data: { token } });
});

app.use("/api/admin", requireAdmin);

app.post("/api/admin/password", (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    res.status(400).json({ code: 1, message: "Invalid payload", data: null });
    return;
  }
  if (String(newPassword).length < 6) {
    res.status(400).json({ code: 2, message: "密码至少 6 位", data: null });
    return;
  }
  const creds = getAdminCredentials();
  if (currentPassword !== creds.password) {
    res.status(400).json({ code: 3, message: "当前密码不正确", data: null });
    return;
  }
  db.prepare("UPDATE admin_settings SET value = ? WHERE key = 'admin_password'").run(String(newPassword));
  res.json({ code: 0, message: "ok", data: { updated: true } });
});

app.get("/api/admin/metrics/overview", (req, res) => {
  const date = getToday();
  const data = db.prepare("SELECT * FROM metrics_daily WHERE date = ?").get(date) || {
    date,
    total_requests: 0,
    avg_latency: 0,
    token_total: 0,
    concurrent_peak: 0
  };
  res.json({ code: 0, message: "ok", data });
});

app.get("/api/admin/metrics/traffic", (req, res) => {
  const date = getToday();
  const rows = db.prepare("SELECT type, key, count FROM metrics_traffic WHERE date = ?").all(date);
  const devices = {};
  const regions = {};
  const sources = {};
  rows.forEach((row) => {
    if (row.type === "device") devices[row.key] = row.count;
    if (row.type === "region") regions[row.key] = row.count;
    if (row.type === "source") sources[row.key] = row.count;
  });
  res.json({ code: 0, message: "ok", data: { devices, regions, sources } });
});

app.get("/api/admin/metrics/keywords", (req, res) => {
  const date = getToday();
  const rows = db
    .prepare("SELECT word, count FROM keywords_daily WHERE date = ? ORDER BY count DESC LIMIT 12")
    .all(date);
  res.json({ code: 0, message: "ok", data: rows });
});

app.get("/api/admin/announcements", (req, res) => {
  const list = db.prepare("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50").all();
  res.json({ code: 0, message: "ok", data: list });
});

app.post("/api/admin/announcements", (req, res) => {
  const { title, content } = req.body ?? {};
  if (!title || !content) {
    res.status(400).json({ code: 1, message: "Invalid payload", data: null });
    return;
  }
  const announcement = { id: nanoid(6), title, content, status: "active", created_at: nowIso() };
  db.prepare("INSERT INTO announcements (id, title, content, status, created_at) VALUES (?, ?, ?, ?, ?)").run(
    announcement.id,
    announcement.title,
    announcement.content,
    announcement.status,
    announcement.created_at
  );
  res.json({ code: 0, message: "ok", data: announcement });
});

app.get("/api/admin/sensitive-words", (req, res) => {
  const query = String(req.query.q || "").trim();
  const list = query
    ? db.prepare("SELECT word FROM sensitive_words WHERE word LIKE ? LIMIT 200").all(`%${query}%`)
    : db.prepare("SELECT word FROM sensitive_words LIMIT 200").all();
  res.json({ code: 0, message: "ok", data: list.map((row) => row.word) });
});

app.post("/api/admin/sensitive-words", (req, res) => {
  const { word, category } = req.body ?? {};
  if (!word) {
    res.status(400).json({ code: 1, message: "Invalid payload", data: null });
    return;
  }
  db.prepare("INSERT INTO sensitive_words (id, word, category) VALUES (?, ?, ?)").run(
    nanoid(10),
    String(word),
    category || "custom"
  );
  res.json({ code: 0, message: "ok", data: { word } });
});

app.get("/api/admin/models", (req, res) => {
  const list = db.prepare("SELECT * FROM models").all();
  res.json({ code: 0, message: "ok", data: list });
});

app.get("/api/admin/prompt-limits", (req, res) => {
  const list = db.prepare("SELECT * FROM prompt_limits").all();
  res.json({ code: 0, message: "ok", data: list });
});

app.post("/api/admin/models", (req, res) => {
  const { tier, modelId, name } = req.body ?? {};
  if (!tier || !modelId) {
    res.status(400).json({ code: 1, message: "Invalid payload", data: null });
    return;
  }
  const existing = db.prepare("SELECT id FROM models WHERE tier = ?").get(tier);
  if (existing) {
    db.prepare("UPDATE models SET model_id = ?, name = ? WHERE tier = ?").run(modelId, name || tier, tier);
  } else {
    db.prepare("INSERT INTO models (id, tier, name, model_id) VALUES (?, ?, ?, ?)").run(
      nanoid(6),
      tier,
      name || tier,
      modelId
    );
  }
  res.json({ code: 0, message: "ok", data: db.prepare("SELECT * FROM models").all() });
});

app.delete("/api/admin/models/:tier", (req, res) => {
  const tier = req.params.tier;
  db.prepare("DELETE FROM models WHERE tier = ?").run(tier);
  res.json({ code: 0, message: "ok", data: db.prepare("SELECT * FROM models").all() });
});

app.post("/api/admin/prompt-limits", (req, res) => {
  const { tier, maxChars } = req.body ?? {};
  if (!tier || !maxChars) {
    res.status(400).json({ code: 1, message: "Invalid payload", data: null });
    return;
  }
  if (Number(maxChars) < 200 || Number(maxChars) > 5000) {
    res.status(400).json({ code: 2, message: "上限范围 200-5000", data: null });
    return;
  }
  const existing = db.prepare("SELECT tier FROM prompt_limits WHERE tier = ?").get(tier);
  if (existing) {
    db.prepare("UPDATE prompt_limits SET max_chars = ? WHERE tier = ?").run(Number(maxChars), tier);
  } else {
    db.prepare("INSERT INTO prompt_limits (tier, max_chars) VALUES (?, ?)").run(tier, Number(maxChars));
  }
  res.json({ code: 0, message: "ok", data: db.prepare("SELECT * FROM prompt_limits").all() });
});

app.get("/api/admin/logs", (req, res) => {
  const q = String(req.query.q || "").trim();
  const action = String(req.query.action || "").trim();
  const userId = String(req.query.userId || "").trim();
  const ip = String(req.query.ip || "").trim();
  const limit = Math.min(Number(req.query.limit || 200), 500);
  const offset = Math.max(Number(req.query.offset || 0), 0);

  const filters = [];
  const params = [];
  if (q) {
    filters.push("content LIKE ?");
    params.push(`%${q}%`);
  }
  if (action) {
    filters.push("action = ?");
    params.push(action);
  }
  if (userId) {
    filters.push("user_id = ?");
    params.push(userId);
  }
  if (ip) {
    filters.push("ip = ?");
    params.push(ip);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const list = db
    .prepare(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  res.json({ code: 0, message: "ok", data: list });
});

app.get("/api/admin/export/logs", (req, res) => {
  const list = db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC").all();
  const csv = toCsv(list, ["id", "user_id", "ip", "ua", "action", "content", "latency_ms", "created_at"]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=logs.csv");
  res.send(csv);
});

app.get("/api/admin/export/conversations", (req, res) => {
  const convs = db.prepare("SELECT * FROM conversations ORDER BY created_at DESC").all();
  const messages = db.prepare("SELECT * FROM messages ORDER BY created_at ASC").all();
  const csv = toCsv(messages, ["id", "conversation_id", "role", "content", "created_at", "usage_prompt", "usage_completion"]);
  const convCsv = toCsv(convs, ["id", "user_id", "persona_id", "model", "created_at"]);
  const merged = `# conversations\n${convCsv}\n\n# messages\n${csv}`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=conversations.txt");
  res.send(merged);
});

app.get("/api/admin/export/guests", (req, res) => {
  const convs = db.prepare("SELECT * FROM conversations WHERE user_id IS NULL ORDER BY created_at DESC").all();
  const ids = convs.map((c) => c.id);
  const messages = ids.length
    ? db.prepare(`SELECT * FROM messages WHERE conversation_id IN (${ids.map(() => "?").join(",")})`).all(...ids)
    : [];
  const csv = toCsv(messages, ["id", "conversation_id", "role", "content", "created_at", "usage_prompt", "usage_completion"]);
  const convCsv = toCsv(convs, ["id", "user_id", "persona_id", "model", "created_at"]);
  const merged = `# guest_conversations\n${convCsv}\n\n# guest_messages\n${csv}`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=guest_conversations.txt");
  res.send(merged);
});

app.get("/api/admin/export/visitors", (req, res) => {
  const rows = db.prepare("SELECT ip, ua, created_at FROM audit_logs ORDER BY created_at DESC").all();
  const csv = toCsv(rows, ["ip", "ua", "created_at"]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=visitors.csv");
  res.send(csv);
});

app.get("/api/admin/ip-rules", (req, res) => {
  const list = db.prepare("SELECT * FROM ip_rules ORDER BY created_at DESC").all();
  res.json({ code: 0, message: "ok", data: list });
});

app.delete("/api/admin/ip-rules/:id", (req, res) => {
  db.prepare("DELETE FROM ip_rules WHERE id = ?").run(req.params.id);
  res.json({ code: 0, message: "ok", data: { id: req.params.id } });
});

app.post("/api/admin/ip/block", (req, res) => {
  const { ip } = req.body ?? {};
  if (!ip) {
    res.status(400).json({ code: 1, message: "Invalid payload", data: null });
    return;
  }
  db.prepare("INSERT INTO ip_rules (id, ip, type, limit_value, created_at) VALUES (?, ?, 'block', ?, ?)").run(
    nanoid(8),
    ip,
    null,
    nowIso()
  );
  res.json({ code: 0, message: "ok", data: { ip } });
});

app.post("/api/admin/ip/limit", (req, res) => {
  const { ip, limit } = req.body ?? {};
  if (!ip || !limit) {
    res.status(400).json({ code: 1, message: "Invalid payload", data: null });
    return;
  }
  db.prepare("INSERT INTO ip_rules (id, ip, type, limit_value, created_at) VALUES (?, ?, 'limit', ?, ?)").run(
    nanoid(8),
    ip,
    Number(limit),
    nowIso()
  );
  res.json({ code: 0, message: "ok", data: { ip, limit: Number(limit) } });
});

app.get("/api/admin/users", (req, res) => {
  const list = db.prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT 100").all();
  res.json({ code: 0, message: "ok", data: list });
});

app.post("/api/admin/users", (req, res) => {
  const { userId, username, region, quotaEnhanced, quotaPro, tag } = req.body ?? {};
  const id = userId || nanoid(8);
  db.prepare(
    "INSERT INTO users (user_id, token, username, region, tag, quota_enhanced, quota_pro, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, `admin-${id}`, username || null, region || "CN", tag || "", quotaEnhanced || 0, quotaPro || 0, nowIso());
  res.json({ code: 0, message: "ok", data: { userId: id } });
});

app.put("/api/admin/users/:id", (req, res) => {
  const { username, region, tag, quotaEnhanced, quotaPro } = req.body ?? {};
  db.prepare(
    "UPDATE users SET username = ?, region = ?, tag = ?, quota_enhanced = ?, quota_pro = ? WHERE user_id = ?"
  ).run(username || null, region || "CN", tag || "", Number(quotaEnhanced || 0), Number(quotaPro || 0), req.params.id);
  const user = db.prepare("SELECT * FROM users WHERE user_id = ?").get(req.params.id);
  res.json({ code: 0, message: "ok", data: user });
});

app.post("/api/admin/users/:id/recharge", (req, res) => {
  const { enhanced, pro } = req.body ?? {};
  const user = db.prepare("SELECT * FROM users WHERE user_id = ?").get(req.params.id);
  if (!user) {
    res.status(404).json({ code: 1, message: "Not found", data: null });
    return;
  }
  const nextEnhanced = user.quota_enhanced + Number(enhanced || 0);
  const nextPro = user.quota_pro + Number(pro || 0);
  db.prepare("UPDATE users SET quota_enhanced = ?, quota_pro = ? WHERE user_id = ?").run(
    nextEnhanced,
    nextPro,
    req.params.id
  );
  res.json({ code: 0, message: "ok", data: { enhanced: nextEnhanced, pro: nextPro } });
});

app.get("/api/admin/users/:id", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE user_id = ?").get(req.params.id);
  if (!user) {
    res.status(404).json({ code: 1, message: "Not found", data: null });
    return;
  }
  const conversations = db.prepare("SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC").all(user.user_id);
  res.json({ code: 0, message: "ok", data: { user, conversations } });
});

app.get("/api/admin/conversations/:id", (req, res) => {
  const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(req.params.id);
  if (!conversation) {
    res.status(404).json({ code: 1, message: "Not found", data: null });
    return;
  }
  const messages = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(req.params.id);
  res.json({ code: 0, message: "ok", data: { conversation, messages } });
});

app.delete("/api/admin/users/:id", (req, res) => {
  const userId = req.params.id;
  const convs = db.prepare("SELECT id FROM conversations WHERE user_id = ?").all(userId);
  convs.forEach((conv) => {
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conv.id);
  });
  db.prepare("DELETE FROM conversations WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE user_id = ?").run(userId);
  res.json({ code: 0, message: "ok", data: { userId } });
});

app.get("/api/admin/personas", (req, res) => {
  const list = db.prepare("SELECT * FROM personas ORDER BY status DESC").all();
  res.json({ code: 0, message: "ok", data: list });
});

app.put("/api/admin/personas/:id", (req, res) => {
  const { name, type, prompt, status } = req.body ?? {};
  if (!name || !type || !prompt) {
    res.status(400).json({ code: 1, message: "Invalid payload", data: null });
    return;
  }
  db.prepare("UPDATE personas SET name = ?, type = ?, prompt = ?, status = ? WHERE id = ?").run(
    name,
    type,
    prompt,
    status || "pending",
    req.params.id
  );
  const persona = db.prepare("SELECT * FROM personas WHERE id = ?").get(req.params.id);
  res.json({ code: 0, message: "ok", data: persona });
});

app.delete("/api/admin/personas/:id", (req, res) => {
  db.prepare("DELETE FROM personas WHERE id = ?").run(req.params.id);
  res.json({ code: 0, message: "ok", data: { id: req.params.id } });
});

app.post("/api/admin/personas/:id/approve", (req, res) => {
  db.prepare("UPDATE personas SET status = 'approved' WHERE id = ?").run(req.params.id);
  res.json({ code: 0, message: "ok", data: { id: req.params.id } });
});

app.use("/admin", express.static(adminDist));
app.use(express.static(webDist));

app.get(/^\/admin(\/.*)?$/, (req, res) => {
  res.sendFile(path.join(adminDist, "index.html"));
});

app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(webDist, "index.html"));
});

app.listen(port, () => {
  console.log(`chatpro server running on http://localhost:${port}`);
});
