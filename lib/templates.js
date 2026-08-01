// Company-mandated copy, ported verbatim from the validated prototype.
// Do not rewrite wording without company sign-off.

// Trial was dropped 2026-07-13 — it's post-hire, tracked outside this app
export const STAGES = ["New", "Approved", "Rejected", "Contacted", "Replied", "Interview", "Signed"];
export const ONBOARD_STAGES = ["Approved", "Contacted", "Replied", "Interview", "Signed"];

export const LINKS = {
  tracker: "https://app.notion.com/p/2925161d763180c3862ae005fb17ea29",
  interviewChecklist: "https://app.notion.com/p/4175f58f81b2471694a2d39a9f3424ca",
  onboardingChecklist: "https://app.notion.com/p/36dabb162ac743a48a91b01238cce781",
  messageBank: "https://app.notion.com/p/7b1fb06a83694d6ea7448441623c2528",
  guide: "https://app.notion.com/p/39091abebbe380e98c59fa9e70d47f04",
  interviewSlides: "https://docs.google.com/presentation/d/17neVrOWGz-ok1q7k3FelSZw806ivJ5FiKmDuYa5jkdU/edit?usp=sharing",
  contractTemplate: "https://docs.google.com/document/d/1R2Opn-vuYjWXPAyFE2Lhp3qq-3xxCrcVFv52nE7cLes/edit?tab=t.0",
  onboardingPresentation: "https://docs.google.com/presentation/d/1elcO_7Ikaey5FgUtaX9ntPagD3dhG6eA5sYro-AwVU8/edit?usp=sharing",
  emailPresentation: "https://docs.google.com/presentation/d/1WLZwnesKQanLQGvDGQlqBmmOMVXVwpFqWSBGRwa97so/edit?usp=sharing",
  demoGuide: "https://docs.google.com/presentation/d/1RLV-eMQaANVUF6oRKgOOmA4HU6s9_kTPOxJi90-OFaI/edit?slide=id.g39144a30ea7_0_1937",
  papersFolder: "https://drive.google.com/drive/folders/1nLXGWWFZllQPWdn_XItEhzVGNjjtH1pE?usp=share_link",
  bankForm: "https://docs.google.com/forms/d/e/1FAIpQLSf07vGIguiBDUcIgMDR2f9BmGnAvljpx_Nx3uFbgF7BtXoF1A/viewform?usp=preview",
  celebrationsChat: "https://ig.me/j/AbYjOhIhd9ZzaNCs/",
  announcementsChat: "https://ig.me/j/AbZPbGNJJl1VmSTB/",
};

export function firstNameOf(name) {
  if (!name) return null;
  const clean = name.split("(")[0].trim();
  const first = clean.split(/\s+/)[0];
  return first && first.length > 1 && !first.includes("@") ? first : null;
}

// Lucas's approved copy (2026-07-11), now the DEFAULT template — every
// account can save their own personal version in the app ({first} is
// replaced with the creator's first name). Blank lines between paragraphs
// are part of the format and must survive copy/paste.
export const DEFAULT_DM = `Hey {first}! I'm Lucas (also Known as The Exam Planner on Tik Tok) and I'm running Growth for Anara atm. Our website helps university students, grad students and researchers find, understand and write papers faster.

We have a UGC program where creators post videos on new accounts solely about Anara, like @kcpagess (example video: https://vm.tiktok.com/ZNR3cDs5M/). Creators earn from $25 for every video they make and post, and bonuses (up to $2,000) when videos go viral :)

We normally work on 10–20 short pieces of content/week (flexible), making it $1–2k fixed per month + bonuses! I came across your account and really loved your content.

Let me know if you'd be interested and I can send more details or we can have a quick call to discuss further (:

If you want to go ahead and book a call straight away!! here is my link: https://calendar.app.google/C8xGYr7yn4jRAvec9`;

export function renderDm(template, first) {
  return (template || DEFAULT_DM).replaceAll("{first}", first || "there");
}

// A short, sensible default follow-up bump (editable per account).
export const DEFAULT_FOLLOWUP = `Hey {first}! Just circling back on my last message — totally get it if you've been busy! The paid UGC spot with Anara is still open if you'd like to hear more or hop on a quick call :)`;

