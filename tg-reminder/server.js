// server.js ─ Render Web Service + Telegraf Webhook (stable logic)
require("dotenv").config();
const http = require("http");
const crypto = require("crypto");
const { Telegraf } = require("telegraf");

const TOKEN = process.env.BOT_TOKEN;                 // Bot Token
const PUBLIC_URL = process.env.PUBLIC_URL;           // 例: https://xxx.onrender.com
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(16).toString("hex");
const ALERT_CHAT_ID = process.env.ALERT_CHAT_ID ? Number(process.env.ALERT_CHAT_ID) : null; // -100xxxx

// 管理员名单（任填其一或都填）：ADMIN_IDS=用逗号分隔的数字ID；ADMIN_USERNAMES=用逗号分隔的不带@用户名
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean); // 例: "2092096693,123456789"
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || "")
  .split(",").map(s => s.trim().replace(/^@/, "").toLowerCase()).filter(Boolean); // 例: "songda,alice"

if (!TOKEN || !PUBLIC_URL || !ALERT_CHAT_ID) {
  console.error("❌ 缺少环境变量：BOT_TOKEN / PUBLIC_URL / ALERT_CHAT_ID");
  process.exit(1);
}

const bot = new Telegraf(TOKEN);
const REMIND_AFTER_MS = Number(process.env.REMIND_AFTER_MS || 10) * 1000;

// 每个业务群的 pending：chatId -> { timeout, askerId, askerName, askerText }
const pendingByChat = new Map();

const nameOf = (u = {}) => (u.username ? "@" + u.username : (u.first_name || "未知用户"));
const textPreview = (m = {}) => {
  const t = m.text || m.caption;
  if (t) return t.length > 180 ? t.slice(0, 177) + "..." : t;
  if (m.photo) return "🖼️ 图片";
  if (m.sticker) return "😊 贴纸";
  if (m.voice) return "🎤 语音";
  if (m.video) return "🎞️ 视频";
  if (m.document) return "📎 文件";
  return "（非文本消息）";
};
const isAdminUser = (u = {}) =>
  ADMIN_IDS.includes(String(u.id)) ||
  (u.username && ADMIN_USERNAMES.includes(u.username.toLowerCase()));

// 只处理群消息；忽略机器人；忽略警报群；过滤系统事件（非文本/无caption的普通内容以外的）
bot.on("message", async (ctx) => {
  const chat = ctx.chat;
  const msg = ctx.message;
  const user = ctx.from;

  if (chat.type !== "group" && chat.type !== "supergroup") return;
  if (user.is_bot) return;
  if (chat.id === ALERT_CHAT_ID) return;

  // 过滤进群/退群/置顶等系统事件，仅对“文本或带caption的媒体”计时
  const isTextOrCaption = !!(msg.text || msg.caption);
  const isMedia = !!(msg.photo || msg.video || msg.document || msg.voice || msg.sticker);
  if (!isTextOrCaption && !isMedia) return;

  const chatId = chat.id;
  const pending = pendingByChat.get(chatId);

  // ① 有 pending：任何人（包含管理员/提问者）发言 = 已回复 → 清计时
  if (pending) {
    clearTimeout(pending.timeout);
    pendingByChat.delete(chatId);
    return;
  }

  // ② 无 pending：只有“非管理员”的消息才开启新计时
  if (isAdminUser(user)) {
    return; // 管理员消息不触发
  }

  // 开启新计时
  const askerName = nameOf(user);
  const askerText = textPreview(msg);
  const srcTitle = chat.title || "(无标题)";
  const srcId = chat.id;

  const timeout = setTimeout(async () => {
    try {
      await ctx.telegram.sendMessage(
        ALERT_CHAT_ID,
        `⚠️ 超时未回复\n来源群：${srcTitle} (ID: ${srcId})\n用户：${askerName}\n内容：${askerText}\n（设定：${REMIND_AFTER_MS / 1000} 秒）`
      );
    } catch (e) {
      console.error("发送到警报群失败：", e.message);
    } finally {
      pendingByChat.delete(chatId);
    }
  }, REMIND_AFTER_MS);

  pendingByChat.set(chatId, { timeout, askerId: user.id, askerName, askerText });
});

// 调试命令：在任意群发 /chatid 获取该群 chatId
bot.command("chatid", (ctx) => {
  ctx.reply(`chatId: ${ctx.chat.id}\ntype: ${ctx.chat.type}\ntitle: ${ctx.chat.title || ""}`);
});

// ===== Webhook 绑定（Render Web Service）=====
const WEBHOOK_PATH = `/webhook/${WEBHOOK_SECRET}`;
const WEBHOOK_URL = `${PUBLIC_URL}${WEBHOOK_PATH}`;
const callback = bot.webhookCallback(WEBHOOK_PATH);

async function setupWebhook() {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.telegram.setWebhook(WEBHOOK_URL);
    console.log("✅ Webhook set:", WEBHOOK_URL);
  } catch (e) {
    console.error("设置 webhook 失败：", e);
    process.exit(1);
  }
}

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (req.method === "POST" && req.url === WEBHOOK_PATH) return callback(req, res);
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }
  res.writeHead(404); res.end();
}).listen(PORT, async () => {
  console.log(`HTTP server listening on ${PORT}`);
  await setupWebhook();
});
