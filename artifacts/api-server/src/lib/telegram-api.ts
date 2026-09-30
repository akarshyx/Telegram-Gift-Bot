export interface TelegramSticker {
  emoji?: string;
}

export interface TelegramGift {
  id: string;
  sticker: TelegramSticker;
  star_count: number;
  upgrade_star_count?: number;
  is_premium?: true;
  total_count?: number;
  remaining_count?: number;
  personal_total_count?: number;
  personal_remaining_count?: number;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: TelegramMessage;
  };
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly errorCode: number | undefined,
    readonly isApiResponse: boolean,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export class TelegramBotApi {
  private readonly endpoint: string;

  constructor(token: string) {
    this.endpoint = `https://api.telegram.org/bot${token}`;
  }

  private async call<T>(
    method: string,
    parameters: Record<string, unknown> = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parameters),
      });
    } catch {
      // Do not include the fetch error: some runtimes include the full URL,
      // which contains the bot token.
      throw new TelegramApiError(
        "Could not reach the Telegram Bot API.",
        undefined,
        false,
      );
    }

    let payload: TelegramResponse<T>;
    try {
      payload = (await response.json()) as TelegramResponse<T>;
    } catch {
      throw new TelegramApiError(
        "Telegram returned an unreadable response.",
        response.status,
        false,
      );
    }

    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new TelegramApiError(
        payload.description ?? `Telegram Bot API returned HTTP ${response.status}.`,
        payload.error_code,
        true,
      );
    }

    return payload.result;
  }

  getMe(): Promise<{ id: number; username?: string }> {
    return this.call("getMe");
  }

  getUpdates(offset: number): Promise<TelegramUpdate[]> {
    return this.call("getUpdates", {
      offset,
      timeout: 25,
      allowed_updates: ["message", "callback_query"],
    });
  }

  async getAvailableGifts(): Promise<TelegramGift[]> {
    const result = await this.call<{ gifts: TelegramGift[] }>(
      "getAvailableGifts",
    );
    return result.gifts;
  }

  sendMessage(
    chatId: number,
    text: string,
    keyboard?: InlineKeyboardButton[][],
  ): Promise<TelegramMessage> {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    return this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  editMessageReplyMarkup(
    chatId: number,
    messageId: number,
  ): Promise<TelegramMessage> {
    return this.call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  }

  sendGift(userId: number, giftId: string): Promise<boolean> {
    return this.call("sendGift", {
      user_id: userId,
      gift_id: giftId,
      pay_for_upgrade: true,
    });
  }

  giftPremiumSubscription(userId: number): Promise<boolean> {
    return this.call("giftPremiumSubscription", {
      user_id: userId,
      month_count: 3,
      star_count: 1000,
    });
  }
}