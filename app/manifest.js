export default function manifest() {
  return {
    name: "Anara Casting Desk",
    short_name: "Casting Desk",
    description: "Creator sourcing + onboarding cockpit",
    start_url: "/",
    display: "standalone",
    background_color: "#0E1014",
    theme_color: "#0E1014",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
