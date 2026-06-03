import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Gemini Setup
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  const SYSTEM_PROMPT = `
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
  `;

  // API Routes
  app.post("/api/chat", async (req, res) => {
    const { prompt, history, imagePart } = req.body;
    
    const contents = history.map((h: any) => ({
      role: h.role === 'model' ? 'model' : 'user',
      parts: h.parts.map((p: any) => {
        if (p.text) return { text: p.text };
        if (p.inlineData) return { inlineData: p.inlineData };
        return p;
      })
    }));

    // Append user prompt and optional image part
    const userParts: any[] = [{ text: prompt }];
    if (imagePart) {
      userParts.push({ inlineData: imagePart.inlineData });
    }

    contents.push({
      role: "user",
      parts: userParts
    });

    // We try gemini-3.5-flash first. If a quota/rate-limit occurs, we try gemini-3.1-flash-lite.
    const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`Attempting generation with model: ${modelName}`);
        const result = await ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            systemInstruction: SYSTEM_PROMPT
          }
        });

        return res.json({ text: result.text || "" });
      } catch (error: any) {
        lastError = error;
        console.warn(`Error using model ${modelName}:`, error.message || error);

        // Check if the error is a quota/rate limit error
        const errorMsg = String(error.message || "").toLowerCase() + " " + JSON.stringify(error).toLowerCase();
        const isQuota = errorMsg.includes("quota") || errorMsg.includes("429") || errorMsg.includes("resource_exhausted") || errorMsg.includes("exceeded") || error.status === "RESOURCE_EXHAUSTED";

        if (isQuota) {
          console.log(`Quota exceeded for ${modelName}, will try next fallback if available.`);
          continue; // Try next model (e.g. gemini-3.1-flash-lite)
        } else {
          // Break immediately for other types of errors (e.g., Auth, Invalid arguments)
          break;
        }
      }
    }

    // If we get here, both models failed or non-quota error occurred.
    const lastErrorMsg = String(lastError?.message || "");
    const lastErrorStr = lastErrorMsg.toLowerCase() + " " + JSON.stringify(lastError).toLowerCase();
    const isQuota = lastErrorStr.includes("quota") || lastErrorStr.includes("429") || lastErrorStr.includes("resource_exhausted") || lastErrorStr.includes("exceeded") || lastError?.status === "RESOURCE_EXHAUSTED";

    if (isQuota) {
      const friendlyKurdish = "⚠️ ڕێژەی بەکارهێنانی خۆڕایی Gemini تەواو بووە. تکایە کەمێکی تر هەوڵ بدەرەوە یان کلیلێکی تایبەتی خۆت دابنێ لە ڕێکخستنەکان.";
      const friendlyEnglish = "⚠️ Gemini free tier quota exceeded. Please wait a few moments and try again, or configure your own API key in Settings > Secrets.";
      return res.status(429).json({ 
        error: `${friendlyKurdish}\n\n${friendlyEnglish}`
      });
    }

    res.status(500).json({ 
      error: lastError?.message || "Failed to generate content" 
    });
  });

  app.post("/api/generate-image", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      console.log("Generating image with prompt:", prompt);
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: prompt,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
          },
        },
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return res.json({ imageUrl: `data:image/png;base64,${part.inlineData.data}` });
        }
      }
      throw new Error("No image data returned from model");
    } catch (error: any) {
      console.error("Image generation error on server:", error);
      res.status(500).json({ error: error.message || "Failed to generate image" });
    }
  });

  app.post("/api/generate-video", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      console.log("Starting video generation with prompt:", prompt);
      const operation = await ai.models.generateVideos({
        model: 'veo-3.1-lite-generate-preview',
        prompt: prompt,
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      res.json({ operationName: operation.name });
    } catch (error: any) {
      console.error("Video generation start error on server:", error);
      res.status(500).json({ error: error.message || "Failed to start video generation" });
    }
  });

  app.post("/api/video-status", async (req, res) => {
    try {
      const { operationName } = req.body;
      if (!operationName) {
        return res.status(400).json({ error: "Operation name is required" });
      }

      const op = new GenerateVideosOperation();
      op.name = operationName;
      const updated = await ai.operations.getVideosOperation({ operation: op });
      res.json({ done: updated.done });
    } catch (error: any) {
      console.error("Video status error on server:", error);
      res.status(500).json({ error: error.message || "Failed to check video status" });
    }
  });

  app.post("/api/video-download", async (req, res) => {
    try {
      const { operationName } = req.body;
      if (!operationName) {
        return res.status(400).json({ error: "Operation name is required" });
      }

      const op = new GenerateVideosOperation();
      op.name = operationName;
      const updated = await ai.operations.getVideosOperation({ operation: op });
      const uri = updated.response?.generatedVideos?.[0]?.video?.uri;
      if (!uri) {
        return res.status(400).json({ error: "No video URI returned from operation" });
      }

      const fetchKey = process.env.GEMINI_API_KEY || "";
      const videoRes = await fetch(uri, {
        headers: { 'x-goog-api-key': fetchKey },
      });

      if (!videoRes.ok) {
        throw new Error(`Failed to fetch video from source: ${videoRes.statusText}`);
      }

      const arrayBuffer = await videoRes.arrayBuffer();
      const base64Video = Buffer.from(arrayBuffer).toString("base64");
      res.json({ base64: `data:video/mp4;base64,${base64Video}` });
    } catch (error: any) {
      console.error("Video download error on server:", error);
      res.status(500).json({ error: error.message || "Failed to fetch video content" });
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
