import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TelegramGift } from "./telegram-api";

export type PendingSend =
  | {
      id: string;
      kind: "gift";
      targetUserId: number;
      gift: TelegramGift;
      status: "ready" | "sending" | "uncertain";
    }
  | {
      id: string;
      kind: "premium";
      targetUserId: number;
      status: "ready" | "sending" | "uncertain";
    };

export interface TelegramBotState {
  recipientUserId?: number;
  sentRegularGiftCount: number;
  awaitingRecipient: boolean;
  pendingSend?: PendingSend;
}

const stateDirectory = join(process.cwd(), "data");
const statePath = join(stateDirectory, "telegram-bot-state.json");

export async function loadTelegramBotState(): Promise<TelegramBotState> {
  try {
    const content = await readFile(statePath, "utf8");
    const parsed = JSON.parse(content) as Partial<TelegramBotState>;

    return {
      recipientUserId:
        typeof parsed.recipientUserId === "number" &&
        Number.isSafeInteger(parsed.recipientUserId) &&
        parsed.recipientUserId! > 0
          ? parsed.recipientUserId
          : undefined,
      sentRegularGiftCount:
        typeof parsed.sentRegularGiftCount === "number" &&
        Number.isSafeInteger(parsed.sentRegularGiftCount) &&
        parsed.sentRegularGiftCount! >= 0
          ? parsed.sentRegularGiftCount
          : 0,
      awaitingRecipient: parsed.awaitingRecipient === true,
      pendingSend: parsed.pendingSend,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { sentRegularGiftCount: 0, awaitingRecipient: false };
    }
    throw error;
  }
}

export async function saveTelegramBotState(
  state: TelegramBotState,
): Promise<void> {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, statePath);
}