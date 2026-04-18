import os
import requests
import sqlite3
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from dotenv import load_dotenv
from datetime import datetime
import threading
import json
import base64
from werkzeug.utils import secure_filename
import csv
from io import StringIO, BytesIO

load_dotenv()

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

VERIFY_TOKEN = os.getenv("VERIFY_TOKEN")
WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN")
PHONE_NUMBER_ID = os.getenv("PHONE_NUMBER_ID")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Media configuration
MEDIA_FOLDER = "media_files"
os.makedirs(MEDIA_FOLDER, exist_ok=True)
app.config['MEDIA_FOLDER'] = MEDIA_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'pdf', 'doc', 'docx', 'mp3', 'mp4', 'txt'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# =========================
# DATABASE - UPDATED
# =========================

def get_db():
    conn = sqlite3.connect("database.db")
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Users table with additional fields
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        phone TEXT PRIMARY KEY,
        first_seen TEXT,
        last_seen TEXT,
        human_mode INTEGER DEFAULT 0,
        tags TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        total_messages INTEGER DEFAULT 0
    )
    """)
    
    # Messages table with media support
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT,
        message TEXT,
        direction TEXT,
        status TEXT DEFAULT 'sent',
        timestamp TEXT,
        message_type TEXT DEFAULT 'text',
        media_url TEXT,
        media_path TEXT,
        media_mime_type TEXT,
        file_name TEXT
    )
    """)
    
    # Analytics table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        total_messages INTEGER DEFAULT 0,
        unique_users INTEGER DEFAULT 0,
        avg_response_time REAL DEFAULT 0
    )
    """)
    
    # Add new columns if they don't exist
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN tags TEXT DEFAULT ''")
    except: pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN notes TEXT DEFAULT ''")
    except: pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN total_messages INTEGER DEFAULT 0")
    except: pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN last_seen TEXT")
    except: pass
    try:
        cursor.execute("ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'text'")
    except: pass
    try:
        cursor.execute("ALTER TABLE messages ADD COLUMN media_url TEXT")
    except: pass
    try:
        cursor.execute("ALTER TABLE messages ADD COLUMN media_path TEXT")
    except: pass
    try:
        cursor.execute("ALTER TABLE messages ADD COLUMN media_mime_type TEXT")
    except: pass
    try:
        cursor.execute("ALTER TABLE messages ADD COLUMN file_name TEXT")
    except: pass
    
    conn.commit()
    conn.close()
    print("✅ Database initialized")

init_db()

# =========================
# KNOWLEDGE
# =========================

def load_knowledge():
    try:
        with open("knowledge.txt", "r", encoding="utf-8") as f:
            return f.read()
    except:
        return ""

KNOWLEDGE = load_knowledge()

def get_relevant_knowledge(msg):
    if not KNOWLEDGE:
        return ""
    words = msg.lower().split()
    lines = KNOWLEDGE.split("\n")
    matched = []
    for line in lines:
        for w in words:
            if w in line.lower():
                matched.append(line)
                break
    return "\n".join(matched)[:800]

# =========================
# SAVE FUNCTIONS
# =========================

def save_user(phone):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT OR IGNORE INTO users (phone, first_seen, last_seen) VALUES (?, ?, ?)",
            (phone, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        )
        cursor.execute(
            "UPDATE users SET last_seen=? WHERE phone=?",
            (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), phone)
        )
        conn.commit()
    except Exception as e:
        print(f"Error saving user: {e}")
    finally:
        conn.close()

def save_message(phone, message, direction, status="sent", message_type="text", media_path=None, media_mime_type=None, file_name=None):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """INSERT INTO messages 
               (phone, message, direction, status, timestamp, message_type, media_path, media_mime_type, file_name) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (phone, message, direction, status, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), 
             message_type, media_path, media_mime_type, file_name)
        )
        conn.commit()
        
        # Update user message count
        cursor.execute("UPDATE users SET total_messages = total_messages + 1 WHERE phone=?", (phone,))
        conn.commit()
        
        return cursor.lastrowid
    except Exception as e:
        print(f"Error saving message: {e}")
        return None
    finally:
        conn.close()

