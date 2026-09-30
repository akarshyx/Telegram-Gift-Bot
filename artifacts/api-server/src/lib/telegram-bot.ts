import { randomBytes } from "node:crypto";
import { logger } from "./logger";
import {
  TelegramApiError,
  TelegramBotApi,
  type InlineKeyboardButton,
  type TelegramGift,
  type TelegramUpdate,
} from "./telegram-api";
import {
  loadTelegramBotState,
  saveTelegramBotState,
  type PendingSend,
  type TelegramBotState,
} from "./telegram-state";

const REGULAR_GIFT_LIMIT = 7;
const PREMIUM_STAR_COUNT = 1000;
const GIFT_PAGE_SIZE = 8;
const ALLOWED_TELEGRAM_USER_ID = 8598790977;

interface GiftMenu {
  gifts: TelegramGift[];
  expiresAt: number;
}

function newId(): string {
  return randomBytes(6).toString("hex");
}

function isPrivateMessage(
  message: NonNullable<TelegramUpdate["message"]>,
): boolean {
  return message.chat.type === "private" && message.from?.id === message.chat.id;
}

function isAllowedTelegramUser(user: { id: number }): boolean {
  return user.id === ALLOWED_TELEGRAM_USER_ID;
}

function quantityLines(gift: TelegramGift): string[] {
  const lines: string[] = [];

  if (gift.personal_remaining_count !== undefined) {
    const total =
      gift.personal_total_count === undefined
        ? ""
        : ` of ${gift.personal_total_count}`;
    lines.push(`Bot availability: ${gift.personal_remaining_count}${total}`);
  }
  if (gift.remaining_count !== undefined) {
    const total =
      gift.total_count === undefined ? "" : ` of ${gift.total_count}`;
    lines.push(`Overall availability: ${gift.remaining_count}${total}`);
  }
  if (lines.length === 0) {
    lines.push("Quantity/availability: not provided by Telegram for this gift.");
  }

  return lines;
}

function giftEmoji(gift: TelegramGift): string {
  return gift.sticker.emoji
    ? `${gift.sticker.emoji} (sticker)`
    : "Sticker (the API did not provide an emoji)";
}

function isInStock(gift: TelegramGift): boolean {
  return gift.remaining_count !== 0 && gift.personal_remaining_count !== 0;
}

function isEligibleGift(gift: TelegramGift): boolean {
  return (
    typeof gift.id === "string" &&
    Number.isSafeInteger(gift.star_count) &&
    gift.star_count > 0 &&
    Number.isSafeInteger(gift.upgrade_star_count) &&
    gift.upgrade_star_count! >= 0 &&
    isInStock(gift)
  );
}

function displayError(error: unknown): string {
  if (error instanceof TelegramApiError) {
    return error.message;
  }
  return "An unexpected error occurred.";
}

