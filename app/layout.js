import "./globals.css";

export const metadata = {
  title: "ANARA Hiring HQ",
  description: "Creator sourcing + onboarding cockpit",
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "ANARA Hiring HQ", statusBarStyle: "default" },
};

export const viewport = {
  themeColor: "#F6F7F9",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Spline+Sans+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
