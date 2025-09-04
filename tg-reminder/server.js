// server.js ─ Render Web Service + Telegraf Webhook (fixed admin logic)
require("dotenv").config();
const http = require("http");
const crypto = require("crypto");
const { Telegraf } = require("telegraf");

const TOKEN = process.env.BOT_TOKEN;                 // Bot Token
const PUBLIC_URL = process.env.PUBLIC_URL;           // 例: https://xxx.onrender.com
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(16).toString("hex");
const ALERT_CHAT_ID = process.env.ALERT_CHAT_ID ? Number(process.env.ALERT_CHAT_ID) : null; // -100xxxx

// 新增：管理员名单（ID 或 用户名，二选一或都用）
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean); // 例如: "2092096693,123456789"
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || "")
  .split(",")
  .map(s => s.trim().replace(/^@/, "").toLowerCase())
  .filter(Boolean); // 例如: "songda,alice"

if (!TOKEN || !PUBLIC_URL || !ALERT_CHAT_ID) {
  console.error("❌ 缺少环境变量：BOT_TOKEN / PUBLIC_URL / ALERT_CHAT_ID");
  process.exit(1);
}

const bot = new Telegraf(TOKEN);
const REMIND_AFTER_MS = 10 * 1000;

// 每个业务群的 pending 计时：chatId -> { timeout, askerId, askerName, askerText }
const pendingByChat = new Map();

const nameOf = (u = {}) => (u.username ? "@" + u.username : (u.first_name || "未知用户"));
const preview = (m = {}) => m.text || m.caption || "（非文本消息）";
const isAdminUser = (u = {}) =>
  ADMIN_IDS.includes(String(u.id)) ||
  (u.username && ADMIN_USERNAMES.includes(u.username.toLowerCase()));

bot.on("message", async (ctx) => {
  // 只处理群；忽略机器人；忽略警报群
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return;
  if (ctx.from.is_bot) return;
  if (ctx.chat.id === ALERT_CHAT_ID) return;

  const chatId = ctx.chat.id;
  const user = ctx.from;
  const pending = pendingByChat.get(chatId);

  // ① 有 pending：任何人发言 = 已回复 → 清计时，不再新开
  if (pending) {
    clearTimeout(pending.timeout);
    pendingByChat.delete(chatId);
    return;
  }

  // ② 无 pending：只有“非管理员”的消息才视为新问题并开启计时
  if (isAdminUser(user)) {
    // 管理员的消息不触发新计时，直接忽略
    return;
  }

  // 开启新计时
  const askerName = nameOf(user);
  const askerText = preview(ctx.message);
  const srcTitle = ctx.chat.title || "(无标题)";

  const timeout = setTimeout(async () => {
    try {
      await ctx.telegram.sendMessage(
        ALERT_CHAT_ID,
        `⚠️ 10秒未回复提醒\n来源群：${srcTitle}\n用户：${askerName}\n内容：${askerText}`
      );
    } catch (e) {
      console.error("发送到警报群失败：", e.message);
    } finally {
      pendingByChat.delete(chatId);
    }
  }, REMIND_AFTER_MS);

  pendingByChat.set(chatId, { timeout, askerId: user.id, askerName, askerText });
});

// 调试命令：在任意群发 /chatid 获取该群的 chatId
bot.command("chatid", (ctx) => ctx.reply(`chatId: ${ctx.chat.id}\ntype: ${ctx.chat.type}\ntitle: ${ctx.chat.title || ""}`));

// ===== Webhook 绑定 =====
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