def update_user_tags(phone, tags):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET tags=? WHERE phone=?", (tags, phone))
    conn.commit()
    conn.close()

def update_user_notes(phone, notes):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET notes=? WHERE phone=?", (notes, phone))
    conn.commit()
    conn.close()

# =========================
# SEND WHATSAPP MESSAGE
# =========================

def send_message(to, message):
    if not WHATSAPP_TOKEN or not PHONE_NUMBER_ID:
        print("❌ WhatsApp credentials missing")
        return False
    
    try:
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
        
        print(f"📤 Sending to {to}: {message[:50]}...")
        res = requests.post(url, headers=headers, json=data, timeout=10)
        
        if res.status_code == 200:
            print(f"✅ Message sent to {to}")
            return True
        else:
            print(f"❌ WhatsApp error {res.status_code}: {res.text}")
            return False
            
    except Exception as e:
        print(f"❌ Send error: {e}")
        return False

def send_file_message(to, file_path, file_type="image"):
    """Send a file/image to WhatsApp"""
    if not WHATSAPP_TOKEN or not PHONE_NUMBER_ID:
        return False
    
    try:
        # First, upload the file to WhatsApp servers
        media_url = upload_media_to_whatsapp(file_path, file_type)
        if not media_url:
            return False
        
        url = f"https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages"
        headers = {
            "Authorization": f"Bearer {WHATSAPP_TOKEN}",
            "Content-Type": "application/json"
        }
        
        data = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": file_type,
            file_type: {"link": media_url}
        }
        
        res = requests.post(url, headers=headers, json=data, timeout=30)
        
        if res.status_code == 200:
            print(f"✅ {file_type} sent to {to}")
            return True
        else:
            print(f"❌ Failed to send {file_type}: {res.text}")
            return False
            
    except Exception as e:
        print(f"❌ Send file error: {e}")
        return False

def upload_media_to_whatsapp(file_path, file_type):
    """Upload media to WhatsApp servers"""
    try:
        url = f"https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/media"
        headers = {
            "Authorization": f"Bearer {WHATSAPP_TOKEN}",
        }
        
        with open(file_path, 'rb') as f:
            files = {'file': f}
            data = {
                'messaging_product': 'whatsapp',
                'type': file_type
            }
            response = requests.post(url, headers=headers, files=files, data=data)
        
        if response.status_code == 200:
            media_id = response.json().get('id')
            return f"https://graph.facebook.com/v18.0/{media_id}"
        else:
            print(f"Upload failed: {response.text}")
            return None
            
    except Exception as e:
        print(f"Upload error: {e}")
        return None

# =========================
# AI
# =========================

def ask_ai(user_message):
    if not OPENROUTER_API_KEY:
        return "AI service is not configured. Please contact support."
    
    try:
        context = get_relevant_knowledge(user_message)
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json"
        }
        
        system_prompt = f"""You are a WhatsApp business assistant.
RULES:
- Reply in 1-2 short sentences
- Friendly and natural
- Clear and direct
- No long paragraphs

KNOWLEDGE:
{context}"""

        data = {
            "model": "mistralai/mistral-7b-instruct",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ]
        }
        
        res = requests.post(url, headers=headers, json=data, timeout=15)
        json_data = res.json()
        
        if "choices" in json_data:
            return json_data["choices"][0]["message"]["content"]
        else:
            print(f"AI Error: {json_data}")
            return "Sorry, I'm having trouble. Please try again."
            
    except Exception as e:
        print(f"AI Exception: {e}")
        return "Server busy. Please try again."

# =========================
# WEBHOOK
# =========================

@app.route("/webhook", methods=["GET"])
def verify():
    if request.args.get("hub.verify_token") == VERIFY_TOKEN:
        return request.args.get("hub.challenge")
    return "fail", 403

