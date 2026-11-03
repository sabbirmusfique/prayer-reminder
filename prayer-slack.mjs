// Dhaka prayer reminders -> Slack (scheduled messages). Node 18+.

// ====== CONFIG: message ar rule ekhane change koro ======
const CONFIG = {
  dhuhr: {
    weekday: { messageAt: "13:00", text: "Johor at 1:30 PM" }, // Mon-Thu
    friday:  { messageAt: "12:45", text: "Jumma at 1:15 PM" },
  },
  asr: {
    gapAfterStart: 30, // Asar shuru howar koto minute por jamaat
    roundTo: 15,       // jamaat time round up hobe (30 -> :00 ba :30)
    remindBefore: 15,  // jamaat-er koto minute age message
    text: "Asar at {time}",
  },
  maghrib: {
    offset: 0,         // azan-er koto minute por message (0 = azan-er shomoy)
    text: "Magrib after Azan",
  },
};
// =========================================================

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL = process.env.SLACK_CHANNEL_ID;
const DRY_RUN = process.env.DRY_RUN === "true";
if (!SLACK_TOKEN || !CHANNEL) throw new Error("SLACK_BOT_TOKEN and SLACK_CHANNEL_ID are required");

// Today in Dhaka (UTC+6)
const nowSec = Math.floor(Date.now() / 1000);
const dhaka = new Date((nowSec + 6 * 3600) * 1000);
const yyyy = dhaka.getUTCFullYear();
const mm = String(dhaka.getUTCMonth() + 1).padStart(2, "0");
const dd = String(dhaka.getUTCDate()).padStart(2, "0");
const isFriday = dhaka.getUTCDay() === 5;
const midnightSec = Date.parse(`${yyyy}-${mm}-${dd}T00:00:00+06:00`) / 1000;

const toMin = (hhmm) => {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};
const fmt = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

// Prayer times from Aladhan (method=1 Karachi, school=1 Hanafi Asr)
const url = `https://api.aladhan.com/v1/timingsByCity/${dd}-${mm}-${yyyy}?city=Dhaka&country=Bangladesh&method=1&school=1`;
const json = await (await fetch(url)).json();
if (json.code !== 200) throw new Error(`Aladhan API error: ${JSON.stringify(json)}`);
const t = json.data.timings;

const messages = [];

// Johr / Jumma (fixed)
const d = isFriday ? CONFIG.dhuhr.friday : CONFIG.dhuhr.weekday;
messages.push({ name: isFriday ? "Jumma" : "Johr", atMin: toMin(d.messageAt), text: d.text });

// Asar: start + gap -> round up -> remind before
const a = CONFIG.asr;
const asrJamaat = Math.ceil((toMin(t.Asr) + a.gapAfterStart) / a.roundTo) * a.roundTo;
messages.push({
  name: `Asar (starts ${t.Asr.slice(0, 5)})`,
  atMin: asrJamaat - a.remindBefore,
  text: a.text.replace("{time}", fmt(asrJamaat)),
});

// Magrib: at azan time
messages.push({
  name: `Magrib (azan ${t.Maghrib.slice(0, 5)})`,
  atMin: toMin(t.Maghrib) + CONFIG.maghrib.offset,
  text: CONFIG.maghrib.text,
});

for (const msg of messages) {
  const postAt = midnightSec + msg.atMin * 60;
  const label = `${msg.name} -> message at ${fmt(msg.atMin)}: "${msg.text}"`;

  if (postAt <= nowSec + 60) { console.log(`SKIP (time passed) ${label}`); continue; }
  if (DRY_RUN) { console.log(`DRY RUN ${label}`); continue; }

  const out = await (await fetch("https://slack.com/api/chat.scheduleMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${SLACK_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: CHANNEL, text: msg.text, post_at: postAt }),
  })).json();
  if (!out.ok) throw new Error(`Slack error (${msg.name}): ${out.error}`);
  console.log(`SCHEDULED ${label}`);
}