export async function runTelegramBot(): Promise<void> {
  const token = process.env.BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("BOT_TOKEN is required to start the Telegram gift bot.");
  }

  const api = new TelegramBotApi(token);
  const state = await loadTelegramBotState();
  const giftMenus = new Map<string, GiftMenu>();
  let offset = 0;

  if (state.pendingSend?.status === "sending") {
    state.pendingSend.status = "uncertain";
    await saveTelegramBotState(state);
  }

  const bot = await api.getMe();
  logger.info(
    { username: bot.username ?? "no username returned" },
    "Telegram gift bot connected using the official Bot API",
  );

  async function sendMainMenu(chatId: number): Promise<void> {
    if (state.pendingSend?.status === "uncertain") {
      await sendUncertainSendInstructions(chatId, state.pendingSend);
      return;
    }
    if (state.pendingSend?.status === "ready") {
      await showPendingConfirmation(chatId, state.pendingSend);
      return;
    }

    const recipient =
      state.recipientUserId === undefined
        ? "Not set"
        : String(state.recipientUserId);
    const lines = [
      "Telegram Gifts",
      `Recipient user ID: ${recipient}`,
      `Regular gifts sent: ${state.sentRegularGiftCount}/${REGULAR_GIFT_LIMIT}`,
      "",
      "Each regular gift needs its own confirmation. The bot never sends a batch.",
    ];
    const keyboard: InlineKeyboardButton[][] = [
      [{ text: "Set recipient user ID", callback_data: "recipient" }],
    ];
    if (state.sentRegularGiftCount < REGULAR_GIFT_LIMIT) {
      keyboard.push([
        { text: "Choose one regular gift", callback_data: "regular" },
      ]);
    } else {
      lines.push("", "The requested 7 regular gifts have been sent.");
    }
    keyboard.push([
      {
        text: "3-month Premium — 1,000 Stars",
        callback_data: "premium",
      },
    ]);
    await api.sendMessage(chatId, lines.join("\n"), keyboard);
  }

  async function sendUncertainSendInstructions(
    chatId: number,
    pending: PendingSend,
  ): Promise<void> {
    const description =
      pending.kind === "gift"
        ? `${giftEmoji(pending.gift)}\nGift ID: ${pending.gift.id}`
        : "3-month Telegram Premium";
    const text = [
      "The previous send has an unknown result because the connection ended before Telegram confirmed it.",
      description,
      "",
      "Check the recipient's Telegram account before choosing. Do not mark it unsent unless you verified it was not delivered.",
    ].join("\n");
    await api.sendMessage(chatId, text, [
      [{ text: "I checked: it was sent", callback_data: `sent:${pending.id}` }],
      [
        {
          text: "I checked: it was not sent",
          callback_data: `unsent:${pending.id}`,
        },
      ],
    ]);
  }

  async function showPendingConfirmation(
    chatId: number,
    pending: PendingSend,
  ): Promise<void> {
    if (pending.kind === "premium") {
      await api.sendMessage(
        chatId,
        [
          "Confirm 3-month Telegram Premium gift",
          `Recipient user ID: ${pending.targetUserId}`,
          `Cost: ${PREMIUM_STAR_COUNT.toLocaleString("en-US")} Stars`,
          "",
          "Telegram's Bot API requires confirmation before this is sent.",
        ].join("\n"),
        [
          [{ text: "Confirm and send Premium", callback_data: `cp:${pending.id}` }],
          [{ text: "Cancel", callback_data: `cancel:${pending.id}` }],
        ],
      );
      return;
    }

    const upgradeCost = pending.gift.upgrade_star_count!;
    const totalCost = pending.gift.star_count + upgradeCost;
    const text = [
      "Confirm this one regular gift",
      `Gift: ${giftEmoji(pending.gift)}`,
      `gift_id: ${pending.gift.id}`,
      `Gift price: ${pending.gift.star_count} Stars`,
      `upgrade_star_count: ${upgradeCost} Stars`,
      `Total required: ${totalCost} Stars`,
      `Recipient user ID: ${pending.targetUserId}`,
      ...quantityLines(pending.gift),
      "",
      "Sending with pay_for_upgrade=true. The bot prepays the upgrade cost; this does not send an already-existing Unique Gift.",
      "Future resale/transfer cooldown information is not provided by the Bot API.",
    ].join("\n");
    await api.sendMessage(chatId, text, [
      [{ text: "Confirm and send this one gift", callback_data: `cg:${pending.id}` }],
      [{ text: "Cancel", callback_data: `cancel:${pending.id}` }],
    ]);
  }

  const askForRecipient = async (chatId: number): Promise<void> => {
    if (state.pendingSend) {
      await api.sendMessage(chatId, "Resolve or finish the pending send first.");
      return;
    }
    state.awaitingRecipient = true;
    await saveTelegramBotState(state);
    await api.sendMessage(
      chatId,
      "Send the recipient's numeric Telegram user ID in this private chat.",
    );
  };

  const showGiftPage = async (
    chatId: number,
    gifts: TelegramGift[],
    page: number,
    sessionId: string,
  ): Promise<void> => {
    const start = page * GIFT_PAGE_SIZE;
    const pageGifts = gifts.slice(start, start + GIFT_PAGE_SIZE);
    const keyboard: InlineKeyboardButton[][] = pageGifts.map((gift, index) => [
      {
        text: `${gift.sticker.emoji ?? "Sticker"} · ${gift.star_count + gift.upgrade_star_count!} Stars`,
        callback_data: `g:${sessionId}:${start + index}`,
      },
    ]);
    if (start + GIFT_PAGE_SIZE < gifts.length) {
      keyboard.push([
        {
          text: "More gifts",
          callback_data: `p:${sessionId}:${page + 1}`,
        },
      ]);
    }
    keyboard.push([{ text: "Back", callback_data: "menu" }]);

    const details = pageGifts
      .map(
        (gift) =>
          `${gift.sticker.emoji ?? "Sticker"}\ngift_id: ${gift.id}\nGift: ${gift.star_count} Stars · Upgrade: ${gift.upgrade_star_count} Stars · Total: ${gift.star_count + gift.upgrade_star_count!} Stars`,
      )
      .join("\n\n");
    const pageCount = Math.max(1, Math.ceil(gifts.length / GIFT_PAGE_SIZE));
    await api.sendMessage(
      chatId,
      [
        `Choose one eligible upgradeable gift (${state.sentRegularGiftCount + 1}/${REGULAR_GIFT_LIMIT})`,
        `Page ${page + 1}/${pageCount}. No gift is sent by selecting it.`,
        "",
        details,
      ].join("\n"),
      keyboard,
    );
  };

  const showGiftSelection = async (chatId: number): Promise<void> => {
    if (state.recipientUserId === undefined) {
      await askForRecipient(chatId);
      return;
    }
    if (state.sentRegularGiftCount >= REGULAR_GIFT_LIMIT) {
      await api.sendMessage(chatId, "All 7 regular gifts have already been sent.");
      return;
    }

    const gifts = await api.getAvailableGifts();
    const eligible = gifts.filter(isEligibleGift);
    if (eligible.length === 0) {
      await api.sendMessage(
        chatId,
        "Telegram did not report an upgrade_star_count for any currently available gift, so there are no gifts eligible for this prepaid-upgrade flow.",
        [[{ text: "Back", callback_data: "menu" }]],
      );
      return;
    }

    const sessionId = newId();
    giftMenus.set(sessionId, {
      gifts: eligible,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    for (const [key, value] of giftMenus) {
      if (value.expiresAt < Date.now()) giftMenus.delete(key);
    }
    await showGiftPage(chatId, eligible, 0, sessionId);
  };

  const preparePremium = async (chatId: number): Promise<void> => {
    if (state.recipientUserId === undefined) {
      await askForRecipient(chatId);
      return;
    }
    if (state.pendingSend) {
      await sendMainMenu(chatId);
      return;
    }

    const pending: PendingSend = {
      id: newId(),
      kind: "premium",
      targetUserId: state.recipientUserId,
      status: "ready",
    };
    state.pendingSend = pending;
    await saveTelegramBotState(state);
    await showPendingConfirmation(chatId, pending);
  };

  const handleMessage = async (
    message: NonNullable<TelegramUpdate["message"]>,
  ): Promise<void> => {
    if (
      !isPrivateMessage(message) ||
      !message.from ||
      !message.text ||
      !isAllowedTelegramUser(message.from)
    ) {
      return;
    }
    const chatId = message.chat.id;
    const text = message.text.trim();

    if (/^\/(?:start|menu)(?:@\w+)?(?:\s|$)/.test(text)) {
      await sendMainMenu(chatId);
      return;
    }
    if (/^\/recipient(?:@\w+)?(?:\s|$)/.test(text)) {
      await askForRecipient(chatId);
      return;
    }
    if (/^\/gifts(?:@\w+)?(?:\s|$)/.test(text)) {
      if (state.pendingSend) {
        await sendMainMenu(chatId);
      } else {
        await showGiftSelection(chatId);
      }
      return;
    }
    if (/^\/premium(?:@\w+)?(?:\s|$)/.test(text)) {
      await preparePremium(chatId);
      return;
    }
    if (/^\/cancel(?:@\w+)?(?:\s|$)/.test(text)) {
      if (state.pendingSend?.status === "ready") {
        state.pendingSend = undefined;
        state.awaitingRecipient = false;
        await saveTelegramBotState(state);
        await api.sendMessage(chatId, "Pending send cancelled.");
      } else if (state.awaitingRecipient) {
        state.awaitingRecipient = false;
        await saveTelegramBotState(state);
        await api.sendMessage(chatId, "Recipient entry cancelled.");
      } else {
        await api.sendMessage(chatId, "There is no cancellable send.");
      }
      await sendMainMenu(chatId);
      return;
    }
    if (state.awaitingRecipient) {
      const userId = Number(text);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        await api.sendMessage(
          chatId,
          "Enter a positive numeric Telegram user ID, or use /menu to cancel.",
        );
        return;
      }
      state.recipientUserId = userId;
      state.awaitingRecipient = false;
      await saveTelegramBotState(state);
      await api.sendMessage(chatId, `Recipient set to user ID ${userId}.`);
      await sendMainMenu(chatId);
      return;
    }

    await api.sendMessage(
      chatId,
      "Use /menu to continue, /recipient to change the recipient, /gifts to choose a regular gift, or /premium for 3-month Premium.",
    );
  };

  const handleGiftConfirmation = async (
    chatId: number,
    messageId: number | undefined,
    pending: PendingSend,
  ): Promise<void> => {
    if (pending.status !== "ready") {
      await api.sendMessage(chatId, "This send is already being processed.");
      return;
    }

    pending.status = "sending";
    await saveTelegramBotState(state);
    if (messageId !== undefined) {
      try {
        await api.editMessageReplyMarkup(chatId, messageId);
      } catch (error) {
        logger.debug(
          { error: displayError(error) },
          "Could not remove the old Telegram confirmation buttons",
        );
      }
    }

    try {
      if (pending.kind === "gift") {
        await api.sendGift(pending.targetUserId, pending.gift.id);
      } else {
        await api.giftPremiumSubscription(pending.targetUserId);
      }
    } catch (error) {
      if (error instanceof TelegramApiError && error.isApiResponse) {
        state.pendingSend = undefined;
        await saveTelegramBotState(state);
        await api.sendMessage(
          chatId,
          `Telegram rejected the send; it was not sent. ${displayError(error)}`,
        );
        await sendMainMenu(chatId);
        return;
      }

      pending.status = "uncertain";
      await saveTelegramBotState(state);
      logger.warn(
        { kind: pending.kind },
        "Telegram send outcome is unknown; waiting for owner resolution to prevent duplicate sends",
      );
      await sendUncertainSendInstructions(chatId, pending);
      return;
    }

    if (pending.kind === "gift") {
      state.sentRegularGiftCount += 1;
    }
    state.pendingSend = undefined;
    await saveTelegramBotState(state);

    const success =
      pending.kind === "gift"
        ? `One gift sent successfully. Progress: ${state.sentRegularGiftCount}/${REGULAR_GIFT_LIMIT}. Choose the next gift only when you are ready.`
        : "The 3-month Telegram Premium gift was sent successfully.";
    await api.sendMessage(chatId, success);
    await sendMainMenu(chatId);
  };

  const handleCallback = async (
    callback: NonNullable<TelegramUpdate["callback_query"]>,
  ): Promise<void> => {
    const data = callback.data ?? "";
    const chatId = callback.message?.chat.id;
    const messageId = callback.message?.message_id;

    if (!isAllowedTelegramUser(callback.from)) {
      await api.answerCallbackQuery(callback.id, "This bot is private to its owner.");
      return;
    }
    await api.answerCallbackQuery(callback.id);
    if (chatId === undefined) return;

    if (data === "menu") {
      await sendMainMenu(chatId);
      return;
    }
    if (data === "recipient") {
      await askForRecipient(chatId);
      return;
    }
    if (data === "regular") {
      if (state.pendingSend) {
        await sendMainMenu(chatId);
      } else {
        await showGiftSelection(chatId);
      }
      return;
    }
    if (data === "premium") {
      await preparePremium(chatId);
      return;
    }

    const pageMatch = data.match(/^p:([a-f0-9]+):(\d+)$/);
    if (pageMatch) {
      const menu = giftMenus.get(pageMatch[1]!);
      if (!menu || menu.expiresAt < Date.now()) {
        await api.sendMessage(chatId, "That gift list expired. Open the gift list again.");
        return;
      }
      await showGiftPage(chatId, menu.gifts, Number(pageMatch[2]), pageMatch[1]!);
      return;
    }

    const giftMatch = data.match(/^g:([a-f0-9]+):(\d+)$/);
    if (giftMatch) {
      if (state.pendingSend) {
        await sendMainMenu(chatId);
        return;
      }
      const menu = giftMenus.get(giftMatch[1]!);
      const gift = menu?.gifts[Number(giftMatch[2])];
      if (!menu || menu.expiresAt < Date.now() || !gift || !isEligibleGift(gift)) {
        await api.sendMessage(chatId, "That gift selection expired. Open the gift list again.");
        return;
      }
      if (state.recipientUserId === undefined) {
        await askForRecipient(chatId);
        return;
      }

      const pending: PendingSend = {
        id: newId(),
        kind: "gift",
        targetUserId: state.recipientUserId,
        gift,
        status: "ready",
      };
      state.pendingSend = pending;
      await saveTelegramBotState(state);
      await showPendingConfirmation(chatId, pending);
      return;
    }

    const confirmGiftMatch = data.match(/^cg:([a-f0-9]+)$/);
    const confirmPremiumMatch = data.match(/^cp:([a-f0-9]+)$/);
    const pending = state.pendingSend;
    if (
      confirmGiftMatch &&
      pending?.kind === "gift" &&
      pending.id === confirmGiftMatch[1]
    ) {
      await handleGiftConfirmation(chatId, messageId, pending);
      return;
    }
    if (
      confirmPremiumMatch &&
      pending?.kind === "premium" &&
      pending.id === confirmPremiumMatch[1]
    ) {
      await handleGiftConfirmation(chatId, messageId, pending);
      return;
    }

    const cancelMatch = data.match(/^cancel:([a-f0-9]+)$/);
    if (cancelMatch && pending?.id === cancelMatch[1] && pending.status === "ready") {
      state.pendingSend = undefined;
      await saveTelegramBotState(state);
      await api.sendMessage(chatId, "Pending send cancelled.");
      await sendMainMenu(chatId);
      return;
    }

    const resolutionMatch = data.match(/^(sent|unsent):([a-f0-9]+)$/);
    if (
      resolutionMatch &&
      pending?.id === resolutionMatch[2] &&
      pending.status === "uncertain"
    ) {
      if (resolutionMatch[1] === "sent" && pending.kind === "gift") {
        state.sentRegularGiftCount = Math.min(
          REGULAR_GIFT_LIMIT,
          state.sentRegularGiftCount + 1,
        );
      }
      state.pendingSend = undefined;
      await saveTelegramBotState(state);
      await api.sendMessage(
        chatId,
        resolutionMatch[1] === "sent"
          ? "Marked as sent. No retry was made."
          : "Marked as not sent. No retry was made; choose the gift again when ready.",
      );
      await sendMainMenu(chatId);
      return;
    }

    await api.sendMessage(chatId, "That action has expired. Use /menu to continue.");
  };

  while (true) {
    try {
      const updates = await api.getUpdates(offset);
      for (const update of updates) {
        try {
          if (update.message) await handleMessage(update.message);
          if (update.callback_query) await handleCallback(update.callback_query);
        } catch (error) {
          logger.error(
            { error: displayError(error), updateId: update.update_id },
            "Failed to process a Telegram update",
          );
        }
        offset = update.update_id + 1;
      }
    } catch (error) {
      if (error instanceof TelegramApiError && error.errorCode === 401) {
        logger.fatal(
          "Telegram rejected BOT_TOKEN. Check the Replit Secret and restart the API Server workflow.",
        );
        process.exit(1);
      }
      logger.error(
        { error: displayError(error) },
        "Telegram polling failed; retrying in 5 seconds",
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}