@app.route("/webhook", methods=["POST"])
def webhook():
    data = request.get_json()
    
    try:
        if "entry" in data:
            for entry in data["entry"]:
                if "changes" in entry:
                    for change in entry["changes"]:
                        if "value" in change and "messages" in change["value"]:
                            for msg in change["value"]["messages"]:
                                phone = msg["from"]
                                msg_type = msg.get("type", "text")
                                
                                print(f"📩 {msg_type} from {phone}")
                                
                                save_user(phone)
                                
                                if msg_type == "text":
                                    text = msg["text"]["body"]
                                    save_message(phone, text, "user")
                                    
                                    # Check mode and respond
                                    conn = get_db()
                                    cursor = conn.cursor()
                                    cursor.execute("SELECT human_mode FROM users WHERE phone=?", (phone,))
                                    row = cursor.fetchone()
                                    conn.close()
                                    
                                    mode = row[0] if row else 0
                                    
                                    if mode == 0:
                                        def process_ai():
                                            reply = ask_ai(text)
                                            if send_message(phone, reply):
                                                save_message(phone, reply, "bot")
                                            else:
                                                save_message(phone, reply, "bot", status="failed")
                                        
                                        thread = threading.Thread(target=process_ai)
                                        thread.daemon = True
                                        thread.start()
                                
                                elif msg_type in ["image", "audio", "document"]:
                                    # Handle media
                                    media_id = msg[msg_type]["id"]
                                    caption = msg[msg_type].get("caption", "")
                                    mime_type = msg[msg_type].get("mime_type", "")
                                    
                                    save_message(phone, caption or f"Sent a {msg_type}", "user", 
                                               message_type=msg_type, media_mime_type=mime_type)
                                    
    except Exception as e:
        print(f"Webhook error: {e}")
    
    return "OK", 200

# =========================
# API ROUTES
# =========================

