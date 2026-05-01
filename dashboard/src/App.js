/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useState, useRef } from "react";
import io from "socket.io-client";

const API = "http://localhost:5000";
const socket = io(API, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10
});

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
  const [connected, setConnected] = useState(false);
  const [typing, setTyping] = useState(false);
  
  // Track unread messages per user
  const [unreadCounts, setUnreadCounts] = useState({});
  const [highlightedUsers, setHighlightedUsers] = useState(new Set());

  const messagesEndRef = useRef(null);
  const modalRef = useRef(null);
  const fileInputRef = useRef(null);

  // =========================
  // INITIAL DATA LOAD
  // =========================
  const loadInitialData = async () => {
    try {
      const [usersRes, statsRes] = await Promise.all([
        fetch(`${API}/users`),
        fetch(`${API}/analytics`)
      ]);
      
      const usersData = await usersRes.json();
      const statsData = await statsRes.json();
      
      setUsers(usersData);
      setStats(statsData);
      
      // Initialize unread counts for all users (all messages considered unread initially)
      const initialUnread = {};
      usersData.forEach(user => {
        initialUnread[user.phone] = 0;
      });
      setUnreadCounts(initialUnread);
      
      if (selectedPhone) {
        const updated = usersData.find(u => u.phone === selectedPhone);
        if (updated) setSelectedUser(updated);
      }
    } catch (err) {
      console.error("Error loading initial data:", err);
    }
  };

  // Load messages for selected user
  const loadMessages = async (phone, search = "") => {
    if (!phone) return;
    setLoading(true);
    try {
      const url = search ? `${API}/messages/${phone}?search=${encodeURIComponent(search)}` : `${API}/messages/${phone}`;
      const res = await fetch(url);
      const data = await res.json();
      setMessages(data);
      
      // When user is selected, mark their messages as read
      markAsRead(phone);
    } catch (err) {
      console.error("Error loading messages:", err);
    } finally {
      setLoading(false);
    }
  };

  // Mark user's messages as read
  const markAsRead = (phone) => {
    if (unreadCounts[phone] && unreadCounts[phone] > 0) {
      setUnreadCounts(prev => ({
        ...prev,
        [phone]: 0
      }));
      
      // Remove from highlighted users set
      setHighlightedUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(phone);
        return newSet;
      });
    }
  };

  // Increment unread count for a user
  const incrementUnread = (phone) => {
    // Don't increment if this is the currently selected chat
    if (selectedPhone === phone) return;
    
    setUnreadCounts(prev => ({
      ...prev,
      [phone]: (prev[phone] || 0) + 1
    }));
    
    // Add to highlighted users set
    setHighlightedUsers(prev => new Set(prev).add(phone));
  };

  // =========================
  // WEBSOCKET EVENTS (LIVE UPDATES)
  // =========================
  useEffect(() => {
    socket.on('connect', () => {
      console.log('🟢 WebSocket connected');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('🔴 WebSocket disconnected');
      setConnected(false);
    });

    socket.on('new_user', (data) => {
      console.log('🆕 New user joined:', data);
      setUsers(prev => {
        if (prev.find(u => u.phone === data.phone)) return prev;
        return [data, ...prev];
      });
      // Initialize unread count for new user
      setUnreadCounts(prev => ({
        ...prev,
        [data.phone]: 1 // New user's first message is unread
      }));
      setHighlightedUsers(prev => new Set(prev).add(data.phone));
    });

    socket.on('user_update', (data) => {
      console.log('📝 User update:', data);
      setUsers(prev => prev.map(user => 
        user.phone === data.phone ? { ...user, ...data } : user
      ));
      if (selectedPhone === data.phone) {
        setSelectedUser(prev => ({ ...prev, ...data }));
      }
    });

    socket.on('new_message', (data) => {
      console.log('💬 New message:', data);
      
      // If this is a user message (incoming), increment unread count
      if (data.direction === 'user') {
        incrementUnread(data.phone);
      }
      
      // Update sidebar user list with last message
      setUsers(prev => prev.map(user => 
        user.phone === data.phone ? { 
          ...user, 
          last: data.message.substring(0, 50),
          total_messages: (user.total_messages || 0) + 1,
          last_seen: data.timestamp
        } : user
      ));
      
      // Add message to chat if this user is selected
      if (selectedPhone === data.phone) {
        if (data.direction === 'bot') {
          setTyping(true);
          setTimeout(() => setTyping(false), 1000);
        }
        
        setMessages(prev => [...prev, {
          message: data.message,
          direction: data.direction,
          status: data.status,
          timestamp: data.timestamp,
          message_type: data.message_type,
          file_name: data.file_name
        }]);
        
        // If message is from user and we're in this chat, mark as read
        if (data.direction === 'user') {
          markAsRead(data.phone);
        }
      }
    });

    socket.on('status_update', (data) => {
      console.log('✅ Status update:', data);
      if (selectedPhone === data.phone) {
        setMessages(prev => prev.map(msg => 
          msg.whatsapp_message_id === data.whatsapp_message_id 
            ? { ...msg, status: data.status }
            : msg
        ));
      }
    });

    socket.on('mode_changed', (data) => {
      console.log('🔄 Mode changed:', data);
      setUsers(prev => prev.map(user => 
        user.phone === data.phone ? { ...user, human_mode: data.human_mode } : user
      ));
      if (selectedPhone === data.phone) {
        setSelectedUser(prev => ({ ...prev, human_mode: data.human_mode }));
      }
    });

    socket.on('user_updated', (data) => {
      console.log('✏️ User updated:', data);
      setUsers(prev => prev.map(user => 
        user.phone === data.phone ? { ...user, tags: data.tags, notes: data.notes } : user
      ));
      if (selectedPhone === data.phone) {
        setSelectedUser(prev => ({ ...prev, tags: data.tags, notes: data.notes }));
      }
    });

    loadInitialData();

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('new_user');
      socket.off('user_update');
      socket.off('new_message');
      socket.off('status_update');
      socket.off('mode_changed');
      socket.off('user_updated');
    };
  }, [selectedPhone]);

  // Auto scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

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

  // Select user - mark as read when clicked
  const selectUser = (user) => {
    setSelectedPhone(user.phone);
    setSelectedUser(user);
    setSearchQuery("");
    loadMessages(user.phone);
    markAsRead(user.phone);
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
      
      if (!res.ok) {
        alert("Failed to send message");
        setMessages(prev => prev.filter(msg => msg !== tempMsg));
      }
    } catch (err) {
      console.error("Send error:", err);
      alert("Error sending message");
      setMessages(prev => prev.filter(msg => msg !== tempMsg));
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
      message: `Sending ${selectedFile.name}...`,
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
      
      if (!res.ok) {
        const error = await res.json();
        alert(error.error || "Failed to send file");
        setMessages(prev => prev.filter(msg => msg !== tempMsg));
      }
    } catch (err) {
      console.error("Send file error:", err);
      alert("Error sending file");
      setMessages(prev => prev.filter(msg => msg !== tempMsg));
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
      `Send to ${users.length} user(s)?\n\n"${broadcastMessage}"`
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
        failCount++;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    setBroadcasting(false);
    setShowBroadcast(false);
    setBroadcastMessage("");
    
    alert(`Broadcast complete!\n✅ Sent: ${successCount}\n❌ Failed: ${failCount}`);
  };

  // Toggle mode
  const toggleMode = async () => {
    if (!selectedPhone) return;
    
    try {
      const res = await fetch(`${API}/toggle/${selectedPhone}`, { method: "POST" });
      const data = await res.json();
      if (data.human_mode !== undefined) {
        setSelectedUser(prev => ({ ...prev, human_mode: data.human_mode }));
        setUsers(prev => prev.map(user => 
          user.phone === selectedPhone ? { ...user, human_mode: data.human_mode } : user
        ));
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

  // Refresh stats
  const refreshStats = async () => {
    try {
      const res = await fetch(`${API}/analytics`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error("Error refreshing stats:", err);
    }
  };

  useEffect(() => {
    refreshStats();
    const interval = setInterval(refreshStats, 30000);
    return () => clearInterval(interval);
  }, []);

  // Get status icon
  const getStatusIcon = (status) => {
    switch(status) {
      case 'sent': return '✓';
      case 'delivered': return '✓✓';
      case 'read': return '✓✓✓';
      case 'sending': return '⋯';
      case 'failed': return '⚠️';
      default: return '';
    }
  };

  // Get status color
  const getStatusColor = (status) => {
    switch(status) {
      case 'read': return '#4caf50';
      case 'delivered': return '#2196f3';
      case 'sent': return '#666';
      default: return '#999';
    }
  };

  // Get message type icon
  const getMessageTypeIcon = (type) => {
    switch(type) {
      case 'image': return '🖼️';
      case 'audio': return '🎵';
      case 'document': return '📄';
      case 'video': return '🎬';
      case 'file': return '📎';
      default: return '💬';
    }
  };

  return (
    <div style={styles.app}>
      {/* Connection Status Indicator */}
      <div style={{
        ...styles.liveIndicator,
        background: connected ? '#4caf50' : '#f44336'
      }}>
        <span style={styles.liveDot}></span>
        {connected ? 'Live' : 'Reconnecting...'}
      </div>

      {/* Analytics Bar */}
      <div style={styles.analyticsBar}>
        <div style={styles.statItem}>👥 Users: {stats.total_users || 0}</div>
        <div style={styles.statItem}>💬 Messages: {stats.total_messages || 0}</div>
        <div style={styles.statItem}>🤖 AI: {stats.ai_users || 0}</div>
        <div style={styles.statItem}>👤 Human: {stats.human_users || 0}</div>
        <div style={styles.statItem}>📅 Today: {stats.messages_today || 0}</div>
        <div style={styles.statItem}>⏱️ Response: {stats.avg_response_time || 0} min</div>
        <button style={styles.analyticsBtn} onClick={() => setShowAnalytics(true)}>
          📊 Analytics
        </button>
        <button style={styles.broadcastBtn} onClick={() => setShowBroadcast(true)}>
          📢 Broadcast
        </button>
      </div>

      <div style={styles.container}>
        {/* Sidebar - WITH UNREAD HIGHLIGHTING */}
        <div style={styles.sidebar}>
          <h2 style={styles.title}>WhatsApp Dashboard</h2>
          <div style={styles.userCount}>
            {users.length} Chats • {connected ? 'Live' : 'Connecting...'}
          </div>
          
          <button style={styles.exportAllBtn} onClick={() => exportConversation()}>
            📥 Export All Conversations
          </button>
          
          <div style={styles.userList}>
            {users.length === 0 && (
              <div style={styles.noUsers}>No users yet. Wait for incoming messages...</div>
            )}
            {users.map((user, i) => {
              const isUnread = highlightedUsers.has(user.phone);
              const unreadCount = unreadCounts[user.phone] || 0;
              
              return (
                <div
                  key={i}
                  style={{
                    ...styles.user,
                    background: selectedPhone === user.phone 
                      ? "#e3f2fd" 
                      : isUnread 
                        ? "#fff3e0"  // Orange highlight for unread
                        : "transparent",
                    borderLeft: selectedPhone === user.phone 
                      ? "3px solid #0b5cff" 
                      : isUnread 
                        ? "3px solid #ff9800" 
                        : "3px solid transparent",
                    fontWeight: isUnread ? "bold" : "normal"
                  }}
                  onClick={() => selectUser(user)}
                >
                  <div style={styles.userHeader}>
                    <div style={styles.userPhone}>{user.phone}</div>
                    {unreadCount > 0 && (
                      <div style={styles.unreadBadge}>{unreadCount}</div>
                    )}
                  </div>
                  <div style={styles.userStats}>
                    <span>📨 {user.total_messages || 0}</span>
                    {user.tags && <span style={styles.userTag}>🏷️ {user.tags}</span>}
                  </div>
                  <div style={{
                    ...styles.userLast,
                    color: isUnread ? "#ff9800" : "#999",
                    fontWeight: isUnread ? "500" : "normal"
                  }}>
                    {user.last || "No messages yet"}
                  </div>
                  <div style={styles.userTime}>
                    {user.last_seen && `Last: ${new Date(user.last_seen).toLocaleTimeString()}`}
                  </div>
                  <div style={{
                    ...styles.userMode,
                    color: user.human_mode ? "#ff9800" : "#4caf50"
                  }}>
                    {user.human_mode ? "👤 HUMAN" : "🤖 AI"}
                  </div>
                </div>
              );
            })}
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
                    <span style={styles.messageCount}>📨 {selectedUser.total_messages} messages</span>
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
                
                {messages.length === 0 && !loading && (
                  <div style={styles.noMessages}>No messages yet. Send a message to start the conversation!</div>
                )}
                
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
                        <span style={{ marginLeft: 5, color: getStatusColor(msg.status) }}>
                          {getStatusIcon(msg.status)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                
                {typing && (
                  <div style={{
                    ...styles.bubble,
                    alignSelf: "flex-end",
                    background: "#0b5cff",
                    color: "#fff",
                    opacity: 0.7
                  }}>
                    <div>typing...</div>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>

              <div style={styles.inputArea}>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => setSelectedFile(e.target.files[0])}
                  style={styles.fileInput}
                  accept="image/*,application/pdf,audio/*,.doc,.docx,.txt"
                />
                {selectedFile && (
                  <button style={styles.sendFileBtn} onClick={sendFile} disabled={sending}>
                    📎 Send ({selectedFile.name})
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
                  {sending ? '...' : 'Send'}
                </button>
              </div>
            </>
          ) : (
            <div style={styles.empty}>
              <div>💬</div>
              <div>Select a chat to start messaging</div>
              <div style={styles.emptySub}>New users appear instantly in the sidebar</div>
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

      {/* Analytics Modal */}
      {showAnalytics && (
        <div style={modalStyles.overlay}>
          <div ref={modalRef} style={{...modalStyles.modal, width: "800px", maxHeight: "80vh"}}>
            <div style={modalStyles.header}>
              <h2>📊 Advanced Analytics Dashboard</h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowAnalytics(false)}>×</button>
            </div>
            <div style={{...modalStyles.body, maxHeight: "calc(80vh - 120px)", overflowY: "auto"}}>
              
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
  liveIndicator: {
    position: "fixed",
    bottom: "10px",
    right: "10px",
    color: "#fff",
    padding: "5px 10px",
    borderRadius: "20px",
    fontSize: "11px",
    display: "flex",
    alignItems: "center",
    gap: "5px",
    zIndex: 999,
    boxShadow: "0 2px 5px rgba(0,0,0,0.2)"
  },
  liveDot: {
    width: "8px",
    height: "8px",
    background: "#fff",
    borderRadius: "50%",
    animation: "pulse 1s infinite"
  },
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
  sidebar: { width: "320px", background: "#fff", borderRight: "1px solid #e0e0e0", display: "flex", flexDirection: "column" },
  title: { padding: "20px", margin: 0, fontSize: "18px", color: "#333", borderBottom: "1px solid #e0e0e0" },
  userCount: { padding: "10px 20px", fontSize: "12px", color: "#666", borderBottom: "1px solid #e0e0e0" },
  exportAllBtn: { margin: "10px 20px", padding: "8px", background: "#4caf50", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer" },
  userList: { flex: 1, overflowY: "auto", padding: "10px" },
  noUsers: { textAlign: "center", padding: "40px", color: "#999", fontSize: "13px" },
  user: { padding: "12px", marginBottom: "8px", borderRadius: "10px", cursor: "pointer", transition: "all 0.2s" },
  userHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" },
  userPhone: { fontWeight: "bold", fontSize: "13px", color: "#333" },
  unreadBadge: {
    background: "#ff9800",
    color: "#fff",
    borderRadius: "12px",
    padding: "2px 8px",
    fontSize: "10px",
    fontWeight: "bold",
    minWidth: "20px",
    textAlign: "center"
  },
  userStats: { fontSize: "11px", display: "flex", gap: "10px", marginBottom: "4px", color: "#666" },
  userTag: { background: "#e3f2fd", padding: "2px 6px", borderRadius: "10px", fontSize: "10px" },
  userLast: { fontSize: "11px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: "2px" },
  userTime: { fontSize: "10px", color: "#aaa", marginBottom: "2px" },
  userMode: { fontSize: "10px", marginTop: "4px", fontWeight: "500" },
  chat: { flex: 1, display: "flex", flexDirection: "column", background: "#f0f2f5" },
  header: { padding: "15px 20px", background: "#fff", borderBottom: "1px solid #e0e0e0", display: "flex", justifyContent: "space-between", alignItems: "center" },
  headerInfo: { display: "flex", gap: "10px", alignItems: "center", marginTop: "5px", flexWrap: "wrap" },
  tagBadge: { background: "#e3f2fd", padding: "2px 8px", borderRadius: "12px", fontSize: "11px", color: "#0b5cff" },
  messageCount: { fontSize: "11px", color: "#666" },
  headerButtons: { display: "flex", gap: "10px" },
  toggleBtn: { padding: "8px 16px", background: "#0b5cff", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer" },
  editBtn: { padding: "8px 16px", background: "#ff9800", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer" },
  exportBtn: { padding: "8px 16px", background: "#4caf50", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer" },
  searchBar: { padding: "10px 20px", background: "#fff", borderBottom: "1px solid #e0e0e0", position: "relative" },
  searchInput: { width: "100%", padding: "8px 12px", borderRadius: "20px", border: "1px solid #ddd", outline: "none" },
  clearSearch: { position: "absolute", right: "30px", top: "18px", background: "none", border: "none", cursor: "pointer", color: "#999" },
  messagesArea: { flex: 1, padding: "20px", display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", backgroundColor: "#efeae2" },
  loading: { textAlign: "center", color: "#666", padding: "20px" },
  noMessages: { textAlign: "center", color: "#999", padding: "40px" },
  bubble: { padding: "8px 12px", borderRadius: "12px", maxWidth: "60%", fontSize: "14px", wordWrap: "break-word", boxShadow: "0 1px 1px rgba(0,0,0,0.1)" },
  bubbleHeader: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  bubbleText: { wordBreak: "break-word" },
  fileName: { fontSize: "11px", opacity: 0.8, fontStyle: "italic" },
  time: { fontSize: "10px", marginTop: "4px", opacity: 0.7, textAlign: "right" },
  inputArea: { display: "flex", padding: "15px 20px", background: "#fff", borderTop: "1px solid #ddd", gap: "10px", alignItems: "center", flexWrap: "wrap" },
  fileInput: { padding: "5px", border: "1px solid #ddd", borderRadius: "5px", fontSize: "12px" },
  sendFileBtn: { padding: "10px 15px", background: "#9c27b0", color: "#fff", border: "none", borderRadius: "20px", cursor: "pointer", fontSize: "12px" },
  input: { flex: 1, padding: "10px 15px", borderRadius: "20px", border: "1px solid #ddd", outline: "none", minWidth: "150px" },
  sendBtn: { padding: "10px 20px", background: "#0b5cff", color: "#fff", border: "none", borderRadius: "20px", cursor: "pointer" },
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", color: "#888" },
  emptySub: { fontSize: "12px", color: "#aaa", marginTop: "5px" }
};

// Add animation
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
`;
document.head.appendChild(styleSheet);

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
  questionCount: { fontSize: "11px", color: "#0b5cff" }
};