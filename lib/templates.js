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
  onboardingPresentation: "https://docs.google.com/presentation/d/11eZMGAK_pElaRxuwbuKA8i-5YBzc88Wj1LVefkRRn9s/edit?slide=id.g36828a3f3e8_0_0",
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

// Opens Gmail's web compose directly (Lucas's preference over the OS mail
// app) with recipient, shared subject, and the sender's own DM as the body.
export function mailtoLink(email, body) {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent("Paid UGC opportunity with Anara")}&body=${encodeURIComponent(body)}`;
}

export function igWelcome(first) {
  const name = first || "CREATOR'S NAME";
  return `Hey ${name}, welcome to the team!! \u{1F90D} I just sent you an email with the contract and some more details — please give it a read along with the presentation :)

Your trial week is 7 days, starting tomorrow. You'll need to create accounts on Instagram, TikTok, and YouTube and "warm them up" by scrolling and engaging with study or research content for about 10 minutes a day on each platform for 2–3 days before you start posting.

@TAG THE TEAM LEAD will be reviewing your drafts and supporting you with everything!! It's really important that you send and post videos during these 7 days — your continuation in the program will be based on the quality of your drafts and your communication with us :)

Excited to work with you!`;
}

export function welcomeEmail(first) {
  const name = first || "XXX";
  return `Subject: ${name}, welcome to the Anara growth team!
CC: alba@anara.com · Attach: contract PDF ("Anara x FULL NAME")

Hi ${name}!

Thanks so much for chatting today — excited to have you join the team! Here's the presentation I shared with you (${LINKS.onboardingPresentation}), feel free to review it as you get started. [TEAM LEAD] will be your content reviewer :)

Some other things:
Review this presentation thoroughly (${LINKS.emailPresentation}) — it covers everything you need to do during your trial and how we work.
I've set you up with Premium access. Log in to anara.com with your email and you'll get sent a code.
Here's a product demo guide (${LINKS.demoGuide}) — go over this after your trial to learn how to show the product in your videos.

Please join the chats using this link: [UNIQUE IG CHAT JOIN LINK]

After your trial, you'll start joining the weekly group meeting on Tuesdays — no need to attend during the trial week.

You can find papers to download and add to your Anara library here: ${LINKS.papersFolder} — or use your own.

Lastly, please fill out this form with your Wise/bank details when you get a chance: ${LINKS.bankForm}

Looking forward to seeing your work!

Best`;
}

export const INTERVIEW_INTRO = `1. Introduce yourself: "Hey XX, thanks for making it to the call! I'm XX, I've been working for Anara for XX — I'm based in XX…"
2. Ask about them: Where are they based? Working or studying? First time doing UGC?
3. Non-compete check: "Before we jump into the slides, we do have a non-competitor clause in the contract — do you currently work for any AI tool targeted to students?"
4. "I'll be sharing my screen now — I've prepared some slides about how we work at Anara. Feel free to interrupt me at any time!"`;

export const INTERVIEW_CLOSE = `"Thank you so much for your time — it was great to meet you! Is this something you'd like to get involved in? We'd love to have you on the team!"
Next steps: "I'll send you an email with all this info, the onboarding steps, product demo guidelines, the contract, and links to join our Instagram chats. Could you drop your full name in the chat now so I have it for the contract?"`;

export const CONTRACT_STEPS = `1. Make a copy of the contract template
2. Replace "CREATOR" with their full name and "START DATE" with their trial start date (start date = day their trial begins)
3. Add their name under the signature field + today's date at the end
4. Date format must be "Jun 14th 2026" — no other variation
5. Save as PDF named "Anara x CREATOR'S NAME"
6. Don't touch the tax column in the tracker — Alba handles that`;

export const IG_SETUP = `1. Create a new IG chat → add the assigned team lead + Laia + @anaralabs
2. Create a join link for the chat (paste it into the onboarding email)
3. Group profile pic: cloud emoji with blue background
4. Send the welcome messages BEFORE the creator joins, then the Celebrations + Announcements chat links, then "Please join these too! :))"`;