@app.route("/users", methods=["GET"])
def get_users():
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
    SELECT u.phone, u.human_mode, u.tags, u.notes, u.total_messages, u.last_seen,
    (SELECT message FROM messages m WHERE m.phone=u.phone ORDER BY id DESC LIMIT 1) as last_message
    FROM users u
    ORDER BY u.last_seen DESC
    """)
    
    rows = cursor.fetchall()
    conn.close()
    
    return jsonify([
        {
            "phone": r["phone"], 
            "human_mode": r["human_mode"], 
            "tags": r["tags"] or "",
            "notes": r["notes"] or "",
            "total_messages": r["total_messages"] or 0,
            "last_seen": r["last_seen"],
            "last": r["last_message"] if r["last_message"] else "No messages"
        }
        for r in rows
    ])

@app.route("/messages/<phone>", methods=["GET"])
def get_messages(phone):
    search = request.args.get("search", "")
    conn = get_db()
    cursor = conn.cursor()
    
    if search:
        cursor.execute(
            "SELECT message, direction, status, timestamp, message_type, media_path, file_name FROM messages WHERE phone=? AND message LIKE ? ORDER BY id ASC",
            (phone, f"%{search}%")
        )
    else:
        cursor.execute(
            "SELECT message, direction, status, timestamp, message_type, media_path, file_name FROM messages WHERE phone=? ORDER BY id ASC",
            (phone,)
        )
    
    rows = cursor.fetchall()
    conn.close()
    
    return jsonify([
        {
            "message": r["message"],
            "direction": r["direction"],
            "status": r["status"],
            "timestamp": r["timestamp"],
            "message_type": r["message_type"],
            "media_path": r["media_path"],
            "file_name": r["file_name"]
        }
        for r in rows
    ])

@app.route("/send", methods=["POST"])
def send_panel():
    data = request.json
    phone = data.get("phone")
    message = data.get("message")
    
    if not phone or not message:
        return jsonify({"success": False, "error": "Phone and message required"}), 400
    
    save_message(phone, message, "bot", status="sending")
    
    if send_message(phone, message):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE messages SET status='sent' WHERE id=(SELECT MAX(id) FROM messages WHERE phone=? AND direction='bot')",
            (phone,)
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    else:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE messages SET status='failed' WHERE id=(SELECT MAX(id) FROM messages WHERE phone=? AND direction='bot')",
            (phone,)
        )
        conn.commit()
        conn.close()
        return jsonify({"success": False, "error": "Failed to send"}), 500

@app.route("/send-file", methods=["POST"])
def send_file_endpoint():
    """Endpoint to send files/images to WhatsApp"""
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "No file provided"}), 400
    
    phone = request.form.get("phone")
    if not phone:
        return jsonify({"success": False, "error": "Phone number required"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"success": False, "error": "No file selected"}), 400
    
    if not allowed_file(file.filename):
        return jsonify({"success": False, "error": "File type not allowed"}), 400
    
    # Save file temporarily
    filename = secure_filename(f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{file.filename}")
    filepath = os.path.join(app.config['MEDIA_FOLDER'], filename)
    file.save(filepath)
    
    # Determine file type for WhatsApp
    ext = filename.rsplit('.', 1)[1].lower()
    if ext in ['jpg', 'jpeg', 'png', 'gif']:
        whatsapp_type = "image"
    elif ext in ['mp3', 'wav']:
        whatsapp_type = "audio"
    elif ext in ['pdf', 'doc', 'docx', 'txt']:
        whatsapp_type = "document"
    else:
        whatsapp_type = "document"
    
    # Send file
    success = send_file_message(phone, filepath, whatsapp_type)
    
    if success:
        save_message(phone, f"Sent {whatsapp_type}: {file.filename}", "bot", 
                    message_type=whatsapp_type, media_path=filepath, file_name=file.filename)
        return jsonify({"success": True})
    else:
        return jsonify({"success": False, "error": "Failed to send file"}), 500

@app.route("/toggle/<phone>", methods=["POST"])
def toggle_mode(phone):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT human_mode FROM users WHERE phone=?", (phone,))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        return jsonify({"error": "User not found"}), 404
    
    current = row["human_mode"]
    new = 0 if current == 1 else 1
    
    cursor.execute("UPDATE users SET human_mode=? WHERE phone=?", (new, phone))
    conn.commit()
    conn.close()
    
    return jsonify({"human_mode": new})

@app.route("/update-user", methods=["POST"])
def update_user():
    data = request.json
    phone = data.get("phone")
    tags = data.get("tags")
    notes = data.get("notes")
    
    if tags is not None:
        update_user_tags(phone, tags)
    if notes is not None:
        update_user_notes(phone, notes)
    
    return jsonify({"success": True})

@app.route("/analytics", methods=["GET"])
def get_analytics():
    conn = get_db()
    cursor = conn.cursor()
    
    # Basic stats
    cursor.execute("SELECT COUNT(*) FROM users")
    total_users = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM messages")
    total_messages = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM users WHERE human_mode=0")
    ai_users = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM users WHERE human_mode=1")
    human_users = cursor.fetchone()[0]
    
    today = datetime.now().strftime("%Y-%m-%d")
    cursor.execute("SELECT COUNT(*) FROM messages WHERE timestamp LIKE ?", (f"{today}%",))
    messages_today = cursor.fetchone()[0]
    
    # Message type distribution
    cursor.execute("""
        SELECT message_type, COUNT(*) as count
        FROM messages
        GROUP BY message_type
    """)
    message_types = [{"type": r[0], "count": r[1]} for r in cursor.fetchall()]
    
    # Engagement metrics
    cursor.execute("""
        SELECT phone, total_messages, last_seen 
        FROM users 
        ORDER BY total_messages DESC 
        LIMIT 10
    """)
    top_users = [{"phone": r[0], "messages": r[1], "last_seen": r[2]} for r in cursor.fetchall()]
    
    # Response time tracking
    cursor.execute("""
        SELECT 
            AVG(
                julianday(b.timestamp) - julianday(u.timestamp)
            ) * 24 * 60 as avg_response_minutes
        FROM messages u
        JOIN messages b ON b.phone = u.phone 
        WHERE u.direction = 'user' 
        AND b.direction = 'bot'
        AND b.id > u.id
        AND b.id = (
            SELECT MIN(id) FROM messages 
            WHERE phone = u.phone AND direction = 'bot' AND id > u.id
        )
    """)
    avg_response = cursor.fetchone()[0] or 0
    
    # Most asked questions
    cursor.execute("""
        SELECT message, COUNT(*) as count
        FROM messages
        WHERE direction = 'user' AND message_type = 'text'
        GROUP BY message
        ORDER BY count DESC
        LIMIT 10
    """)
    top_questions = [{"question": r[0], "count": r[1]} for r in cursor.fetchall()]
    
    # Daily activity for last 7 days
    cursor.execute("""
        SELECT DATE(timestamp) as date, COUNT(*) as count
        FROM messages
        WHERE DATE(timestamp) >= DATE('now', '-7 days')
        GROUP BY DATE(timestamp)
        ORDER BY date
    """)
    daily_activity = [{"date": r[0], "messages": r[1]} for r in cursor.fetchall()]
    
    # Hourly activity
    cursor.execute("""
        SELECT STRFTIME('%H', timestamp) as hour, COUNT(*) as count
        FROM messages
        GROUP BY hour
        ORDER BY hour
    """)
    hourly_activity = [{"hour": r[0], "messages": r[1]} for r in cursor.fetchall()]
    
    # User growth over time
    cursor.execute("""
        SELECT DATE(first_seen) as date, COUNT(*) as count
        FROM users
        WHERE DATE(first_seen) >= DATE('now', '-30 days')
        GROUP BY DATE(first_seen)
        ORDER BY date
    """)
    user_growth = [{"date": r[0], "new_users": r[1]} for r in cursor.fetchall()]
    
    conn.close()
    
    return jsonify({
        "total_users": total_users,
        "total_messages": total_messages,
        "ai_users": ai_users,
        "human_users": human_users,
        "messages_today": messages_today,
        "avg_response_time": round(avg_response, 2),
        "message_types": message_types,
        "top_users": top_users,
        "top_questions": top_questions,
        "daily_activity": daily_activity,
        "hourly_activity": hourly_activity,
        "user_growth": user_growth
    })

@app.route("/export/csv", methods=["GET"])
def export_csv():
    phone = request.args.get("phone")
    conn = get_db()
    cursor = conn.cursor()
    
    if phone:
        cursor.execute(
            "SELECT message, direction, status, timestamp FROM messages WHERE phone=? ORDER BY id ASC",
            (phone,)
        )
    else:
        cursor.execute(
            "SELECT phone, message, direction, status, timestamp FROM messages ORDER BY id ASC"
        )
    
    rows = cursor.fetchall()
    conn.close()
    
    output = StringIO()
    writer = csv.writer(output)
    
    if phone:
        writer.writerow(['Message', 'Direction', 'Status', 'Timestamp'])
        for row in rows:
            writer.writerow([row[0], row[1], row[2], row[3]])
    else:
        writer.writerow(['Phone', 'Message', 'Direction', 'Status', 'Timestamp'])
        for row in rows:
            writer.writerow([row[0], row[1], row[2], row[3], row[4]])
    
    output.seek(0)
    filename = f"conversation_{phone if phone else 'all'}_{datetime.now().strftime('%Y%m%d')}.csv"
    
    return send_file(
        BytesIO(output.getvalue().encode()),
        mimetype='text/csv',
        as_attachment=True,
        download_name=filename
    )

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "whatsapp_configured": bool(WHATSAPP_TOKEN),
        "openrouter_configured": bool(OPENROUTER_API_KEY)
    })

# =========================
# RUN
# =========================

if __name__ == "__main__":
    print("\n" + "="*50)
    print("🤖 WhatsApp Bot Server - Full Feature")
    print("="*50)
    print(f"📍 Webhook: http://localhost:5000/webhook")
    print(f"📍 Dashboard: http://localhost:3000")
    print("\n📋 Features:")
    print("   ✅ File & Image Sending")
    print("   ✅ Advanced Analytics")
    print("   ✅ Export Conversations")
    print("   ✅ User Tags & Notes")
    print("   ✅ Message Search")
    print("="*50 + "\n")
    
    app.run(host="0.0.0.0", port=5000, debug=True)