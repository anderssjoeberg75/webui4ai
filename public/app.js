document.addEventListener("DOMContentLoaded", () => {

    const chatEl = document.getElementById("chat");
    const chatListEl = document.getElementById("chatList");
    const newChatBtn = document.getElementById("newChatBtn");
    const form = document.getElementById("chatForm");
    const input = document.getElementById("messageInput");
    const fileInput = document.getElementById("fileInput");
    const modelSelect = document.getElementById("modelSelect");

    const STORAGE_KEY = "ollama_conversations";

    let conversations = [];
    let activeChat = null;

    /* ================= STORAGE ================= */

    function save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    }

    function load() {
        conversations = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
        if (!conversations.length) createChat();
        renderSidebar();
        openChat(conversations[0].id);
    }

    /* ================= CHAT MGMT ================= */

    function createChat() {
        const chat = {
            id: crypto.randomUUID(),
            title: "New Chat",
            messages: []
        };
        conversations.unshift(chat);
        save();
        renderSidebar();
        openChat(chat.id);
    }

    function openChat(id) {
        activeChat = conversations.find(c => c.id === id);
        document.querySelectorAll(".chat-item").forEach(e => e.classList.remove("active"));
        document.querySelector(`[data-id="${id}"]`)?.classList.add("active");
        renderMessages();
    }

    function renderSidebar() {
        chatListEl.innerHTML = "";
        conversations.forEach(c => {
            const div = document.createElement("div");
            div.className = "chat-item";
            div.dataset.id = c.id;
            div.textContent = c.title;
            div.onclick = () => openChat(c.id);
            chatListEl.appendChild(div);
        });
    }

    /* ================= RENDER ================= */

    function renderMessages() {
        chatEl.innerHTML = "";
        let lastRole = null;
        let group;

        activeChat.messages.forEach(m => {
            if (m.role !== lastRole) {
                group = document.createElement("div");
                group.className = "message-group";
                chatEl.appendChild(group);
                lastRole = m.role;
            }

            const msg = document.createElement("div");
            msg.className = `message ${m.role}`;
            msg.innerHTML = m.role === "assistant"
                ? marked.parse(m.content)
                : m.content;

            const time = document.createElement("div");
            time.className = "timestamp";
            time.textContent = new Date(m.timestamp).toLocaleTimeString();

            group.appendChild(msg);
            group.appendChild(time);
        });

        chatEl.scrollTop = chatEl.scrollHeight;
    }

    /* ================= CHAT ================= */

    form.onsubmit = async e => {
        e.preventDefault();
        if (!activeChat) return;

        let text = input.value.trim();
        const hasFile = fileInput.files.length > 0;

        if (!text && !hasFile) return;

        /* ---- FILE UPLOAD ---- */
        if (hasFile) {
            const file = fileInput.files[0];
            const content = await file.text();

            activeChat.messages.push({
                role: "system",
                content: `User uploaded file (${file.name}). Treat the following as input data:\n\n${content}`,
                timestamp: Date.now()
            });

            fileInput.value = "";

            // Auto prompt if user wrote nothing
            if (!text) {
                text = "Please analyze the uploaded file.";
            }
        }

        /* ---- USER MESSAGE ---- */
        activeChat.messages.push({
            role: "user",
            content: text,
            timestamp: Date.now()
        });

        input.value = "";
        renderMessages();

        /* ---- ASSISTANT PLACEHOLDER ---- */
        const assistantMsg = {
            role: "assistant",
            content: "",
            timestamp: Date.now()
        };
        activeChat.messages.push(assistantMsg);

        const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: modelSelect.value,
                messages: activeChat.messages
            })
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();

            for (const line of lines) {
                try {
                    const json = JSON.parse(line);
                    if (json.message?.content) {
                        answer += json.message.content;
                        assistantMsg.content = answer;
                        renderMessages();
                    }
                } catch {}
            }
        }

        activeChat.title ||= text.slice(0, 30);
        save();
        renderSidebar();
    };

    /* ================= MODELS ================= */

    fetch("/api/models")
        .then(r => r.json())
        .then(d => {
            d.models.forEach(m => {
                const o = document.createElement("option");
                o.value = m.name;
                o.textContent = m.name;
                modelSelect.appendChild(o);
            });
        });

    newChatBtn.onclick = createChat;
    load();
});
