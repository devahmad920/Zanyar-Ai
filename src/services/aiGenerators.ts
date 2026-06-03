export async function generateImage(prompt: string) {
  try {
    const response = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Failed to generate image");
    }

    const data = await response.json();
    return data.imageUrl;
  } catch (error) {
    console.error("Image generation error:", error);
    throw error;
  }
}

export async function generateVideo(prompt: string, onStatus?: (status: string) => void) {
  try {
    if (onStatus) onStatus("Starting video generation...");
    
    // 1. Start generation
    const response = await fetch("/api/generate-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Failed to start video generation");
    }

    const { operationName } = await response.json();

    // 2. Poll for completion
    let done = false;
    while (!done) {
      if (onStatus) onStatus("Generating video (this may take a few moments)...");
      await new Promise(resolve => setTimeout(resolve, 5000));

      const statusRes = await fetch("/api/video-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationName })
      });

      if (!statusRes.ok) {
        throw new Error("Failed to check video status");
      }

      const statusData = await statusRes.json();
      done = statusData.done;
    }

    // 3. Download / Get video
    if (onStatus) onStatus("Fetching video data...");
    const downloadRes = await fetch("/api/video-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationName })
    });

    if (!downloadRes.ok) {
      const err = await downloadRes.json();
      throw new Error(err.error || "Failed to download video");
    }

    const { base64 } = await downloadRes.json();
    return base64;
  } catch (error) {
    console.error("Video generation error:", error);
    throw error;
  }
}
