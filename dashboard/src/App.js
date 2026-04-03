import { useEffect, useRef, useState } from "react";

export default function App() {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const chatEndRef = useRef(null);

  // Load users
  const loadUsers = async () => {
    const res = await fetch("http://127.0.0.1:5000/users");
    const data = await res.json();
    setUsers(data);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  // Load messages
  const loadMessages = async (phone) => {
    const res = await fetch(`http://127.0.0.1:5000/messages/${phone}`);
    const data = await res.json();

    setMessages(data);
    setSelectedUser(phone);
  };

  // Auto scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ✅ FIXED REAL-TIME POLLING
  useEffect(() => {
    let lastLength = 0;

    const interval = setInterval(async () => {
      if (!selectedUser) return;

      const res = await fetch(`http://127.0.0.1:5000/messages/${selectedUser}`);
      const data = await res.json();

      if (data.length !== lastLength) {
        const lastMsg = data[data.length - 1];

        if (lastMsg && lastMsg[1] === "user") {
          setTyping(true);

          setTimeout(() => {
            setTyping(false);
            setMessages(data);
          }, 600);
        } else {
          setMessages(data);
        }

        lastLength = data.length;
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [selectedUser]);

  // Send message
  const sendMessage = async () => {
    if (!input || !selectedUser) return;

    await fetch("http://127.0.0.1:5000/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: selectedUser, message: input })
    });

    setMessages(prev => [
      ...prev,
      [input, "bot", new Date().toLocaleTimeString()]
    ]);

    setInput("");
  };

  const toggleMode = async (phone) => {
    await fetch(`http://127.0.0.1:5000/toggle/${phone}`, {
      method: "POST"
    });
    loadUsers();
  };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "Segoe UI" }}>

      {/* Sidebar */}
      <div style={{ width: "30%", background: "#111b21", color: "white" }}>
        <div style={{ padding: 15, borderBottom: "1px solid #222" }}>
          <h2>WhatsApp</h2>
        </div>

        {users.map((u, i) => (
          <div
            key={i}
            onClick={() => loadMessages(u.phone)}
            style={{
              padding: 15,
              borderBottom: "1px solid #222",
              cursor: "pointer",
              background: selectedUser === u.phone ? "#202c33" : "transparent"
            }}
          >
            <div style={{ fontWeight: "bold" }}>{u.phone}</div>

            <div style={{ fontSize: 12, color: "#aaa" }}>
              {u.human_mode ? "👨 Human" : "🤖 Bot"}
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleMode(u.phone);
              }}
              style={{
                marginTop: 5,
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 5,
                border: "none",
                background: u.human_mode ? "#ef4444" : "#25D366",
                color: "white"
              }}
            >
              {u.human_mode ? "Bot" : "Take Over"}
            </button>
          </div>
        ))}
      </div>

      {/* Chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#0b141a" }}>

        {/* Header */}
        <div style={{ padding: 15, borderBottom: "1px solid #222", color: "white" }}>
          {selectedUser || "Select chat"}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: m[1] === "user" ? "flex-start" : "flex-end"
              }}
            >
              <div
                style={{
                  background: m[1] === "user" ? "#202c33" : "#005c4b",
                  color: "white",
                  padding: "8px 12px",
                  borderRadius: 8,
                  marginBottom: 8,
                  maxWidth: "60%"
                }}
              >
                {m[0]}
                <div style={{ fontSize: 10, textAlign: "right", opacity: 0.7 }}>
                  {m[2]}
                </div>
              </div>
            </div>
          ))}

          {typing && (
            <div style={{ color: "#aaa", fontSize: 12 }}>typing...</div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={{ display: "flex", padding: 10, borderTop: "1px solid #222", background: "#202c33" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message"
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 20,
              border: "none",
              outline: "none"
            }}
          />

          <button
            onClick={sendMessage}
            style={{
              marginLeft: 10,
              background: "#25D366",
              border: "none",
              borderRadius: "50%",
              width: 45,
              height: 45,
              color: "white"
            }}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}