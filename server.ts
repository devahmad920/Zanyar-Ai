import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Gemini Setup
  const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY || "");
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash",
    systemInstruction: `
      You are Zanyar AI, a dedicated study assistant for Kurdish (Sorani) speaking students.
      Your primary language of communication is Kurdish (Sorani) using the Arabic script.
      Your goal is to help students learn better by:
      1. Answering questions clearly and accurately in Sorani.
      2. Explaining complex concepts step-by-step.
      3. Generating study materials like quizzes and flashcards.
      4. Summarizing text provided by the user.

      When asked to generate a quiz, provide it in a structured format:
      [QUIZ]
      Question: ...
      Options: a) ..., b) ..., c) ..., d) ...
      Answer: [letter]
      Explanation: ...
      [/QUIZ]

      Always be encouraging and helpful. Use right-to-left friendly formatting.
      If the user asks in English or another language, reply in that language but keep the focus on aiding their study.
    `
  });

  // API Routes
  app.post("/api/chat", async (req, res) => {
    try {
      const { prompt, history, imagePart } = req.body;
      
      const chat = model.startChat({
        history: history.map((h: any) => ({
          role: h.role === 'model' ? 'model' : 'user',
          parts: h.parts
        }))
      });

      const parts: any[] = [prompt];
      if (imagePart) {
        parts.push(imagePart);
      }

      const result = await chat.sendMessage(parts);
      const response = await result.response;
      res.json({ text: response.text() });
    } catch (error: any) {
      console.error("Gemini Server Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate content" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
