import "./globals.css";

export const metadata = {
  title: "Anara Casting Desk",
  description: "Creator sourcing + onboarding cockpit",
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Casting Desk", statusBarStyle: "black-translucent" },
};

export const viewport = {
  themeColor: "#0E1014",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800;900&family=Spline+Sans+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
