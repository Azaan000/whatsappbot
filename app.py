import os
import requests
import sqlite3
from flask import Flask, request
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

app = Flask(__name__)

# ENV
VERIFY_TOKEN = os.getenv("VERIFY_TOKEN")
WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN")
PHONE_NUMBER_ID = os.getenv("PHONE_NUMBER_ID")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# DATABASE
conn = sqlite3.connect("database.db", check_same_thread=False)
cursor = conn.cursor()

cursor.execute("""
CREATE TABLE IF NOT EXISTS users (
    phone TEXT PRIMARY KEY,
    first_seen TEXT
)
""")

cursor.execute("""
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    message TEXT,
    direction TEXT,
    timestamp TEXT
)
""")

conn.commit()

# LOAD KNOWLEDGE
def load_knowledge():
    with open("knowledge.txt", "r", encoding="utf-8") as f:
        return f.read()

KNOWLEDGE = load_knowledge()

# SMART RETRIEVAL
def get_relevant_knowledge(user_message):
    keywords = user_message.lower().split()
    lines = KNOWLEDGE.split("\n")

    relevant = []
    for line in lines:
        for word in keywords:
            if word in line.lower():
                relevant.append(line)

    return "\n".join(set(relevant))[:1000]

# DATABASE FUNCTIONS
def save_user(phone):
    cursor.execute(
        "INSERT OR IGNORE INTO users (phone, first_seen) VALUES (?, ?)",
        (phone, datetime.now().isoformat())
    )
    conn.commit()

def save_message(phone, message, direction):
    cursor.execute(
        "INSERT INTO messages (phone, message, direction, timestamp) VALUES (?, ?, ?, ?)",
        (phone, message, direction, datetime.now().isoformat())
    )
    conn.commit()

# SEND WHATSAPP MESSAGE
def send_message(to, message):
    url = f"https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages"

    headers = {
        "Authorization": f"Bearer {WHATSAPP_TOKEN}",
        "Content-Type": "application/json"
    }

    data = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": message}
    }

    requests.post(url, headers=headers, json=data)

# 🤖 AI FUNCTION (OPENROUTER)
def ask_ai(user_message):
    url = "https://openrouter.ai/api/v1/chat/completions"

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost",
        "X-Title": "WhatsApp Bot"
    }

    context = get_relevant_knowledge(user_message)

    data = {
        "model": "openrouter/free",
        "messages": [
            {
                "role": "system",
                "content": f"""
You are a smart WhatsApp business assistant.

Use this knowledge to answer:
{context}

Rules:
- Be short
- Be friendly
- Try to convert user into customer
"""
            },
            {
                "role": "user",
                "content": user_message
            }
        ]
    }

    response = requests.post(url, headers=headers, json=data)

    print("STATUS:", response.status_code)
    print("RAW:", response.text)

    try:
        res_json = response.json()
        return res_json["choices"][0]["message"]["content"]
    except:
        return "⚠️ AI error. Try again."

# CHATBOT LOGIC
def chatbot_reply(phone, user_message):
    save_user(phone)
    save_message(phone, user_message, "user")

    reply = ask_ai(user_message)

    save_message(phone, reply, "bot")

    return reply

# WEBHOOK VERIFY
@app.route("/webhook", methods=["GET"])
def verify():
    if request.args.get("hub.verify_token") == VERIFY_TOKEN:
        return request.args.get("hub.challenge")
    return "Verification failed"

# WEBHOOK RECEIVE
@app.route("/webhook", methods=["POST"])
def webhook():
    data = request.get_json()

    try:
        entry = data["entry"][0]
        changes = entry["changes"][0]
        value = changes["value"]

        if "messages" in value:
            message = value["messages"][0]
            phone = message["from"]
            text = message["text"]["body"]

            print(f"{phone}: {text}")

            reply = chatbot_reply(phone, text)
            send_message(phone, reply)

    except Exception as e:
        print("ERROR:", e)

    return "OK", 200

# RUN
if __name__ == "__main__":
    app.run(port=5000, debug=True)