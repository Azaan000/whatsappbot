/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useState, useRef } from "react";

const API = "http://localhost:5000";

export default function App() {
  const [users, setUsers] = useState([]);
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastProgress, setBroadcastProgress] = useState({ current: 0, total: 0 });
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingUser, setEditingUser] = useState(null);
  const [userTags, setUserTags] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);

  const messagesEndRef = useRef(null);
  const modalRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load users
  const loadUsers = async () => {
    try {
      const res = await fetch(`${API}/users`);
      const data = await res.json();
      setUsers(data);
      
      if (selectedPhone) {
        const updated = data.find(u => u.phone === selectedPhone);
        if (updated) setSelectedUser(updated);
      }
    } catch (err) {
      console.error("Error loading users:", err);
    }
  };

  // Load stats
  const loadStats = async () => {
    try {
      const res = await fetch(`${API}/analytics`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error("Error loading stats:", err);
    }
  };

  // Load messages with search
  const loadMessages = async (phone, search = "") => {
    setLoading(true);
    try {
      const url = search ? `${API}/messages/${phone}?search=${encodeURIComponent(search)}` : `${API}/messages/${phone}`;
      const res = await fetch(url);
      const data = await res.json();
      setMessages(data);
    } catch (err) {
      console.error("Error loading messages:", err);
    } finally {
      setLoading(false);
    }
  };

  // Auto refresh
  useEffect(() => {
    loadUsers();
    loadStats();
    const interval = setInterval(() => {
      loadStats();
      if (selectedPhone) loadMessages(selectedPhone, searchQuery);
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedPhone, searchQuery]);

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close modal on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setShowBroadcast(false);
        setShowAnalytics(false);
        setEditingUser(null);
      }
    };
    if (showBroadcast || showAnalytics || editingUser) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showBroadcast, showAnalytics, editingUser]);

  // Select user
  const selectUser = (user) => {
    setSelectedPhone(user.phone);
    setSelectedUser(user);
    setSearchQuery("");
    loadMessages(user.phone);
  };

  // Send message
  const sendMessage = async () => {
    if (!text.trim() || !selectedPhone || sending) return;

    const messageText = text;
    setText("");
    setSending(true);
    
    const tempMsg = {
      message: messageText,
      direction: "bot",
      status: "sending",
      timestamp: new Date().toISOString(),
      message_type: "text"
    };
    setMessages(prev => [...prev, tempMsg]);

    try {
      const res = await fetch(`${API}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selectedPhone, message: messageText })
      });
      
      if (res.ok) {
        setTimeout(() => loadMessages(selectedPhone, searchQuery), 500);
      } else {
        alert("Failed to send message");
      }
    } catch (err) {
      console.error("Send error:", err);
      alert("Error sending message");
    } finally {
      setSending(false);
    }
  };

  // Send file
  const sendFile = async () => {
    if (!selectedFile || !selectedPhone) return;

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('phone', selectedPhone);

    setSending(true);
    
    const tempMsg = {
      message: `Sending ${selectedFile.name}`,
      direction: "bot",
      status: "sending",
      timestamp: new Date().toISOString(),
      message_type: "file",
      file_name: selectedFile.name
    };
    setMessages(prev => [...prev, tempMsg]);

    try {
      const res = await fetch(`${API}/send-file`, {
        method: "POST",
        body: formData
      });
      
      if (res.ok) {
        setTimeout(() => loadMessages(selectedPhone, searchQuery), 500);
      } else {
        alert("Failed to send file");
      }
    } catch (err) {
      console.error("Send file error:", err);
      alert("Error sending file");
    } finally {
      setSending(false);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Broadcast message
  const sendBroadcast = async () => {
    if (!broadcastMessage.trim()) {
      alert("Please enter a message to broadcast");
      return;
    }

    if (users.length === 0) {
      alert("No users to send broadcast to");
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to send this message to ${users.length} user(s)?\n\nMessage: "${broadcastMessage}"`
    );

    if (!confirmed) return;

    setBroadcasting(true);
    setBroadcastProgress({ current: 0, total: users.length });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      setBroadcastProgress({ current: i + 1, total: users.length });
      
      try {
        const res = await fetch(`${API}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: user.phone, message: broadcastMessage })
        });
        
        if (res.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        console.error(`Failed to send to ${user.phone}:`, err);
        failCount++;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    setBroadcasting(false);
    setShowBroadcast(false);
    setBroadcastMessage("");
    
    alert(`Broadcast completed!\n✅ Sent: ${successCount}\n❌ Failed: ${failCount}`);
    
    if (selectedPhone) {
      loadMessages(selectedPhone, searchQuery);
    }
  };

  // Toggle mode
  const toggleMode = async () => {
    if (!selectedPhone) return;
    
    try {
      const res = await fetch(`${API}/toggle/${selectedPhone}`, { method: "POST" });
      const data = await res.json();
      if (data.human_mode !== undefined) {
        setSelectedUser(prev => ({ ...prev, human_mode: data.human_mode }));
        loadUsers();
      }
    } catch (err) {
      console.error("Toggle error:", err);
    }
  };

  // Update user tags/notes
  const updateUser = async () => {
    try {
      await fetch(`${API}/update-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selectedPhone, tags: userTags, notes: userNotes })
      });
      alert("User updated successfully!");
      setEditingUser(null);
      loadUsers();
    } catch (err) {
      console.error("Update error:", err);
      alert("Failed to update user");
    }
  };

  // Export conversation
  const exportConversation = async (phone = null) => {
    const url = phone ? `${API}/export/csv?phone=${phone}` : `${API}/export/csv`;
    window.open(url, '_blank');
  };

  // Get status icon
  const getStatusIcon = (status) => {
    switch(status) {
      case 'sent': return '✓';
      case 'delivered': return '✓✓';
      case 'read': return '✓✓';
      case 'sending': return '⋯';
      case 'failed': return '⚠️';
      default: return '';
    }
  };

  // Get message type icon
  const getMessageTypeIcon = (type) => {
    switch(type) {
      case 'image': return '🖼️';
      case 'audio': return '🎵';
      case 'document': return '📄';
      case 'file': return '📎';
      default: return '💬';
    }
  };

  return (
    <div style={styles.app}>
      {/* Analytics Bar */}
      <div style={styles.analyticsBar}>
        <div style={styles.statItem}>👥 Users: {stats.total_users || 0}</div>
        <div style={styles.statItem}>💬 Messages: {stats.total_messages || 0}</div>
        <div style={styles.statItem}>🤖 AI: {stats.ai_users || 0}</div>
        <div style={styles.statItem}>👤 Human: {stats.human_users || 0}</div>
        <div style={styles.statItem}>📅 Today: {stats.messages_today || 0}</div>
        <div style={styles.statItem}>⏱️ Response: {stats.avg_response_time || 0} min</div>
        <button style={styles.analyticsBtn} onClick={() => setShowAnalytics(true)}>
          📊 View Analytics
        </button>
        <button style={styles.broadcastBtn} onClick={() => setShowBroadcast(true)}>
          📢 Broadcast
        </button>
      </div>

      <div style={styles.container}>
        {/* Sidebar */}
        <div style={styles.sidebar}>
          <h2 style={styles.title}>WhatsApp Dashboard</h2>
          <div style={styles.userCount}>{users.length} Chats</div>
          
          <button style={styles.exportAllBtn} onClick={() => exportConversation()}>
            📥 Export All Conversations
          </button>
          
          <div style={styles.userList}>
            {users.map((user, i) => (
              <div
                key={i}
                style={{
                  ...styles.user,
                  background: selectedPhone === user.phone ? "#e3f2fd" : "transparent"
                }}
                onClick={() => selectUser(user)}
              >
                <div style={styles.userPhone}>{user.phone}</div>
                <div style={styles.userStats}>
                  <span>📨 {user.total_messages || 0}</span>
                  {user.tags && <span style={styles.userTag}>🏷️ {user.tags}</span>}
                </div>
                <div style={styles.userLast}>{user.last || "No messages"}</div>
                <div style={{
                  ...styles.userMode,
                  color: user.human_mode ? "#ff9800" : "#4caf50"
                }}>
                  {user.human_mode ? "👤 HUMAN" : "🤖 AI"}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat Area */}
        <div style={styles.chat}>
          {selectedUser ? (
            <>
              <div style={styles.header}>
                <div>
                  <h3>{selectedUser.phone}</h3>
                  <div style={styles.headerInfo}>
                    <span style={{ fontSize: 12, color: selectedUser.human_mode ? "#ff9800" : "#0b5cff" }}>
                      {selectedUser.human_mode ? "👤 Human Mode" : "🤖 AI Mode"}
                    </span>
                    {selectedUser.tags && <span style={styles.tagBadge}>🏷️ {selectedUser.tags}</span>}
                  </div>
                </div>
                <div style={styles.headerButtons}>
                  <button style={styles.toggleBtn} onClick={toggleMode}>
                    {selectedUser.human_mode ? "Switch to AI 🤖" : "Switch to Human 👤"}
                  </button>
                  <button style={styles.editBtn} onClick={() => {
                    setEditingUser(selectedUser);
                    setUserTags(selectedUser.tags || "");
                    setUserNotes(selectedUser.notes || "");
                  }}>
                    ✏️ Edit
                  </button>
                  <button style={styles.exportBtn} onClick={() => exportConversation(selectedUser.phone)}>
                    📥 Export
                  </button>
                </div>
              </div>

              {/* Search Bar */}
              <div style={styles.searchBar}>
                <input
                  style={styles.searchInput}
                  type="text"
                  placeholder="🔍 Search messages..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button style={styles.clearSearch} onClick={() => setSearchQuery("")}>
                    ✖
                  </button>
                )}
              </div>

              <div style={styles.messagesArea}>
                {loading && <div style={styles.loading}>Loading...</div>}
                
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      ...styles.bubble,
                      alignSelf: msg.direction === "user" ? "flex-start" : "flex-end",
                      background: msg.direction === "user" ? "#e4e6eb" : "#0b5cff",
                      color: msg.direction === "user" ? "#000" : "#fff"
                    }}
                  >
                    <div style={styles.bubbleHeader}>
                      <span>{getMessageTypeIcon(msg.message_type)}</span>
                      {msg.file_name && <span style={styles.fileName}>📎 {msg.file_name}</span>}
                      <span style={styles.bubbleText}>{msg.message || `[${msg.message_type} message]`}</span>
                    </div>
                    <div style={styles.time}>
                      {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
                      {msg.direction === "bot" && (
                        <span style={{ marginLeft: 5 }}>{getStatusIcon(msg.status)}</span>
                      )}
                    </div>
                  </div>
                ))}
                
                <div ref={messagesEndRef} />
              </div>

              <div style={styles.inputArea}>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => setSelectedFile(e.target.files[0])}
                  style={styles.fileInput}
                  accept="image/*,application/pdf,audio/*"
                />
                {selectedFile && (
                  <button style={styles.sendFileBtn} onClick={sendFile} disabled={sending}>
                    📎 Send File
                  </button>
                )}
                <input
                  style={styles.input}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Type a message..."
                  disabled={sending}
                />
                <button style={styles.sendBtn} onClick={sendMessage} disabled={sending || !text.trim()}>
                  {sending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </>
          ) : (
            <div style={styles.empty}>
              <div>💬</div>
              <div>Select a chat to start messaging</div>
            </div>
          )}
        </div>
      </div>

      {/* Broadcast Modal */}
      {showBroadcast && (
        <div style={modalStyles.overlay}>
          <div ref={modalRef} style={modalStyles.modal}>
            <div style={modalStyles.header}>
              <h2>📢 Broadcast Message</h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowBroadcast(false)}>×</button>
            </div>
            <div style={modalStyles.body}>
              <div style={modalStyles.info}>👥 Will be sent to: <strong>{users.length}</strong> user(s)</div>
              <textarea
                style={modalStyles.textarea}
                placeholder="Type your broadcast message here..."
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                rows={6}
              />
              {broadcasting && (
                <div style={modalStyles.progressContainer}>
                  <div style={modalStyles.progressBar}>
                    <div style={{...modalStyles.progressFill, width: `${(broadcastProgress.current / broadcastProgress.total) * 100}%`}} />
                  </div>
                  <div style={modalStyles.progressText}>{broadcastProgress.current} / {broadcastProgress.total}</div>
                </div>
              )}
            </div>
            <div style={modalStyles.footer}>
              <button style={modalStyles.cancelBtn} onClick={() => setShowBroadcast(false)}>Cancel</button>
              <button style={modalStyles.sendBtn} onClick={sendBroadcast} disabled={broadcasting}>Send Broadcast</button>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Modal - Beautiful Presentation */}
      {showAnalytics && (
        <div style={modalStyles.overlay}>
          <div ref={modalRef} style={{...modalStyles.modal, width: "800px", maxHeight: "80vh"}}>
            <div style={modalStyles.header}>
              <h2>📊 Advanced Analytics Dashboard</h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowAnalytics(false)}>×</button>
            </div>
            <div style={{...modalStyles.body, maxHeight: "calc(80vh - 120px)", overflowY: "auto"}}>
              
              {/* Key Metrics Cards */}
              <div style={analyticsStyles.cardsGrid}>
                <div style={analyticsStyles.card}>
                  <div style={analyticsStyles.cardIcon}>👥</div>
                  <div style={analyticsStyles.cardValue}>{stats.total_users || 0}</div>
                  <div style={analyticsStyles.cardLabel}>Total Users</div>
                </div>
                <div style={analyticsStyles.card}>
                  <div style={analyticsStyles.cardIcon}>💬</div>
                  <div style={analyticsStyles.cardValue}>{stats.total_messages || 0}</div>
                  <div style={analyticsStyles.cardLabel}>Total Messages</div>
                </div>
                <div style={analyticsStyles.card}>
                  <div style={analyticsStyles.cardIcon}>⏱️</div>
                  <div style={analyticsStyles.cardValue}>{stats.avg_response_time || 0} min</div>
                  <div style={analyticsStyles.cardLabel}>Avg Response Time</div>
                </div>
                <div style={analyticsStyles.card}>
                  <div style={analyticsStyles.cardIcon}>📅</div>
                  <div style={analyticsStyles.cardValue}>{stats.messages_today || 0}</div>
                  <div style={analyticsStyles.cardLabel}>Messages Today</div>
                </div>
              </div>

              {/* Mode Distribution */}
              <div style={analyticsStyles.section}>
                <h3>🤖 Mode Distribution</h3>
                <div style={analyticsStyles.statsRow}>
                  <div style={analyticsStyles.statBox}>
                    <div style={analyticsStyles.statNumber}>{stats.ai_users || 0}</div>
                    <div style={analyticsStyles.statLabel}>AI Mode Users</div>
                    <div style={{...analyticsStyles.progressBar, background: "#e3f2fd"}}>
                      <div style={{...analyticsStyles.progressFill, width: `${((stats.ai_users || 0) / (stats.total_users || 1)) * 100}%`, background: "#4caf50"}} />
                    </div>
                  </div>
                  <div style={analyticsStyles.statBox}>
                    <div style={analyticsStyles.statNumber}>{stats.human_users || 0}</div>
                    <div style={analyticsStyles.statLabel}>Human Mode Users</div>
                    <div style={{...analyticsStyles.progressBar, background: "#e3f2fd"}}>
                      <div style={{...analyticsStyles.progressFill, width: `${((stats.human_users || 0) / (stats.total_users || 1)) * 100}%`, background: "#ff9800"}} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Message Types */}
              {stats.message_types && stats.message_types.length > 0 && (
                <div style={analyticsStyles.section}>
                  <h3>📨 Message Types Distribution</h3>
                  <div style={analyticsStyles.typesGrid}>
                    {stats.message_types.map((type, i) => (
                      <div key={i} style={analyticsStyles.typeBadge}>
                        {type.type === 'text' && '💬'} 
                        {type.type === 'image' && '🖼️'} 
                        {type.type === 'audio' && '🎵'} 
                        {type.type === 'document' && '📄'}
                        {' '}{type.type}: {type.count}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Daily Activity */}
              {stats.daily_activity && stats.daily_activity.length > 0 && (
                <div style={analyticsStyles.section}>
                  <h3>📈 Daily Activity (Last 7 Days)</h3>
                  <div style={analyticsStyles.chart}>
                    {stats.daily_activity.map((day, i) => (
                      <div key={i} style={analyticsStyles.chartBar}>
                        <div style={analyticsStyles.chartLabel}>{new Date(day.date).toLocaleDateString()}</div>
                        <div style={analyticsStyles.chartBarContainer}>
                          <div style={{
                            ...analyticsStyles.chartBarFill,
                            width: `${(day.messages / Math.max(...stats.daily_activity.map(d => d.messages), 1)) * 100}%`,
                            background: "#0b5cff"
                          }} />
                          <div style={analyticsStyles.chartValue}>{day.messages}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top Users */}
              {stats.top_users && stats.top_users.length > 0 && (
                <div style={analyticsStyles.section}>
                  <h3>🏆 Top Active Users</h3>
                  <div style={analyticsStyles.topUsersList}>
                    {stats.top_users.map((user, i) => (
                      <div key={i} style={analyticsStyles.topUserItem}>
                        <div style={analyticsStyles.topUserRank}>#{i+1}</div>
                        <div style={analyticsStyles.topUserPhone}>{user.phone}</div>
                        <div style={analyticsStyles.topUserStats}>
                          📨 {user.messages} messages
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Most Asked Questions */}
              {stats.top_questions && stats.top_questions.length > 0 && (
                <div style={analyticsStyles.section}>
                  <h3>❓ Most Asked Questions</h3>
                  <div style={analyticsStyles.questionsList}>
                    {stats.top_questions.map((q, i) => (
                      <div key={i} style={analyticsStyles.questionItem}>
                        <div style={analyticsStyles.questionText}>"{q.question}"</div>
                        <div style={analyticsStyles.questionCount}>Asked {q.count} times</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Hourly Activity */}
              {stats.hourly_activity && stats.hourly_activity.length > 0 && (
                <div style={analyticsStyles.section}>
                  <h3>⏰ Activity by Hour</h3>
                  <div style={analyticsStyles.hourlyGrid}>
                    {stats.hourly_activity.map((hour, i) => (
                      <div key={i} style={analyticsStyles.hourItem}>
                        <div>{hour.hour}:00</div>
                        <div style={analyticsStyles.hourCount}>{hour.messages}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div style={modalStyles.overlay}>
          <div ref={modalRef} style={modalStyles.modal}>
            <div style={modalStyles.header}>
              <h2>✏️ Edit User</h2>
              <button style={modalStyles.closeBtn} onClick={() => setEditingUser(null)}>×</button>
            </div>
            <div style={modalStyles.body}>
              <div style={modalStyles.field}>
                <label>Phone: <strong>{editingUser.phone}</strong></label>
              </div>
              <div style={modalStyles.field}>
                <label>Tags (comma separated):</label>
                <input
                  style={modalStyles.input}
                  value={userTags}
                  onChange={(e) => setUserTags(e.target.value)}
                  placeholder="e.g., VIP, lead, interested"
                />
              </div>
              <div style={modalStyles.field}>
                <label>Notes:</label>
                <textarea
                  style={modalStyles.textarea}
                  value={userNotes}
                  onChange={(e) => setUserNotes(e.target.value)}
                  rows={4}
                  placeholder="Internal notes about this user..."
                />
              </div>
            </div>
            <div style={modalStyles.footer}>
              <button style={modalStyles.cancelBtn} onClick={() => setEditingUser(null)}>Cancel</button>
              <button style={modalStyles.saveBtn} onClick={updateUser}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  app: { backgroundColor: "#f5f5f5", minHeight: "100vh" },
  analyticsBar: {
    display: "flex",
    gap: "20px",
    padding: "12px 24px",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: "#fff",
    fontSize: "13px",
    alignItems: "center",
    flexWrap: "wrap",
    boxShadow: "0 2px 10px rgba(0,0,0,0.1)"
  },
  statItem: { fontWeight: "500" },
  analyticsBtn: { padding: "6px 14px", background: "#fff", color: "#667eea", border: "none", borderRadius: "20px", cursor: "pointer", fontWeight: "500" },
  broadcastBtn: { padding: "6px 14px", background: "#ff9800", color: "#fff", border: "none", borderRadius: "20px", cursor: "pointer", fontWeight: "500" },
  container: { display: "flex", height: "calc(100vh - 60px)" },
  sidebar: { width: "300px", background: "#fff", borderRight: "1px solid #e0e0e0", display: "flex", flexDirection: "column" },
  title: { padding: "20px", margin: 0, fontSize: "18px", color: "#333", borderBottom: "1px solid #e0e0e0" },
  userCount: { padding: "10px 20px", fontSize: "12px", color: "#666", borderBottom: "1px solid #e0e0e0" },
  exportAllBtn: { margin: "10px 20px", padding: "8px", background: "#4caf50", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer" },
  userList: { flex: 1, overflowY: "auto", padding: "10px" },
  user: { padding: "12px", marginBottom: "8px", borderRadius: "10px", cursor: "pointer", transition: "all 0.2s" },
  userPhone: { fontWeight: "bold", fontSize: "13px", marginBottom: "4px", color: "#333" },
  userStats: { fontSize: "11px", display: "flex", gap: "10px", marginBottom: "4px", color: "#666" },
  userTag: { background: "#e3f2fd", padding: "2px 6px", borderRadius: "10px", fontSize: "10px" },
  userLast: { fontSize: "11px", color: "#999", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  userMode: { fontSize: "10px", marginTop: "4px", fontWeight: "500" },
  chat: { flex: 1, display: "flex", flexDirection: "column", background: "#f0f2f5" },
  header: { padding: "15px 20px", background: "#fff", borderBottom: "1px solid #e0e0e0", display: "flex", justifyContent: "space-between", alignItems: "center" },
  headerInfo: { display: "flex", gap: "10px", alignItems: "center", marginTop: "5px" },
  tagBadge: { background: "#e3f2fd", padding: "2px 8px", borderRadius: "12px", fontSize: "11px", color: "#0b5cff" },
  headerButtons: { display: "flex", gap: "10px" },
  toggleBtn: { padding: "8px 16px", background: "#0b5cff", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer" },
  editBtn: { padding: "8px 16px", background: "#ff9800", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer" },
  exportBtn: { padding: "8px 16px", background: "#4caf50", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer" },
  searchBar: { padding: "10px 20px", background: "#fff", borderBottom: "1px solid #e0e0e0", position: "relative" },
  searchInput: { width: "100%", padding: "8px 12px", borderRadius: "20px", border: "1px solid #ddd", outline: "none" },
  clearSearch: { position: "absolute", right: "30px", top: "18px", background: "none", border: "none", cursor: "pointer", color: "#999" },
  messagesArea: { flex: 1, padding: "20px", display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", backgroundColor: "#efeae2" },
  loading: { textAlign: "center", color: "#666", padding: "20px" },
  bubble: { padding: "8px 12px", borderRadius: "12px", maxWidth: "60%", fontSize: "14px", wordWrap: "break-word", boxShadow: "0 1px 1px rgba(0,0,0,0.1)" },
  bubbleHeader: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  bubbleText: { wordBreak: "break-word" },
  fileName: { fontSize: "11px", opacity: 0.8, fontStyle: "italic" },
  time: { fontSize: "10px", marginTop: "4px", opacity: 0.7, textAlign: "right" },
  inputArea: { display: "flex", padding: "15px 20px", background: "#fff", borderTop: "1px solid #ddd", gap: "10px", alignItems: "center" },
  fileInput: { padding: "5px", border: "1px solid #ddd", borderRadius: "5px", fontSize: "12px" },
  sendFileBtn: { padding: "10px 15px", background: "#9c27b0", color: "#fff", border: "none", borderRadius: "20px", cursor: "pointer" },
  input: { flex: 1, padding: "10px 15px", borderRadius: "20px", border: "1px solid #ddd", outline: "none" },
  sendBtn: { padding: "10px 20px", background: "#0b5cff", color: "#fff", border: "none", borderRadius: "20px", cursor: "pointer" },
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", color: "#888" }
};

const modalStyles = {
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal: { background: "#fff", borderRadius: "16px", width: "500px", maxWidth: "90%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px", borderBottom: "1px solid #e0e0e0" },
  closeBtn: { background: "none", border: "none", fontSize: "28px", cursor: "pointer", color: "#999" },
  body: { padding: "20px" },
  footer: { display: "flex", justifyContent: "flex-end", gap: "10px", padding: "20px", borderTop: "1px solid #e0e0e0" },
  info: { marginBottom: "15px", fontSize: "14px", color: "#666" },
  textarea: { width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "8px", marginTop: "10px", minHeight: "100px", fontFamily: "inherit" },
  input: { width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "8px", marginTop: "5px" },
  field: { marginBottom: "15px" },
  progressContainer: { marginTop: "15px" },
  progressBar: { height: "8px", background: "#f0f0f0", borderRadius: "4px", overflow: "hidden" },
  progressFill: { height: "100%", background: "#0b5cff", transition: "width 0.3s" },
  progressText: { textAlign: "center", marginTop: "8px", fontSize: "12px", color: "#666" },
  cancelBtn: { padding: "8px 16px", background: "#f5f5f5", color: "#333", border: "1px solid #ddd", borderRadius: "8px", cursor: "pointer" },
  sendBtn: { padding: "8px 20px", background: "#0b5cff", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer" },
  saveBtn: { padding: "8px 20px", background: "#4caf50", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer" }
};

const analyticsStyles = {
  cardsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "15px", marginBottom: "25px" },
  card: { background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", padding: "20px", borderRadius: "12px", textAlign: "center", color: "#fff" },
  cardIcon: { fontSize: "32px", marginBottom: "10px" },
  cardValue: { fontSize: "28px", fontWeight: "bold", marginBottom: "5px" },
  cardLabel: { fontSize: "12px", opacity: 0.9 },
  section: { marginBottom: "25px", padding: "15px", background: "#f8f9fa", borderRadius: "12px" },
  statsRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px" },
  statBox: { textAlign: "center", padding: "15px", background: "#fff", borderRadius: "8px" },
  statNumber: { fontSize: "24px", fontWeight: "bold", color: "#333" },
  statLabel: { fontSize: "12px", color: "#666", marginBottom: "8px" },
  progressBar: { height: "6px", background: "#e0e0e0", borderRadius: "3px", overflow: "hidden" },
  progressFill: { height: "100%", transition: "width 0.3s" },
  typesGrid: { display: "flex", flexWrap: "wrap", gap: "10px" },
  typeBadge: { padding: "5px 12px", background: "#fff", borderRadius: "20px", fontSize: "12px", color: "#333", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" },
  chart: { display: "flex", flexDirection: "column", gap: "10px" },
  chartBar: { display: "flex", alignItems: "center", gap: "10px" },
  chartLabel: { width: "100px", fontSize: "11px", color: "#666" },
  chartBarContainer: { flex: 1, position: "relative", height: "30px", background: "#e0e0e0", borderRadius: "15px", overflow: "hidden" },
  chartBarFill: { height: "100%", transition: "width 0.3s", display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: "10px" },
  chartValue: { position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", fontSize: "11px", color: "#333" },
  topUsersList: { display: "flex", flexDirection: "column", gap: "8px" },
  topUserItem: { display: "flex", alignItems: "center", gap: "10px", padding: "10px", background: "#fff", borderRadius: "8px" },
  topUserRank: { fontSize: "18px", fontWeight: "bold", color: "#0b5cff", width: "40px" },
  topUserPhone: { flex: 1, fontSize: "13px", fontWeight: "500" },
  topUserStats: { fontSize: "12px", color: "#666" },
  questionsList: { display: "flex", flexDirection: "column", gap: "8px" },
  questionItem: { padding: "10px", background: "#fff", borderRadius: "8px" },
  questionText: { fontSize: "13px", color: "#333", marginBottom: "5px" },
  questionCount: { fontSize: "11px", color: "#0b5cff" },
  hourlyGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: "8px" },
  hourItem: { padding: "8px", background: "#fff", borderRadius: "8px", textAlign: "center", fontSize: "12px" },
  hourCount: { fontSize: "16px", fontWeight: "bold", color: "#0b5cff", marginTop: "4px" }
};