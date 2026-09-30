# Telegram Gift Bot

A private Telegram bot for sending confirmed regular Gifts with prepaid upgrade costs, one at a time, plus a separate 3-month Premium gift.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `BOT_TOKEN` — Telegram BotFather token; keep it in Replit Secrets
- Bot access is restricted by the owner's numeric Telegram user ID only; usernames are not used for authorization, and other users/groups are ignored
- Bot commands: `/menu`, `/recipient`, `/gifts`, `/premium`, `/cancel`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- Uses only Telegram's official HTTPS Bot API and long polling; no MTProto or Telegram user session.
- Uses a fixed numeric Telegram user ID allowlist. Recipient, send count, and pending-send state are persisted in a private local JSON file; no database is needed.
- Each send is a separate user-confirmed API call. Ambiguous network outcomes require owner resolution rather than an automatic retry.

## Product

- Choose an available upgradeable regular Gift and see its ID, base price, upgrade price, total, and API-provided availability.
- Send up to seven regular Gifts one at a time with `pay_for_upgrade=true`.
- Send a separate 3-month Telegram Premium gift for 1,000 Stars after confirmation.
- Future resale/transfer cooldown information is reported as unavailable when the API does not provide it.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- There is no `/claim` command. Bot messages are accepted only in private chats from the allowlisted numeric Telegram user ID.
- Gift availability can change between display and confirmation; Telegram may reject a send if the gift is no longer available or the Stars balance is insufficient.
- A transport failure after a send can leave delivery uncertain. Check Telegram before resolving it; the bot will not retry automatically.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