// Opens Gmail's web compose directly (Lucas's preference over the OS mail
// app) with recipient, subject, and the sender's own message as the body.
export function mailtoLink(email, body, subject = "Paid UGC opportunity with Anara") {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ── Partner (community-owner) outreach ──
// Tokens: {name} owner first name, {community} community name, {link} the
// community's personalised application link.
export const PARTNER_SUBJECT = "paid UGC work for your community's creators";

export const DEFAULT_PARTNER_EMAIL = `Hi {name}!

I'm Lucas, I lead creator hiring at Anara (anara.com), an AI workspace used by students and researchers all over the world. You might also know me as The Exam Planner on TikTok.

We're hiring UGC creators right now and paying a base rate of $1,000 to $2,000 per month for ongoing content, with bonuses on top when videos take off. We've already onboarded a bunch of creators this month and we're scaling fast.

I came across {community} and thought your members would be a great fit. I know landing real paid work is the hardest part for most creators, so hopefully this is a proper win for your community. If you're up for sharing it, here's an application link made just for your members, it takes about 30 seconds:

{link}

Applications through your link get priority review from me personally. Happy to jump on a quick call if you want to know more before passing it on.

Lucas`;

export const DEFAULT_PARTNER_DM = `hey {name}! I'm Lucas, I run creator hiring at Anara (anara.com, AI study tool). we're paying UGC creators a $1-2k/month base rate for ongoing content and I think your members would be a perfect fit. landing paid work is the hardest bit for most creators so figured this could be a proper win for your community. made an application link just for your people if you're up for sharing: {link} - happy to hop on a call first if you want the details!`;

// What the OWNER pastes to their community once they agree.
export const DEFAULT_PARTNER_BLURB = `Paid opportunity for creators here! Anara (anara.com, an AI workspace for students and researchers) is hiring UGC creators right now. Base rate of $1,000 to $2,000 per month for ongoing content, plus bonuses when videos take off. No follower minimum, they care about your content. Apply here (takes 30 seconds): {link}`;

export function renderPartner(template, { name, community, link } = {}) {
  return String(template || "")
    .replaceAll("{name}", name || "there")
    .replaceAll("{community}", community || "your community")
    .replaceAll("{link}", link || "");
}

// IG group-chat welcome, editable per account ({first} token).
export const DEFAULT_IG_WELCOME = `Hey {first}, welcome to the team!! \u{1F90D} I just sent you an email with the contract and some more details — please give it a read along with the presentation :)

Your trial week is 7 days, starting tomorrow. You'll need to create accounts on Instagram, TikTok, and YouTube and "warm them up" by scrolling and engaging with study or research content for about 10 minutes a day on each platform for 2–3 days before you start posting.

@TAG THE TEAM LEAD will be reviewing your drafts and supporting you with everything!! It's really important that you send and post videos during these 7 days — your continuation in the program will be based on the quality of your drafts and your communication with us :)

Excited to work with you!`;

export function igWelcome(first) {
  return renderDm(DEFAULT_IG_WELCOME, first);
}

// Welcome email is RICH (HTML) so its links + bullets survive a paste into
// Gmail. Editable per account ({first} token); no Subject/CC line — the
// sender adds those in Gmail manually.
export const DEFAULT_WELCOME_EMAIL = `<p>Hi {first}!</p>
<p>Thanks so much for taking the time to chat! Excited to have you join the team and get started with the trial period from tomorrow. Here's the <a href="${LINKS.onboardingPresentation}">Presentation</a> I shared with you, feel free to review it as you get started. [TEAM LEAD] will be your content reviewer :)</p>
<p><b>Some other things:</b></p>
<ul>
<li>Review this <a href="${LINKS.emailPresentation}">presentation</a> thoroughly to learn what you need to do during your trial and how we work.</li>
<li>I've set you up with Premium access to the platform. If you log in to <a href="https://anara.com">anara.com</a> with your email you'll get sent a code (this may take a day or so to process).</li>
<li>Here's a <a href="${LINKS.demoGuide}">product demo guide</a>, you can go over this after your trial to learn how to show the product on your future videos.</li>
<li>Please join the chats using this link: [UNIQUE IG CHAT JOIN LINK]</li>
<li>After your trial you'll start attending the weekly group meeting on Tuesday, but you don't need to do it during your trial week.</li>
<li>You can find papers to download and add to your Anara library <a href="${LINKS.papersFolder}">here</a>, or feel free to use your own as well.</li>
<li>Lastly, please fill out <a href="${LINKS.bankForm}">this form</a> with your Wise/bank info when you get a chance.</li>
<li>I have also attached your contract below for you to sign and send back to me!</li>
</ul>
<p>Looking forward to seeing your work!</p>
<p>Best</p>`;

export function welcomeEmail(first) {
  return renderDm(DEFAULT_WELCOME_EMAIL, first);
}

// Rich entries are edited/copied as HTML; everything else is plain text.
export const isRichMessage = (name) => name.startsWith("Welcome email");

// Strip theme styling so a pasted email uses the recipient's default colours
// (no dark backgrounds carried over from the app's editor). Keeps structural
// tags: links, bold/italic, lists, paragraphs, breaks, headings.
export function cleanEmailHtml(html) {
  return String(html || "")
    .replace(/<div[^>]*>/gi, "<p>").replace(/<\/div>/gi, "</p>")
    .replace(/<\/?(span|font|o:p)[^>]*>/gi, "")
    .replace(/\s(style|class|bgcolor|color|face|id|dir|align|lang)=("[^"]*"|'[^']*')/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

// Plain-text fallback of an HTML snippet (for non-rich paste targets).
export function htmlToText(html) {
  return String(html || "")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The fixed message bank every account starts with — each entry is editable,
// grouped into Outreach and Onboarding on the Messages tab. Entries whose
// name ends in "link" are single URLs (not {first} templates).
export const DEFAULT_MESSAGES = {
  "Outreach DM": DEFAULT_DM,
  "Follow-up bump": DEFAULT_FOLLOWUP,
  "Welcome email (postgrad)": DEFAULT_WELCOME_EMAIL,
  "Welcome message": DEFAULT_IG_WELCOME,
  "Contract template link": LINKS.contractTemplate,
  "Trial videos link (postgrad)": "",
  "Welcome email (undergrad)": DEFAULT_WELCOME_EMAIL,
  "Trial videos link (undergrad)": "",
  "Partner email": DEFAULT_PARTNER_EMAIL,
  "Partner DM": DEFAULT_PARTNER_DM,
  "Partner post blurb": DEFAULT_PARTNER_BLURB,
};
export const MESSAGE_GROUPS = [
  { label: "Outreach", names: ["Outreach DM", "Follow-up bump"] },
  { label: "Onboarding", names: ["Welcome email (postgrad)", "Trial videos link (postgrad)", "Welcome email (undergrad)", "Trial videos link (undergrad)", "Welcome message", "Contract template link"] },
  { label: "Partners", names: ["Partner email", "Partner DM", "Partner post blurb"] },
];
export const DEFAULT_MESSAGE_NAMES = Object.keys(DEFAULT_MESSAGES);
export const isLinkMessage = (name) => name.toLowerCase().endsWith("link");

// Display-only stage rename: "Signed" reads as "Onboarded" in the UI, while
// the Notion status value and Stage Log history stay "Signed".
export const stageLabel = (s) => (s === "Signed" ? "Onboarded" : s);

// Partner track re-reads the SAME status values as its own journey:
// Approved = Found (not yet pitched) → Contacted → Replied → Interview =
// Agreed (they'll share it) → Signed = Posted (link live in the community).
// Notion values + Stage Log stay untouched — display only.
const PARTNER_STAGE_LABELS = { Approved: "Found", Interview: "Agreed", Signed: "Posted" };
export const stageLabelT = (s, track) =>
  track === "partner" ? (PARTNER_STAGE_LABELS[s] || s) : stageLabel(s);

// A community's ?c= slug is derived from its name, deterministically.
export const communitySlug = (name) =>
  String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
export const APPLY_BASE = "https://anara-casting-desk.vercel.app/apply";
export const partnerLink = (name) => `${APPLY_BASE}?c=${communitySlug(name)}`;

export const INTERVIEW_INTRO = `1. Introduce yourself: "Hey XX, thanks for making it to the call! I'm XX, I've been working for Anara for XX — I'm based in XX…"
2. Ask about them: Where are they based? Working or studying? First time doing UGC?
3. Non-compete check: "Before we jump into the slides, we do have a non-competitor clause in the contract — do you currently work for any AI tool targeted to students?"
4. "I'll be sharing my screen now — I've prepared some slides about how we work at Anara. Feel free to interrupt me at any time!"`;

export const INTERVIEW_CLOSE = `"Thank you so much for your time — it was great to meet you! Is this something you'd like to get involved in? We'd love to have you on the team!"
Next steps: "I'll send you an email with all this info, the onboarding steps, product demo guidelines, the contract, and links to join our Instagram chats. Could you drop your full name in the chat now so I have it for the contract?"`;
