// Google Calendar via OAuth refresh token (single-user app: the token
// belongs to Lucas's Google account and lives in env vars).

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL_BASE = "https://www.googleapis.com/calendar/v3";

export function hasGoogle() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN
  );
}

let cached = { token: null, exp: 0 };

async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google auth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  cached = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

async function gcal(path, opts = {}) {
  const res = await fetch(`${CAL_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function calId() {
  return encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || "primary");
}

function mapEvent(e) {
  const start = e.start?.dateTime || e.start?.date;
  const end = e.end?.dateTime || e.end?.date;
  const durationMins = e.start?.dateTime && e.end?.dateTime
    ? Math.round((new Date(end) - new Date(start)) / 60000)
    : null;
  return {
    id: e.id,
    title: e.summary || "(untitled)",
    start,
    end,
    allDay: !e.start?.dateTime,
    durationMins,
    attendees: (e.attendees || [])
      .filter((a) => !a.self && !a.resource)
      .map((a) => a.displayName || a.email)
      .slice(0, 4),
    meetLink: e.hangoutLink || null,
    calendarLink: e.htmlLink,
    description: String(e.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  };
}

// From two hours ago (so a call that just ended is still notable) through +14 days.
export async function listEvents() {
  const timeMin = new Date(Date.now() - 2 * 3600e3).toISOString();
  const timeMax = new Date(Date.now() + 30 * 86400e3).toISOString();
  const data = await gcal(
    `/calendars/${calId()}/events?singleEvents=true&orderBy=startTime` +
      `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=100`
  );
  return (data.items || []).filter((e) => e.status !== "cancelled").map(mapEvent);
}

export async function createEvent({ title, startISO, durationMins, description }) {
  const start = new Date(startISO);
  const end = new Date(start.getTime() + durationMins * 60000);
  const body = {
    summary: title,
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };
  const created = await gcal(`/calendars/${calId()}/events?conferenceDataVersion=1`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return mapEvent(created);
}
