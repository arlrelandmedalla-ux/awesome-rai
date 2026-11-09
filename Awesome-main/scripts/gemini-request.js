const GEMINI_REQUEST_TIMEOUT_MS = 20000;

async function generateContentWithTimeout(client, request, timeoutMs = GEMINI_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      const error = new Error("The AI request timed out.");
      error.code = "GEMINI_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });
  try {
    const requestPromise = client.models.generateContent({
      ...request,
      config: {
        ...request.config,
        abortSignal: controller.signal
      }
    });
    return await Promise.race([requestPromise, timeoutPromise]);
  } catch (error) {
    if (controller.signal.aborted || error?.name === "RequestTimeoutError" || error?.name === "TimeoutError") {
      const timeoutError = new Error("The AI request timed out.");
      timeoutError.code = "GEMINI_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = generateContentWithTimeout;
