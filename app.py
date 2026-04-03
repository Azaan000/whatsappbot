import os
import requests
import sqlite3
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

app = Flask(__name__)
CORS(app)

# ENV
VERIFY_TOKEN = os.getenv("VERIFY_TOKEN")
WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN")
PHONE_NUMBER_ID = os.getenv("PHONE_NUMBER_ID")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# ✅ DATABASE HELPER (FIXED)
def get_db():
    return sqlite3.connect("database.db")

# ✅ INIT DATABASE
def init_db():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT,
        message TEXT,
        direction TEXT,
        timestamp TEXT
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        phone TEXT PRIMARY KEY,
        first_seen TEXT,
        human_mode INTEGER DEFAULT 0
    )
    """)

    conn.commit()
    conn.close()

init_db()

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
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        "INSERT OR IGNORE INTO users (phone, first_seen) VALUES (?, ?)",
        (phone, datetime.now().isoformat())
    )

    conn.commit()
    conn.close()

def save_message(phone, message, direction):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        "INSERT INTO messages (phone, message, direction, timestamp) VALUES (?, ?, ?, ?)",
        (phone, message, direction, datetime.now().isoformat())
    )

    conn.commit()
    conn.close()

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

# AI FUNCTION
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
            {"role": "user", "content": user_message}
        ]
    }

    response = requests.post(url, headers=headers, json=data)

    try:
        return response.json()["choices"][0]["message"]["content"]
    except:
        return "⚠️ AI error. Try again."

# WEBHOOK VERIFY
@app.route("/webhook", methods=["GET"])
def verify():
    if request.args.get("hub.verify_token") == VERIFY_TOKEN:
        return request.args.get("hub.challenge")
    return "Verification failed"

# WEBHOOK RECEIVE (FIXED)
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

            save_user(phone)
            save_message(phone, text, "user")

            # ✅ CHECK HUMAN MODE (FIXED)
            conn = get_db()
            cursor = conn.cursor()

            cursor.execute("SELECT human_mode FROM users WHERE phone = ?", (phone,))
            result = cursor.fetchone()

            conn.close()

            # 👨 HUMAN MODE
            if result and result[0] == 1:
                print("👨 Human mode active")
            else:
                reply = ask_ai(text)
                save_message(phone, reply, "bot")
                send_message(phone, reply)

    except Exception as e:
        print("ERROR:", e)

    return "OK", 200

# ADMIN ROUTES

@app.route("/users", methods=["GET"])
def get_users():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT phone, human_mode FROM users")
    users = [{"phone": row[0], "human_mode": row[1]} for row in cursor.fetchall()]

    conn.close()
    return jsonify(users)

@app.route("/messages/<phone>", methods=["GET"])
def get_messages(phone):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT message, direction, timestamp FROM messages WHERE phone = ? ORDER BY id ASC",
        (phone,)
    )

    messages = cursor.fetchall()
    conn.close()

    return jsonify(messages)

@app.route("/send", methods=["POST"])
def send_manual():
    data = request.json
    phone = data.get("phone")
    message = data.get("message")

    send_message(phone, message)
    save_message(phone, message, "bot")

    return jsonify({"status": "sent"})

@app.route("/toggle/<phone>", methods=["POST"])
def toggle_mode(phone):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT human_mode FROM users WHERE phone = ?", (phone,))
    current = cursor.fetchone()[0]

    new_mode = 0 if current == 1 else 1

    cursor.execute("UPDATE users SET human_mode = ? WHERE phone = ?", (new_mode, phone))
    conn.commit()
    conn.close()

    return jsonify({"human_mode": new_mode})

# RUN
if __name__ == "__main__":
    app.run(port=5000, debug=True)