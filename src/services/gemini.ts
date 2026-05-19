import { GoogleGenAI } from "@google/genai";

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

export async function askZanyar(
  prompt: string, 
  history: { role: string; parts: { text: string }[] }[] = [],
  imagePart?: { inlineData: { data: string; mimeType: string } }
) {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, history, imagePart })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Failed to call Gemini API");
    }

    const data = await response.json();
    return data.text || "";
  } catch (error) {
    console.error("Gemini Service Error:", error);
    throw error;
  }
}

export async function generateQuiz(topic: string) {
  const prompt = `Generate a 5-question multi-choice quiz about "${topic}" in Kurdish (Sorani). Follow the [QUIZ] format exactly for each question.`;
  return askZanyar(prompt);
}

export async function generateFlashcards(topic: string) {
  const prompt = `Generate 5 flashcards for "${topic}" in Kurdish (Sorani). 
  Format:
  Front: [Question/Term]
  Back: [Answer/Definition]
  ---
  `;
  return askZanyar(prompt);
}
