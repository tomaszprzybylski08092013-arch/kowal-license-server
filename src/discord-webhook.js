export async function sendDiscordWebhook(webhookUrl, event) {
  if (!webhookUrl) {
    return;
  }

  const lines = [
    `Typ: ${event.type}`,
    `Licencja: ${event.licenseKey}`,
    `Install ID: ${event.installId}`,
    `Wersja moda: ${event.modVersion || "brak"}`,
    `Wygasa: ${event.expiresAt || "lifetime"}`
  ];

  await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      content: `Kowal-Helper license event\n${lines.join("\n")}`
    })
  });
}

