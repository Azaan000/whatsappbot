import os
import requests
import sqlite3
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv
from datetime import datetime
import threading
import json
import mimetypes
from werkzeug.utils import secure_filename
import csv
from io import StringIO, BytesIO

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", ping_timeout=60, ping_interval=25)

VERIFY_TOKEN = os.getenv("VERIFY_TOKEN")
WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN")
PHONE_NUMBER_ID = os.getenv("PHONE_NUMBER_ID")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Media configuration
MEDIA_FOLDER = "media_files"
os.makedirs(MEDIA_FOLDER, exist_ok=True)
app.config['MEDIA_FOLDER'] = MEDIA_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'pdf', 'doc', 'docx', 'mp3', 'mp4', 'txt', 'webp', 'mp4', 'mov'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# =========================
# DATABASE
# =========================

def get_db():
    conn = sqlite3.connect("database.db")
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
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
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT,
        message TEXT,
        direction TEXT,
        status TEXT DEFAULT 'sent',
        timestamp TEXT,
        message_type TEXT DEFAULT 'text',
        media_path TEXT,
        file_name TEXT,
        whatsapp_message_id TEXT
    )
    """)
    
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
# SAVE FUNCTIONS WITH SOCKET EMITS
# =========================

def save_user(phone):
    conn = get_db()
    cursor = conn.cursor()
    is_new = False
    try:
        cursor.execute("SELECT phone FROM users WHERE phone=?", (phone,))
        existing = cursor.fetchone()
        is_new = existing is None
        
        cursor.execute(
            "INSERT OR IGNORE INTO users (phone, first_seen, last_seen) VALUES (?, ?, ?)",
            (phone, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        )
        cursor.execute(
            "UPDATE users SET last_seen=? WHERE phone=?",
            (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), phone)
        )
        conn.commit()
        
        if is_new:
            cursor.execute("SELECT * FROM users WHERE phone=?", (phone,))
            user_data = cursor.fetchone()
            socketio.emit('new_user', {
                'phone': user_data["phone"],
                'human_mode': user_data["human_mode"],
                'total_messages': 0,
                'last': 'New user'
            })
            print(f"🆕 New user joined: {phone}")
            
    except Exception as e:
        print(f"Error saving user: {e}")
    finally:
        conn.close()

def save_message(phone, message, direction, status="sent", message_type="text", media_path=None, file_name=None, whatsapp_message_id=None):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """INSERT INTO messages 
               (phone, message, direction, status, timestamp, message_type, media_path, file_name, whatsapp_message_id) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (phone, message, direction, status, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), 
             message_type, media_path, file_name, whatsapp_message_id)
        )
        msg_id = cursor.lastrowid
        conn.commit()
        
        # Update user message count
        cursor.execute("UPDATE users SET total_messages = total_messages + 1 WHERE phone=?", (phone,))
        cursor.execute("UPDATE users SET last_seen=? WHERE phone=?", (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), phone))
        conn.commit()
        
        # Get updated user data
        cursor.execute("SELECT * FROM users WHERE phone=?", (phone,))
        user_data = cursor.fetchone()
        
        # Emit message update via WebSocket
        socketio.emit('new_message', {
            'phone': phone,
            'message': message,
            'direction': direction,
            'status': status,
            'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            'message_type': message_type,
            'file_name': file_name,
            'msg_id': msg_id
        })
        
        # Emit user update for sidebar
        if user_data:
            socketio.emit('user_update', {
                'phone': user_data["phone"],
                'human_mode': user_data["human_mode"],
                'tags': user_data["tags"] or "",
                'total_messages': user_data["total_messages"],
                'last': message[:50] if message else "Sent a file",
                'last_seen': user_data["last_seen"]
            })
        
        return msg_id
    except Exception as e:
        print(f"Error saving message: {e}")
        return None
    finally:
        conn.close()

def update_message_status(whatsapp_message_id, status):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT phone FROM messages WHERE whatsapp_message_id=?",
            (whatsapp_message_id,)
        )
        result = cursor.fetchone()
        
        cursor.execute(
            "UPDATE messages SET status=? WHERE whatsapp_message_id=?",
            (status, whatsapp_message_id)
        )
        conn.commit()
        
        if result:
            socketio.emit('status_update', {
                'whatsapp_message_id': whatsapp_message_id,
                'status': status,
                'phone': result["phone"]
            })
        print(f"✅ Updated message {whatsapp_message_id} status to: {status}")
    except Exception as e:
        print(f"Error updating message status: {e}")
    finally:
        conn.close()

