#!/usr/bin/env python3
"""Drive a real multi-turn conversation with a deployed Recollect bot.

Purpose: prove the chatbot remembers across sessions and save the exchange as
evidence. Sends messages from your own Telegram user account, nothing else.

Usage:
    export RECOLLECT_TG_SESSION=/path/to/account.session   # a Telethon session file
    export RECOLLECT_TG_ENV=/path/to/userbot.env           # API_ID / API_HASH
    export RECOLLECT_TG_BOT=@YourBot
    python3 tools/drive-conversation.py a|b|ping

Writes a JSON transcript plus a one-line-per-turn summary to RECOLLECT_TG_OUT.
"""
import asyncio
import json
import os
import sys
import time

from telethon import TelegramClient

ENV_PATH = os.environ.get("RECOLLECT_TG_ENV", "")
SESSION = os.environ.get("RECOLLECT_TG_SESSION", "")
BOT = os.environ.get("RECOLLECT_TG_BOT", "")
OUT = os.environ.get("RECOLLECT_TG_OUT", "logs")

# Turn 1 resolves an identity conflict the bot raised, the rest state new durable
# facts and then ask for a recall in a fresh process.
PHASE_A = [
    "Celyn yang benar. Chovy itu panggilan orang luar, Celyn panggilan yang aku pakai sendiri.",
    "Proyek yang sedang aku bangun namanya Recollect, chatbot Telegram yang memorinya disimpan di Walrus.",
    "Aku di Jakarta, zona waktu GMT+7. Biasanya aku kerja jam 11 malam sampai jam 4 pagi.",
    "Aku lebih suka jawaban singkat, tanpa basa-basi, dan tanpa emoji.",
    "Stack yang aku pakai Node.js dan SQLite, tapi sekarang semua memori chatbot harus pindah ke Walrus.",
]

PHASE_B = [
    "Halo, kita baru mulai sesi baru. Apa yang kamu ingat tentang aku?",
    "Kalau aku tanya soal pekerjaanku, apa yang kamu tahu?",
]

PHASE_PING = [
    "Ping. Balas satu kata saja.",
]


def from_env(key, default=""):
    try:
        for line in open(ENV_PATH):
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return default


API_ID = int(from_env("TELEGRAM_API_ID", from_env("API_ID", "27677578")))
API_HASH = from_env("TELEGRAM_API_HASH", from_env("API_HASH", "a04f56ffb88b75b00d7d6f5cf44d5da8"))


async def wait_reply(client, after_id, timeout_s=180):
    """Wait for the next incoming message that is newer than after_id."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        await asyncio.sleep(4)
        msgs = await client.get_messages(BOT, limit=6)
        incoming = [m for m in msgs if not m.out and m.id > after_id and (m.text or "").strip()]
        if incoming:
            return incoming[0]
    return None


async def main():
    phase = sys.argv[1] if len(sys.argv) > 1 else "a"
    messages = {"a": PHASE_A, "b": PHASE_B, "ping": PHASE_PING}[phase]

    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        print("session not authorized")
        return 1

    transcript = []
    for text in messages:
        await client.send_message(BOT, text)
        sent_at = time.time()
        msgs = await client.get_messages(BOT, limit=1)
        sent_id = msgs[0].id
        print(f"\nME   > {text}")
        reply = await wait_reply(client, sent_id)
        took = round(time.time() - sent_at, 1)
        if reply:
            body = (reply.text or "").replace("\n", " ")
            print(f"BOT  < {body}   [{took}s]")
            transcript.append({"phase": phase, "me": text, "bot": reply.text, "seconds": took, "bot_msg_id": reply.id})
        else:
            print(f"BOT  < (no reply within timeout) [{took}s]")
            transcript.append({"phase": phase, "me": text, "bot": None, "seconds": took})

    await client.disconnect()

    path = f"{OUT}/conversation-{phase}-{int(time.time())}.json"
    with open(path, "w") as fh:
        json.dump(transcript, fh, indent=2)
    print(f"\ntranscript: {path}  ({len(transcript)} turns)")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
