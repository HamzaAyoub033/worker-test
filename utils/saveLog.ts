const LOG_API_ENDPOINT = process.env.LOG_API_ENDPOINT;

export async function saveLog(message: string, model_id: string) {
  if (!LOG_API_ENDPOINT) {
    throw new Error("LOG_API_ENDPOINT is not defined");
  }
  try {
    const response = await fetch(LOG_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, model_id }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log("Log saved:", result);
  } catch (error) {
    console.error("Error saving log:", error);
  }
}