def get_user_mode(phone):
    """Get user's current mode"""
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT human_mode FROM users WHERE phone=?", (phone,))
        row = cursor.fetchone()
        mode = row[0] if row else 0
        return mode
    except Exception as e:
        print(f"Error getting user mode: {e}")
        return 0
    finally:
        conn.close()

# =========================
# SEND WHATSAPP MESSAGE
# =========================

def send_message(to, message):
    if not WHATSAPP_TOKEN or not PHONE_NUMBER_ID:
        print("❌ WhatsApp credentials missing")
        return False, None
    
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
            response_data = res.json()
            whatsapp_msg_id = response_data.get('messages', [{}])[0].get('id')
            print(f"✅ Message sent to {to}, ID: {whatsapp_msg_id}")
            return True, whatsapp_msg_id
        else:
            print(f"❌ WhatsApp error {res.status_code}: {res.text}")
            return False, None
            
    except Exception as e:
        print(f"❌ Send error: {e}")
        return False, None

def send_file_message(to, file_path, file_type="image", caption=""):
    if not WHATSAPP_TOKEN or not PHONE_NUMBER_ID:
        return False, None
    
    try:
        media_id = upload_media_to_whatsapp(file_path, file_type)
        if not media_id:
            print("❌ Failed to upload media")
            return False, None
        
        url = f"https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages"
        headers = {
            "Authorization": f"Bearer {WHATSAPP_TOKEN}",
            "Content-Type": "application/json"
        }
        
        data = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": file_type,
            file_type: {"id": media_id}
        }
        
        if caption:
            data[file_type]["caption"] = caption
        
        print(f"📤 Sending {file_type} to {to}...")
        res = requests.post(url, headers=headers, json=data, timeout=30)
        
        if res.status_code == 200:
            response_data = res.json()
            whatsapp_msg_id = response_data.get('messages', [{}])[0].get('id')
            print(f"✅ {file_type} sent to {to}, ID: {whatsapp_msg_id}")
            return True, whatsapp_msg_id
        else:
            print(f"❌ Failed to send {file_type}: {res.text}")
            return False, None
            
    except Exception as e:
        print(f"❌ Send file error: {e}")
        return False, None

def upload_media_to_whatsapp(file_path, file_type):
    try:
        url = f"https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/media"
        headers = {
            "Authorization": f"Bearer {WHATSAPP_TOKEN}",
        }
        
        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type:
            if file_type == "image":
                mime_type = "image/jpeg"
            elif file_type == "audio":
                mime_type = "audio/mpeg"
            else:
                mime_type = "application/pdf"
        
        with open(file_path, 'rb') as f:
            files = {
                'file': (os.path.basename(file_path), f, mime_type)
            }
            data = {
                'messaging_product': 'whatsapp',
                'type': file_type
            }
            response = requests.post(url, headers=headers, files=files, data=data)
        
        if response.status_code == 200:
            media_id = response.json().get('id')
            print(f"✅ Media uploaded successfully, ID: {media_id}")
            return media_id
        else:
            print(f"❌ Upload failed: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Upload error: {e}")
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
- If something is asked outside the knowledge base, say you don't know

