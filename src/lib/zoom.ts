const ZOOM_ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;

type ZoomMeeting = {
  zoomMeetingId: string;
  zoomJoinUrl: string;
  zoomPassword: string;
};

async function getZoomAccessToken(): Promise<string> {
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error("Credenciales de Zoom no configuradas");
  }

  const basicAuth = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString("base64");

  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Zoom OAuth falló: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token as string;
}

export async function createZoomMeeting(
  topic: string,
  startTime: Date,
  duration: number
): Promise<ZoomMeeting> {
  const accessToken = await getZoomAccessToken();

  const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic,
      start_time: startTime.toISOString(),
      duration,
      type: 2,
      settings: {
        join_before_host: true,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Zoom API falló al crear la reunión: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return {
    zoomMeetingId: String(data.id),
    zoomJoinUrl: data.join_url,
    zoomPassword: data.password ?? "",
  };
}
