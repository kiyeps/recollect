#!/usr/bin/env python3
"""Drive one conversation with the Recollect bot as a real Telegram user.

This is the harness the evidence in docs/EVIDENCE.md was produced with, trimmed down: it logs in
as a user account, sends one fact per message, waits for the bot's reply, and writes a transcript.

It is not part of the bot. It exists so a second and third user can be added to a running instance
without hand-typing twelve messages, and so the transcript is machine-readable afterwards.

Usage:
    pip install telethon
    python3 tools/drive-session.py --session me.session --bot @RecollectMemoryBot \
        --facts tools/facts-example.json --out docs/evidence

The session file is a Telethon session for a normal Telegram account (not the bot's token). Create
one with TelegramClient("me", api_id, api_hash) and a phone login; the api id and hash come from
https://my.telegram.org. One session file per user account is what makes the three spaces in the
evidence three spaces.
"""
import argparse
import asyncio
import json
import os
import time

from telethon import TelegramClient

WAIT_SECONDS = 240
POLL_SECONDS = 3


async def wait_for_reply(client, bot, after_id):
    """Return the first message from the bot that arrives after `after_id`."""
    deadline = time.time() + WAIT_SECONDS
    while time.time() < deadline:
        messages = await client.get_messages(bot, limit=5)
        for message in messages:
            if message.out:
                continue
            if after_id is None or message.id > after_id:
                return message
        await asyncio.sleep(POLL_SECONDS)
    return None


async def run(args):
    with open(args.facts, encoding="utf-8") as handle:
        facts = json.load(handle)
    if isinstance(facts, dict):
        facts = facts.get("facts", [])

    os.makedirs(args.out, exist_ok=True)
    client = TelegramClient(args.session, int(args.api_id), args.api_hash)
    await client.start()
    me = await client.get_me()
    print(f"user: id={me.id} @{me.username}")

    bot = await client.get_entity(args.bot)
    turns = []
    last_id = None
    for fact in facts:
        print(f"ME  > {fact}")
        sent = await client.send_message(bot, fact)
        reply = await wait_for_reply(client, bot, last_id)
        if reply is None:
            print("BOT < (no reply within the window)")
            turns.append({"user": fact, "bot": None, "seconds": None})
            break
        last_id = reply.id
        turns.append({"user": fact, "bot": reply.text, "seconds": None})
        print(f"BOT < {(reply.text or '')[:120]}")
        await asyncio.sleep(1)

    stamp = int(time.time())
    path = os.path.join(args.out, f"session-{me.id}-{stamp}.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(turns, handle, ensure_ascii=False, indent=2)
    print(f"\ntranscript: {path}  ({len(turns)} turns)")
    await client.disconnect()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", required=True, help="Telethon session path for the user account")
    parser.add_argument("--bot", required=True, help="bot username, with the @")
    parser.add_argument("--facts", required=True, help="JSON file holding a list of fact strings")
    parser.add_argument("--out", default="docs/evidence")
    parser.add_argument("--api-id", default=os.environ.get("TELEGRAM_API_ID", ""))
    parser.add_argument("--api-hash", default=os.environ.get("TELEGRAM_API_HASH", ""))
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
