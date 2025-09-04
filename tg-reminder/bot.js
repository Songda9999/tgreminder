require("dotenv").config();
const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);
const REMIND_AFTER_MS = 10 * 1000;

const pendingByChat = new Map();
const nameOf = (u={}) => (u.username ? "@"+u.username : (u.first_name || "未知用户"));
const preview = (m={}) => m.text || m.caption || "（非文本消息）";

bot.on("message", (ctx) => {
  // 只处理群
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return;
  // 忽略机器人消息（包括本机器人）
  if (ctx.from.is_bot) return;

  const chatId = ctx.chat.id;
  const fromId = ctx.from.id;
  const pending = pendingByChat.get(chatId);

  // 已有一个“待回复问题”
  if (pending) {
    // 只要不是提问者本人发言，就视为“已回复”
    if (fromId !== pending.askerId) {
      clearTimeout(pending.timeout);
      pendingByChat.delete(chatId);
    }
    return;
  }

  // 没有 pending → 记录新问题并开始 10 秒计时
  const askerName = nameOf(ctx.from);
  const askerText = preview(ctx.message);

  const timeout = setTimeout(() => {
    ctx.telegram.sendMessage(
      chatId,
      `⚠️ 10秒未回复提醒\n用户：${askerName}\n内容：${askerText}`
    );
    pendingByChat.delete(chatId);
  }, REMIND_AFTER_MS);

  pendingByChat.set(chatId, { timeout, askerId: fromId, askerName, askerText });
});

// 清理旧 webhook，避免 409 冲突；长轮询模式，无需域名
(async () => {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch();
    console.log("🤖 Bot running…");
  } catch (e) {
    console.error("启动失败：", e.message);
    process.exit(1);
  }
})();