KNOWLEDGE:
{context}"""

        data = {
            "model": "openrouter/free",
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
# WEBHOOK - FIXED MODE HANDLING
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
                        if "value" in change:
                            value = change["value"]
                            
                            if "statuses" in value:
                                for status_update in value["statuses"]:
                                    status = status_update.get("status")
                                    message_id = status_update.get("id")
                                    
                                    if status and message_id:
                                        print(f"📊 Status update: {message_id} -> {status}")
                                        update_message_status(message_id, status)
                            
                            if "messages" in value:
                                for msg in value["messages"]:
                                    phone = msg["from"]
                                    msg_type = msg.get("type", "text")
                                    msg_id = msg.get("id")
                                    
                                    print(f"📩 {msg_type} from {phone}")
                                    
                                    # Save or update user
                                    save_user(phone)
                                    
                                    if msg_type == "text":
                                        text = msg["text"]["body"]
                                        save_message(phone, text, "user", status="delivered", whatsapp_message_id=msg_id)
                                        
                                        # IMPORTANT: Get mode AFTER saving message (to ensure latest mode)
                                        mode = get_user_mode(phone)
                                        
                                        print(f"🤖 User {phone} mode: {'HUMAN' if mode == 1 else 'AI'}")
                                        
                                        # ONLY reply if mode is AI (0) and NOT Human (1)
                                        if mode == 0:
                                            def process_ai():
                                                print(f"🤖 AI processing for {phone}")
                                                reply = ask_ai(text)
                                                success, whatsapp_msg_id = send_message(phone, reply)
                                                if success:
                                                    save_message(phone, reply, "bot", status="sent", whatsapp_message_id=whatsapp_msg_id)
                                                    print(f"✅ AI reply sent to {phone}")
                                                else:
                                                    save_message(phone, reply, "bot", status="failed")
                                                    print(f"❌ Failed to send AI reply to {phone}")
                                            
                                            thread = threading.Thread(target=process_ai)
                                            thread.daemon = True
                                            thread.start()
                                        else:
                                            print(f"👤 Human mode active for {phone} - AI reply skipped")
                                    
                                    elif msg_type in ["image", "audio", "document"]:
                                        media_info = msg[msg_type]
                                        caption = media_info.get("caption", "")
                                        
                                        save_message(phone, caption or f"Sent a {msg_type}", "user", 
                                                   message_type=msg_type, whatsapp_message_id=msg_id)
                                    
                                    elif msg_type == "button":
                                        text = msg["button"]["text"]
                                        save_message(phone, text, "user", status="delivered", whatsapp_message_id=msg_id)
                                    
                                    elif msg_type == "interactive":
                                        if "list_reply" in msg["interactive"]:
                                            text = msg["interactive"]["list_reply"]["title"]
                                            save_message(phone, text, "user", status="delivered", whatsapp_message_id=msg_id)
                                    
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
    
    users_list = []
    for r in rows:
        users_list.append({
            "phone": r["phone"], 
            "human_mode": r["human_mode"], 
            "tags": r["tags"] or "",
            "notes": r["notes"] or "",
            "total_messages": r["total_messages"] or 0,
            "last_seen": r["last_seen"],
            "last": r["last_message"] if r["last_message"] else "No messages"
        })
    
    return jsonify(users_list)

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
    
    messages_list = []
    for r in rows:
        messages_list.append({
            "message": r["message"] or "",
            "direction": r["direction"],
            "status": r["status"] if r["status"] else "sent",
            "timestamp": r["timestamp"],
            "message_type": r["message_type"] if r["message_type"] else "text",
            "media_path": r["media_path"],
            "file_name": r["file_name"]
        })
    
    return jsonify(messages_list)

@app.route("/send", methods=["POST"])
def send_panel():
    data = request.json
    phone = data.get("phone")
    message = data.get("message")
    
    if not phone or not message:
        return jsonify({"success": False, "error": "Phone and message required"}), 400
    
    success, whatsapp_msg_id = send_message(phone, message)
    
    if success:
        save_message(phone, message, "bot", status="sent", whatsapp_message_id=whatsapp_msg_id)
        return jsonify({"success": True, "message_id": whatsapp_msg_id})
    else:
        save_message(phone, message, "bot", status="failed")
        return jsonify({"success": False, "error": "Failed to send"}), 500

@app.route("/send-file", methods=["POST"])
def send_file_endpoint():
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
    
    original_filename = file.filename
    filename = secure_filename(f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{original_filename}")
    filepath = os.path.join(app.config['MEDIA_FOLDER'], filename)
    file.save(filepath)
    
    ext = filename.rsplit('.', 1)[1].lower()
    if ext in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
        whatsapp_type = "image"
    elif ext in ['mp3', 'wav', 'ogg']:
        whatsapp_type = "audio"
    elif ext in ['mp4', 'mov', 'avi']:
        whatsapp_type = "video"
    else:
        whatsapp_type = "document"
    
    caption = request.form.get("caption", f"Sent: {original_filename}")
    success, whatsapp_msg_id = send_file_message(phone, filepath, whatsapp_type, caption)
    
    if success:
        save_message(phone, caption, "bot", message_type=whatsapp_type, 
                    media_path=filepath, file_name=original_filename, 
                    whatsapp_message_id=whatsapp_msg_id)
        return jsonify({"success": True, "message_id": whatsapp_msg_id})
    else:
        try:
            os.remove(filepath)
        except:
            pass
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
    
    mode_text = "AI" if new == 0 else "HUMAN"
    print(f"🔄 User {phone} switched to {mode_text} mode")
    
    socketio.emit('mode_changed', {'phone': phone, 'human_mode': new})
    
    return jsonify({"human_mode": new})

@app.route("/update-user", methods=["POST"])
def update_user():
    data = request.json
    phone = data.get("phone")
    tags = data.get("tags")
    notes = data.get("notes")
    
    conn = get_db()
    cursor = conn.cursor()
    
    if tags is not None:
        cursor.execute("UPDATE users SET tags=? WHERE phone=?", (tags, phone))
    if notes is not None:
        cursor.execute("UPDATE users SET notes=? WHERE phone=?", (notes, phone))
    
    conn.commit()
    conn.close()
    
    socketio.emit('user_updated', {'phone': phone, 'tags': tags, 'notes': notes})
    
    return jsonify({"success": True})

@app.route("/analytics", methods=["GET"])
def get_analytics():
    conn = get_db()
    cursor = conn.cursor()
    
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
    
    cursor.execute("""
        SELECT message_type, COUNT(*) as count
        FROM messages
        GROUP BY message_type
    """)
    message_types = [{"type": r[0] if r[0] else "text", "count": r[1]} for r in cursor.fetchall()]
    
    cursor.execute("""
        SELECT phone, total_messages, last_seen 
        FROM users 
        ORDER BY total_messages DESC 
        LIMIT 10
    """)
    top_users = [{"phone": r[0], "messages": r[1], "last_seen": r[2]} for r in cursor.fetchall()]
    
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
    
    cursor.execute("""
        SELECT message, COUNT(*) as count
        FROM messages
        WHERE direction = 'user' AND message_type = 'text' AND message != ''
        GROUP BY message
        ORDER BY count DESC
        LIMIT 10
    """)
    top_questions = [{"question": r[0], "count": r[1]} for r in cursor.fetchall()]
    
    cursor.execute("""
        SELECT DATE(timestamp) as date, COUNT(*) as count
        FROM messages
        WHERE DATE(timestamp) >= DATE('now', '-7 days')
        GROUP BY DATE(timestamp)
        ORDER BY date
    """)
    daily_activity = [{"date": r[0], "messages": r[1]} for r in cursor.fetchall()]
    
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
        "daily_activity": daily_activity
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
        rows = cursor.fetchall()
        conn.close()
        
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(['Message', 'Direction', 'Status', 'Timestamp'])
        for row in rows:
            writer.writerow([row[0], row[1], row[2], row[3]])
    else:
        cursor.execute(
            "SELECT phone, message, direction, status, timestamp FROM messages ORDER BY id ASC"
        )
        rows = cursor.fetchall()
        conn.close()
        
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(['Phone', 'Message', 'Direction', 'Status', 'Timestamp'])
        for row in rows:
            writer.writerow([row[0], row[1], row[2], row[3], row[4]])
    
    output.seek(0)
    filename = f"conversation_{phone if phone else 'all'}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    
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
        "phone_number_id": bool(PHONE_NUMBER_ID),
        "openrouter_configured": bool(OPENROUTER_API_KEY),
        "timestamp": datetime.now().isoformat()
    })

@app.route("/socket-test", methods=["GET"])
def socket_test():
    return jsonify({"message": "WebSocket is running on port 5000"})

@app.route("/debug/mode/<phone>", methods=["GET"])
def debug_mode(phone):
    """Debug endpoint to check user mode"""
    mode = get_user_mode(phone)
    return jsonify({"phone": phone, "human_mode": mode})

if __name__ == "__main__":
    print("\n" + "="*50)
    print("🤖 WhatsApp Bot Server - WebSocket Live Updates")
    print("="*50)
    print(f"📍 Webhook: http://localhost:5000/webhook")
    print(f"📍 Dashboard: http://localhost:3000")
    print(f"📍 WebSocket: ws://localhost:5000/socket.io")
    print(f"📍 Health: http://localhost:5000/health")
    print(f"📍 Debug: http://localhost:5000/debug/mode/PHONE_NUMBER")
    print("\n📋 Mode Control:")
    print("   🔴 AI Mode = Bot auto-replies")
    print("   🟢 Human Mode = Bot does NOT reply")
    print("   ✅ Click 'Switch to Human' to disable AI")
    print("="*50 + "\n")
    
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, allow_unsafe_werkzeug=True)