// server.js ─ Render Web Service + Telegraf Webhook
require("dotenv").config();
const http = require("http");
const crypto = require("crypto");
const { Telegraf } = require("telegraf");

const TOKEN = process.env.BOT_TOKEN;                 // 机器人 Token
const PUBLIC_URL = process.env.PUBLIC_URL;           // Render 主地址，如：https://xxx.onrender.com
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(16).toString("hex");
const ALERT_CHAT_ID = process.env.ALERT_CHAT_ID      // 警报群 chatId（负数，形如 -100xxxxxxxxxx）
  ? Number(process.env.ALERT_CHAT_ID)
  : null;

if (!TOKEN || !PUBLIC_URL || !ALERT_CHAT_ID) {
  console.error("❌ 缺少环境变量：BOT_TOKEN / PUBLIC_URL / ALERT_CHAT_ID");
  process.exit(1);
}

const bot = new Telegraf(TOKEN);

// ===== 逻辑：任意人回话=已回复；忽略警报群；提醒发到警报群 =====
const REMIND_AFTER_MS = 10 * 1000;
const pendingByChat = new Map(); // chatId -> { timeout, askerId, askerName, askerText }

const nameOf = (u = {}) => (u.username ? "@" + u.username : (u.first_name || "未知用户"));
const preview = (m = {}) => m.text || m.caption || "（非文本消息）";

bot.on("message", async (ctx) => {
  // 只处理群；忽略机器人；忽略警报群
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return;
  if (ctx.from.is_bot) return;
  if (ctx.chat.id === ALERT_CHAT_ID) return;

  const chatId = ctx.chat.id;

  // 如果存在待回复状态：只要“任何人”（包括提问者/管理员）说话，即视为已回复 → 取消计时
  const pending = pendingByChat.get(chatId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingByChat.delete(chatId);
    return;
  }

  // 没有待回复状态 → 当前消息视为“问题”，开始计时
  const askerName = nameOf(ctx.from);
  const askerText = preview(ctx.message);
  const srcTitle = ctx.chat.title || "(无标题)";

  const timeout = setTimeout(async () => {
    try {
      // 提醒发到固定“警报群”，并带上来源群信息
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

  pendingByChat.set(chatId, { timeout, askerId: ctx.from.id, askerName, askerText });
});

// 可选：查 chatId（在任何群里发 /chatid）
bot.command("chatid", (ctx) => ctx.reply(`chatId: ${ctx.chat.id}`));

// ===== Webhook 绑定 =====
const WEBHOOK_PATH = `/webhook/${WEBHOOK_SECRET}`;
const WEBHOOK_URL = `${PUBLIC_URL}${WEBHOOK_PATH}`;

async function setupWebhook() {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true }); // 清旧配置
    await bot.telegram.setWebhook(WEBHOOK_URL);
    console.log("✅ Webhook set:", WEBHOOK_URL);
  } catch (e) {
    console.error("设置 webhook 失败：", e);
    process.exit(1);
  }
}

// 原生 HTTP server（Render 需要监听端口）
const PORT = process.env.PORT || 3000;
const callback = bot.webhookCallback(WEBHOOK_PATH);

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
