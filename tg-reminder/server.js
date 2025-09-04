// server.js
require("dotenv").config();
const http = require("http");
const { Telegraf } = require("telegraf");

// === Telegram bot (long polling) ===
const bot = new Telegraf(process.env.BOT_TOKEN);

// 你的群内10秒提醒逻辑（可替换为你现有 bot.js 里的处理）
const REMIND_AFTER_MS = 10 * 1000;
const pendingByChat = new Map();
const nameOf = (u={}) => (u.username ? "@"+u.username : (u.first_name || "未知用户"));
const preview = (m={}) => m.text || m.caption || "（非文本消息）";

bot.on("message", (ctx) => {
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return;
  if (ctx.from.is_bot) return;

  const chatId = ctx.chat.id;
  const fromId = ctx.from.id;
  const pending = pendingByChat.get(chatId);

  if (pending) {
    if (fromId !== pending.askerId) {
      clearTimeout(pending.timeout);
      pendingByChat.delete(chatId);
    }
    return;
  }

  const askerName = nameOf(ctx.from);
  const askerText = preview(ctx.message);

  const timeout = setTimeout(() => {
    ctx.telegram.sendMessage(chatId, `⚠️ 10秒未回复提醒\n用户：${askerName}\n内容：${askerText}`);
    pendingByChat.delete(chatId);
  }, REMIND_AFTER_MS);

  pendingByChat.set(chatId, { timeout, askerId: fromId, askerName, askerText });
});

(async () => {
  // 防 409：确保用长轮询
  await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  await bot.launch();
  console.log("🤖 Bot started (long polling)");
})().catch(e => {
  console.error("Bot start failed:", e);
  process.exit(1);
});

// === Tiny HTTP server for Render ===
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    if (req.url === "/" || req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }
    res.writeHead(404);
    res.end();
  })
  .listen(PORT, () => console.log(`HTTP server listening on ${PORT}`));
