const { GoogleGenAI, Type } = require("@google/genai");
const generateContentWithTimeout = require("../scripts/gemini-request");

const GEMINI_MODEL = "gemini-3.8-flash";
const MAX_IMAGE_BYTES = 1024 * 1024;
const REQUEST_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 10;
const requestCounts = new Map();

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { imageData } = req.body || {};
  const dataUrlMatch = typeof imageData === "string"
    ? imageData.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/)
    : null;
  if (!dataUrlMatch) {
    return res.status(400).json({ error: "Send a JPEG image to caption." });
  }

  const image = Buffer.from(dataUrlMatch[1], "base64");
  if (
    image.length === 0
    || image.length > MAX_IMAGE_BYTES
    || image.toString("base64").replace(/=+$/, "") !== dataUrlMatch[1].replace(/=+$/, "")
    || image[0] !== 0xff
    || image[1] !== 0xd8
    || image[2] !== 0xff
  ) {
    return res.status(400).json({ error: "The image is invalid or exceeds the 1 MB limit." });
  }

  const now = Date.now();
  const forwardedFor = req.headers["x-forwarded-for"];
  const clientIp = typeof forwardedFor === "string" ? forwardedFor.split(",")[0].trim() : "unknown";
  for (const [ip, record] of requestCounts) {
    if (now - record.startedAt >= REQUEST_WINDOW_MS) requestCounts.delete(ip);
  }
  const requestRecord = requestCounts.get(clientIp);
  if (requestRecord && now - requestRecord.startedAt < REQUEST_WINDOW_MS) {
    if (requestRecord.count >= MAX_REQUESTS_PER_WINDOW) {
      return res.status(429).json({ error: "Too many caption requests. Please try again in a minute." });
    }
    requestRecord.count += 1;
  } else {
    requestCounts.set(clientIp, { startedAt: now, count: 1 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "AI captions are not configured. Set GEMINI_API_KEY on the server." });
  }

  try {
    const client = new GoogleGenAI({ apiKey });
    const result = await generateContentWithTimeout(client, {
      model: GEMINI_MODEL,
      contents: [{
        role: "user",
        parts: [
          {
            text: [
              "Write a concise gallery caption in English based only on what is visibly present in this image.",
              "Do not identify people or infer names, ages, private details, exact locations, or events that are not clearly visible.",
              "Return a short title (up to 6 words) and one sentence description (up to 24 words)."
            ].join(" ")
          },
          { inlineData: { mimeType: "image/jpeg", data: dataUrlMatch[1] } }
        ]
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING }
          },
          required: ["title", "description"]
        }
      }
    });

    const caption = JSON.parse(result.text || "");
    if (
      typeof caption.title !== "string"
      || !caption.title.trim()
      || caption.title.length > 80
      || typeof caption.description !== "string"
      || !caption.description.trim()
      || caption.description.length > 300
    ) {
      throw new Error("Gemini returned an invalid gallery caption.");
    }

    return res.status(200).json({
      title: caption.title.trim(),
      description: caption.description.trim()
    });
  } catch (error) {
    console.error("Gallery caption request failed:", error?.message || error);
    if (error.code === "GEMINI_TIMEOUT") {
      return res.status(504).json({ error: "Generating the caption timed out. Please try again." });
    }
    return res.status(502).json({ error: "Could not generate an image caption. Please try again." });
  }
};
