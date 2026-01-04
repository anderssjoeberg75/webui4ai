/**
 * server.js
 * ----------
 * Ollama Web UI backend
 *
 * Fixes:
 * - Explicit embedding model
 * - Safe embeddings proxy
 */

import express from "express";
import http from "http";

const app = express();

const OLLAMA_BASE = "http://192.168.107.15:11434";
const PORT = 3000;

/**
 * Dedicated embedding model (MUST exist in Ollama)
 */
const EMBEDDING_MODEL = "nomic-embed-text";

const ollamaAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 5
});

app.use(express.json());
app.use(express.static("public"));

/**
 * List models
 */
app.get("/api/models", async (_, res) => {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`, { agent: ollamaAgent });
    res.json(await r.json());
});

/**
 * Embeddings proxy (uses embedding model only)
 */
app.post("/api/embeddings", async (req, res) => {
    try {
        const r = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
            method: "POST",
            agent: ollamaAgent,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: EMBEDDING_MODEL,
                prompt: req.body.prompt
            })
        });

        res.json(await r.json());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Chat proxy (unchanged)
 */
app.post("/api/chat", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        agent: ollamaAgent,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body)
    });

    const reader = r.body.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
    }
    res.end();
});

app.listen(PORT, () => {
    console.log(`Ollama Web UI running on http://localhost:${PORT}`);
});
