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
