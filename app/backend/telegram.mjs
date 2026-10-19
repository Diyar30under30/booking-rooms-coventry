// Credentials stay on the server; a private recipient requires a numeric chat ID.
export function createBookingNotifier(options = {}) {
  const token = options.token ?? process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId ?? process.env.TELEGRAM_CHAT_ID;
  const send = options.fetch ?? fetch;
  if (!token && !chatId) return async () => 'disabled';
  if (!token || !/^-?\d+$/.test(String(chatId || ''))) throw new Error('Set both TELEGRAM_BOT_TOKEN and a numeric TELEGRAM_CHAT_ID.');
  return async ({ booking, space, user }) => {
    const text = [
      `New classroom booking #${booking.id}`,
      `Person: ${user.name}`,
      `Room: ${space.name}`,
      `Location: ${space.building}, ${space.floor}`,
      `Date: ${booking.date}`,
      `Time: ${booking.start}–${booking.end} (campus time)`,
      `Attendees: ${booking.attendees}`,
      `Reason: ${booking.title}`,
    ].join('\n');
    try {
      const response = await send(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(chatId), text }),
        signal: AbortSignal.timeout(5000),
      });
      const result = await response.json();
      return response.ok && result.ok === true ? 'sent' : 'failed';
    } catch {
      // Do not log the request URL or exception: it can contain the bot token.
      return 'failed';
    }
  };
}
