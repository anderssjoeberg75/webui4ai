import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs'; // We read the persona file directly on the server

// --- CONFIGURATION ---
const OLLAMA_URL = 'http://ollama.andrix.local:11434'; 
const GOOGLE_API_KEY = process.env.GEMINI_API_KEY; 
// ---------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the Persona and Name directly on the server for security/consistency
let SERVER_PERSONA = "You are a helpful AI.";
let SERVER_NAME = "Nova AI"; // Default fallback

try {
    const personaPath = path.join(__dirname, 'persona.js');
    if (fs.existsSync(personaPath)) {
        const fileContent = fs.readFileSync(personaPath, 'utf8');
        
        // 1. Extract Persona text between backticks ` `
        const personaMatch = fileContent.match(/`([\s\S]*)`/);
        if (personaMatch && personaMatch[1]) {
            SERVER_PERSONA = personaMatch[1].trim();
        }

        // 2. Extract Name from: const ASSISTANT_NAME = "Name";
        const nameMatch = fileContent.match(/const ASSISTANT_NAME = ["'](.*?)["'];/);
        if (nameMatch && nameMatch[1]) {
            SERVER_NAME = nameMatch[1].trim();
        }

        console.log(`Loaded configuration: ${SERVER_NAME}`);
    }
} catch (e) { console.error("Could not read persona.js on server", e); }

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// File handling
app.get('/persona.js', (req, res) => res.sendFile(path.join(__dirname, 'persona.js')));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// New Endpoint: Get basic configuration (Name)
app.get('/api/config', (req, res) => {
    res.json({ name: SERVER_NAME });
});

app.get('/api/models', async (req, res) => {
    let allModels = [];
    // 1. Ollama
    try {
        const ollamaRes = await fetch(`${OLLAMA_URL}/api/tags`);
        if (ollamaRes.ok) {
            const data = await ollamaRes.json();
            if (data.models) allModels = [...data.models];
        }
    } catch (e) { console.error('Ollama is down:', e.message); }

    // 2. Google
    if (GOOGLE_API_KEY) {
        try {
            const googleRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GOOGLE_API_KEY}`);
            if (googleRes.ok) {
                const data = await googleRes.json();
                const googleModels = data.models
                    .filter(m => m.name.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent'))
                    .map(m => ({ name: m.name.replace('models/', ''), details: { family: "google" } }));
                allModels = [...googleModels, ...allModels];
            }
        } catch (e) { console.error('Google is down:', e.message); }
    }
    res.json({ models: allModels });
});

app.post('/api/chat', async (req, res) => {
    const { model, messages } = req.body;

    // --- A. GOOGLE GEMINI (Force Persona) ---
    if (model.includes('gemini')) {
        if (!GOOGLE_API_KEY) return res.status(500).json({ error: "No API Key provided." });

        try {
            const modelName = model.startsWith('models/') ? model : `models/${model}`;
            const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:streamGenerateContent?key=${GOOGLE_API_KEY}`;
            
            // 1. Get system message from client, or use server copy
            const clientSystemMsg = messages.find(m => m.role === 'system');
            const activePersona = clientSystemMsg ? clientSystemMsg.content : SERVER_PERSONA;

            // 2. Filter out system role (Google doesn't like it in the messages list)
            let chatMessages = messages.filter(m => m.role !== 'system');

            // 3. "Nuclear option": Put instruction FIRST in user's last message
            // This forces the model to see it as part of the immediate task.
            if (chatMessages.length > 0) {
                const lastMsg = chatMessages[chatMessages.length - 1];
                if (lastMsg.role === 'user') {
                    lastMsg.content = `[INSTRUCTION: ${activePersona}]\n\nQUERY: ${lastMsg.content}`;
                }
            }

            // 4. Build payload
            const googleContents = chatMessages.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            }));

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: googleContents })
            });

            if (!response.ok) throw new Error(`Google Error ${response.status}: ${await response.text()}`);

            res.setHeader('Content-Type', 'application/json');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const regex = /"text":\s*"((?:[^"\\]|\\.)*)"/g;
                let match;
                while ((match = regex.exec(buffer)) !== null) {
                    let content = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                    res.write(JSON.stringify({ message: { content: content } }) + "\n");
                }
                if (buffer.length > 10000) buffer = buffer.slice(-1000); 
            }
            res.end();
        } catch (e) {
            if (!res.headersSent) res.status(500).json({ error: e.message }); else res.end();
        }
        return;
    }

    // --- B. OLLAMA ---
    try {
        const response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages })
        });
        if (!response.ok) throw new Error("Ollama not responding");
        res.setHeader('Content-Type', 'application/json');
        if (response.body) for await (const chunk of response.body) res.write(chunk);
        res.end();
    } catch (error) {
        if (!res.headersSent) res.status(500).json({ error: 'Ollama Error' }); else res.end();
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`- Persona loaded: ${SERVER_PERSONA ? 'Yes' : 'No'}`);
});